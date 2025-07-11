// Version: 2025-07-07-03-45-00 - Fixed missing moment import
const logger = require('../utils/logger');
const { databaseService } = require('../services/database');
// Version: 2025-07-07-20:47 - FORCE REFRESH ALL LAMBDA VERSIONS
const { openaiService } = require('../services/openaiService');
const configHandler = require('./configHandler');
const { 
  getUserSession, 
  getUserSessionById,
  createUserSession, 
  updateUserSessionById, 
  deleteUserSession,
  deleteUserSessionById 
} = require('../services/database');
const dateParser = require('../utils/dateParser');
const { getIconSet } = require('../utils/iconConfig');
const moment = require('moment');

class SlashCommandHandler {
  async handleTimeLogCommand({ command, ack, say, client }) {
    await ack();

    try {
      const userId = command.user_id;
      const text = command.text.trim();
      const icons = await getIconSet(userId, 'slack');

      logger.info('Processing timelog command:', { userId, text });

      // Check if user is configured
      const isConfigured = await configHandler.isUserConfigured(userId, 'slack');
      if (!isConfigured) {
        await this.sendConfigurationPrompt(say, userId);
        return;
      }

      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      if (!jiraService) {
        await this.sendConfigurationPrompt(say, userId);
        return;
      }

      if (!text) {
        await this.showTimeLogInterface(userId, say);
        return;
      }

      // Parse the natural language input
      const intent = await openaiService.parseIntent(text);
      
      if (intent.intent === 'log_time') {
        await this.handleTimeLogging(intent, userId, say);
      } else {
        await say({
          text: `${icons.help}I couldn't understand that time log request. Try something like:\n• \`/timelog 3 hours to PROJ-123 working on feature\`\n• \`/timelog 2h yesterday to PROJ-456\`\n• Or just \`/timelog\` to see the interface`,
          response_type: 'ephemeral'
        });
      }

    } catch (error) {
      logger.error('Error handling timelog command:', error);
      const icons = await getIconSet(command.user_id, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your time log. Please try again.`,
        response_type: 'ephemeral'
      });
    }
  }

  async handleMyTicketsCommand({ command, ack, say, client }) {
    await ack();

    try {
      const userId = command.user_id;
      const icons = await getIconSet(userId, 'slack');

      logger.info('Processing mytickets command:', { userId });

      // Check if user is configured
      const isConfigured = await configHandler.isUserConfigured(userId, 'slack');
      if (!isConfigured) {
        await this.sendConfigurationPrompt(say, userId);
        return;
      }

      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      if (!jiraService) {
        await this.sendConfigurationPrompt(say, userId);
        return;
      }

      const tickets = await jiraService.getMyAssignedTickets();

      if (tickets.length === 0) {
        await say({
          text: `${icons.success}You don't have any assigned tickets right now! 🎉`,
          response_type: 'ephemeral'
        });
        return;
      }

      // Create ticket blocks with action buttons
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
        ],
        response_type: 'ephemeral'
      });

    } catch (error) {
      logger.error('Error handling mytickets command:', error);
      const icons = await getIconSet(command.user_id, 'slack');
      await say({
        text: `${icons.error}Sorry, I couldn't fetch your tickets from Jira. Please try again later.`,
        response_type: 'ephemeral'
      });
    }
  }

  async showTimeLogInterface(userId, say) {
    try {
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        await this.sendConfigurationPrompt(say, userId);
        return;
      }

      const tickets = await jiraService.getMyAssignedTickets();

      if (tickets.length === 0) {
        await say({
          text: `${icons.error}You don't have any assigned tickets to log time to.`,
          response_type: 'ephemeral'
        });
        return;
      }

      // Create ticket options for select menu
      const ticketOptions = tickets.slice(0, 25).map(ticket => ({
        text: {
          type: 'plain_text',
          text: `${ticket.key} - ${ticket.summary.substring(0, 75)}`
        },
        value: ticket.key
      }));

      // Create time options
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
        text: "Quick Time Logger",
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${icons.timer}Quick Time Logger` }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.info}Select a ticket and time duration to log:`
            }
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.ticket}*Select Ticket:*`
            },
            accessory: {
              type: 'static_select',
              placeholder: { type: 'plain_text', text: 'Choose a ticket' },
              options: ticketOptions,
              action_id: 'quick_ticket_select'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.time}*Time Duration:*`
            },
            accessory: {
              type: 'static_select',
              placeholder: { type: 'plain_text', text: 'Select time' },
              options: timeOptions,
              action_id: 'quick_time_select'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.help}*Or use natural language:*\n• \`/timelog 2.5 hours to ABC-123 working on login fix\`\n• \`/timelog 3h yesterday to DEF-456\`\n• \`/timelog 1 hour last Friday\``
            }
          }
        ],
        response_type: 'ephemeral'
      });

    } catch (error) {
      logger.error('Error showing time log interface:', error);
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error showing the time log interface.`,
        response_type: 'ephemeral'
      });
    }
  }

  async handleTimeLogging(intent, userId, say) {
    const { hours, ticket_key, description, date } = intent.parameters;
    const icons = await getIconSet(userId, 'slack');

    if (!hours) {
      await say({
        text: "Please specify how many hours you'd like to log. Example: `/timelog 3 hours to ABC-123` or `/timelog 2h yesterday`",
        response_type: 'ephemeral'
      });
      return;
    }

    // Check if user is configured
    const isConfigured = await configHandler.isUserConfigured(userId, 'slack');
    if (!isConfigured) {
      await this.sendConfigurationPrompt(say, userId);
      return;
    }

    const jiraService = await configHandler.getUserJiraService(userId, 'slack');
    if (!jiraService) {
      await this.sendConfigurationPrompt(say, userId);
      return;
    }

    // Parse date if provided
    let parsedDate = null;
    let dateInfo = null;
    if (date) {
      dateInfo = dateParser.parseDate(date);
      if (!dateInfo.isValid) {
        await say({ 
          text: `I couldn't understand the date "${date}". Please try again with a date like "yesterday", "last Friday", or "July 1st".`,
          response_type: 'ephemeral'
        });
        return;
      }
      // Convert moment object to Date object for Jira service
      parsedDate = dateInfo.date ? dateInfo.date.toDate() : null;
      
      // Check if date is in the future
      if (!dateInfo.isPast && !dateInfo.isToday) {
        await say({ 
          text: `I can only log time for today or past dates. "${dateInfo.displayText}" appears to be in the future.`,
          response_type: 'ephemeral'
        });
        return;
      }
    }

    if (!ticket_key) {
      // Store session and ask for ticket selection
      const sessionData = { 
        hours, 
        description, 
        date: parsedDate ? parsedDate.iso : null,
        dateFormatted: dateInfo ? dateInfo.displayText : null,
        source: 'slash_command' 
      };
      await databaseService.createUserSession(
        userId, 
        'pending_time_log', 
        sessionData, 
        moment().add(15, 'minutes').toISOString()
      );

      const tickets = await jiraService.getMyAssignedTickets();

      const ticketOptions = tickets.slice(0, 25).map(ticket => ({
        text: {
          type: 'plain_text',
          text: `${ticket.key}: ${ticket.summary.substring(0, 60)}${ticket.summary.length > 60 ? '...' : ''}`
        },
        value: ticket.key
      }));

      const dateText = dateInfo ? ` for ${dateInfo.displayText}` : '';

      await say({
        text: `Which ticket would you like to log ${hours} hours${dateText} to?`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Log ${hours} hours${dateText}*\nSelect a ticket:`
            },
            accessory: {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Choose a ticket'
              },
              options: ticketOptions,
              action_id: 'ticket_select'
            }
          }
        ],
        response_type: 'ephemeral'
      });
      return;
    }

    // Log time directly
    await this.logTimeToTicket(userId, ticket_key, hours, description, parsedDate, dateInfo, say);
  }

  async logTimeToTicket(userId, ticketKey, hours, description, parsedDate, dateInfo, say) {
    try {
      logger.info('[DEBUG] logTimeToTicket called with:', { userId, ticketKey, hours, description, parsedDate, dateInfo });
      
      const icons = await getIconSet(userId, 'slack');
      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      
      if (!jiraService) {
        await say({
          text: `${icons.error}Jira service not configured. Please run /jiraconfig first.`,
          response_type: 'ephemeral'
        });
        return;
      }

      // Get ticket details
      logger.info('[DEBUG] Getting ticket details for:', ticketKey);
      const ticket = await jiraService.getTicket(ticketKey);
      logger.info('[DEBUG] Ticket details:', { summary: ticket.summary });
      
      // Generate description if not provided
      let workDescription = description;
      if (!workDescription) {
        logger.info('[DEBUG] Generating work description');
        workDescription = await openaiService.generateWorkDescription(ticket.summary, hours);
      }

      // Ensure parsedDate is always a valid moment object
      if (!parsedDate || !parsedDate.date) {
        parsedDate = {
          date: moment(),
          formatted: moment().format('YYYY-MM-DD'),
          iso: moment().toISOString(),
        };
      }

      // Log work to Jira using UserJiraService API
      logger.info('[DEBUG] Logging work to Jira:', { ticketKey, hours, workDescription, parsedDate });
      const result = await jiraService.logWork(ticketKey, hours, workDescription, parsedDate.date);
      logger.info('[DEBUG] Jira logWork result:', result);

      if (!result.success) {
        throw new Error(result.error);
      }

      // Store in database (optional - could be added later)
      const logDate = parsedDate ? parsedDate.formatted : moment().format('YYYY-MM-DD');
      
      const dateText = logDate !== moment().format('YYYY-MM-DD') ? ` for ${logDate}` : '';

      await say({
        text: `${icons.success}Successfully logged ${hours} hours to ${ticketKey}${dateText}!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icons.success}*Time Logged Successfully*\n\n*Ticket:* ${ticketKey}\n*Time:* ${hours} hours\n*Date:* ${logDate}\n*Description:* ${workDescription}\n*Summary:* ${ticket.summary}`
            }
          }
        ],
        response_type: 'ephemeral'
      });

    } catch (error) {
      logger.error('Error logging time to ticket:', error);
      const icons = await getIconSet(userId, 'slack');
      await say({
        text: `${icons.error}Sorry, I couldn't log time to ${ticketKey}. ${error.message}`,
        response_type: 'ephemeral'
      });
    }
  }

  async handleTimeReportCommand({ command, ack, say, client }) {
    await ack();

    try {
      const userId = command.user_id;
      const text = command.text.trim();
      const icons = await getIconSet(userId, 'slack');

      logger.info('Processing timereport command:', { userId, text });

      // Check if user is configured
      const isConfigured = await configHandler.isUserConfigured(userId, 'slack');
      if (!isConfigured) {
        await this.sendConfigurationPrompt(say, userId);
        return;
      }

      const jiraService = await configHandler.getUserJiraService(userId, 'slack');
      if (!jiraService) {
        await this.sendConfigurationPrompt(say, userId);
        return;
      }

      // Parse the period parameter
      let period = 'all';
      if (text) {
        const textLower = text.toLowerCase();
        if (textLower.includes('today')) {
          period = 'today';
        } else if (textLower.includes('week')) {
          period = 'week';
        } else if (textLower.includes('month')) {
          period = 'month';
        } else if (textLower.includes('year')) {
          period = 'year';
        } else {
          // Check for exact matches as fallback
          const validPeriods = ['today', 'week', 'month', 'year'];
          if (validPeriods.includes(textLower)) {
            period = textLower;
          }
        }
      }

      const intent = {
        intent: 'get_time_report',
        parameters: { period }
      };

      // Use the same handler from messageHandler
      const messageHandler = require('./messageHandler');
      await messageHandler.handleTimeReportingIntent(intent, userId, say);

    } catch (error) {
      logger.error('Error handling timereport command:', error);
      const icons = await getIconSet(command.user_id, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error generating your time report. Please try again.`,
        response_type: 'ephemeral'
      });
    }
  }

  async handleIconConfigCommand({ command, ack, say, client }) {
    await ack();

    try {
      const userId = command.user_id;
      const iconSet = command.text.trim().toLowerCase();
      const icons = await getIconSet(userId, 'slack');

      logger.info('Processing iconconfig command:', { userId, iconSet });

      if (!iconSet) {
        // Show current configuration and available options
        const currentIconSet = await getUserIconSet(userId, 'slack');
        const availableSets = getAvailableIconSets();

        const blocks = [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${icons.config}Icon Configuration` }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Current icon set:* ${currentIconSet.name}\n*Description:* ${currentIconSet.description}`
            }
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Available icon sets:*'
            }
          }
        ];

        // Add each available icon set
        availableSets.forEach(set => {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${set.name}* - ${set.description}\nExample: ${set.icons.success} ${set.icons.error} ${set.icons.ticket} ${set.icons.time}`
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: 'Select' },
              action_id: `icon_set_${set.name}`,
              value: set.name
            }
          });
        });

        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `Or use: \`/iconconfig <set-name>\` where set-name is one of: ${availableSets.map(s => s.name).join(', ')}`
          }]
        });

        await say({
          text: 'Icon Configuration',
          blocks,
          response_type: 'ephemeral'
        });
        return;
      }

      // Set the icon set
      const result = await setUserIconSet(userId, 'slack', iconSet);
      
      if (result.success) {
        const newIcons = await getIconSet(userId, 'slack');
        await say({
          text: `${newIcons.success}Icon set changed to "${result.iconSet.name}"!`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${newIcons.success}*Icon Set Updated!*\n\n*Set:* ${result.iconSet.name}\n*Description:* ${result.iconSet.description}\n*Examples:* ${newIcons.success} ${newIcons.error} ${newIcons.ticket} ${newIcons.time} ${newIcons.help}`
              }
            }
          ],
          response_type: 'ephemeral'
        });
      } else {
        await say({
          text: `${icons.error}Invalid icon set "${iconSet}". Available sets: current, large, small, minimal, text, none`,
          response_type: 'ephemeral'
        });
      }

    } catch (error) {
      logger.error('Error handling iconconfig command:', error);
      const icons = await getIconSet(command.user_id, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error updating your icon configuration.`,
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Handle /jiraconfig command
   */
  async handleJiraConfigCommand({ command, ack, say, client }) {
    await ack();

    try {
      const userId = command.user_id;
      const text = command.text.trim();
      const icons = await getIconSet(userId, 'slack');

      logger.info('Processing jiraconfig command:', { userId, text: '***' });

      if (!text) {
        const instructions = configHandler.generateSetupInstructions('slack');
        await say({
          text: "Configure your Jira access",
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${icons.config}*Jira Configuration*\n\nChoose your Jira type:`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${icons.config}*${instructions.cloudInstructions.title}*\n${instructions.cloudInstructions.steps.join('\n')}`
              }
            },
            {
              type: 'divider'
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${icons.config}*${instructions.serverInstructions.title}*\n${instructions.serverInstructions.steps.join('\n')}`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${icons.help}*How to get credentials:*\n• **Jira Cloud**: Create API Token in Atlassian Account Settings\n• **Jira Server**: Create Personal Access Token in Jira profile`
              }
            }
          ],
          response_type: 'ephemeral'
        });
        return;
      }

      // Parse the command arguments
      const args = text.split(' ');
      if (args.length < 2) {
        await say({
          text: `${icons.error}Please provide both Jira URL and access token.\n\n**For Jira Cloud:** \`/jiraconfig <url> <api-token> <email>\`\n**For Jira Server:** \`/jiraconfig <url> <personal-access-token>\``,
          response_type: 'ephemeral'
        });
        return;
      }

      const jiraUrl = args[0];
      const accessToken = args[1];
      const userEmail = args.length >= 3 ? args[2] : null;

      // Validate URL format
      if (!jiraUrl.startsWith('http://') && !jiraUrl.startsWith('https://')) {
        await say({
          text: `${icons.error}Please provide a valid Jira URL starting with http:// or https://`,
          response_type: 'ephemeral'
        });
        return;
      }

      // Auto-detect Jira type and validate parameters
      const jiraType = configHandler.detectJiraType(jiraUrl);
      if (jiraType === 'cloud' && !userEmail) {
        await say({
          text: `${icons.error}Jira Cloud requires your email address.\n\nUsage: \`/jiraconfig ${jiraUrl} ${accessToken} <your-email>\``,
          response_type: 'ephemeral'
        });
        return;
      }

      await say({
        text: `${icons.loading}Testing your ${jiraType === 'cloud' ? 'Jira Cloud' : 'Jira Server'} configuration...`,
        response_type: 'ephemeral'
      });

      // Test and save configuration
      const result = await configHandler.setupUserConfig(userId, 'slack', jiraUrl, accessToken, userEmail);

      if (result.success) {
        const typeMessage = result.jiraType === 'cloud' ? 'Jira Cloud' : 'Jira Server/Data Center';
        await say({
          text: `${icons.success}${typeMessage} configuration saved successfully!`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${icons.success}*${typeMessage} Configuration Saved!*\n\n${icons.url}*Jira URL:* ${jiraUrl}\n${icons.user}*Connected as:* ${result.user.displayName}\n${icons.email}*Email:* ${result.user.emailAddress}`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${icons.info}*What's next?*\n• Try \`/mytickets\` to see your assigned tickets\n• Use \`/timelog\` to log time to tickets\n• Send me natural language messages like "Log 3 hours to PROJ-123"`
              }
            }
          ],
          response_type: 'ephemeral'
        });
      } else {
        await say({
          text: `${icons.error}Failed to configure Jira access: ${result.error}`,
          response_type: 'ephemeral'
        });
      }

    } catch (error) {
      logger.error('Error handling jiraconfig command:', error);
      const icons = await getIconSet(command.user_id, 'slack');
      await say({
        text: `${icons.error}Sorry, I encountered an error processing your configuration.`,
        response_type: 'ephemeral'
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
            text: `${icons.info}To use the Time Logger bot, you need to configure your Jira access first.\n\nUse \`/jiraconfig\` to get started.`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `**${instructions.cloudInstructions.title}**\n${instructions.cloudInstructions.steps.slice(2).join('\n')}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `**${instructions.serverInstructions.title}**\n${instructions.serverInstructions.steps.slice(2).join('\n')}`
          }
        }
      ],
      response_type: 'ephemeral'
    });
  }
}

module.exports = new SlashCommandHandler(); 