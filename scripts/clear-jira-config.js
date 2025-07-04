#!/usr/bin/env node

/**
 * Script to clear Jira configuration for a user
 */

const path = require('path');
const { deleteUserConfiguration, initializeDatabase } = require('../src/services/database');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  success: (msg, data) => console.log(`[SUCCESS] ${msg}`, data || '')
};

async function clearJiraConfig(userId, platform = 'slack') {
  try {
    // Initialize database
    await initializeDatabase();
    
    logger.info(`Clearing Jira configuration for user: ${userId} on platform: ${platform}`);
    
    const result = await deleteUserConfiguration(userId, platform);
    
    if (result > 0) {
      logger.success(`✅ Jira configuration cleared successfully!`);
      logger.info('You can now run /jiraconfig again to set up with the new encryption method.');
    } else {
      logger.info('No configuration found to clear.');
    }
    
  } catch (error) {
    logger.error('Failed to clear configuration:', error.message);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node clear-jira-config.js <user-id> [platform]');
    console.log('');
    console.log('Examples:');
    console.log('  node clear-jira-config.js U01V4HE31U2');
    console.log('  node clear-jira-config.js U01V4HE31U2 slack');
    console.log('  node clear-jira-config.js user@example.com teams');
    console.log('');
    process.exit(1);
  }
  
  const userId = args[0];
  const platform = args[1] || 'slack';
  
  try {
    await clearJiraConfig(userId, platform);
  } catch (error) {
    logger.error('Script failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = clearJiraConfig; 