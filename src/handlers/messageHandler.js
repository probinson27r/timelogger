const { openaiService } = require('../services/openaiService');
const configHandler = require('./configHandler');
const { 
  getUserSession, 
  getUserSessionById,
  createUserSession, 
  updateUserSessionById, 
  deleteUserSession,
  deleteUserSessionById 
} = require('../services/auroraService');
const dateParser = require('../utils/dateParser');
const { getIconSet } = require('../utils/iconConfig');
const logger = require('../utils/logger');
const moment = require('moment');
const { WebClient } = require('@slack/web-api');

// Version: 2025-07-07-03-45-00 - Fixed date parsing null check error
// Version 12 - Fixed null check for parsedDate.date

class MessageHandler {
  /**
   * Handle incoming Slack messages
   */
  async handleMessage({ message, say, client }) {
    const userId = message.user;
    const text = message.text;
    
    try {
      // Skip bot messages and empty messages
      if (message.subtype === 'bot_message' || !text) {
        return;
      }

      logger.info('Processing Slack message:', { userId, text });

      // Check for help requests
      if (text.toLowerCase().includes('help')) {
        return await this.sendHelpMessage(say, userId);
      }

      // Check if user has configured Jira access
      const isConfigured = await configHandler.isUserConfigured(userId, 'slack');
      if (!isConfigured) {
        return await this.sendConfigurationPrompt(say, userId);
      }

      // Use OpenAI to parse the user's intent
      const intent = await openaiService.parseIntent(text);
      
      if (intent.intent === 'log_time') {
        await this.handleTimeLoggingIntent(intent, userId, say, client);
      } else if (intent.intent === 'get_time_report') {
        await this.handleTimeReportingIntent(intent, userId, say, client);
      } else if (intent.intent === 'get_my_tickets') {
        await this.handleTicketInquiryIntent(intent, userId, say, client);
      } else if (intent.intent === 'get_ticket_details') {
        await this.handleTicketInquiryIntent(intent, userId, say, client);
      } else if (intent.intent === 'search_tickets') {
        await this.handleTicketInquiryIntent(intent, userId, say, client);
      } else if (intent.intent === 'help') {
        await this.sendHelpMessage(say, userId);
      } else {
        // Handle unclear intent or ask for clarification
        if (intent.clarification_needed) {
          await say({
            text: `${await getIconSet(userId, 'slack').then(icons => icons.question)}${intent.clarification_needed}`
          });
        } else {
          await this.sendHelpMessage(say, userId);
        }
      }
    } catch (error) {
      logger.error('Error handling Slack message:', error);
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your request.`
      });
    }
  }

  /**
   * Handle time logging intent
   */
  async handleTimeLoggingIntent(intent, userId, say, client) {
    try {
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(say, userId);
      }

      let { ticket_key: ticketKey, hours, description, date: dateString } = intent.parameters;

      // Parse date if provided
      let parsedDate = null;
      if (dateString) {
        const dateResult = dateParser.parseDate(dateString);
        if (!dateResult.isValid) {
          await say({
            text: `${icons.error}I couldn't understand the date "${dateString}". Please use formats like "yesterday", "last Friday", or "July 1st".`
          });
          return;
        }
        
        parsedDate = dateResult; // Keep the full result object
        
        // Check if date is in the future
        if (parsedDate.date && parsedDate.date.isAfter(moment(), 'day')) {
          await say({
            text: `${icons.error}Cannot log time for future dates. Please specify a past date.`
          });
          return;
        }
      }

      // If no ticket specified, show ticket selection
      if (!ticketKey) {
        const tickets = await jiraService.getMyAssignedTickets();
        
        if (tickets.length === 0) {
          await say({
            text: `${icons.error}No assigned tickets found. Please make sure you have tickets assigned in Jira.`
          });
          return;
        }

        // Create session for multi-step interaction
        const sessionId = await createUserSession(userId, 'slack', 'AWAITING_TICKET_SELECTION', {
          hours,
          description,
          parsedDate: parsedDate ? parsedDate.iso : null,
          dateString
        });

        const ticketOptions = tickets.slice(0, 25).map(ticket => ({
          text: { 
            type: 'plain_text', 
            text: `${ticket.key} - ${ticket.summary.substring(0, 75)}` 
          },
          value: JSON.stringify({ ticketKey: ticket.key, sessionId })
        }));

        const dateText = parsedDate ? ` on ${parsedDate.formatted}` : '';
        
        await say({
          text: `Which ticket would you like to log ${hours} hours${dateText} to?`,
          blocks: [{
            type: 'section',
            text: { 
              type: 'mrkdwn', 
              text: `${icons.ticket}*Log ${hours} hours${dateText}*\nSelect a ticket:` 
            },
            accessory: {
              type: 'static_select',
              placeholder: { type: 'plain_text', text: 'Choose a ticket' },
              options: ticketOptions,
              action_id: 'ticket_select'
            }
          }]
        });
        return;
      }

      // Use provided description or leave empty

      // Create confirmation
      const sessionId = await createUserSession(userId, 'slack', 'AWAITING_CONFIRMATION', {
        ticketKey,
        hours,
        description,
        parsedDate: parsedDate ? parsedDate.iso : null,
        dateString
      });

      const dateStr = parsedDate ? parsedDate.formatted : 'today';
      
      await say({
        text: `Confirm logging ${hours} hours to ${ticketKey} on ${dateStr}?`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.time}*Confirm Time Log*\n*Ticket:* ${ticketKey}\n*Hours:* ${hours}\n*Date:* ${dateStr}${description ? `\n*Description:* ${description}` : ''}`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Confirm' },
                style: 'primary',
                action_id: `log_time_confirm_${sessionId}`,
                value: 'confirm'
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Cancel' },
                action_id: `log_time_cancel_${sessionId}`,
                value: 'cancel'
              }
            ]
          }
        ]
      });
      
    } catch (error) {
      logger.error('Error in time logging intent:', error);
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your time logging request.`
      });
    }
  }

  /**
   * Handle time reporting intent
   */
  async handleTimeReportingIntent(intent, userId, say, client) {
    try {
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(say, userId);
      }

      const { period } = intent.parameters;
      
      const reportData = await jiraService.getMyTimeReports(period);
      
      if (reportData.totalHours === 0) {
        await say({
          text: `${icons.reports}No time logged for ${period}.`
        });
        return;
      }

      // Build report blocks
      const summaryText = `${icons.summary}*Total Hours:* ${reportData.totalHours}`;
      
      const ticketBlocks = Object.entries(reportData.worklogsByTicket).map(([ticketKey, data]) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icons.ticket}*${ticketKey}* - ${data.hours}h\n${data.summary}`
        }
      }));

      await say({
        text: `Time report for ${period}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${icons.reports}Time Report - ${period}` }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: summaryText }
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `${icons.details}*Details:*` }
          },
          ...ticketBlocks
        ]
      });
      
    } catch (error) {
      logger.error('Error in time reporting intent:', error);
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error generating your time report.`
      });
    }
  }

  /**
   * Handle ticket inquiry intent
   */
  async handleTicketInquiryIntent(intent, userId, say, client) {
    try {
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(say, userId);
      }

      const tickets = await jiraService.getMyAssignedTickets();
      
      if (tickets.length === 0) {
        await say({
          text: `${icons.error}No assigned tickets found.`
        });
        return;
      }

      const ticketBlocks = tickets.slice(0, 10).map(ticket => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icons.ticket}*${ticket.key}* - ${ticket.summary}\n${icons.status}${ticket.status} | ${icons.priority}${ticket.priority}`
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Log Time' },
          action_id: `quick_log_${ticket.key}`,
          value: ticket.key
        }
      }));

      await say({
        text: `Your assigned tickets (${tickets.length} total)`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${icons.tickets}Your Assigned Tickets` }
          },
          { type: 'divider' },
          ...ticketBlocks
        ]
      });
      
    } catch (error) {
      logger.error('Error in ticket inquiry intent:', error);
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error retrieving your tickets.`
      });
    }
  }

  /**
   * Handle ticket selection from dropdown
   */
  async handleTicketSelection({ body, ack, say, client }) {
    await ack();
    
    try {
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      
      const selectedValue = JSON.parse(body.actions[0].selected_option.value);
      const { ticketKey, sessionId } = selectedValue;

      const session = await getUserSessionById(sessionId);
      if (!session) {
        await say({
          text: `${icons.error}Session expired. Please try again.`
        });
        return;
      }

      const { hours, description, parsedDate, dateString } = session.session_data;
      
      // Use provided description or leave empty
      let finalDescription = description;

      // Update session with selected ticket
      await updateUserSessionById(sessionId, 'AWAITING_CONFIRMATION', {
        ticketKey,
        hours,
        description: finalDescription,
        parsedDate,
        dateString
      });

      // Fix date parsing issue
      let dateStr = 'today';
      if (parsedDate && parsedDate !== 'null' && parsedDate !== null) {
        try {
          const parsedDateObj = new Date(parsedDate);
          if (!isNaN(parsedDateObj.getTime())) {
            dateStr = parsedDateObj.toLocaleDateString();
          }
        } catch (error) {
          // Keep default 'today' if parsing fails
        }
      }
      
      await say({
        text: `Confirm logging ${hours} hours to ${ticketKey} on ${dateStr}?`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.time}*Confirm Time Log*\n*Ticket:* ${ticketKey}\n*Hours:* ${hours}\n*Date:* ${dateStr}${finalDescription ? `\n*Description:* ${finalDescription}` : ''}`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Confirm' },
                style: 'primary',
                action_id: `log_time_confirm_${sessionId}`,
                value: 'confirm'
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Cancel' },
                action_id: `log_time_cancel_${sessionId}`,
                value: 'cancel'
              }
            ]
          }
        ]
      });
      
    } catch (error) {
      logger.error('Error handling ticket selection:', error);
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your ticket selection.`
      });
    }
  }

  /**
   * Handle time logging confirmation
   */
  async handleTimeLogging({ body, ack, say, client }) {
    await ack();
    
    try {
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(say, userId);
      }

      const actionId = body.actions[0].action_id;
      const sessionId = actionId.replace(/^log_time_(confirm|cancel)_/, '');
      const confirmed = body.actions[0].value === 'confirm';

      const session = await getUserSessionById(sessionId);
      if (!session) {
        await say({
          text: `${icons.error}Session expired. Please try again.`
        });
        return;
      }

      if (!confirmed) {
        await deleteUserSessionById(sessionId);
        await say({
          text: `${icons.cancelled}Time logging cancelled.`
        });
        return;
      }

      const { ticketKey, hours, description, parsedDate } = session.session_data;
      
      // Log the time - fix date parsing issue
      let worklogDate;
      if (parsedDate && parsedDate !== 'null' && parsedDate !== null) {
        try {
          worklogDate = new Date(parsedDate);
          // Check if the date is valid
          if (isNaN(worklogDate.getTime())) {
            worklogDate = new Date();
          }
        } catch (error) {
          worklogDate = new Date();
        }
      } else {
        worklogDate = new Date();
      }
      
      const result = await jiraService.logWork(ticketKey, hours, description, worklogDate);
      
      await deleteUserSessionById(sessionId);
      
      if (result.success) {
        const dateStr = worklogDate.toLocaleDateString();
        await say({
          text: `${icons.success}Successfully logged ${hours} hours to ${ticketKey} on ${dateStr}`,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.success}*Time Logged Successfully!*\n*Ticket:* ${ticketKey}\n*Hours:* ${hours}\n*Date:* ${dateStr}${description ? `\n*Description:* ${description}` : ''}`
            }
          }]
        });
      } else {
        await say({
          text: `${icons.error}Failed to log time: ${result.error}`
        });
      }
      
    } catch (error) {
      logger.error('Error handling time logging:', error);
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error logging your time.`
      });
    }
  }

  /**
   * Send configuration prompt for unconfigured users
   */
  async sendConfigurationPrompt(say, userId) {
    const icons = await getIconSet(userId, 'slack');
    const instructions = configHandler.generateSetupInstructions('slack');
    
    await say({
      text: "You need to configure your Jira access first.",
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${icons.config}Setup Required` }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${icons.info}To use the Time Logger bot, you need to configure your Jira access first.\n\nUse: \`/jiraconfig <jira-url> <personal-access-token>\`\n\nExample: \`/jiraconfig https://mycompany.atlassian.net abcd1234efgh5678\``
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${icons.help}*Need help?*\n• Your Jira URL: \`https://yourcompany.atlassian.net\`\n• Create a Personal Access Token in your Jira profile settings\n• Your token is encrypted and stored securely`
          }
        }
      ]
    });
  }

  /**
   * Handle quick log button clicks from ticket lists
   */
  async handleQuickLog({ body, ack, say, client }) {
    await ack();
    
    try {
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      const actionId = body.actions[0].action_id;
      const ticketKey = actionId.replace('quick_log_', '');

      // Create session for quick time selection
      const sessionId = await createUserSession(userId, 'slack', 'AWAITING_QUICK_TIME', {
        ticketKey,
        source: 'quick_log'
      });

      // Show time selection options
      const timeOptions = [
        { text: { type: 'plain_text', text: '15 minutes' }, value: '0.25' },
        { text: { type: 'plain_text', text: '30 minutes' }, value: '0.5' },
        { text: { type: 'plain_text', text: '1 hour' }, value: '1' },
        { text: { type: 'plain_text', text: '1.5 hours' }, value: '1.5' },
        { text: { type: 'plain_text', text: '2 hours' }, value: '2' },
        { text: { type: 'plain_text', text: '3 hours' }, value: '3' },
        { text: { type: 'plain_text', text: '4 hours' }, value: '4' },
        { text: { type: 'plain_text', text: '8 hours' }, value: '8' }
      ];

      await say({
        text: `Log time to ${ticketKey}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.time}*Log time to ${ticketKey}*\nSelect duration:`
            },
            accessory: {
              type: 'static_select',
              placeholder: { type: 'plain_text', text: 'Select time' },
              options: timeOptions,
              action_id: `quick_time_confirm_${sessionId}`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Cancel' },
                action_id: `quick_log_cancel_${sessionId}`,
                value: 'cancel'
              }
            ]
          }
        ],
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      logger.error('Error handling quick log:', error);
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your quick log request.`,
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Handle quick time confirmation
   */
  async handleQuickTimeConfirm({ body, ack, say, client }) {
    await ack();
    
    try {
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(say, userId);
      }

      const actionId = body.actions[0].action_id;
      const sessionId = actionId.replace('quick_time_confirm_', '');
      const selectedValue = body.actions[0].selected_option?.value;

      if (!selectedValue) {
        await say({
          text: `${icons.error}Please select a time duration.`,
          response_type: 'ephemeral'
        });
        return;
      }

      const session = await getUserSessionById(sessionId);
      if (!session) {
        await say({
          text: `${icons.error}Session expired. Please try again.`,
          response_type: 'ephemeral'
        });
        return;
      }

      const { ticketKey } = session.session_data;
      const hours = parseFloat(selectedValue);
      
      // Log the time directly
      const result = await jiraService.logWork(ticketKey, hours, '', new Date());
      
      await deleteUserSessionById(sessionId);
      
      if (result.success) {
        await say({
          text: `${icons.success}Successfully logged ${hours} hours to ${ticketKey}!`,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.success}*Time Logged Successfully!*\n*Ticket:* ${ticketKey}\n*Hours:* ${hours}\n*Date:* Today`
            }
          }],
          response_type: 'ephemeral'
        });
      } else {
        await say({
          text: `${icons.error}Failed to log time: ${result.error}`,
          response_type: 'ephemeral'
        });
      }
      
    } catch (error) {
      logger.error('Error handling quick time confirm:', error);
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error logging your time: ${error.message}`,
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Handle quick log cancellation
   */
  async handleQuickLogCancel({ body, ack, say, client }) {
    await ack();
    
    try {
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      const actionId = body.actions[0].action_id;
      const sessionId = actionId.replace('quick_log_cancel_', '');

      await deleteUserSessionById(sessionId);
      
      await say({
        text: `${icons.cancelled}Time logging cancelled.`,
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      logger.error('Error handling quick log cancel:', error);
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error cancelling the operation.`,
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Handle quick ticket selection from the time log interface
   */
  async handleQuickTicketSelect({ body, ack, say, client }) {
    await ack();
    
    try {
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      const selectedTicket = body.actions[0].selected_option?.value;

      if (!selectedTicket) {
        await say({
          text: `${icons.error}Please select a ticket.`,
          response_type: 'ephemeral'
        });
        return;
      }

      // Create session for this ticket selection
      const sessionId = await createUserSession(userId, 'slack', 'AWAITING_QUICK_TIME', {
        ticketKey: selectedTicket,
        source: 'quick_interface'
      });

      // Show time selection options
      const timeOptions = [
        { text: { type: 'plain_text', text: '15 minutes' }, value: '0.25' },
        { text: { type: 'plain_text', text: '30 minutes' }, value: '0.5' },
        { text: { type: 'plain_text', text: '1 hour' }, value: '1' },
        { text: { type: 'plain_text', text: '1.5 hours' }, value: '1.5' },
        { text: { type: 'plain_text', text: '2 hours' }, value: '2' },
        { text: { type: 'plain_text', text: '3 hours' }, value: '3' },
        { text: { type: 'plain_text', text: '4 hours' }, value: '4' },
        { text: { type: 'plain_text', text: '8 hours' }, value: '8' }
      ];

      await say({
        text: `Log time to ${selectedTicket}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.time}*Log time to ${selectedTicket}*\nSelect duration:`
            },
            accessory: {
              type: 'static_select',
              placeholder: { type: 'plain_text', text: 'Select time' },
              options: timeOptions,
              action_id: `quick_time_confirm_${sessionId}`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Cancel' },
                action_id: `quick_log_cancel_${sessionId}`,
                value: 'cancel'
              }
            ]
          }
        ],
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      logger.error('Error handling quick ticket select:', error);
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your ticket selection.`,
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Handle quick time selection from the time log interface
   */
  async handleQuickTimeSelect({ body, ack, say, client }) {
    await ack();
    
    try {
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(say, userId);
      }

      const selectedTime = body.actions[0].selected_option?.value;

      if (!selectedTime) {
        await say({
          text: `${icons.error}Please select a time duration.`,
          response_type: 'ephemeral'
        });
        return;
      }

      // This requires both ticket and time to be selected in the quick interface
      // For now, we'll show an error asking them to select a ticket first
      await say({
        text: `${icons.info}Please select a ticket first, then choose the time duration.`,
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      logger.error('Error handling quick time select:', error);
      const userId = body.user.id;
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your time selection.`,
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Send help message
   */
  async sendHelpMessage(say, userId) {
    const icons = await getIconSet(userId, 'slack');
    
    await say({
      text: "Time Logger Help",
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${icons.help}Time Logger Help` }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${icons.info}*Natural Language Examples:*\n• "Log 3 hours to PROJ-123"\n• "I worked 2 hours yesterday on bug fixing"\n• "Log 4h to ticket last Friday"\n• "How many hours did I log today?"\n• "Show me my time report for this week"`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${icons.config}*Commands:*\n• \`/jiraconfig\` - Set up your Jira access\n• \`/timelog\` - Log time to tickets\n• \`/mytickets\` - Show assigned tickets\n• \`/timereport\` - Generate time reports\n• \`/iconconfig\` - Configure icon display`
          }
        }
      ]
    });
  }
}

module.exports = new MessageHandler(); 