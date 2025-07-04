#!/usr/bin/env node

/**
 * Debug script for Jira issues
 * 
 * This script helps diagnose specific Jira connectivity and permission issues.
 */

const path = require('path');
const { getUserConfiguration, initializeDatabase } = require('../src/services/database');
const UserJiraService = require('../src/services/userJiraService');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  success: (msg, data) => console.log(`[SUCCESS] ${msg}`, data || '')
};

class JiraIssueDiagnostic {
  constructor(userId, platform, ticketKey) {
    this.userId = userId;
    this.platform = platform;
    this.ticketKey = ticketKey;
    this.jiraService = null;
  }

  async diagnose() {
    logger.info(`🔍 Diagnosing Jira issue: ${this.ticketKey}`);
    logger.info(`User: ${this.userId}, Platform: ${this.platform}\n`);

    try {
      // Step 1: Check user configuration
      await this.checkUserConfiguration();
      
      // Step 2: Test connection
      await this.testConnection();
      
      // Step 3: Check if ticket exists
      await this.checkTicketExists();
      
      // Step 4: Check permissions
      await this.checkPermissions();
      
      // Step 5: Test time logging
      await this.testTimeLogging();
      
      logger.success('\n✅ Diagnostic completed successfully!');
      
    } catch (error) {
      logger.error('\n❌ Diagnostic failed:', error.message);
      throw error;
    }
  }

  async checkUserConfiguration() {
    logger.info('1. Checking user configuration...');
    
    const config = await getUserConfiguration(this.userId, this.platform);
    
    if (!config) {
      throw new Error('No user configuration found. Please run /jiraconfig first.');
    }
    
    if (!config.is_configured) {
      throw new Error('User configuration is incomplete. Please run /jiraconfig again.');
    }
    
    logger.info(`   ✅ Configuration found for: ${config.jira_email}`);
    logger.info(`   ✅ Jira URL: ${config.jira_base_url}`);
    logger.info(`   ✅ Jira Type: ${config.jira_type || 'server'}`);
    
    this.jiraService = new UserJiraService(config);
  }

  async testConnection() {
    logger.info('2. Testing Jira connection...');
    
    const result = await this.jiraService.testConnection();
    
    if (!result.success) {
      throw new Error(`Connection failed: ${result.error}`);
    }
    
    logger.info(`   ✅ Connected as: ${result.user.displayName}`);
    logger.info(`   ✅ Email: ${result.user.emailAddress}`);
  }

  async checkTicketExists() {
    logger.info(`3. Checking if ticket ${this.ticketKey} exists...`);
    
    try {
      const ticket = await this.jiraService.getTicket(this.ticketKey);
      
      logger.info(`   ✅ Ticket found: ${ticket.summary}`);
      logger.info(`   ✅ Status: ${ticket.status}`);
      logger.info(`   ✅ Assigned to: ${ticket.assignee || 'Unassigned'}`);
      logger.info(`   ✅ Issue Type: ${ticket.issueType}`);
      
      return ticket;
    } catch (error) {
      throw new Error(`Ticket not found or no access: ${error.message}`);
    }
  }

  async checkPermissions() {
    logger.info('4. Checking time logging permissions...');
    
    try {
      // Try to get existing worklogs for this ticket to test read permissions
      const response = await this.jiraService.axiosInstance.get(`/rest/api/2/issue/${this.ticketKey}/worklog`);
      
      logger.info(`   ✅ Can read worklogs (${response.data.total} existing worklogs)`);
      
      // Check if user has permission to add worklogs by examining issue details
      const issue = await this.jiraService.axiosInstance.get(`/rest/api/2/issue/${this.ticketKey}`, {
        params: { expand: 'operations' }
      });
      
      const operations = issue.data.operations || {};
      const canAddWorklog = operations.worklog && operations.worklog.canAddWorklog;
      
      if (canAddWorklog === false) {
        throw new Error('User does not have permission to add worklogs to this ticket');
      }
      
      logger.info('   ✅ Permissions appear to be correct');
      
    } catch (error) {
      if (error.response && error.response.status === 403) {
        throw new Error('Permission denied: User cannot access this ticket or add worklogs');
      } else if (error.response && error.response.status === 404) {
        throw new Error('Ticket not found or user has no access');
      } else {
        logger.warn(`   ⚠️  Could not verify permissions: ${error.message}`);
      }
    }
  }

  async testTimeLogging() {
    logger.info('5. Testing time logging with minimal entry...');
    
    try {
      // Test with a very small time entry to minimize impact
      const result = await this.jiraService.logWork(this.ticketKey, 0.01, 'Test log entry - please ignore', new Date());
      
      if (result.success) {
        logger.info(`   ✅ Time logging successful! Worklog ID: ${result.worklogId}`);
        logger.info('   ℹ️  A 0.01 hour test entry was created. You may want to delete it.');
      } else {
        throw new Error(`Time logging failed: ${result.error}`);
      }
      
    } catch (error) {
      logger.error('   ❌ Time logging failed');
      
      // Provide detailed error analysis
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        logger.error(`   HTTP Status: ${status}`);
        logger.error(`   Response:`, JSON.stringify(data, null, 2));
        
        switch (status) {
          case 400:
            logger.error('   Cause: Bad request - check time format or required fields');
            break;
          case 401:
            logger.error('   Cause: Authentication failed - check token validity');
            break;
          case 403:
            logger.error('   Cause: Permission denied - user cannot log time to this ticket');
            break;
          case 404:
            logger.error('   Cause: Ticket not found or no access');
            break;
          default:
            logger.error('   Cause: Unknown error');
        }
      }
      
      throw error;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node debug-jira-issue.js <user-id> <platform> <ticket-key>');
    console.log('');
    console.log('Examples:');
    console.log('  node debug-jira-issue.js U12345 slack APVMA007');
    console.log('  node debug-jira-issue.js user@example.com teams PROJ-123');
    console.log('');
    console.log('This script will:');
    console.log('  1. Check user configuration');
    console.log('  2. Test Jira connection');
    console.log('  3. Verify ticket exists');
    console.log('  4. Check permissions');
    console.log('  5. Test time logging with minimal entry');
    process.exit(1);
  }

  const [userId, platform, ticketKey] = args;
  
  // Initialize database first
  try {
    await initializeDatabase();
  } catch (error) {
    logger.error('Failed to initialize database:', error.message);
    process.exit(1);
  }
  
  const diagnostic = new JiraIssueDiagnostic(userId, platform, ticketKey);
  
  try {
    await diagnostic.diagnose();
  } catch (error) {
    logger.error('\n💥 Diagnostic failed:', error.message);
    process.exit(1);
  }
}

// Run diagnostic if called directly
if (require.main === module) {
  main();
}

module.exports = JiraIssueDiagnostic; 