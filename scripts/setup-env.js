#!/usr/bin/env node

/**
 * Setup script for Time Logger Bot environment configuration
 * This script helps create a .env file with proper encryption key
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

async function createEnvFile() {
  console.log('🔧 Time Logger Bot - Environment Setup\n');
  
  const envPath = path.join(__dirname, '..', '.env');
  const examplePath = path.join(__dirname, '..', 'env.example');
  
  // Check if .env already exists
  if (fs.existsSync(envPath)) {
    const overwrite = await question('⚠️  .env file already exists. Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
      console.log('❌ Setup cancelled. Existing .env file preserved.');
      rl.close();
      return;
    }
  }
  
  // Read the template
  if (!fs.existsSync(examplePath)) {
    console.error('❌ env.example file not found!');
    rl.close();
    return;
  }
  
  console.log('📋 Let\'s set up your environment variables...\n');
  
  // Generate encryption key
  const encryptionKey = generateEncryptionKey();
  console.log('🔐 Generated secure encryption key (32 bytes)');
  
  // Get user inputs
  console.log('\n📱 Slack Configuration:');
  const slackBotToken = await question('   SLACK_BOT_TOKEN (xoxb-...): ');
  const slackSigningSecret = await question('   SLACK_SIGNING_SECRET: ');
  const slackAppToken = await question('   SLACK_APP_TOKEN (xapp-...): ');
  
  console.log('\n🤖 OpenAI Configuration:');
  const openaiApiKey = await question('   OPENAI_API_KEY (sk-...): ');
  
  console.log('\n🔧 Optional - Teams Configuration (press Enter to skip):');
  const teamsAppId = await question('   TEAMS_APP_ID: ');
  const teamsAppPassword = await question('   TEAMS_APP_PASSWORD: ');
  const teamsAppTenantId = await question('   TEAMS_APP_TENANT_ID: ');
  
  // Read template and replace values
  let envContent = fs.readFileSync(examplePath, 'utf8');
  
  // Replace values
  envContent = envContent.replace('SLACK_BOT_TOKEN=xoxb-your-bot-token', `SLACK_BOT_TOKEN=${slackBotToken}`);
  envContent = envContent.replace('SLACK_SIGNING_SECRET=your-signing-secret', `SLACK_SIGNING_SECRET=${slackSigningSecret}`);
  envContent = envContent.replace('SLACK_APP_TOKEN=xapp-your-app-token', `SLACK_APP_TOKEN=${slackAppToken}`);
  envContent = envContent.replace('OPENAI_API_KEY=your-openai-api-key', `OPENAI_API_KEY=${openaiApiKey}`);
  envContent = envContent.replace('ENCRYPTION_KEY=your-32-character-encryption-key-here', `ENCRYPTION_KEY=${encryptionKey}`);
  
  if (teamsAppId) {
    envContent = envContent.replace('TEAMS_APP_ID=your-teams-app-id', `TEAMS_APP_ID=${teamsAppId}`);
  }
  if (teamsAppPassword) {
    envContent = envContent.replace('TEAMS_APP_PASSWORD=your-teams-app-password', `TEAMS_APP_PASSWORD=${teamsAppPassword}`);
  }
  if (teamsAppTenantId) {
    envContent = envContent.replace('TEAMS_APP_TENANT_ID=your-teams-tenant-id', `TEAMS_APP_TENANT_ID=${teamsAppTenantId}`);
  }
  
  // Write .env file
  fs.writeFileSync(envPath, envContent);
  
  console.log('\n✅ .env file created successfully!');
  console.log('\n📋 Summary:');
  console.log(`   📁 File location: ${envPath}`);
  console.log(`   🔐 Encryption key: Generated (${encryptionKey.length} chars)`);
  console.log(`   📱 Slack: ${slackBotToken ? 'Configured' : 'Not configured'}`);
  console.log(`   🤖 OpenAI: ${openaiApiKey ? 'Configured' : 'Not configured'}`);
  console.log(`   👥 Teams: ${teamsAppId ? 'Configured' : 'Not configured'}`);
  
  console.log('\n🚀 Next steps:');
  console.log('   1. Review your .env file');
  console.log('   2. Run: npm start');
  console.log('   3. Users configure Jira with: /jiraconfig <url> <token>');
  
  console.log('\n🔒 Security reminder:');
  console.log('   - Never commit the .env file to version control');
  console.log('   - Keep your encryption key secure');
  console.log('   - User PATs are encrypted with this key');
  
  rl.close();
}

// Run the setup
if (require.main === module) {
  createEnvFile().catch((error) => {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  });
}

module.exports = createEnvFile; 