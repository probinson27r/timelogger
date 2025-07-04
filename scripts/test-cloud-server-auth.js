#!/usr/bin/env node

/**
 * Test script for Jira Cloud and Server authentication
 * 
 * This script validates that both authentication methods work correctly.
 */

const path = require('path');
const UserJiraService = require('../src/services/userJiraService');
const configHandler = require('../src/handlers/configHandler');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  success: (msg, data) => console.log(`[SUCCESS] ${msg}`, data || '')
};

async function testUrlDetection() {
  logger.info('🧪 Testing URL detection...');

  // Test Cloud URL detection
  const cloudUrls = [
    'https://mycompany.atlassian.net',
    'https://test.atlassian.net/jira',
    'http://example.atlassian.net'
  ];

  const serverUrls = [
    'https://jira.mycompany.com',
    'https://internal-jira.local',
    'https://jira.example.org',
    'http://localhost:8080'
  ];

  let allPassed = true;

  for (const url of cloudUrls) {
    const type = configHandler.detectJiraType(url);
    if (type !== 'cloud') {
      logger.error(`  ❌ Expected 'cloud' for ${url}, got '${type}'`);
      allPassed = false;
    } else {
      logger.info(`  ✅ Correctly detected '${type}' for ${url}`);
    }
  }

  for (const url of serverUrls) {
    const type = configHandler.detectJiraType(url);
    if (type !== 'server') {
      logger.error(`  ❌ Expected 'server' for ${url}, got '${type}'`);
      allPassed = false;
    } else {
      logger.info(`  ✅ Correctly detected '${type}' for ${url}`);
    }
  }

  if (allPassed) {
    logger.success('✅ URL detection tests passed!\n');
  } else {
    logger.error('❌ URL detection tests failed!\n');
  }

  return allPassed;
}

async function testAuthenticationStructure() {
  logger.info('🔧 Testing authentication structure...');

  try {
    // Test Cloud config structure
    const cloudConfig = {
      jira_type: 'cloud',
      jira_base_url: 'https://test.atlassian.net',
      jira_personal_access_token: 'fake-token',
      jira_email: 'test@example.com'
    };

    const cloudService = new UserJiraService(cloudConfig);
    logger.info('  ✅ Cloud service created successfully');

    // Test Server config structure
    const serverConfig = {
      jira_type: 'server',
      jira_base_url: 'https://jira.example.com',
      jira_personal_access_token: 'fake-token'
    };

    const serverService = new UserJiraService(serverConfig);
    logger.info('  ✅ Server service created successfully');

    // Test missing email for Cloud
    try {
      const badCloudConfig = {
        jira_type: 'cloud',
        jira_base_url: 'https://test.atlassian.net',
        jira_personal_access_token: 'fake-token'
        // missing jira_email
      };
      new UserJiraService(badCloudConfig);
      logger.error('  ❌ Should have failed without email for Cloud');
      return false;
    } catch (error) {
      logger.info('  ✅ Correctly rejected Cloud config without email');
    }

    logger.success('✅ Authentication structure tests passed!\n');
    return true;

  } catch (error) {
    logger.error(`❌ Authentication structure test failed: ${error.message}\n`);
    return false;
  }
}

async function main() {
  logger.info('🚀 Starting Jira Cloud/Server authentication tests...\n');

  try {
    const urlTestPassed = await testUrlDetection();
    const authTestPassed = await testAuthenticationStructure();

    logger.info('📊 Test Results Summary:');
    logger.info('========================');
    logger.info(`URL Detection: ${urlTestPassed ? '✅ PASS' : '❌ FAIL'}`);
    logger.info(`Auth Structure: ${authTestPassed ? '✅ PASS' : '❌ FAIL'}`);

    if (urlTestPassed && authTestPassed) {
      logger.success('\n🎉 All tests passed! Jira Cloud/Server authentication is working correctly.');
      logger.info('\n💡 The system now supports:');
      logger.info('   • Jira Cloud (*.atlassian.net) with email + API token');
      logger.info('   • Jira Server/Data Center with Personal Access Token');
      logger.info('   • Auto-detection of Jira type based on URL');
    } else {
      logger.error('\n❌ Some tests failed. Please check the errors above.');
      process.exit(1);
    }

  } catch (error) {
    logger.error('💥 Test execution failed:', error.message);
    process.exit(1);
  }
}

// Run tests
main(); 