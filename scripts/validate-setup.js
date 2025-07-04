#!/usr/bin/env node

/**
 * Setup Validation Script
 * Tests Jira and OpenAI connectivity before running the main application
 */

require('dotenv').config();
const axios = require('axios');

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

function success(message) {
  log(colors.green, '✓', message);
}

function error(message) {
  log(colors.red, '✗', message);
}

function warning(message) {
  log(colors.yellow, '⚠', message);
}

function info(message) {
  log(colors.blue, 'ℹ', message);
}

async function validateJiraConnection() {
  console.log('\n' + colors.blue + '=== Jira Configuration Validation ===' + colors.reset);
  
  const baseURL = process.env.JIRA_BASE_URL;
  const personalAccessToken = process.env.JIRA_PERSONAL_ACCESS_TOKEN;
  const username = process.env.JIRA_USERNAME;
  const password = process.env.JIRA_PASSWORD;

  if (!baseURL) {
    error('JIRA_BASE_URL is not set in environment variables');
    return false;
  }

  // Check authentication method
  let authHeaders = {};
  let authMethod = '';

  if (personalAccessToken) {
    authHeaders = { 'Authorization': `Bearer ${personalAccessToken}` };
    authMethod = 'Personal Access Token';
  } else if (username && password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    authHeaders = { 'Authorization': `Basic ${credentials}` };
    authMethod = 'Basic Authentication';
  } else {
    error('No authentication method configured');
    error('Set either JIRA_PERSONAL_ACCESS_TOKEN or JIRA_USERNAME+JIRA_PASSWORD');
    return false;
  }

  info(`Testing connection to: ${baseURL}`);
  info(`Using: ${authMethod}`);

  try {
    const client = axios.create({
      baseURL: `${baseURL}/rest/api/2`,
      headers: {
        'Accept': 'application/json',
        ...authHeaders
      },
      timeout: 10000,
      // Handle SSL certificate issues for enterprise instances
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: process.env.JIRA_REJECT_UNAUTHORIZED !== 'false'
      })
    });

    // Test authentication by getting current user
    const response = await client.get('/myself');
    const user = response.data;

    // Check if we got HTML instead of JSON (indicates SSO redirect)
    if (typeof user === 'string' && user.includes('<html>')) {
      error('Received HTML login page instead of JSON response');
      error('This indicates your Jira instance requires SSO authentication');
      error('Personal Access Tokens may not work with this Jira instance');
      warning('Try using JIRA_USERNAME and JIRA_PASSWORD instead');
      return false;
    }

    success(`Successfully authenticated with Jira`);
    success(`Logged in as: ${user.displayName} (${user.emailAddress})`);
    success(`Account ID: ${user.accountId}`);

    // Test permissions by searching for issues
    try {
      await client.get('/search', {
        params: {
          jql: 'ORDER BY created DESC',
          maxResults: 1
        }
      });
      success('Issue search permissions verified');
    } catch (searchError) {
      warning('Issue search failed - check project permissions');
      console.log('  Error:', searchError.response?.data?.errorMessages || searchError.message);
    }

    return true;

  } catch (err) {
    error(`Jira connection failed: ${err.response?.data?.message || err.message}`);
    
    if (err.response?.status === 401) {
      error('Authentication failed - check your Personal Access Token');
    } else if (err.response?.status === 403) {
      error('Access forbidden - check token permissions');
    } else if (err.code === 'ENOTFOUND') {
      error('Domain not found - check your JIRA_BASE_URL');
    }
    
    return false;
  }
}

async function validateOpenAIConnection() {
  console.log('\n' + colors.blue + '=== OpenAI Configuration Validation ===' + colors.reset);
  
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    error('OPENAI_API_KEY is not set in environment variables');
    return false;
  }

  if (!apiKey.startsWith('sk-')) {
    warning('OpenAI API key format looks unusual (should start with sk-)');
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    success('OpenAI API connection successful');
    success(`Model: ${response.data.model}`);
    return true;

  } catch (err) {
    error(`OpenAI connection failed: ${err.response?.data?.error?.message || err.message}`);
    
    if (err.response?.status === 401) {
      error('Invalid API key - check your OPENAI_API_KEY');
    } else if (err.response?.status === 429) {
      error('Rate limit or quota exceeded');
    }
    
    return false;
  }
}

function validateSlackConfiguration() {
  console.log('\n' + colors.blue + '=== Slack Configuration Validation ===' + colors.reset);
  
  const botToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;

  let isValid = true;

  if (!botToken) {
    error('SLACK_BOT_TOKEN is not set');
    isValid = false;
  } else if (!botToken.startsWith('xoxb-')) {
    error('SLACK_BOT_TOKEN should start with "xoxb-"');
    isValid = false;
  } else {
    success('SLACK_BOT_TOKEN format looks correct');
  }

  if (!signingSecret) {
    error('SLACK_SIGNING_SECRET is not set');
    isValid = false;
  } else {
    success('SLACK_SIGNING_SECRET is set');
  }

  if (!appToken) {
    error('SLACK_APP_TOKEN is not set');
    isValid = false;
  } else if (!appToken.startsWith('xapp-')) {
    error('SLACK_APP_TOKEN should start with "xapp-"');
    isValid = false;
  } else {
    success('SLACK_APP_TOKEN format looks correct');
  }

  if (isValid) {
    info('Slack tokens format validation passed');
    info('Note: Actual Slack connectivity will be tested when the app starts');
  }

  return isValid;
}

async function main() {
  console.log(colors.blue + '🔍 Time Logger Bot - Setup Validation' + colors.reset);
  console.log('This script validates your configuration before starting the application.\n');

  const results = {
    slack: validateSlackConfiguration(),
    jira: await validateJiraConnection(),
    openai: await validateOpenAIConnection()
  };

  console.log('\n' + colors.blue + '=== Validation Summary ===' + colors.reset);
  
  if (results.slack) {
    success('Slack configuration ✓');
  } else {
    error('Slack configuration ✗');
  }

  if (results.jira) {
    success('Jira connection ✓');
  } else {
    error('Jira connection ✗');
  }

  if (results.openai) {
    success('OpenAI connection ✓');
  } else {
    error('OpenAI connection ✗');
  }

  const allValid = Object.values(results).every(result => result);

  if (allValid) {
    console.log('\n' + colors.green + '🎉 All validations passed! You can now start the application with: npm start' + colors.reset);
    process.exit(0);
  } else {
    console.log('\n' + colors.red + '❌ Some validations failed. Please fix the issues above before starting the application.' + colors.reset);
    console.log('\nFor setup help, check the README.md file or run: npm run help');
    process.exit(1);
  }
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('\n' + colors.red + 'Unexpected error:' + colors.reset, error.message);
  process.exit(1);
});

main().catch(error => {
  console.error('\n' + colors.red + 'Validation script failed:' + colors.reset, error.message);
  process.exit(1);
}); 