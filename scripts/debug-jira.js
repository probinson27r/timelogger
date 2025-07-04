#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');

async function debugJiraResponse() {
  const baseURL = process.env.JIRA_BASE_URL;
  const personalAccessToken = process.env.JIRA_PERSONAL_ACCESS_TOKEN;

  console.log('🔍 Debugging Jira API Response\n');
  console.log('Base URL:', baseURL);
  console.log('Token starts with:', personalAccessToken?.substring(0, 10) + '...');

  try {
    const client = axios.create({
      baseURL: `${baseURL}/rest/api/2`,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${personalAccessToken}`
      }
    });

    console.log('\n📡 Making request to /myself...');
    const response = await client.get('/myself');
    
    console.log('\n✅ Response Status:', response.status);
    console.log('📄 Full Response Data:');
    console.log(JSON.stringify(response.data, null, 2));

    console.log('\n🔍 Checking specific fields:');
    console.log('displayName:', response.data.displayName);
    console.log('emailAddress:', response.data.emailAddress);
    console.log('accountId:', response.data.accountId);
    console.log('name:', response.data.name);
    console.log('key:', response.data.key);

  } catch (error) {
    console.log('\n❌ Error details:');
    console.log('Status:', error.response?.status);
    console.log('Data:', error.response?.data);
    console.log('Message:', error.message);
  }
}

debugJiraResponse(); 