const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const https = require('https');

const secretsClient = new SecretsManagerClient({ region: 'ap-southeast-2' });

async function getAppSecrets() {
  const command = new GetSecretValueCommand({
    SecretId: process.env.APP_SECRETS_ARN,
  });
  
  const response = await secretsClient.send(command);
  return JSON.parse(response.SecretString);
}

async function testSlackAPI() {
  try {
    const secrets = await getAppSecrets();
    const token = secrets.SLACK_BOT_TOKEN;
    
    console.log('Bot token (first 10 chars):', token.substring(0, 10));
    
    // Test 1: Bot info
    console.log('\n=== Testing bot info ===');
    const botInfo = await makeSlackRequest('auth.test', token);
    console.log('Bot info:', JSON.stringify(botInfo, null, 2));
    
    // Test 2: List channels
    console.log('\n=== Testing channel list ===');
    const channels = await makeSlackRequest('conversations.list', token, { types: 'public_channel,private_channel' });
    console.log('Channels:', channels.channels?.map(c => ({ id: c.id, name: c.name, is_member: c.is_member })));
    
    // Test 3: Test specific channel
    const testChannelId = 'C09564WGVCG';
    console.log(`\n=== Testing channel ${testChannelId} ===`);
    const channelInfo = await makeSlackRequest('conversations.info', token, { channel: testChannelId });
    console.log('Channel info:', JSON.stringify(channelInfo, null, 2));
    
    // Test 4: Test posting to channel
    console.log(`\n=== Testing post to channel ${testChannelId} ===`);
    const postResult = await makeSlackRequest('chat.postMessage', token, {
      channel: testChannelId,
      text: 'Test message from TimeLogger bot'
    });
    console.log('Post result:', JSON.stringify(postResult, null, 2));
    
  } catch (error) {
    console.error('Error testing Slack API:', error);
  }
}

function makeSlackRequest(method, token, data = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: 'slack.com',
      port: 443,
      path: `/api/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Run the test
testSlackAPI(); 