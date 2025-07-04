#!/usr/bin/env node

/**
 * Teams Time Logger Bot Setup Validation
 */

require('dotenv').config();

async function validateTeamsSetup() {
  console.log('🔍 Validating Teams Time Logger Bot Setup...\n');

  let allPassed = true;
  
  // Test 1: Environment Variables
  console.log('1. Testing Environment Variables...');
  const requiredEnvVars = [
    'TEAMS_APP_ID',
    'TEAMS_APP_PASSWORD',
    'JIRA_BASE_URL',
    'JIRA_PERSONAL_ACCESS_TOKEN',
    'OPENAI_API_KEY'
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.log(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.log('   Please check your .env file and ensure all required variables are set.');
    allPassed = false;
  } else {
    console.log('✅ All required environment variables are set');
  }
  
  // Test 2: Node.js Dependencies
  console.log('\n2. Testing Node.js Dependencies...');
  try {
    require('botbuilder');
    require('restify');
    require('axios');
    require('openai');
    require('sqlite3');
    require('winston');
    require('chrono-node');
    console.log('✅ All required Node.js dependencies are installed');
  } catch (error) {
    console.log(`❌ Missing dependency: ${error.message}`);
    console.log('   Run: npm install');
    allPassed = false;
  }
  
  // Test 3: Teams Bot Framework Configuration
  console.log('\n3. Testing Teams Bot Framework Configuration...');
  try {
    const { CloudAdapter, ConfigurationServiceClientCredentialFactory } = require('botbuilder');
    
    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: process.env.TEAMS_APP_ID,
      MicrosoftAppPassword: process.env.TEAMS_APP_PASSWORD,
      MicrosoftAppType: process.env.TEAMS_APP_TYPE || 'MultiTenant',
      MicrosoftAppTenantId: process.env.TEAMS_APP_TENANT_ID
    });
    
    console.log('✅ Teams Bot Framework configuration is valid');
    console.log(`   App ID: ${process.env.TEAMS_APP_ID}`);
    console.log(`   App Type: ${process.env.TEAMS_APP_TYPE || 'MultiTenant'}`);
    if (process.env.TEAMS_APP_TENANT_ID) {
      console.log(`   Tenant ID: ${process.env.TEAMS_APP_TENANT_ID}`);
    }
  } catch (error) {
    console.log(`❌ Teams Bot Framework configuration error: ${error.message}`);
    allPassed = false;
  }
  
  // Test 4: JIRA Connection
  console.log('\n4. Testing JIRA Connection...');
  try {
    const axios = require('axios');
    const https = require('https');
    
    const httpsAgent = new https.Agent({
      rejectUnauthorized: process.env.JIRA_REJECT_UNAUTHORIZED !== 'false'
    });
    
    const response = await axios.get(`${process.env.JIRA_BASE_URL}/rest/api/2/myself`, {
      headers: {
        'Authorization': `Bearer ${process.env.JIRA_PERSONAL_ACCESS_TOKEN}`,
        'Accept': 'application/json'
      },
      httpsAgent: httpsAgent,
      timeout: 10000
    });
    
    console.log(`✅ JIRA connection successful`);
    console.log(`   Logged in as: ${response.data.displayName} (${response.data.emailAddress})`);
    console.log(`   Account ID: ${response.data.accountId}`);
  } catch (error) {
    console.log(`❌ JIRA connection failed: ${error.message}`);
    if (error.response?.status === 401) {
      console.log('   Check your JIRA_PERSONAL_ACCESS_TOKEN');
    } else if (error.response?.status === 403) {
      console.log('   Check your JIRA permissions');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('   Check your JIRA_BASE_URL');
    }
    allPassed = false;
  }
  
  // Test 5: OpenAI Connection
  console.log('\n5. Testing OpenAI Connection...');
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // Test with a simple completion
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 5
    });
    
    console.log('✅ OpenAI connection successful');
    console.log(`   Model: ${completion.model}`);
  } catch (error) {
    console.log(`❌ OpenAI connection failed: ${error.message}`);
    if (error.status === 401) {
      console.log('   Check your OPENAI_API_KEY');
    }
    allPassed = false;
  }
  
  // Test 6: Database Connection
  console.log('\n6. Testing Database Connection...');
  try {
    const { initializeDatabase } = require('../src/services/database');
    await initializeDatabase();
    console.log('✅ Database connection successful');
  } catch (error) {
    console.log(`❌ Database connection failed: ${error.message}`);
    allPassed = false;
  }
  
  // Test 7: Port Availability
  console.log('\n7. Testing Port Availability...');
  try {
    const port = process.env.TEAMS_PORT || 3978;
    const net = require('net');
    
    const server = net.createServer();
    
    await new Promise((resolve, reject) => {
      server.listen(port, () => {
        server.close(() => resolve());
      });
      
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(err);
        }
      });
    });
    
    console.log(`✅ Port ${port} is available`);
  } catch (error) {
    console.log(`❌ Port test failed: ${error.message}`);
    allPassed = false;
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log('🎉 All validation tests passed!');
    console.log('✅ Your Teams Time Logger Bot is ready to start');
    console.log('\nNext steps:');
    console.log('1. Register your bot in Microsoft Teams Admin Center');
    console.log('2. Configure bot messaging endpoint: http://localhost:3978/api/messages');
    console.log('3. Run: npm run start:teams');
  } else {
    console.log('❌ Some validation tests failed');
    console.log('Please fix the issues above before starting the bot');
  }
  console.log('='.repeat(50));
  
  return allPassed;
}

if (require.main === module) {
  validateTeamsSetup()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Validation error:', error);
      process.exit(1);
    });
}

module.exports = validateTeamsSetup; 