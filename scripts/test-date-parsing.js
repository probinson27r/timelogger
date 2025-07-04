#!/usr/bin/env node

/**
 * Test script for Date Parsing functionality
 */

require('dotenv').config();
const dateParser = require('../src/utils/dateParser');
const moment = require('moment');

function testDateParsing() {
  console.log('🧪 Testing Date Parsing functionality...\n');

  const testCases = [
    // Basic relative dates
    'yesterday',
    'today',
    'last Friday',
    'Friday',
    'last Monday',
    
    // Days ago format
    '3 days ago',
    '1 week ago',
    '2 weeks ago',
    
    // Specific dates (these might fail if not current)
    'July 1st',
    'July 1st, 2024',
    '2024-07-01',
    '07/01/2024',
    
    // Complex expressions from text
    'log 3 hours yesterday',
    'I worked 2h on Friday',
    'for July 1st - debugging',
    'Log time for last Tuesday',
    
    // Invalid cases
    'tomorrow',
    'next week',
    'invalid date',
    ''
  ];

  console.log('📅 Testing individual date parsing:');
  console.log('=====================================');
  
  testCases.forEach(testCase => {
    const result = dateParser.parseDate(testCase);
    const status = result.isValid ? '✅' : '❌';
    const dateDisplay = result.isValid ? result.displayText : result.error;
    
    console.log(`${status} "${testCase}" → ${dateDisplay}`);
    if (result.isValid) {
      console.log(`    Date: ${result.formatted}, isPast: ${result.isPast}, isToday: ${result.isToday}`);
    }
    console.log();
  });

  console.log('\n🔍 Testing date extraction from text:');
  console.log('=====================================');
  
  const textExtractionTests = [
    'log 3 hours yesterday to ABC-123',
    'I worked 4 hours last Friday on bug fixes',
    'Log time for July 1st - 2 hours debugging',
    'Log 5 hours 3 days ago',
    'I spent 2.5h on Monday working on features',
    'Log 1 hour today to ticket DEF-456',
    'Log 3h to ABC-123' // no date
  ];

  textExtractionTests.forEach(text => {
    const result = dateParser.extractDateFromText(text);
    if (result) {
      console.log(`✅ "${text}"`);
      console.log(`    Extracted: "${result.extractedText}" → ${result.displayText}`);
      console.log(`    Remaining: "${result.remainingText}"`);
    } else {
      console.log(`❌ "${text}" → No date found`);
    }
    console.log();
  });

  console.log('\n🏁 Date parsing test completed!');
  console.log('\n🎯 You can now use these date formats:');
  console.log('   • Natural language: "yesterday", "last Friday", "3 days ago"');
  console.log('   • Specific dates: "July 1st", "2024-07-01"');
  console.log('   • In commands: "log 3h yesterday", "I worked 2h last Friday"');
  console.log('   • Slash commands: "/timelog 2h yesterday to ABC-123"');
}

if (require.main === module) {
  testDateParsing();
}

module.exports = testDateParsing; 