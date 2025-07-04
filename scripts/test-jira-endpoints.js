#!/usr/bin/env node

/**
 * Test script to check different Jira API endpoints and error responses
 */

const path = require('path');
const { getUserConfiguration, initializeDatabase } = require('../src/services/database');
const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  success: (msg, data) => console.log(`[SUCCESS] ${msg}`, data || '')
};

async function testEndpoints() {
  try {
    // Initialize database
    await initializeDatabase();
    
    const config = await getUserConfiguration('U01V4HE31U2', 'slack');
    
    if (!config || !config.jira_personal_access_token) {
      logger.error('No valid configuration found. Please run /jiraconfig first.');
      return;
    }
    
    logger.info(`Testing endpoints for: ${config.jira_base_url}`);
    logger.info(`Email: ${config.jira_email}`);
    logger.info(`Type: ${config.jira_type}`);
    
    // Set up authentication
    const credentials = Buffer.from(`${config.jira_email}:${config.jira_personal_access_token}`).toString('base64');
    const authHeaders = {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    const axiosInstance = axios.create({
      baseURL: config.jira_base_url,
      headers: authHeaders,
      timeout: 30000
    });
    
    const ticketKey = 'APVMA007';
    
    // Test 1: Check if ticket exists
    logger.info('\n1. Testing ticket access...');
    try {
      const response = await axiosInstance.get(`/rest/api/2/issue/${ticketKey}`);
      logger.success(`✅ Can access ticket ${ticketKey}: ${response.data.fields.summary}`);
    } catch (error) {
      logger.error(`❌ Cannot access ticket: ${error.response?.status} ${error.response?.statusText}`);
      if (error.response?.data) {
        logger.error('Response:', JSON.stringify(error.response.data, null, 2));
      }
      return;
    }
    
    // Test 2: Check worklog read permissions
    logger.info('\n2. Testing worklog read access...');
    try {
      const response = await axiosInstance.get(`/rest/api/2/issue/${ticketKey}/worklog`);
      logger.success(`✅ Can read worklogs: ${response.data.total} existing worklogs`);
    } catch (error) {
      logger.error(`❌ Cannot read worklogs: ${error.response?.status} ${error.response?.statusText}`);
      if (error.response?.data) {
        logger.error('Response:', JSON.stringify(error.response.data, null, 2));
      }
    }
    
    // Test 3: Try different API versions for worklog creation
    const testData = {
      comment: 'Test worklog entry',
      timeSpent: '1m',
      started: new Date().toISOString()
    };
    
    const endpointsToTest = [
      `/rest/api/2/issue/${ticketKey}/worklog`,
      `/rest/api/3/issue/${ticketKey}/worklog`,
      `/rest/api/latest/issue/${ticketKey}/worklog`
    ];
    
    logger.info('\n3. Testing worklog creation endpoints...');
    
    for (const endpoint of endpointsToTest) {
      logger.info(`\nTesting POST to: ${endpoint}`);
      try {
        const response = await axiosInstance.post(endpoint, testData);
        logger.success(`✅ Success with ${endpoint}: Created worklog ${response.data.id}`);
        
        // Clean up - delete the test worklog
        try {
          await axiosInstance.delete(`${endpoint}/${response.data.id}`);
          logger.info('🧹 Test worklog cleaned up');
        } catch (deleteError) {
          logger.info('⚠️ Could not delete test worklog - please remove manually');
        }
        break;
        
      } catch (error) {
        logger.error(`❌ Failed with ${endpoint}: ${error.response?.status} ${error.response?.statusText}`);
        if (error.response?.data) {
          logger.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
        
        // Log the exact URL being called
        logger.error(`Full URL: ${config.jira_base_url}${endpoint}`);
      }
    }
    
    // Test 4: Check user permissions
    logger.info('\n4. Testing user permissions...');
    try {
      const response = await axiosInstance.get(`/rest/api/2/issue/${ticketKey}`, {
        params: { expand: 'operations' }
      });
      
      const operations = response.data.operations || {};
      logger.info('Available operations:', Object.keys(operations));
      
      if (operations.worklog) {
        logger.info('Worklog operations:', operations.worklog);
      } else {
        logger.error('❌ No worklog operations available for this user/ticket');
      }
      
    } catch (error) {
      logger.error(`❌ Cannot check permissions: ${error.response?.status} ${error.response?.statusText}`);
    }
    
  } catch (error) {
    logger.error('Test failed:', error.message);
    throw error;
  }
}

// Run test if called directly
if (require.main === module) {
  testEndpoints()
    .then(() => {
      console.log('\nEndpoint testing completed.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nTest failed:', error.message);
      process.exit(1);
    });
}

module.exports = testEndpoints; 