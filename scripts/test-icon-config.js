#!/usr/bin/env node

/**
 * Test script for Icon Configuration
 */

const icons = require('../src/utils/iconConfig');

function testIconConfiguration() {
  console.log('🧪 Testing Icon Configuration System...\n');

  // Show all available icon sets
  console.log('📋 Available Icon Sets:');
  console.log('=======================');
  const availableSets = icons.getAvailableSets();
  Object.entries(availableSets).forEach(([key, description]) => {
    console.log(`${key}: ${description}`);
  });
  console.log();

  // Preview all icon sets
  console.log('👀 Icon Set Preview:');
  console.log('====================');
  icons.previewAllSets();

  // Test changing icon sets and showing example messages
  const testSets = ['current', 'large', 'small', 'minimal', 'none'];
  
  console.log('💬 Example Slack Messages with Different Icon Sets:');
  console.log('===================================================');

  testSets.forEach(setName => {
    console.log(`\n--- ${setName.toUpperCase()} SET ---`);
    icons.setIconSet(setName);
    
    // Example messages
    console.log(`Success: "${icons.get('success')}Successfully logged 3 hours to ABC-123!"`);
    console.log(`Report:  "${icons.get('report')}Time Logging Summary"`);
    console.log(`Timer:   "${icons.get('timer')}Quick Time Logger"`);
    console.log(`Help:    "${icons.get('robot')}Time Logger Bot Help"`);
    console.log(`Celebration: "${icons.get('celebration')}No tickets assigned!"`);
    console.log(`Calendar: "${icons.get('calendar')}Today's Time Log"`);
    console.log(`Loading: "${icons.get('loading')}Generating report..."`);
  });

  // Reset to default
  icons.setIconSet('current');
  
  console.log('\n✅ Icon configuration test completed!');
  console.log('\n🎯 How to use:');
  console.log('   • Use `/iconconfig` to see current settings');
  console.log('   • Use `/iconconfig large` to make icons more prominent');
  console.log('   • Use `/iconconfig small` for minimal visual impact');
  console.log('   • Use `/iconconfig none` for clean text-only messages');
  console.log('   • Changes apply to all future bot messages');
}

if (require.main === module) {
  testIconConfiguration();
}

module.exports = testIconConfiguration; 