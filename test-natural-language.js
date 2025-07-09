const https = require('https');

// Test the natural language processing directly
const testData = {
  token: "WZk7S3nF3kvJtifkO7AIXzDt",
  team_id: "T9E2GG5BK",
  api_app_id: "A094A8ZTF0U",
  event: {
    user: "U01V4HE31U2",
    type: "message",
    ts: Date.now() / 1000,
    text: "I worked on IKON-8934 for 3 hours yesterday",
    team: "T9E2GG5BK",
    channel: "C094J3C5X9Q",
    event_ts: Date.now() / 1000,
    channel_type: "group"
  },
  type: "event_callback",
  event_id: "TEST_" + Date.now(),
  event_time: Math.floor(Date.now() / 1000)
};

const postData = JSON.stringify(testData);

const options = {
  hostname: '63jzcnjke8.execute-api.ap-southeast-2.amazonaws.com',
  port: 443,
  path: '/prod/slack/events',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'X-Slack-Signature': 'v0=test',
    'X-Slack-Request-Timestamp': Math.floor(Date.now() / 1000).toString()
  }
};

console.log('Testing natural language: "I worked on IKON-8934 for 3 hours yesterday"');
console.log('Using new API Gateway endpoint:', options.hostname);

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', data);
    if (res.statusCode === 200) {
      console.log('✅ SUCCESS: Natural language processing is working!');
    } else {
      console.log('❌ FAILED: Error in natural language processing');
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end(); 