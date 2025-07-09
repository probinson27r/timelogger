const axios = require('axios');

const API_BASE_URL = 'https://63jzcnjke8.execute-api.ap-southeast-2.amazonaws.com/prod';

async function testWithDifferentDates() {
    console.log('🧪 Testing natural language with different date formats...\n');
    
    const testCases = [
        'I worked on IKON-8934 for 3 hours yesterday',
        'Log 2 hours to IKON-8934 today',
        'I spent 4 hours on IKON-8934 last Friday',
        'Log 1.5h to IKON-8934 working on testing'
    ];

    for (const testText of testCases) {
        console.log(`Testing: "${testText}"`);
        
        const testPayload = {
            token: 'WZk7S3nF3kvJtifkO7AIXzDt',
            team_id: 'T9E2GG5BK',
            context_team_id: 'T9E2GG5BK',
            context_enterprise_id: null,
            api_app_id: 'A094A8ZTF0U',
            event: {
                user: 'U01V4HE31U2',
                type: 'message',
                ts: Math.floor(Date.now() / 1000).toString() + '.000000',
                client_msg_id: 'test-' + Math.random().toString(36).substr(2, 9),
                text: testText,
                team: 'T9E2GG5BK',
                blocks: [{
                    type: 'rich_text',
                    block_id: '4TwvZ',
                    elements: [{
                        type: 'rich_text_section',
                        elements: [{
                            type: 'text',
                            text: testText
                        }]
                    }]
                }],
                channel: 'C094J3C5X9Q',
                event_ts: Math.floor(Date.now() / 1000).toString() + '.000000',
                channel_type: 'group'
            },
            type: 'event_callback',
            event_id: 'Ev094EV4NECW-' + Math.random().toString(36).substr(2, 9),
            event_time: Math.floor(Date.now() / 1000),
            authorizations: [{
                enterprise_id: null,
                team_id: 'T9E2GG5BK',
                user_id: 'U094787DS2Z',
                is_bot: true,
                is_enterprise_install: false
            }],
            is_ext_shared_channel: false,
            event_context: '4-eyJldCI6Im1lc3NhZ2UiLCJ0aWQiOiJUOUUyR0c1QksiLCJhaWQiOiJBMDk0QThaVEYwVSIsImNpZCI6IkMwOTRKM0M1WDlRIn0'
        };

        try {
            const response = await axios.post(`${API_BASE_URL}/slack/events`, testPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Slack-Request-Timestamp': Math.floor(Date.now() / 1000).toString(),
                    'X-Slack-Signature': 'v0=test_signature'
                },
                timeout: 30000
            });

            if (response.status === 200) {
                console.log(`✅ Success: ${response.data.message}`);
            } else {
                console.log(`❌ Unexpected status: ${response.status}`);
            }

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
            if (error.response) {
                console.error(`   Status: ${error.response.status}`);
                console.error(`   Data: ${JSON.stringify(error.response.data)}`);
            }
        }
        
        console.log(''); // blank line for readability
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function main() {
    await testWithDifferentDates();
    
    console.log('🔍 All tests completed.');
    console.log('📝 If you see any "Sorry, I encountered an error" responses in Slack,');
    console.log('   check the Lambda logs for specific error details.');
    console.log('📋 The fix should prevent the "parsedDate.toISOString is not a function" error.');
}

main().catch(console.error); 