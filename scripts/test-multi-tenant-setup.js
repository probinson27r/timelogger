/**
 * Test script to validate multi-tenant setup
 * Tests the new user configuration system, database schema, and handlers
 */

require('dotenv').config();
const path = require('path');

// Set up the environment for testing
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-timelogger.db');

const configHandler = require('../src/handlers/configHandler');
const { getIconSet } = require('../src/utils/iconConfig');
const { initializeDatabase } = require('../src/services/database');
const logger = require('../src/utils/logger');

async function testMultiTenantSetup() {
  console.log('🧪 Testing Multi-Tenant Time Logger Setup...\n');

  try {
    // Initialize database
    console.log('1. Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized successfully\n');

    // Test user configuration
    console.log('2. Testing user configuration system...');
    
    const testUserId = 'test-user-123';
    const testPlatform = 'slack';
    
    // Check if user is configured (should be false)
    let isConfigured = await configHandler.isUserConfigured(testUserId, testPlatform);
    console.log(`   User configured status: ${isConfigured} (should be false)`);
    
    if (isConfigured) {
      console.log('❌ User should not be configured initially');
      return false;
    }

    // Test getting user jira service (should be null)
    let userJiraService = await configHandler.getUserJiraService(testUserId, testPlatform);
    console.log(`   User Jira service: ${userJiraService ? 'exists' : 'null'} (should be null)`);
    
    if (userJiraService) {
      console.log('❌ User Jira service should be null for unconfigured user');
      return false;
    }

    console.log('✅ User configuration system working correctly\n');

    // Test icon configuration
    console.log('3. Testing icon configuration system...');
    
    // Test default icon set
    let icons = await getIconSet(testUserId, testPlatform);
    console.log(`   Default icon set: ${icons.name} (${icons.description})`);
    console.log(`   Sample icons: ${icons.success}${icons.error}${icons.ticket}${icons.time}`);
    
    // Test setting different icon set
    await configHandler.saveUserIconSet(testUserId, testPlatform, 'minimal');
    icons = await getIconSet(testUserId, testPlatform);
    console.log(`   Updated icon set: ${icons.name} (${icons.description})`);
    console.log(`   Sample icons: ${icons.success}${icons.error}${icons.ticket}${icons.time}`);
    
    if (icons.name !== 'minimal') {
      console.log('❌ Icon set update failed');
      return false;
    }

    console.log('✅ Icon configuration system working correctly\n');

    // Test setup instructions
    console.log('4. Testing setup instructions...');
    
    const instructions = configHandler.generateSetupInstructions('slack');
    console.log(`   Instructions title: ${instructions.title}`);
    console.log(`   Instructions count: ${instructions.instructions.length} steps`);
    
    if (!instructions.instructions.some(step => step.includes('/jiraconfig'))) {
      console.log('❌ Setup instructions missing /jiraconfig command');
      return false;
    }

    console.log('✅ Setup instructions working correctly\n');

    // Test encryption system
    console.log('5. Testing encryption system...');
    
    if (!process.env.ENCRYPTION_KEY) {
      console.log('⚠️  ENCRYPTION_KEY not set - this is required for production');
    } else {
      console.log(`   Encryption key length: ${process.env.ENCRYPTION_KEY.length} chars`);
      if (process.env.ENCRYPTION_KEY.length < 32) {
        console.log('⚠️  ENCRYPTION_KEY should be at least 32 characters');
      } else {
        console.log('✅ Encryption key properly configured');
      }
    }

    console.log('\n🎉 Multi-tenant setup validation completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Set up your .env file with proper values');
    console.log('   2. Ensure ENCRYPTION_KEY is set (32+ characters)');
    console.log('   3. Deploy to Slack/Teams and test with real users');
    console.log('   4. Users can configure with: /jiraconfig <url> <token>');
    console.log('   5. Monitor logs for any configuration issues');

    return true;

  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testMultiTenantSetup()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Test crashed:', error);
      process.exit(1);
    });
}

module.exports = testMultiTenantSetup; 