#!/usr/bin/env node

/**
 * Simple Slack Socket Mode Connection Test
 */

require('dotenv').config();
const { App } = require('@slack/bolt');

async function testSlackConnection() {
  console.log('🔍 Testing Slack Socket Mode Connection...\n');

  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  console.log('Configuration:');
  console.log(`Bot Token: ${botToken ? botToken.substring(0, 12) + '...' : 'NOT SET'}`);
  console.log(`App Token: ${appToken ? appToken.substring(0, 12) + '...' : 'NOT SET'}`);
  console.log(`Signing Secret: ${signingSecret ? 'SET' : 'NOT SET'}\n`);

  if (!botToken || !appToken || !signingSecret) {
    console.log('❌ Missing required Slack tokens');
    return;
  }

  try {
    console.log('Creating Slack app...');
    
    const app = new App({
      token: botToken,
      signingSecret: signingSecret,
      socketMode: true,
      appToken: appToken,
      port: 3000
    });

    console.log('✅ App created successfully');
    console.log('Attempting to start...');

    // Add connection event listeners
    app.client.on('connect', () => {
      console.log('✅ Socket Mode connected successfully!');
    });

    app.client.on('disconnect', () => {
      console.log('⚠️  Socket Mode disconnected');
    });

    app.client.on('error', (error) => {
      console.log('❌ Socket Mode error:', error.message);
    });

    // Add a simple test handler
    app.message('test', async ({ message, say }) => {
      await say('Test message received!');
    });

    // Start the app with timeout
    const startPromise = app.start();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
    );

    await Promise.race([startPromise, timeoutPromise]);
    
    console.log('✅ Slack app started successfully!');
    console.log('🎉 Socket Mode is working correctly');
    console.log('\nYou can now:');
    console.log('1. Invite the bot to a channel');
    console.log('2. Send a message with "test" to verify it responds');
    console.log('\nPress Ctrl+C to stop the test');

    // Keep running for testing
    process.on('SIGINT', () => {
      console.log('\n👋 Stopping test...');
      process.exit(0);
    });

  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    console.log('\n🔧 Troubleshooting steps:');
    console.log('1. Check Socket Mode is enabled in Slack app settings');
    console.log('2. Verify app is installed to your workspace');
    console.log('3. Regenerate App Token if needed');
    console.log('4. Check network/firewall allows WebSocket connections');
    
    if (error.message.includes('invalid_app_token')) {
      console.log('5. ⚠️  App Token is invalid - regenerate it in Slack app settings');
    }
    
    if (error.message.includes('not_authed')) {
      console.log('5. ⚠️  Bot Token is invalid - check OAuth installation');
    }
  }
}

if (require.main === module) {
  testSlackConnection().catch(console.error);
}

module.exports = testSlackConnection; 