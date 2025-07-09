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

async function makeSlackRequest(endpoint, token, payload = {}) {
  const postData = JSON.stringify(payload);
  
  const requestOptions = {
    hostname: 'slack.com',
    port: 443,
    path: `/api/${endpoint}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
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

async function testSlackAPI() {
  try {
    // Get the secrets ARN from CloudFormation
    const AWS = require('aws-sdk');
    const cloudformation = new AWS.CloudFormation({ region: 'ap-southeast-2' });
    
    const stackResponse = await cloudformation.describeStacks({
      StackName: 'TimeLoggerStack'
    }).promise();
    
    const outputs = stackResponse.Stacks[0].Outputs;
    const secretsArn = outputs.find(o => o.OutputKey === 'AppSecretsArn')?.OutputValue;
    
    if (!secretsArn) {
      console.error('Could not find AppSecretsArn output from CloudFormation stack');
      return;
    }
    
    console.log('Found secrets ARN:', secretsArn);
    process.env.APP_SECRETS_ARN = secretsArn;
    
    const secrets = await getAppSecrets();
    const token = secrets.SLACK_BOT_TOKEN;
    
    console.log('Bot token (first 10 chars):', token.substring(0, 10));
    
    // Test 1: Bot info
    console.log('\\n=== Testing bot info ===');
    const botInfo = await makeSlackRequest('auth.test', token);
    console.log('Bot info:', JSON.stringify(botInfo, null, 2));
    
    // Test 2: Channel info for the problematic channel
    const channelId = 'C09564WGVCG';
    console.log(`\\n=== Testing channel info for ${channelId} ===`);
    const channelInfo = await makeSlackRequest('conversations.info', token, {
      channel: channelId
    });
    console.log('Channel info:', JSON.stringify(channelInfo, null, 2));
    
    // Test 3: List channels the bot is in
    console.log('\\n=== Testing bot channel membership ===');
    const channels = await makeSlackRequest('conversations.list', token, {
      types: 'public_channel,private_channel,mpim,im'
    });
    console.log('Channels bot can see:', channels.channels?.map(c => ({ id: c.id, name: c.name, is_member: c.is_member })));
    
    // Test 4: Try to send a test message
    console.log(`\\n=== Testing message send to ${channelId} ===`);
    const testMessage = await makeSlackRequest('chat.postMessage', token, {
      channel: channelId,
      text: 'Test message from debug script'
    });
    console.log('Test message result:', JSON.stringify(testMessage, null, 2));
    
  } catch (error) {
    console.error('Error testing Slack API:', error);
  }
}

testSlackAPI(); 