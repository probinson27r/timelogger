const { MessageFactory, CardFactory } = require('botbuilder');

class TeamsFormatter {
  /**
   * Create a simple text message
   */
  static text(text) {
    return MessageFactory.text(text);
  }

  /**
   * Create an adaptive card with title and content
   */
  static createCard(title, content, actions = []) {
    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: title,
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'TextBlock',
          text: content,
          wrap: true
        }
      ]
    };

    if (actions.length > 0) {
      card.actions = actions;
    }

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create a ticket selection card
   */
  static createTicketSelectionCard(tickets, sessionId) {
    const choices = tickets.map(ticket => ({
      title: `${ticket.key} - ${ticket.summary}`,
      value: ticket.key
    }));

    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: 'Select a ticket:',
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'Input.ChoiceSet',
          id: 'ticket_key',
          style: 'compact',
          choices: choices
        }
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: 'Select',
          data: {
            action: 'ticket_select',
            sessionId: sessionId
          }
        }
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create a time logging confirmation card
   */
  static createTimeLoggingCard(ticketKey, hours, description, date, sessionId) {
    const dateStr = date ? ` on ${date}` : '';
    
    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: `Log ${hours} hours to ${ticketKey}${dateStr}?`,
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'TextBlock',
          text: `Description: ${description}`,
          wrap: true
        }
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: 'Confirm',
          data: {
            action: `log_time_${sessionId}`,
            confirm: true
          }
        },
        {
          type: 'Action.Submit',
          title: 'Cancel',
          data: {
            action: `log_time_${sessionId}`,
            confirm: false
          }
        }
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create a tickets list card
   */
  static createTicketsListCard(tickets, icons) {
    const ticketItems = tickets.map(ticket => ({
      type: 'TextBlock',
      text: `${icons.ticket} **${ticket.key}** - ${ticket.summary}\n` +
            `${icons.status} ${ticket.status} | ${icons.priority} ${ticket.priority}`,
      wrap: true,
      separator: true
    }));

    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: `${icons.tickets} Your Assigned Tickets`,
          weight: 'Bolder',
          size: 'Medium'
        },
        ...ticketItems
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create a time report card
   */
  static createTimeReportCard(reportData, period, icons) {
    const { totalHours, worklogsByTicket } = reportData;
    
    const summaryItems = [
      {
        type: 'TextBlock',
        text: `${icons.summary} **Total Hours**: ${totalHours}`,
        weight: 'Bolder'
      }
    ];

    const detailItems = Object.entries(worklogsByTicket).map(([ticketKey, data]) => ({
      type: 'TextBlock',
      text: `${icons.ticket} **${ticketKey}** - ${data.hours} hours\n` +
            `${data.summary}`,
      wrap: true,
      separator: true
    }));

    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: `${icons.reports} Time Report - ${period}`,
          weight: 'Bolder',
          size: 'Medium'
        },
        ...summaryItems,
        {
          type: 'TextBlock',
          text: `${icons.details} Details:`,
          weight: 'Bolder',
          size: 'Small'
        },
        ...detailItems
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create an icon configuration card
   */
  static createIconConfigCard(currentSet, availableSets) {
    const choices = availableSets.map(set => ({
      title: `${set.name} - ${set.description}`,
      value: set.name
    }));

    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: 'Icon Configuration',
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'TextBlock',
          text: `Current: ${currentSet}`,
          wrap: true
        },
        {
          type: 'Input.ChoiceSet',
          id: 'icon_set',
          style: 'compact',
          choices: choices
        }
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: 'Update',
          data: {
            action: 'icon_config_update'
          }
        }
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create a success message card
   */
  static createSuccessCard(message, icon = '✅') {
    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: `${icon} ${message}`,
          weight: 'Bolder',
          color: 'Good'
        }
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create an error message card
   */
  static createErrorCard(message, icon = '❌') {
    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: `${icon} ${message}`,
          weight: 'Bolder',
          color: 'Attention'
        }
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }

  /**
   * Create a help card
   */
  static createHelpCard(icons) {
    const card = {
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: `${icons.help} Time Logger Help`,
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'TextBlock',
          text: '**Natural Language Examples:**\n' +
                '• "Log 3 hours to PROJ-123"\n' +
                '• "I worked 2 hours yesterday on bug fixing"\n' +
                '• "Log 4h to ticket last Friday"\n' +
                '• "How many hours did I log today?"\n' +
                '• "Show me my time report for this week"',
          wrap: true
        },
        {
          type: 'TextBlock',
          text: '**Commands:**\n' +
                '• `/timelog` - Log time to tickets\n' +
                '• `/mytickets` - Show assigned tickets\n' +
                '• `/timereport` - Generate time reports\n' +
                '• `/iconconfig` - Configure icon display',
          wrap: true
        }
      ]
    };

    return MessageFactory.attachment(CardFactory.adaptiveCard(card));
  }
}

module.exports = TeamsFormatter; 