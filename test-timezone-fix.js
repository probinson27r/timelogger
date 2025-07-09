const moment = require('moment-timezone');
const dateParser = require('./src/utils/dateParser');

console.log('=== Timezone Fix Test ===\n');

// Test current time in different timezones
const utcNow = moment();
const singaporeNow = moment().tz('Asia/Singapore');

console.log('Current time:');
console.log(`UTC: ${utcNow.format('YYYY-MM-DD HH:mm:ss')}`);
console.log(`Singapore (UTC+8): ${singaporeNow.format('YYYY-MM-DD HH:mm:ss')}`);
console.log(`Timezone offset: ${singaporeNow.format('Z')}\n`);

// Test date parsing
console.log('Date parsing tests:');
const testDates = ['today', 'yesterday', 'last friday'];

testDates.forEach(dateText => {
  const result = dateParser.parseDate(dateText, 'Asia/Singapore');
  console.log(`${dateText}: ${result.formatted} (${result.displayText})`);
});

console.log('\n=== Date Range Tests ===');

// Test date ranges
const periods = ['today', 'yesterday', 'week', 'month', 'year', 'all'];

periods.forEach(period => {
  const range = dateParser.getDateRange(period, 'Asia/Singapore');
  console.log(`${period}:`);
  console.log(`  Start: ${range.start.format('YYYY-MM-DD HH:mm:ss Z')}`);
  console.log(`  End: ${range.end.format('YYYY-MM-DD HH:mm:ss Z')}`);
  console.log(`  Start UTC: ${range.start.toISOString()}`);
  console.log(`  End UTC: ${range.end.toISOString()}\n`);
});

console.log('=== Test Complete ==='); 