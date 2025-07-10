const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

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

function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

exports.handler = async (event, context) => {
  console.log('Slack interactions:', JSON.stringify(event, null, 2));

  // Allow Lambda to finish async operations
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    // Parse URL-encoded form data from Slack first
    let body;
    if (event.body && event.body.startsWith('payload=')) {
      const payload = decodeURIComponent(event.body.substring(8));
      body = JSON.parse(payload);
    } else if (event.body) {
      body = JSON.parse(event.body);
    } else {
      return createResponse(400, { error: 'No body provided' });
    }
    
    console.log('Processing Slack interaction:', {
      type: body.type,
      action_id: body.actions?.[0]?.action_id,
      callback_id: body.callback_id,
      user: body.user?.id,
      channel: body.channel?.id
    });

    // Get app secrets
    const secrets = await getAppSecrets();
    
    // Set environment variables for existing code compatibility
    process.env.SLACK_BOT_TOKEN = secrets.SLACK_BOT_TOKEN;
    process.env.SLACK_SIGNING_SECRET = secrets.SLACK_SIGNING_SECRET;
    process.env.OPENAI_API_KEY = secrets.OPENAI_API_KEY;
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;

    // Handle button clicks and interactive components
    if (body.type === 'block_actions') {
      const action = body.actions[0];
      const actionId = action.action_id;

      // Import required handlers
      const messageHandler = require('../handlers/messageHandler');
      const configHandler = require('../handlers/configHandler');

      // Create mock Slack Web API client for responses
      const https = require('https');
      
      const postToSlack = async (options) => {
        // Handle channel archived error by using response_url as fallback
        const payload = {
          channel: body.channel?.id,
          ...options
        };
        
        const postData = JSON.stringify(payload);
        
        const requestOptions = {
          hostname: 'slack.com',
          port: 443,
          path: '/api/chat.postMessage',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        return new Promise((resolve, reject) => {
          const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                
                // If channel is archived, try using response_url as fallback
                if (!response.ok && response.error === 'is_archived' && body.response_url) {
                  console.log('Channel archived, using response_url fallback');
                  
                  // Use response_url for ephemeral message
                  const fallbackPayload = {
                    text: options.text || 'Message processed',
                    response_type: 'ephemeral',
                    ...(options.blocks && { blocks: options.blocks })
                  };
                  
                  const fallbackData = JSON.stringify(fallbackPayload);
                  const fallbackUrl = new URL(body.response_url);
                  
                  const fallbackOptions = {
                    hostname: fallbackUrl.hostname,
                    port: 443,
                    path: fallbackUrl.pathname + fallbackUrl.search,
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Content-Length': Buffer.byteLength(fallbackData)
                    }
                  };
                  
                  const fallbackReq = https.request(fallbackOptions, (fallbackRes) => {
                    let fallbackResData = '';
                    fallbackRes.on('data', (chunk) => fallbackResData += chunk);
                    fallbackRes.on('end', () => {
                      console.log('Fallback response sent successfully');
                      resolve({ ok: true, fallback: true });
                    });
                  });
                  
                  fallbackReq.on('error', (err) => {
                    console.error('Fallback request failed:', err);
                    resolve(response); // Return original response
                  });
                  
                  fallbackReq.write(fallbackData);
                  fallbackReq.end();
                } else {
                  resolve(response);
                }
              } catch (error) {
                reject(error);
              }
            });
          });
          
          req.on('error', reject);
          req.write(postData);
          req.end();
        });
      };
      
      const mockSay = async (options) => {
        return await postToSlack(options);
      };
      
      const mockClient = {
        chat: {
          postMessage: postToSlack
        }
      };
      
      const mockAck = async () => {
        // Acknowledge the interaction
        return { ok: true };
      };

      // Handle different button actions with proper mock functions
      if (actionId.startsWith('quick_log_')) {
        await messageHandler.handleQuickLog({ body, ack: mockAck, say: mockSay, client: mockClient });
      } else if (actionId.startsWith('quick_time_confirm_')) {
        await messageHandler.handleQuickTimeConfirm({ body, ack: mockAck, say: mockSay, client: mockClient });
      } else if (actionId.startsWith('quick_log_cancel_')) {
        await messageHandler.handleQuickLogCancel({ body, ack: mockAck, say: mockSay, client: mockClient });
      } else if (actionId.startsWith('log_time_confirm_') || actionId.startsWith('log_time_cancel_')) {
        // Handle natural language time logging confirmation/cancellation
        await messageHandler.handleTimeLogging({ 
          body, 
          ack: mockAck, 
          say: mockSay, 
          client: mockClient 
        });
      } else if (actionId === 'ticket_select') {
        await messageHandler.handleTicketSelection({ body, ack: mockAck, say: mockSay, client: mockClient });
      } else if (actionId === 'quick_ticket_select') {
        // Handle quick ticket selection from the quick interface
        await messageHandler.handleTicketSelection({ body, ack: mockAck, say: mockSay, client: mockClient });
      } else if (actionId === 'icon_config') {
        await configHandler.handleIconConfig({ body, ack: mockAck, say: mockSay, client: mockClient });
      } else {
        console.log('Unknown action ID:', actionId);
      }
      
      return createResponse(200, { message: 'Interaction processed' });
    }

    return createResponse(200, { message: 'Interaction received' });
    
  } catch (error) {
    console.error('Error processing Slack interaction:', error);
    
    // Try to send error message to user if possible
    if (body?.response_url) {
      try {
        const https = require('https');
        const errorPayload = {
          text: 'Sorry, I encountered an error processing your request. Please try again.',
          response_type: 'ephemeral'
        };
        
        const errorData = JSON.stringify(errorPayload);
        const errorUrl = new URL(body.response_url);
        
        const errorOptions = {
          hostname: errorUrl.hostname,
          port: 443,
          path: errorUrl.pathname + errorUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(errorData)
          }
        };
        
        const errorReq = https.request(errorOptions, (res) => {
          console.log('Error message sent to user');
        });
        
        errorReq.on('error', (err) => {
          console.error('Failed to send error message:', err);
        });
        
        errorReq.write(errorData);
        errorReq.end();
      } catch (fallbackError) {
        console.error('Failed to send error message via response_url:', fallbackError);
      }
    }
    
    return createResponse(500, { error: 'Internal server error' });
  }
}; 