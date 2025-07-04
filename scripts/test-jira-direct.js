#!/usr/bin/env node

/**
 * Direct Jira Connection Test
 * Tests different authentication methods to diagnose connection issues
 */

require('dotenv').config();
const axios = require('axios');
const https = require('https');

async function testJiraConnection() {
  const baseURL = process.env.JIRA_BASE_URL;
  const personalAccessToken = process.env.JIRA_PERSONAL_ACCESS_TOKEN;
  const username = process.env.JIRA_USERNAME;
  const password = process.env.JIRA_PASSWORD;

  console.log('🔍 Testing Jira Connection...\n');
  console.log(`Base URL: ${baseURL}`);
  console.log(`SSL Certificate Validation: ${process.env.JIRA_REJECT_UNAUTHORIZED !== 'false' ? 'Enabled' : 'Disabled'}\n`);

  // Create HTTPS agent with SSL settings
  const httpsAgent = new https.Agent({
    rejectUnauthorized: process.env.JIRA_REJECT_UNAUTHORIZED !== 'false'
  });

  const testConfigs = [];

  // Test 1: Personal Access Token
  if (personalAccessToken) {
    testConfigs.push({
      name: 'Personal Access Token',
      headers: { 'Authorization': `Bearer ${personalAccessToken}` }
    });
  }

  // Test 2: Basic Authentication
  if (username && password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    testConfigs.push({
      name: 'Basic Authentication',
      headers: { 'Authorization': `Basic ${credentials}` }
    });
  }

  if (testConfigs.length === 0) {
    console.log('❌ No authentication methods configured!');
    console.log('Set either:');
    console.log('  - JIRA_PERSONAL_ACCESS_TOKEN');
    console.log('  - JIRA_USERNAME and JIRA_PASSWORD');
    return;
  }

  for (const config of testConfigs) {
    console.log(`--- Testing ${config.name} ---`);
    
    try {
      const client = axios.create({
        baseURL: `${baseURL}/rest/api/2`,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...config.headers
        },
        httpsAgent,
        timeout: 15000
      });

      console.log('Making request to /myself...');
      const response = await client.get('/myself');
      
      // Check if response is HTML (SSO redirect)
      if (typeof response.data === 'string' && response.data.includes('<html>')) {
        console.log('❌ Got HTML response (SSO redirect)');
        console.log('First 200 chars:', response.data.substring(0, 200));
      } else {
        console.log('✅ Success!');
        console.log(`User: ${response.data.displayName} (${response.data.emailAddress})`);
        console.log(`Account ID: ${response.data.accountId}`);
        
        // Test a simple search
        try {
          await client.get('/search', { params: { jql: 'ORDER BY created DESC', maxResults: 1 } });
          console.log('✅ Search permissions verified');
        } catch (searchError) {
          console.log('⚠️  Search failed:', searchError.response?.data?.errorMessages || searchError.message);
        }
      }
      
    } catch (error) {
      console.log('❌ Connection failed');
      console.log('Error:', error.message);
      if (error.response) {
        console.log('Status:', error.response.status);
        console.log('Response:', error.response.data);
      }
    }
    
    console.log();
  }

  console.log('🔧 Troubleshooting Tips:');
  console.log('1. If you get HTML responses, your Jira requires SSO login');
  console.log('2. Try using JIRA_USERNAME/JIRA_PASSWORD instead of Personal Access Token');
  console.log('3. Verify you can access Jira in your browser from this network');
  console.log('4. Check if you need VPN access to reach the Jira instance');
  console.log('5. Confirm the URL is correct: ' + baseURL);
}

if (require.main === module) {
  testJiraConnection().catch(console.error);
}

module.exports = testJiraConnection; 