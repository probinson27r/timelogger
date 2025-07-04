# Slack-Jira Time Logger Bot 🤖⏱️

A Slack bot that helps users log time to Jira tickets using natural language processing. Users can ask for their assigned tickets and log hours with simple conversational commands.

## Features 🚀

- **Multi-Tenant Support**: Each user configures their own Jira access (Cloud or Server/Data Center)
- **Auto-Detection**: Automatically detects Jira type (Cloud vs Server) based on URL
- **Secure Storage**: User credentials encrypted and stored per-user
- **Natural Language Processing**: Users can interact with the bot using everyday language
- **Multiple Interfaces**: 
  - Direct messaging with the bot
  - Slash commands (`/timelog`, `/mytickets`, `/jiraconfig`)
  - Interactive buttons and select menus
- **Smart Time Parsing**: Understands various time formats (3 hours, 2h, 30 minutes, etc.)
- **Ticket Selection**: If no ticket is specified, the bot asks the user to choose from their assigned tickets
- **Session Management**: Maintains conversation context for multi-step interactions

## User Experience 💬

Users can interact with the bot in several ways:

### Natural Language Messages
```
"Show me my tickets"
"What tickets are assigned to me?"
"Log 3 hours to ABC-123"
"I worked 2.5 hours on fixing the login bug"
"Log 30 minutes" (bot will ask which ticket)
```

### Slash Commands
```
/timelog                          # Shows quick interface
/timelog 3 hours to ABC-123      # Direct time logging
/mytickets                       # Shows assigned tickets
```

### Interactive Elements
- Click "Log Time" buttons on tickets
- Select tickets from dropdown menus
- Quick time selection interface

## Prerequisites 📋

- Node.js 16+ 
- Jira Cloud OR Jira Server/Data Center instance with API access
- Slack workspace with bot creation permissions
- OpenAI API key for natural language processing

## Setup Instructions 🛠️

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd TimeLogger
npm install
```

### 2. Jira Setup

The application supports both Jira Cloud and Jira Server/Data Center. Choose the appropriate setup for your Jira instance:

#### For Jira Cloud (*.atlassian.net)

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a descriptive name like "Slack Time Logger Bot"
4. Copy the generated API token (you won't be able to see it again)
5. Note your Jira base URL (e.g., `https://yourcompany.atlassian.net`)
6. You'll need your email address for authentication

**Configuration**: `/jiraconfig <jira-url> <api-token> <email>`
**Example**: `/jiraconfig https://mycompany.atlassian.net abcd1234efgh5678 user@company.com`

#### For Jira Server/Data Center

1. Go to your Jira profile settings
2. Navigate to Security > Personal Access Tokens
3. Create a new Personal Access Token
4. Give it a descriptive name and appropriate permissions
5. Copy the generated token
6. Note your Jira base URL (e.g., `https://jira.yourcompany.com`)

**Configuration**: `/jiraconfig <jira-url> <personal-access-token>`
**Example**: `/jiraconfig https://jira.mycompany.com abcd1234efgh5678`

### 3. Slack App Setup

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click "Create New App" → "From an app manifest"
3. Copy the contents of `slack-app-manifest.yml` from this repository

**Important**: The manifest includes the essential `/jiraconfig` command for Cloud/Server authentication setup.

4. Install the app to your workspace
5. Copy the Bot Token (`xoxb-...`) and App Token (`xapp-...`)
6. Go to "Basic Information" and copy the Signing Secret

### 4. OpenAI Setup

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)

### 5. Environment Configuration

1. Copy the environment template:
   ```bash
   cp env.example .env
   ```

2. Fill in your configuration:
   ```bash
   # Slack Configuration
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token

   # OpenAI Configuration
   OPENAI_API_KEY=your-openai-api-key

   # Security
   ENCRYPTION_KEY=your-32-character-encryption-key

   # Application Configuration
   PORT=3000
   NODE_ENV=development
   LOG_LEVEL=info

   # Database
   DB_PATH=./data/timelogger.db
   ```

**Note**: Jira configuration is now done per-user using the `/jiraconfig` command. No global Jira credentials are needed in the environment file.

### 6. Validate Your Setup

Before starting the application, run the validation script to test your configuration:

```bash
npm run validate
```

This will check:
- OpenAI API key and connectivity  
- Slack token format validation
- Database connectivity

**Note**: Jira connectivity is now validated per-user when they run `/jiraconfig` command.

### 7. Start the Application

```bash
# Validate and start in one command
npm run setup

# Or start directly after validation
npm start

# Development mode with auto-restart
npm run dev
```

The application will:
- Initialize the SQLite database
- Start the Slack bot in Socket Mode
- Start an Express server on the specified port

## Usage Examples 🎯

### First-Time Setup
Every user needs to configure their Jira access once:

**For Jira Cloud users:**
```
/jiraconfig https://mycompany.atlassian.net myApiToken123 user@company.com
```

**For Jira Server users:**
```
/jiraconfig https://jira.company.com myPersonalAccessToken123
```

### Basic Time Logging
```
User: "Log 3 hours to DEV-123"
Bot: "✅ Successfully logged 3 hours to DEV-123!"
```

### Time Logging Without Ticket
```
User: "I worked 2 hours on the login bug"
Bot: "Which ticket would you like to log this time to?" 
    [Shows dropdown with assigned tickets]
```

### View Assigned Tickets
```
User: "Show me my tickets"
Bot: [Shows list of assigned tickets with "Log Time" buttons]
```

### Using Slash Commands
```
User: "/timelog 1.5 hours to API-456 fixing authentication"
Bot: "✅ Successfully logged 1.5 hours to API-456!"
```

## Architecture 🏗️

```
src/
├── app.js                     # Main application entry point
├── handlers/
│   ├── messageHandler.js      # Natural language message processing
│   └── slashCommandHandler.js # Slash command handling
├── services/
│   ├── database.js           # SQLite database operations
│   ├── jiraService.js        # Jira API integration
│   └── openaiService.js      # Natural language processing
└── utils/
    └── logger.js             # Winston logging configuration
```

## Database Schema 📊

### user_mappings
- Maps Slack users to Jira accounts
- Stores email associations

### user_sessions
- Maintains conversation context
- Handles multi-step interactions

### time_logs
- Records all time entries
- Links to Jira worklog IDs

## Deployment 🚀

### Development
Use ngrok to expose your local server:
```bash
ngrok http 3000
```
Update your Slack app's request URLs to use the ngrok URL.

### Production
Deploy to your preferred platform (Heroku, AWS, etc.) and update Slack app configuration with your production URLs.

## Troubleshooting 🔧

### Common Issues

1. **"Couldn't find your Jira account"**
   - Ensure your Slack email matches your Jira email
   - Check Jira Personal Access Token is valid and has proper permissions
   - Verify JIRA_BASE_URL is correct

2. **OpenAI errors**
   - Verify API key is valid
   - Check API usage limits

3. **Database errors**
   - Ensure `data/` directory is writable
   - Check SQLite installation

### Logs
Check the logs in:
- `logs/error.log` - Error messages
- `logs/combined.log` - All log messages
- Console output for real-time debugging

## Contributing 🤝

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License 📄

MIT License - see LICENSE file for details.

## Support 💬

For issues and questions:
1. Check the troubleshooting section
2. Review the logs
3. Open an issue on GitHub

---

Built with ❤️ using Slack Bolt, Jira API, and OpenAI 