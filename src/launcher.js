require('dotenv').config();
const logger = require('./utils/logger');

// Parse command line arguments
const args = process.argv.slice(2);
const platform = args[0]?.toLowerCase();

if (platform === 'help' || platform === '--help' || platform === '-h') {
  console.log('Time Logger Bot Launcher');
  console.log('Usage: node src/launcher.js [platform]');
  console.log('Platforms: slack, teams, both');
  process.exit(0);
}

async function startSlackBot() {
  try {
    logger.info('Starting Slack Time Logger Bot...');
    
    // Check required environment variables
    const requiredVars = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN'];
    const missing = requiredVars.filter(v => !process.env[v]);
    
    if (missing.length > 0) {
      logger.error(`Missing required Slack environment variables: ${missing.join(', ')}`);
      return false;
    }
    
    // Import and start Slack app
    require('./app');
    return true;
  } catch (error) {
    logger.error('Failed to start Slack bot:', error);
    return false;
  }
}

async function startTeamsBot() {
  try {
    logger.info('Starting Teams Time Logger Bot...');
    
    // Check required environment variables
    const requiredVars = ['TEAMS_APP_ID', 'TEAMS_APP_PASSWORD'];
    const missing = requiredVars.filter(v => !process.env[v]);
    
    if (missing.length > 0) {
      logger.error(`Missing required Teams environment variables: ${missing.join(', ')}`);
      return false;
    }
    
    // Import and start Teams app
    require('./teamsApp');
    return true;
  } catch (error) {
    logger.error('Failed to start Teams bot:', error);
    return false;
  }
}

async function checkSharedEnvironment() {
  const requiredVars = ['OPENAI_API_KEY', 'ENCRYPTION_KEY'];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    logger.error(`Missing required shared environment variables: ${missing.join(', ')}`);
    logger.error('For multi-tenant setup, you need:');
    logger.error('  - OPENAI_API_KEY: Your OpenAI API key');
    logger.error('  - ENCRYPTION_KEY: Secure key for encrypting user PATs (32+ chars)');
    logger.error('Run "npm run setup-env" for interactive setup');
    return false;
  }
  
  return true;
}

async function main() {
  logger.info('Time Logger Bot Launcher');
  
  // Check shared environment first
  if (!(await checkSharedEnvironment())) {
    logger.error('Shared environment check failed');
    process.exit(1);
  }
  
  let slackStarted = false;
  let teamsStarted = false;
  
  switch (platform) {
    case 'teams':
      teamsStarted = await startTeamsBot();
      break;
      
    case 'both':
      slackStarted = await startSlackBot();
      teamsStarted = await startTeamsBot();
      break;
      
    case 'slack':
    case undefined:
    default:
      slackStarted = await startSlackBot();
      break;
  }
  
  // Summary
  logger.info('Startup Summary:');
  if (slackStarted) logger.info('Slack bot: Running');
  if (teamsStarted) logger.info('Teams bot: Running');
  
  if (!slackStarted && !teamsStarted) {
    logger.error('No bots started successfully');
    process.exit(1);
  }
  
  logger.info('Time Logger Bot(s) are ready!');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
  process.exit(0);
});

// Start the launcher
main().catch(error => {
  logger.error('Launcher error:', error);
  process.exit(1);
}); 