#!/usr/bin/env node

/**
 * Test script to verify the fixed worklog functionality
 */

const path = require('path');
const { getUserConfiguration, initializeDatabase } = require('../src/services/database');
const UserJiraService = require('../src/services/userJiraService');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  success: (msg, data) => console.log(`[SUCCESS] ${msg}`, data || '')
};

async function testFixedWorklog() {
  try {
    // Initialize database
    await initializeDatabase();
    
    logger.info('Testing fixed worklog functionality...');
    
    const config = await getUserConfiguration('U01V4HE31U2', 'slack');
    
    if (!config || !config.jira_personal_access_token) {
      logger.error('No valid configuration found. Please run /jiraconfig first.');
      return;
    }
    
    logger.info(`✅ Configuration loaded successfully`);
    logger.info(`Base URL: ${config.jira_base_url}`);
    logger.info(`Email: ${config.jira_email}`);
    logger.info(`Token length: ${config.jira_personal_access_token?.length || 0}`);
    
    // Create UserJiraService instance
    const jiraService = new UserJiraService(config);
    
    // Test connection
    logger.info('\nTesting connection...');
    const connectionTest = await jiraService.testConnection();
    
    if (!connectionTest.success) {
      logger.error(`❌ Connection failed: ${connectionTest.error}`);
      return;
    }
    
    logger.success(`✅ Connected as: ${connectionTest.user.displayName}`);
    
    // Test with a valid ticket
    const testTicket = 'APVM007-13'; // One of the "To Do" tickets from the search results
    
    logger.info(`\nTesting worklog creation on ${testTicket}...`);
    
    // Try to get the ticket first
    try {
      const ticket = await jiraService.getTicket(testTicket);
      logger.success(`✅ Ticket found: ${ticket.summary}`);
      logger.info(`Status: ${ticket.status}`);
    } catch (ticketError) {
      logger.error(`❌ Cannot access ticket ${testTicket}: ${ticketError.message}`);
      return;
    }
    
    // Test worklog creation
    try {
      const result = await jiraService.logWork(testTicket, 0.02, 'Test worklog entry from TimeLogger debugging - please ignore', new Date());
      
      if (result.success) {
        logger.success(`✅ Worklog created successfully!`);
        logger.info(`Worklog ID: ${result.worklogId}`);
        logger.info(`Time logged: ${result.timeSpent}`);
        logger.info('🧹 You may want to delete this test entry from Jira');
      } else {
        logger.error(`❌ Worklog creation failed: ${result.error}`);
      }
      
    } catch (worklogError) {
      logger.error(`❌ Worklog creation error: ${worklogError.message}`);
    }
    
  } catch (error) {
    logger.error('Test failed:', error.message);
    throw error;
  }
}

// Run test if called directly
if (require.main === module) {
  testFixedWorklog()
    .then(() => {
      console.log('\nFixed worklog test completed.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nTest failed:', error.message);
      process.exit(1);
    });
}

module.exports = testFixedWorklog; 