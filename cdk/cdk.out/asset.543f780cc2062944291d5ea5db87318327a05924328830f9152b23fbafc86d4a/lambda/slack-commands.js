const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { WebClient } = require('@slack/web-api');

// Force refresh of secrets - v5.0 - FIXED IAM PERMISSIONS AND DATE PARSING
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-southeast-2' });

async function getAppSecrets() {
  if (process.env.NODE_ENV === 'development') {
    return {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    };
  }

  const command = new GetSecretValueCommand({
    SecretId: process.env.APP_SECRETS_ARN,
  });
  
  const response = await secretsClient.send(command);
  return JSON.parse(response.SecretString);
}

function createSlackResponse(text, blocks = null, responseType = 'ephemeral') {
  const response = {
    response_type: responseType,
    text: text
  };
  
  if (blocks) {
    response.blocks = blocks;
  }
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(response),
  };
}

exports.handler = async (event, context) => {
  console.log('Slack command event:', JSON.stringify(event, null, 2));

  try {
    // Get app secrets
    const secrets = await getAppSecrets();
    
    // Set environment variables for existing code compatibility
    process.env.SLACK_BOT_TOKEN = secrets.SLACK_BOT_TOKEN;
    process.env.SLACK_SIGNING_SECRET = secrets.SLACK_SIGNING_SECRET;
    process.env.OPENAI_API_KEY = secrets.OPENAI_API_KEY;
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;

    if (!event.body) {
      return createSlackResponse('Error: No command data received');
    }

    // Parse URL-encoded body from Slack
    const params = new URLSearchParams(event.body);
    const slackData = {};
    for (const [key, value] of params) {
      slackData[key] = value;
    }

    console.log('Parsed slack command:', slackData);

    // Create Slack Web API client
    const client = new WebClient(secrets.SLACK_BOT_TOKEN);

    // Mock response storage
    let slackResponse = null;

    // Create mock functions for Slack Bolt compatibility
    const ack = async () => {
      console.log('Command acknowledged');
    };

    const say = async (message) => {
      console.log('Say called with:', message);
      slackResponse = message;
    };

    // Import slash command handler
    const slashCommandHandler = require('../handlers/slashCommandHandler');

    // Create command object in the format expected by handlers
    const command = {
      command: slackData.command,
      text: slackData.text || '',
      user_id: slackData.user_id,
      user_name: slackData.user_name,
      channel_id: slackData.channel_id,
      channel_name: slackData.channel_name,
      team_id: slackData.team_id,
      team_domain: slackData.team_domain,
      response_url: slackData.response_url,
      trigger_id: slackData.trigger_id
    };

    // Route to appropriate handler based on command
    switch (slackData.command) {
      case '/jiraconfig':
        await slashCommandHandler.handleJiraConfigCommand({ command, ack, say, client });
        break;
      case '/timelog':
        await slashCommandHandler.handleTimeLogCommand({ command, ack, say, client });
        break;
      case '/mytickets':
        await slashCommandHandler.handleMyTicketsCommand({ command, ack, say, client });
        break;
      case '/timereport':
        await slashCommandHandler.handleTimeReportCommand({ command, ack, say, client });
        break;
      case '/iconconfig':
        await slashCommandHandler.handleIconConfigCommand({ command, ack, say, client });
        break;
      default:
        slackResponse = {
          text: `Unknown command: ${slackData.command}`,
          response_type: 'ephemeral'
        };
    }

    // Return the response that was set by the say function
    if (slackResponse) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(slackResponse),
      };
    }

    // Fallback response
    return createSlackResponse('Command processed successfully');

  } catch (error) {
    console.error('Error processing Slack command:', error);
    return createSlackResponse(`Error: ${error.message}`);
  }
}; 