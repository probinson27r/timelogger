const { CardFactory } = require('botbuilder');
const { openaiService } = require('../services/openaiService');
const configHandler = require('./configHandler');
const { 
  getUserSession, 
  getUserSessionById,
  createUserSession, 
  updateUserSessionById, 
  deleteUserSession,
  deleteUserSessionById 
} = require('../services/databaseAdapter');
const dateParser = require('../utils/dateParser');
const { getIconSet } = require('../utils/iconConfig');
const { formatAsAdaptiveCard } = require('../utils/teamsFormatter');
const logger = require('../utils/logger');
const moment = require('moment');

class TeamsMessageHandler {
  /**
   * Handle incoming Teams messages
   */
  async handleMessage(context) {
    const userId = context.activity.from.id;
    const text = context.activity.text;
    
    try {
      // Skip empty messages
      if (!text || !text.trim()) {
        return;
      }

      logger.info('Processing Teams message:', { userId, text });

      // Check for help requests
      if (text.toLowerCase().includes('help')) {
        return await this.sendHelpMessage(context, userId);
      }

      // Check if user has configured Jira access
      const isConfigured = await configHandler.isUserConfigured(userId, 'teams');
      if (!isConfigured) {
        return await this.sendConfigurationPrompt(context, userId);
      }

      // Use OpenAI to parse the user's intent
      const intent = await openaiService.parseIntent(text);
      
      if (intent.intent === 'log_time') {
        await this.handleTimeLoggingIntent(intent, userId, context);
      } else if (intent.intent === 'get_time_report') {
        await this.handleTimeReportingIntent(intent, userId, context);
      } else if (intent.intent === 'get_my_tickets') {
        await this.handleTicketInquiryIntent(intent, userId, context);
      } else if (intent.intent === 'get_ticket_details') {
        await this.handleTicketInquiryIntent(intent, userId, context);
      } else if (intent.intent === 'search_tickets') {
        await this.handleTicketInquiryIntent(intent, userId, context);
      } else if (intent.intent === 'help') {
        await this.sendHelpMessage(context, userId);
      } else {
        // Handle unclear intent or ask for clarification
        if (intent.clarification_needed) {
          await context.sendActivity({
            type: 'message',
            text: `${await getIconSet(userId, 'teams').then(icons => icons.question)}${intent.clarification_needed}`
          });
        } else {
          await this.sendHelpMessage(context, userId);
        }
      }
    } catch (error) {
      logger.error('Error handling Teams message:', error);
      const icons = await getIconSet(userId, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error processing your request.`
      });
    }
  }

  /**
   * Handle time logging intent
   */
  async handleTimeLoggingIntent(intent, userId, context) {
    try {
      const icons = await getIconSet(userId, 'teams');
      const jiraService = await configHandler.getUserJiraService(userId, 'teams');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(context, userId);
      }

      let { ticket_key: ticketKey, hours, description, date: dateString } = intent.parameters;

      // Parse date if provided
      let parsedDate = null;
      if (dateString) {
        const dateResult = dateParser.parseDate(dateString);
        if (!dateResult.isValid) {
          await context.sendActivity({
            type: 'message',
            text: `${icons.error}I couldn't understand the date "${dateString}". Please use formats like "yesterday", "last Friday", or "July 1st".`
          });
          return;
        }
        
        parsedDate = dateResult; // Keep the full result object
        
        // Check if date is in the future
        if (parsedDate.date && parsedDate.date.isAfter(moment(), 'day')) {
          await context.sendActivity({
            type: 'message',
            text: `${icons.error}Cannot log time for future dates. Please specify a past date.`
          });
          return;
        }
      }

      // If no ticket specified, show ticket selection
      if (!ticketKey) {
        const tickets = await jiraService.getMyAssignedTickets();
        
        if (tickets.length === 0) {
          await context.sendActivity({
            type: 'message',
            text: `${icons.error}No assigned tickets found. Please make sure you have tickets assigned in Jira.`
          });
          return;
        }

        // Create session for multi-step interaction
        const sessionId = await createUserSession(userId, 'teams', 'AWAITING_TICKET_SELECTION', {
          hours,
          description,
          parsedDate: parsedDate ? parsedDate.iso : null,
          dateString
        });

        const dateText = parsedDate ? ` on ${parsedDate.formatted}` : '';
        
        const card = formatAsAdaptiveCard({
          title: `${icons.ticket}Log ${hours} hours${dateText}`,
          subtitle: 'Select a ticket:',
          items: tickets.slice(0, 10).map(ticket => ({
            title: ticket.key,
            subtitle: ticket.summary,
            value: JSON.stringify({ action: 'select_ticket', ticketKey: ticket.key, sessionId })
          }))
        });

        await context.sendActivity({
          type: 'message',
          attachments: [CardFactory.adaptiveCard(card)]
        });
        return;
      }

      // Use provided description or leave empty

      // Create confirmation
      const sessionId = await createUserSession(userId, 'teams', 'AWAITING_CONFIRMATION', {
        ticketKey,
        hours,
        description,
        parsedDate: parsedDate ? parsedDate.iso : null,
        dateString
      });

      const dateStr = parsedDate && parsedDate.date ? new Date(parsedDate.date).toLocaleDateString() : 'today';
      
      const fields = [
        { name: 'Ticket', value: ticketKey },
        { name: 'Hours', value: hours.toString() },
        { name: 'Date', value: dateStr }
      ];
      
      if (description) {
        fields.push({ name: 'Description', value: description });
      }
      
      const card = formatAsAdaptiveCard({
        title: `${icons.time}Confirm Time Log`,
        subtitle: `Log ${hours} hours to ${ticketKey} on ${dateStr}`,
        fields,
        actions: [
          { title: 'Confirm', value: JSON.stringify({ action: 'confirm_log', sessionId }) },
          { title: 'Cancel', value: JSON.stringify({ action: 'cancel_log', sessionId }) }
        ]
      });

      await context.sendActivity({
        type: 'message',
        attachments: [CardFactory.adaptiveCard(card)]
      });
      
    } catch (error) {
      logger.error('Error in time logging intent:', error);
      const icons = await getIconSet(userId, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error processing your time logging request.`
      });
    }
  }

  /**
   * Handle time reporting intent
   */
  async handleTimeReportingIntent(intent, userId, context) {
    try {
      const icons = await getIconSet(userId, 'teams');
      const jiraService = await configHandler.getUserJiraService(userId, 'teams');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(context, userId);
      }

      const { period } = intent.parameters;
      
      const reportData = await jiraService.getMyTimeReports(period);
      
      if (reportData.totalHours === 0) {
        await context.sendActivity({
          type: 'message',
          text: `${icons.reports}No time logged for ${period}.`
        });
        return;
      }

      const card = formatAsAdaptiveCard({
        title: `${icons.reports}Time Report - ${period}`,
        subtitle: `Total Hours: ${reportData.totalHours}`,
        items: Object.entries(reportData.worklogsByTicket).map(([ticketKey, data]) => ({
          title: `${icons.ticket}${ticketKey}`,
          subtitle: `${data.hours}h - ${data.summary}`,
          value: ticketKey
        }))
      });

      await context.sendActivity({
        type: 'message',
        attachments: [CardFactory.adaptiveCard(card)]
      });
      
    } catch (error) {
      logger.error('Error in time reporting intent:', error);
      const icons = await getIconSet(userId, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error generating your time report.`
      });
    }
  }

  /**
   * Handle ticket inquiry intent
   */
  async handleTicketInquiryIntent(intent, userId, context) {
    try {
      const icons = await getIconSet(userId, 'teams');
      const jiraService = await configHandler.getUserJiraService(userId, 'teams');
      
      if (!jiraService) {
        return await this.sendConfigurationPrompt(context, userId);
      }

      const tickets = await jiraService.getMyAssignedTickets();
      
      if (tickets.length === 0) {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}No assigned tickets found.`
        });
        return;
      }

      const card = formatAsAdaptiveCard({
        title: `${icons.tickets}Your Assigned Tickets`,
        subtitle: `${tickets.length} tickets found`,
        items: tickets.slice(0, 10).map(ticket => ({
          title: `${icons.ticket}${ticket.key}`,
          subtitle: `${ticket.summary} - ${ticket.status}`,
          value: JSON.stringify({ action: 'quick_log', ticketKey: ticket.key })
        }))
      });

      await context.sendActivity({
        type: 'message',
        attachments: [CardFactory.adaptiveCard(card)]
      });
      
    } catch (error) {
      logger.error('Error in ticket inquiry intent:', error);
      const icons = await getIconSet(userId, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error retrieving your tickets.`
      });
    }
  }

  /**
   * Handle button/action submissions
   */
  async handleSubmitAction(context) {
    try {
      const userId = context.activity.from.id;
      const icons = await getIconSet(userId, 'teams');
      const data = JSON.parse(context.activity.value);
      
      if (data.action === 'select_ticket') {
        await this.handleTicketSelection(context, data);
      } else if (data.action === 'confirm_log') {
        await this.handleTimeLogging(context, data, true);
      } else if (data.action === 'cancel_log') {
        await this.handleTimeLogging(context, data, false);
      } else if (data.action === 'quick_log') {
        await this.handleQuickLog(context, data);
      }
      
    } catch (error) {
      logger.error('Error handling Teams action:', error);
      const userId = context.activity.from.id;
      const icons = await getIconSet(userId, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error processing your action.`
      });
    }
  }

  /**
   * Handle ticket selection
   */
  async handleTicketSelection(context, data) {
    const userId = context.activity.from.id;
    const icons = await getIconSet(userId, 'teams');
    const { ticketKey, sessionId } = data;

    const session = await getUserSessionById(sessionId);
    if (!session) {
      await context.sendActivity({
        type: 'message',
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
      parsedDate: parsedDate ? parsedDate.iso : null,
      dateString
    });

    const dateStr = parsedDate && parsedDate.date ? new Date(parsedDate.date).toLocaleDateString() : 'today';
    
    const fields = [
      { name: 'Ticket', value: ticketKey },
      { name: 'Hours', value: hours.toString() },
      { name: 'Date', value: dateStr }
    ];
    
    if (finalDescription) {
      fields.push({ name: 'Description', value: finalDescription });
    }
    
    const card = formatAsAdaptiveCard({
      title: `${icons.time}Confirm Time Log`,
      subtitle: `Log ${hours} hours to ${ticketKey} on ${dateStr}`,
      fields,
      actions: [
        { title: 'Confirm', value: JSON.stringify({ action: 'confirm_log', sessionId }) },
        { title: 'Cancel', value: JSON.stringify({ action: 'cancel_log', sessionId }) }
      ]
    });

    await context.sendActivity({
      type: 'message',
      attachments: [CardFactory.adaptiveCard(card)]
    });
  }

  /**
   * Handle time logging confirmation
   */
  async handleTimeLogging(context, data, confirmed) {
    const userId = context.activity.from.id;
    const icons = await getIconSet(userId, 'teams');
    const jiraService = await configHandler.getUserJiraService(userId, 'teams');
    
    if (!jiraService) {
      return await this.sendConfigurationPrompt(context, userId);
    }

    const { sessionId } = data;
    const session = await getUserSessionById(sessionId);
    
    if (!session) {
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Session expired. Please try again.`
      });
      return;
    }

    if (!confirmed) {
      await deleteUserSessionById(sessionId);
      await context.sendActivity({
        type: 'message',
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
      const fields = [
        { name: 'Ticket', value: ticketKey },
        { name: 'Hours', value: hours.toString() },
        { name: 'Date', value: dateStr }
      ];
      
      if (description) {
        fields.push({ name: 'Description', value: description });
      }
      
      const card = formatAsAdaptiveCard({
        title: `${icons.success}Time Logged Successfully!`,
        subtitle: `${hours} hours logged to ${ticketKey} on ${dateStr}`,
        fields
      });

      await context.sendActivity({
        type: 'message',
        attachments: [CardFactory.adaptiveCard(card)]
      });
    } else {
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Failed to log time: ${result.error}`
      });
    }
  }

  /**
   * Handle quick log action
   */
  async handleQuickLog(context, data) {
    const userId = context.activity.from.id;
    const icons = await getIconSet(userId, 'teams');
    const { ticketKey } = data;

    const card = formatAsAdaptiveCard({
      title: `${icons.time}Quick Log Time`,
      subtitle: `Log time to ${ticketKey}`,
      fields: [
        { name: 'Ticket', value: ticketKey }
      ],
      actions: [
        { title: '15 minutes', value: JSON.stringify({ action: 'log_time', ticketKey, hours: 0.25 }) },
        { title: '30 minutes', value: JSON.stringify({ action: 'log_time', ticketKey, hours: 0.5 }) },
        { title: '1 hour', value: JSON.stringify({ action: 'log_time', ticketKey, hours: 1 }) },
        { title: '2 hours', value: JSON.stringify({ action: 'log_time', ticketKey, hours: 2 }) },
        { title: '4 hours', value: JSON.stringify({ action: 'log_time', ticketKey, hours: 4 }) }
      ]
    });

    await context.sendActivity({
      type: 'message',
      attachments: [CardFactory.adaptiveCard(card)]
    });
  }

  /**
   * Send configuration prompt for unconfigured users
   */
  async sendConfigurationPrompt(context, userId) {
    const icons = await getIconSet(userId, 'teams');
    
    const card = formatAsAdaptiveCard({
      title: `${icons.config}Setup Required`,
      subtitle: 'Configure your Jira access to use the Time Logger bot',
      fields: [
        { 
          name: 'Setup Command', 
          value: 'Use: `/jiraconfig <jira-url> <personal-access-token>`' 
        },
        { 
          name: 'Example', 
          value: '/jiraconfig https://mycompany.atlassian.net abcd1234efgh5678' 
        },
        { 
          name: 'Help', 
          value: 'Create a Personal Access Token in your Jira profile settings' 
        }
      ]
    });

    await context.sendActivity({
      type: 'message',
      attachments: [CardFactory.adaptiveCard(card)]
    });
  }

  /**
   * Send help message
   */
  async sendHelpMessage(context, userId) {
    const icons = await getIconSet(userId, 'teams');
    
    const card = formatAsAdaptiveCard({
      title: `${icons.help}Time Logger Help`,
      subtitle: 'How to use the Time Logger bot',
      fields: [
        { 
          name: 'Natural Language Examples', 
          value: '• "Log 3 hours to PROJ-123"\n• "I worked 2 hours yesterday on bug fixing"\n• "Log 4h to ticket last Friday"' 
        },
        { 
          name: 'Commands', 
          value: '• `/jiraconfig` - Set up your Jira access\n• `/timelog` - Log time to tickets\n• `/mytickets` - Show assigned tickets\n• `/timereport` - Generate time reports' 
        },
        { 
          name: 'Time Formats', 
          value: '"3 hours", "2h", "30 minutes", "45m"' 
        },
        { 
          name: 'Date Formats', 
          value: '"yesterday", "last Friday", "July 1st", "3 days ago"' 
        }
      ]
    });

    await context.sendActivity({
      type: 'message',
      attachments: [CardFactory.adaptiveCard(card)]
    });
  }
}

module.exports = new TeamsMessageHandler();