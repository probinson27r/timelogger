const { App } = require('@slack/bolt');
const express = require('express');
require('dotenv').config();

const logger = require('./utils/logger');
const { initializeDatabase } = require('./services/database');
const messageHandler = require('./handlers/messageHandler');
const slashCommandHandler = require('./handlers/slashCommandHandler');

class TimeLoggerApp {
  constructor() {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMode: true,
      appToken: process.env.SLACK_APP_TOKEN,
      port: process.env.PORT || 3000
    });

    this.expressApp = express();
    this.setupHandlers();
    this.setupExpress();
  }

  setupHandlers() {
    // Handle direct messages and mentions
    this.app.message(async ({ message, say, client }) => {
      await messageHandler.handleMessage({ message, say, client });
    });

    // Handle slash commands
    this.app.command('/jiraconfig', async ({ command, ack, say, client }) => {
      await slashCommandHandler.handleJiraConfigCommand({ command, ack, say, client });
    });

    this.app.command('/timelog', async ({ command, ack, say, client }) => {
      await slashCommandHandler.handleTimeLogCommand({ command, ack, say, client });
    });

    this.app.command('/mytickets', async ({ command, ack, say, client }) => {
      await slashCommandHandler.handleMyTicketsCommand({ command, ack, say, client });
    });

    this.app.command('/timereport', async ({ command, ack, say, client }) => {
      await slashCommandHandler.handleTimeReportCommand({ command, ack, say, client });
    });

    this.app.command('/iconconfig', async ({ command, ack, say, client }) => {
      await slashCommandHandler.handleIconConfigCommand({ command, ack, say, client });
    });

    // Handle interactive elements (buttons, select menus)
    this.app.action('ticket_select', async ({ body, ack, say, client }) => {
      await messageHandler.handleTicketSelection({ body, ack, say, client });
    });

    this.app.action(/log_time_.*/, async ({ body, ack, say, client }) => {
      await messageHandler.handleTimeLogging({ body, ack, say, client });
    });

    // Handle quick log buttons from ticket lists
    this.app.action(/quick_log_.*/, async ({ body, ack, say, client }) => {
      await messageHandler.handleQuickLog({ body, ack, say, client });
    });

    // Handle quick time interface selections
    this.app.action('quick_ticket_select', async ({ body, ack, say, client }) => {
      await messageHandler.handleQuickTicketSelect({ body, ack, say, client });
    });

    this.app.action('quick_time_select', async ({ body, ack, say, client }) => {
      await messageHandler.handleQuickTimeSelect({ body, ack, say, client });
    });

    // Handle quick time confirmation and cancellation
    this.app.action(/quick_time_confirm_.*/, async ({ body, ack, say, client }) => {
      await messageHandler.handleQuickTimeConfirm({ body, ack, say, client });
    });

    this.app.action(/quick_log_cancel_.*/, async ({ body, ack, say, client }) => {
      await messageHandler.handleQuickLogCancel({ body, ack, say, client });
    });

    // Error handling
    this.app.error((error) => {
      logger.error('Slack app error:', error);
    });
  }

  setupExpress() {
    this.expressApp.use(express.json());
    
    // Health check endpoint
    this.expressApp.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // Start Express server
    this.expressApp.listen(process.env.PORT || 3000, () => {
      logger.info(`Express server listening on port ${process.env.PORT || 3000}`);
    });
  }

  async start() {
    try {
      // Initialize database
      await initializeDatabase();
      
      // Start Slack app
      await this.app.start();
      
      logger.info('⚡️ Time Logger Slack app is running!');
    } catch (error) {
      logger.error('Failed to start Time Logger app:', error);
      process.exit(1);
    }
  }

  async stop() {
    try {
      await this.app.stop();
      logger.info('Time Logger app stopped');
    } catch (error) {
      logger.error('Error stopping app:', error);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  if (global.timeLoggerApp) {
    await global.timeLoggerApp.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  if (global.timeLoggerApp) {
    await global.timeLoggerApp.stop();
  }
  process.exit(0);
});

// Start the application
const timeLoggerApp = new TimeLoggerApp();
global.timeLoggerApp = timeLoggerApp;
timeLoggerApp.start(); 