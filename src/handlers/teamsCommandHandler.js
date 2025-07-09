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

class TeamsCommandHandler {
  /**
   * Handle /jiraconfig command
   */
  async handleJiraConfigCommand(context, args) {
    try {
      const userId = context.activity.from.id;
      const icons = await getIconSet(userId, 'teams');

      logger.info('Processing Teams jiraconfig command:', { userId, args: '***' });

      if (!args || args.length < 2) {
        const instructions = configHandler.generateSetupInstructions('teams');
        const card = formatAsAdaptiveCard({
          title: `${icons.config}Jira Configuration`,
          subtitle: 'Choose your Jira type and configure access',
          fields: [
            { 
              name: instructions.cloudInstructions.title, 
              value: instructions.cloudInstructions.steps.join('\n') 
            },
            { 
              name: instructions.serverInstructions.title, 
              value: instructions.serverInstructions.steps.join('\n') 
            },
            { 
              name: 'How to get credentials', 
              value: '• **Jira Cloud**: Create API Token in Atlassian Account Settings\n• **Jira Server**: Create Personal Access Token in Jira profile' 
            }
          ]
        });

        await context.sendActivity({
          type: 'message',
          attachments: [CardFactory.adaptiveCard(card)]
        });
        return;
      }

      const jiraUrl = args[0];
      const accessToken = args[1];
      const userEmail = args.length >= 3 ? args[2] : null;

      // Validate URL format
      if (!jiraUrl.startsWith('http://') && !jiraUrl.startsWith('https://')) {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}Please provide a valid Jira URL starting with http:// or https://`
        });
        return;
      }

      // Auto-detect Jira type and validate parameters
      const jiraType = configHandler.detectJiraType(jiraUrl);
      if (jiraType === 'cloud' && !userEmail) {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}Jira Cloud requires your email address.\n\nUsage: /jiraconfig ${jiraUrl} ${accessToken} <your-email>`
        });
        return;
      }

      await context.sendActivity({
        type: 'message',
        text: `${icons.loading}Testing your ${jiraType === 'cloud' ? 'Jira Cloud' : 'Jira Server'} configuration...`
      });

      // Test and save configuration
      const result = await configHandler.setupUserConfig(userId, 'teams', jiraUrl, accessToken, userEmail);

      if (result.success) {
        const typeMessage = result.jiraType === 'cloud' ? 'Jira Cloud' : 'Jira Server/Data Center';
        const card = formatAsAdaptiveCard({
          title: `${icons.success}${typeMessage} Configuration Saved!`,
          subtitle: 'Your Jira access has been configured',
          fields: [
            { name: 'Jira URL', value: jiraUrl },
            { name: 'Connected as', value: result.user.displayName },
            { name: 'Email', value: result.user.emailAddress },
            { name: 'Type', value: typeMessage }
          ]
        });

        await context.sendActivity({
          type: 'message',
          attachments: [CardFactory.adaptiveCard(card)]
        });

        // Send what's next card
        const nextCard = formatAsAdaptiveCard({
          title: `${icons.info}What's next?`,
          subtitle: 'You can now use all Time Logger features',
          fields: [
            { name: 'Commands', value: '• Try `/mytickets` to see your assigned tickets\n• Use `/timelog` to log time to tickets\n• Send natural language messages like "Log 3 hours to PROJ-123"' }
          ]
        });

        await context.sendActivity({
          type: 'message',
          attachments: [CardFactory.adaptiveCard(nextCard)]
        });
      } else {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}Failed to configure Jira access: ${result.error}`
        });
      }

    } catch (error) {
      logger.error('Error handling Teams jiraconfig command:', error);
      const icons = await getIconSet(context.activity.from.id, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error processing your configuration.`
      });
    }
  }

  /**
   * Handle /timelog command
   */
  async handleTimeLogCommand(context, args) {
    try {
      const userId = context.activity.from.id;
      const icons = await getIconSet(userId, 'teams');
      const text = args.join(' ');

      logger.info('Processing Teams timelog command:', { userId, text });

      // Check if user is configured
      const isConfigured = await configHandler.isUserConfigured(userId, 'teams');
      if (!isConfigured) {
        await this.sendConfigurationPrompt(context, userId);
        return;
      }

      if (!text.trim()) {
        await this.showTimeLogInterface(context, userId);
        return;
      }

      // Parse the command text using OpenAI
      const intent = await openaiService.parseIntent(text);
      
      if (intent.intent === 'log_time') {
        await this.handleTimeLogging(context, intent, userId);
      } else {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}Please specify what you'd like to log. Example: '/timelog 3 hours to ABC-123'`
        });
      }

    } catch (error) {
      logger.error('Error handling Teams timelog command:', error);
      const icons = await getIconSet(context.activity.from.id, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error processing your command.`
      });
    }
  }

  /**
   * Handle /mytickets command
   */
  async handleMyTicketsCommand(context, args) {
    try {
      const userId = context.activity.from.id;
      const icons = await getIconSet(userId, 'teams');

      logger.info('Processing Teams mytickets command:', { userId });

      // Check if user is configured
      const isConfigured = await configHandler.isUserConfigured(userId, 'teams');
      if (!isConfigured) {
        await this.sendConfigurationPrompt(context, userId);
        return;
      }

      const jiraService = await configHandler.getUserJiraService(userId, 'teams');
      if (!jiraService) {
        await this.sendConfigurationPrompt(context, userId);
        return;
      }

      const tickets = await jiraService.getMyAssignedTickets();

      if (tickets.length === 0) {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}You don't have any assigned tickets right now.`
        });
        return;
      }

      const card = formatAsAdaptiveCard({
        title: `${icons.tickets}Your Assigned Tickets`,
        subtitle: `${tickets.length} tickets found`,
        items: tickets.slice(0, 10).map(ticket => ({
          title: `${icons.ticket}${ticket.key}`,
          subtitle: `${ticket.summary} - ${ticket.status} | ${ticket.priority}`,
          value: JSON.stringify({ action: 'quick_log', ticketKey: ticket.key })
        }))
      });

      await context.sendActivity({
        type: 'message',
        attachments: [CardFactory.adaptiveCard(card)]
      });

    } catch (error) {
      logger.error('Error handling Teams mytickets command:', error);
      const icons = await getIconSet(context.activity.from.id, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I couldn't fetch your tickets from Jira.`
      });
    }
  }

  /**
   * Handle /timereport command
   */
  async handleTimeReportCommand(context, args) {
    try {
      const userId = context.activity.from.id;
      const period = args[0] || 'today';
      const icons = await getIconSet(userId, 'teams');

      logger.info('Processing Teams timereport command:', { userId, period });

      // Check if user is configured
      const isConfigured = await configHandler.isUserConfigured(userId, 'teams');
      if (!isConfigured) {
        await this.sendConfigurationPrompt(context, userId);
        return;
      }

      const jiraService = await configHandler.getUserJiraService(userId, 'teams');
      if (!jiraService) {
        await this.sendConfigurationPrompt(context, userId);
        return;
      }

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
      logger.error('Error handling Teams timereport command:', error);
      const icons = await getIconSet(context.activity.from.id, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I couldn't generate your time report.`
      });
    }
  }

  /**
   * Handle /iconconfig command
   */
  async handleIconConfigCommand(context, args) {
    try {
      const userId = context.activity.from.id;
      const iconSet = args[0] || '';
      const icons = await getIconSet(userId, 'teams');

      logger.info('Processing Teams iconconfig command:', { userId, iconSet });

      const validIconSets = ['current', 'large', 'small', 'minimal', 'text', 'none'];

      if (!iconSet) {
        const card = formatAsAdaptiveCard({
          title: `${icons.config}Icon Configuration`,
          subtitle: 'Configure your icon display preferences',
          fields: [
            { 
              name: 'Available icon sets', 
              value: '• `current` - Default emoji icons\n• `large` - Large emoji icons\n• `small` - Small emoji icons\n• `minimal` - Minimal text icons\n• `text` - Text-only labels\n• `none` - No icons' 
            },
            { 
              name: 'Example', 
              value: '/iconconfig minimal' 
            }
          ]
        });

        await context.sendActivity({
          type: 'message',
          attachments: [CardFactory.adaptiveCard(card)]
        });
        return;
      }

      if (!validIconSets.includes(iconSet)) {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}Invalid icon set. Available options: ${validIconSets.join(', ')}`
        });
        return;
      }

      // Save icon set preference
      await configHandler.saveUserIconSet(userId, 'teams', iconSet);

      // Get new icons to show confirmation
      const newIcons = await getIconSet(userId, 'teams');

      const card = formatAsAdaptiveCard({
        title: `${newIcons.success}Icon Set Updated!`,
        subtitle: `Icon set changed to "${iconSet}"`,
        fields: [
          { 
            name: 'Preview of new icons', 
            value: `${newIcons.ticket}Ticket ${newIcons.time}Time ${newIcons.reports}Reports ${newIcons.config}Config` 
          }
        ]
      });

      await context.sendActivity({
        type: 'message',
        attachments: [CardFactory.adaptiveCard(card)]
      });

    } catch (error) {
      logger.error('Error handling Teams iconconfig command:', error);
      const icons = await getIconSet(context.activity.from.id, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error updating your icon configuration.`
      });
    }
  }

  /**
   * Show time logging interface
   */
  async showTimeLogInterface(context, userId) {
    try {
      const icons = await getIconSet(userId, 'teams');
      const jiraService = await configHandler.getUserJiraService(userId, 'teams');
      
      if (!jiraService) {
        await this.sendConfigurationPrompt(context, userId);
        return;
      }

      const tickets = await jiraService.getMyAssignedTickets();

      if (tickets.length === 0) {
        await context.sendActivity({
          type: 'message',
          text: `${icons.error}You don't have any assigned tickets to log time to.`
        });
        return;
      }

      const card = formatAsAdaptiveCard({
        title: `${icons.timer}Quick Time Logger`,
        subtitle: 'Select a ticket and time duration to log',
        fields: [
          { 
            name: 'Or use natural language', 
            value: '• `/timelog 2.5 hours to ABC-123 working on login fix`\n• `/timelog 3h yesterday to DEF-456`\n• `/timelog 1 hour last Friday`' 
          }
        ],
        items: tickets.slice(0, 10).map(ticket => ({
          title: `${icons.ticket}${ticket.key}`,
          subtitle: ticket.summary,
          value: JSON.stringify({ action: 'quick_log', ticketKey: ticket.key })
        }))
      });

      await context.sendActivity({
        type: 'message',
        attachments: [CardFactory.adaptiveCard(card)]
      });

    } catch (error) {
      logger.error('Error showing Teams time log interface:', error);
      const icons = await getIconSet(userId, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error showing the time log interface.`
      });
    }
  }

  /**
   * Handle time logging from slash command
   */
  async handleTimeLogging(context, intent, userId) {
    try {
      const icons = await getIconSet(userId, 'teams');
      const jiraService = await configHandler.getUserJiraService(userId, 'teams');
      
      if (!jiraService) {
        await this.sendConfigurationPrompt(context, userId);
        return;
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

      // Use provided description or leave empty

      // Create confirmation
      const sessionId = await createUserSession(userId, 'teams', 'AWAITING_CONFIRMATION', {
        ticketKey,
        hours,
        description,
        parsedDate: parsedDate ? parsedDate.iso : null,
        dateString
      });

      const dateStr = parsedDate ? parsedDate.formatted : 'today';
      
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
      logger.error('Error handling Teams time logging:', error);
      const icons = await getIconSet(userId, 'teams');
      await context.sendActivity({
        type: 'message',
        text: `${icons.error}Sorry, I encountered an error processing your time logging request.`
      });
    }
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
}

module.exports = new TeamsCommandHandler(); 