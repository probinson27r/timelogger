const { SecretsManagerClient, UpdateSecretCommand, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// AWS Secrets ARNs from current deployment
const APP_SECRETS_ARN = 'arn:aws:secretsmanager:ap-southeast-2:199279692978:secret:AppSecretsA1997F2A-9V7N0BcKXIW5-c7zDSr';
const DB_SECRET_ARN = 'arn:aws:secretsmanager:ap-southeast-2:199279692978:secret:AuroraSecret41E6E877-sp0l5vg9NaDz-m91D3u';

const secretsClient = new SecretsManagerClient({ region: 'ap-southeast-2' });

async function updateAppSecrets() {
  console.log('🔄 Updating App Secrets...');
  
  // Get current app secrets to see what's there
  try {
    const getCommand = new GetSecretValueCommand({ SecretId: APP_SECRETS_ARN });
    const response = await secretsClient.send(getCommand);
    const currentSecrets = JSON.parse(response.SecretString);
    
    console.log('Current App Secrets:');
    Object.keys(currentSecrets).forEach(key => {
      if (key === 'ENCRYPTION_KEY') {
        console.log(`  ${key}: ${currentSecrets[key].substring(0, 8)}...`);
      } else if (key.includes('TOKEN') || key.includes('SECRET') || key.includes('KEY')) {
        console.log(`  ${key}: ${currentSecrets[key].substring(0, 10)}...`);
      } else {
        console.log(`  ${key}: ${currentSecrets[key]}`);
      }
    });
  } catch (error) {
    console.log('Could not retrieve current secrets:', error.message);
  }
  
  console.log('\n📝 Please provide the following values:');
  
  // Get values from user (you can modify this to use environment variables)
  const newSecrets = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || 'CHANGE_ME',
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || 'CHANGE_ME',
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN || 'CHANGE_ME',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'CHANGE_ME',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'CHANGE_ME_32_CHARS_LONG_KEY_HERE',
    TEAMS_APP_ID: process.env.TEAMS_APP_ID || '',
    TEAMS_APP_PASSWORD: process.env.TEAMS_APP_PASSWORD || '',
  };
  
  console.log('New App Secrets to be set:');
  Object.keys(newSecrets).forEach(key => {
    if (key === 'ENCRYPTION_KEY') {
      console.log(`  ${key}: ${newSecrets[key].substring(0, 8)}...`);
    } else if (key.includes('TOKEN') || key.includes('SECRET') || key.includes('KEY')) {
      console.log(`  ${key}: ${newSecrets[key].substring(0, 10)}...`);
    } else {
      console.log(`  ${key}: ${newSecrets[key]}`);
    }
  });
  
  // Update the secret
  try {
    const updateCommand = new UpdateSecretCommand({
      SecretId: APP_SECRETS_ARN,
      SecretString: JSON.stringify(newSecrets, null, 2)
    });
    
    await secretsClient.send(updateCommand);
    console.log('✅ App Secrets updated successfully!');
  } catch (error) {
    console.error('❌ Error updating App Secrets:', error.message);
  }
}

async function checkDatabaseSecret() {
  console.log('\n🔄 Checking Database Secret...');
  
  try {
    const getCommand = new GetSecretValueCommand({ SecretId: DB_SECRET_ARN });
    const response = await secretsClient.send(getCommand);
    const dbSecrets = JSON.parse(response.SecretString);
    
    console.log('Database Secret (managed by CDK):');
    Object.keys(dbSecrets).forEach(key => {
      if (key === 'password') {
        console.log(`  ${key}: ${dbSecrets[key].substring(0, 8)}...`);
      } else {
        console.log(`  ${key}: ${dbSecrets[key]}`);
      }
    });
    
    console.log('✅ Database secret is managed by CDK and should not be manually updated.');
  } catch (error) {
    console.error('❌ Error checking Database Secret:', error.message);
  }
}

async function main() {
  console.log('🔐 AWS Secrets Update Tool');
  console.log('==========================\n');
  
  await updateAppSecrets();
  await checkDatabaseSecret();
  
  console.log('\n📋 Summary:');
  console.log('- App Secrets ARN:', APP_SECRETS_ARN);
  console.log('- Database Secret ARN:', DB_SECRET_ARN);
  console.log('\n💡 To update secrets with environment variables, run:');
  console.log('SLACK_BOT_TOKEN=xoxb-your-token SLACK_SIGNING_SECRET=your-secret node scripts/update-aws-secrets.js');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { updateAppSecrets, checkDatabaseSecret }; 