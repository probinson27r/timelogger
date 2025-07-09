const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Force refresh of secrets - v6.0 - FORCE REFRESH ALL LAMBDA VERSIONS - FINAL FIX
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

// Database-backed deduplication
async function isDuplicateEvent(eventKey) {
  try {
    // Add timeout wrapper for database operations
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database timeout')), 2000); // 2 second timeout
    });

    const databasePromise = (async () => {
      const { databaseService } = require('../services/databaseAdapter');
      await databaseService.initialize();
      
      if (databaseService.isAWS) {
        // Check if event exists in Aurora
        const result = await databaseService.service.pool.query(
          'SELECT id FROM processed_events WHERE event_key = $1 AND created_at > NOW() - INTERVAL \'5 minutes\'',
          [eventKey]
        );
        
        if (result.rows.length > 0) {
          return true; // Duplicate found
        }
        
        // Insert new event (ignore conflicts)
        try {
          await databaseService.service.pool.query(
            'INSERT INTO processed_events (event_key, created_at) VALUES ($1, NOW()) ON CONFLICT (event_key) DO NOTHING',
            [eventKey]
          );
        } catch (error) {
          // Ignore constraint violations - just means another instance got there first
          if (!error.message.includes('duplicate key')) {
            console.warn('Error inserting processed event:', error.message);
          }
        }
        
        return false; // Not a duplicate
      } else {
        // For local development, fall back to in-memory cache
        return false;
      }
    })();

    return await Promise.race([databasePromise, timeoutPromise]);
  } catch (error) {
    console.warn('Error checking for duplicate event (using timeout fallback):', error.message);
    return false; // On error or timeout, allow processing to continue
  }
}

async function cleanupOldEvents() {
  try {
    const { databaseService } = require('../services/databaseAdapter');
    if (databaseService.isAWS) {
      // Clean up events older than 5 minutes
      await databaseService.service.pool.query(
        'DELETE FROM processed_events WHERE created_at < NOW() - INTERVAL \'5 minutes\''
      );
    }
  } catch (error) {
    console.warn('Error cleaning up old events:', error.message);
  }
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
  console.log('Slack events:', JSON.stringify(event, null, 2));

  // Allow Lambda to finish async operations
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (!event.body) {
      return createResponse(400, { error: 'No body provided' });
    }

    // Parse body - Slack Events API sends JSON only
    let body;
    try {
      // Try parsing as JSON first (normal Events API)
      body = JSON.parse(event.body);
    } catch (jsonError) {
      // If JSON parsing fails, this might be a button interaction or slash command
      // These should go to their respective endpoints, not the events endpoint
      console.log('JSON parsing failed, likely button interaction or slash command:', jsonError.message);
      
      // Check if it's URL-encoded data (button interactions)
      if (event.body.startsWith('payload=')) {
        console.log('Button interaction received on events endpoint, ignoring');
        return createResponse(200, { message: 'Button interaction ignored on events endpoint' });
      }
      
      // Check if it's a slash command
      const params = new URLSearchParams(event.body);
      if (params.get('command')) {
        console.log('Slash command received on events endpoint, ignoring');
        return createResponse(200, { message: 'Slash command ignored on events endpoint' });
      }
      
      // If we can't parse it, return error
      return createResponse(400, { error: 'Invalid request format' });
    }
    
    // Handle Slack URL verification challenge
    if (body.type === 'url_verification') {
      return createResponse(200, { challenge: body.challenge });
    }

    // Handle Slack events
    if (body.type === 'event_callback') {
      const slackEvent = body.event;
      
      // Create a unique key for this event to prevent duplicate processing
      const eventKey = `${slackEvent.type}_${slackEvent.user}_${slackEvent.ts}_${slackEvent.channel}`;
      
      // Check if we've already processed this event (quick check first)
      if (await isDuplicateEvent(eventKey)) {
        console.log('Duplicate event detected, ignoring:', eventKey);
        return createResponse(200, { message: 'Duplicate event ignored' });
      }
      
      // Ignore bot messages and message edits - Enhanced bot filtering
      if (slackEvent.bot_id || 
          slackEvent.subtype === 'message_changed' || 
          slackEvent.subtype === 'bot_message' ||
          slackEvent.user === 'U094787DS2Z' || // Explicit bot user ID check
          (slackEvent.message && slackEvent.message.bot_id) ||
          (slackEvent.message && slackEvent.message.user === 'U094787DS2Z')) {
        console.log('Ignoring bot message or edit:', {
          bot_id: slackEvent.bot_id,
          subtype: slackEvent.subtype,
          user: slackEvent.user,
          message_bot_id: slackEvent.message?.bot_id
        });
        return createResponse(200, { message: 'Ignored bot or edited message' });
      }

      // Handle app mentions, direct messages, group messages, and public channels
      if (slackEvent.type === 'app_mention' || 
          (slackEvent.type === 'message' && (
            slackEvent.channel_type === 'im' || 
            slackEvent.channel_type === 'group' || 
            slackEvent.channel_type === 'channel'
          ))) {
        console.log('Processing message:', slackEvent.type, 'in channel type:', slackEvent.channel_type, 'channel:', slackEvent.channel);
        
        console.log('[LAMBDA DEBUG] Step 1: Starting getAppSecrets');
        // Get app secrets
        const secrets = await getAppSecrets();
        console.log('[LAMBDA DEBUG] Step 2: Got app secrets');
        
        // Set environment variables for existing code compatibility
        process.env.SLACK_BOT_TOKEN = secrets.SLACK_BOT_TOKEN;
        process.env.SLACK_SIGNING_SECRET = secrets.SLACK_SIGNING_SECRET;
        process.env.OPENAI_API_KEY = secrets.OPENAI_API_KEY;
        process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
        console.log('[LAMBDA DEBUG] Step 3: Set environment variables');

        console.log('[LAMBDA DEBUG] Step 4: Starting cleanupOldEvents');
        // Clean up old entries periodically
        await cleanupOldEvents();
        console.log('[LAMBDA DEBUG] Step 5: Completed cleanupOldEvents');
        
        console.log('[LAMBDA DEBUG] Step 6: Requiring messageHandler');
        // Import and use existing message handler
        const messageHandler = require('../handlers/messageHandler');
        console.log('[LAMBDA DEBUG] Step 7: Got messageHandler');
        
        // Create Slack Web API client
        const https = require('https');
        
        const postToSlack = async (options) => {
          const payload = {
            channel: slackEvent.channel,
            ...options
          };
          
          const postData = JSON.stringify(payload);
          
          const requestOptions = {
            hostname: 'slack.com',
            port: 443,
            path: '/api/chat.postMessage',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${secrets.SLACK_BOT_TOKEN}`,
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
                  console.log('Slack API response:', response);
                  
                  // If channel is archived, log it but don't fail
                  if (!response.ok && response.error === 'is_archived') {
                    console.log(`Channel ${slackEvent.channel} is archived, cannot send message`);
                    // Return a successful response to avoid errors
                    resolve({ ok: true, archived: true, warning: 'Channel is archived' });
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
        
        const mockClient = {
          chat: {
            postMessage: postToSlack
          }
        };
        
        // Create say function that posts to the same channel
        const mockSay = async (options) => {
          return await postToSlack(options);
        };

        console.log('[LAMBDA DEBUG] Step 8: About to call messageHandler.handleMessage');
        console.log('[LAMBDA DEBUG] slackEvent contents:', JSON.stringify(slackEvent, null, 2));
        console.log('[LAMBDA DEBUG] mockSay type:', typeof mockSay);
        console.log('[LAMBDA DEBUG] mockClient type:', typeof mockClient);
        
        // Use existing message handler with proper parameters
        await messageHandler.handleMessage({
          message: slackEvent,
          say: mockSay,
          client: mockClient
        });
        console.log('[LAMBDA DEBUG] Step 9: messageHandler.handleMessage completed');
        
        return createResponse(200, { message: 'Message processed' });
      }
    }

    return createResponse(200, { message: 'Event received' });

  } catch (error) {
    console.error('Error processing Slack event:', error);
    
    // Try to send error message to user if possible
    try {
      const secrets = await getAppSecrets();
      const https = require('https');
      
      const errorPayload = {
        channel: body?.event?.channel,
        text: 'Sorry, I encountered an error processing your message. Please try again.'
      };
      
      const errorData = JSON.stringify(errorPayload);
      
      const errorOptions = {
        hostname: 'slack.com',
        port: 443,
        path: '/api/chat.postMessage',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secrets.SLACK_BOT_TOKEN}`,
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
      console.error('Failed to send error message:', fallbackError);
    }
    
    return createResponse(500, { 
      error: 'Internal server error',
      details: error.message 
    });
  }
}; 