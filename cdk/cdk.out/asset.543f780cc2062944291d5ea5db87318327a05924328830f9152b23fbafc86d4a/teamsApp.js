const { 
  CloudAdapter, 
  ConfigurationServiceClientCredentialFactory, 
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
  MessageFactory,
  CardFactory,
  ActionTypes
} = require('botbuilder');
const restify = require('restify');
require('dotenv').config();

const logger = require('./utils/logger');
const { initializeDatabase } = require('./services/database');
const teamsMessageHandler = require('./handlers/teamsMessageHandler');
const teamsCommandHandler = require('./handlers/teamsCommandHandler');

class TeamsTimeLoggerApp {
  constructor() {
    this.setupCredentials();
    this.setupAdapter();
    this.setupServer();
    this.setupBot();
  }

  setupCredentials() {
    // Bot Framework authentication
    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: process.env.TEAMS_APP_ID,
      MicrosoftAppPassword: process.env.TEAMS_APP_PASSWORD,
      MicrosoftAppType: process.env.TEAMS_APP_TYPE || 'MultiTenant',
      MicrosoftAppTenantId: process.env.TEAMS_APP_TENANT_ID
    });

    this.botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
      {},
      credentialsFactory
    );
  }

  setupAdapter() {
    // Create adapter
    this.adapter = new CloudAdapter(this.botFrameworkAuthentication);

    // Error handling
    this.adapter.onTurnError = async (context, error) => {
      logger.error('Teams adapter error:', error);
      await context.sendActivity(MessageFactory.text('Sorry, an error occurred processing your request.'));
    };
  }

  setupServer() {
    // Create Restify server
    this.server = restify.createServer({
      name: 'Teams Time Logger Bot',
      version: '1.0.0'
    });

    this.server.use(restify.plugins.bodyParser());
    this.server.use(restify.plugins.queryParser());

    // Health check endpoint
    this.server.get('/health', (req, res, next) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
      return next();
    });

    // Bot Framework endpoint
    this.server.post('/api/messages', async (req, res, next) => {
      await this.adapter.process(req, res, (context) => this.handleActivity(context));
      return next();
    });
  }

  setupBot() {
    // Main activity handler
    this.handleActivity = async (context) => {
      if (context.activity.type === 'message') {
        await this.handleMessage(context);
      } else if (context.activity.type === 'invoke') {
        await this.handleInvoke(context);
      }
    };
  }

  async handleMessage(context) {
    const text = context.activity.text?.trim();
    
    if (!text) return;

    try {
      // Handle slash commands (Teams uses different format)
      if (text.startsWith('/')) {
        await this.handleSlashCommand(context, text);
      } else {
        // Handle regular messages
        await teamsMessageHandler.handleMessage(context);
      }
    } catch (error) {
      logger.error('Error handling Teams message:', error);
      await context.sendActivity(MessageFactory.text('Sorry, I encountered an error processing your request.'));
    }
  }

  async handleSlashCommand(context, commandText) {
    const parts = commandText.split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    switch (command) {
      case '/jiraconfig':
        await teamsCommandHandler.handleJiraConfigCommand(context, args);
        break;
      case '/timelog':
        await teamsCommandHandler.handleTimeLogCommand(context, args);
        break;
      case '/mytickets':
        await teamsCommandHandler.handleMyTicketsCommand(context, args);
        break;
      case '/timereport':
        await teamsCommandHandler.handleTimeReportCommand(context, args);
        break;
      case '/iconconfig':
        await teamsCommandHandler.handleIconConfigCommand(context, args);
        break;
      default:
        await context.sendActivity(MessageFactory.text(
          'Available commands:\n' +
          '• `/jiraconfig` - Configure your Jira access\n' +
          '• `/timelog` - Log time to Jira tickets\n' +
          '• `/mytickets` - Show your assigned tickets\n' +
          '• `/timereport` - Generate time reports\n' +
          '• `/iconconfig` - Configure icon display'
        ));
    }
  }

  async handleInvoke(context) {
    // Handle adaptive card actions
    if (context.activity.name === 'adaptiveCard/action') {
      await teamsMessageHandler.handleSubmitAction(context);
    }
  }

  async start() {
    try {
      // Initialize database
      await initializeDatabase();
      
      // Start server
      const port = process.env.TEAMS_PORT || 3978;
      this.server.listen(port, () => {
        logger.info(`⚡️ Teams Time Logger bot listening on port ${port}`);
        logger.info(`Bot endpoint: http://localhost:${port}/api/messages`);
      });
      
    } catch (error) {
      logger.error('Failed to start Teams Time Logger app:', error);
      process.exit(1);
    }
  }

  async stop() {
    try {
      if (this.server) {
        this.server.close();
      }
      logger.info('Teams Time Logger app stopped');
    } catch (error) {
      logger.error('Error stopping Teams app:', error);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down Teams app gracefully');
  if (global.teamsTimeLoggerApp) {
    await global.teamsTimeLoggerApp.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down Teams app gracefully');
  if (global.teamsTimeLoggerApp) {
    await global.teamsTimeLoggerApp.stop();
  }
  process.exit(0);
});

// Start the application
const teamsTimeLoggerApp = new TeamsTimeLoggerApp();
global.teamsTimeLoggerApp = teamsTimeLoggerApp;
teamsTimeLoggerApp.start(); 