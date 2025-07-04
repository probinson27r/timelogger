# Microsoft Teams Integration Setup Guide

This guide will help you set up the Time Logger Bot for Microsoft Teams.

## Prerequisites

1. **Microsoft Teams Admin Access** - You'll need admin permissions to register the bot
2. **Azure Bot Service** - For bot registration and authentication
3. **Existing Environment** - The Slack version should already be configured with Jira and OpenAI

## Step 1: Register Your Bot in Azure

### Option A: Using Azure Portal

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Bot Service**
3. Click **Create a resource** > **AI + Machine Learning** > **Bot**
4. Fill in the details:
   - **Bot handle**: `timelogger-bot` (or your preferred name)
   - **Resource group**: Create new or use existing
   - **Pricing tier**: F0 (Free tier is sufficient for development)
   - **App ID**: Will be generated automatically
   - **App password**: Will be generated automatically

### Option B: Using Azure CLI

```bash
# Login to Azure
az login

# Create resource group
az group create --name timelogger-rg --location "East US"

# Create bot registration
az bot create --resource-group timelogger-rg --name timelogger-bot --kind webapp --version v4 --lang Node --verbose
```

## Step 2: Configure Environment Variables

Add these variables to your `.env` file:

```bash
# Microsoft Teams Configuration
TEAMS_APP_ID=your-azure-app-id
TEAMS_APP_PASSWORD=your-azure-app-password
TEAMS_APP_TENANT_ID=your-tenant-id-optional
TEAMS_PORT=3978

# Existing variables (should already be configured)
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_PERSONAL_ACCESS_TOKEN=your-jira-pat
OPENAI_API_KEY=your-openai-key
JIRA_REJECT_UNAUTHORIZED=false
```

## Step 3: Configure Bot Messaging Endpoint

1. In Azure Portal, go to your bot resource
2. Navigate to **Configuration**
3. Set **Messaging endpoint** to: `https://your-domain.ngrok.io/api/messages`
   - For local development, use ngrok: `ngrok http 3978`
   - For production, use your actual domain

## Step 4: Enable Teams Channel

1. In Azure Portal, go to your bot resource
2. Navigate to **Channels**
3. Click on **Microsoft Teams** channel
4. Click **Apply** to enable Teams integration

## Step 5: Create Teams App Package

### Update App Manifest

1. Edit `teams-app-manifest.json`
2. Replace `{{TEAMS_APP_ID}}` with your actual Azure App ID
3. Update the `developer` section with your information
4. Add app icons (32x32 and 192x192 PNG files)

### Create App Package

```bash
# Create app package directory
mkdir teams-app-package
cd teams-app-package

# Copy manifest
cp ../teams-app-manifest.json ./manifest.json

# Add icons (you'll need to create these)
# timelogger-color.png (192x192)
# timelogger-outline.png (32x32)

# Create ZIP package
zip -r timelogger-teams-app.zip manifest.json *.png
```

## Step 6: Install App in Teams

### Option A: Upload Custom App (Development)

1. Open Microsoft Teams
2. Go to **Apps** > **Manage your apps**
3. Click **Upload a custom app**
4. Select your `timelogger-teams-app.zip` file
5. Click **Add** to install

### Option B: Teams Admin Center (Organization)

1. Go to [Teams Admin Center](https://admin.teams.microsoft.com)
2. Navigate to **Teams apps** > **Manage apps**
3. Click **Upload** and select your app package
4. Configure app permissions and policies

## Step 7: Validate Setup

Run the Teams validation script:

```bash
npm run validate:teams
```

This will test:
- Environment variables
- Dependencies
- Bot Framework configuration
- Jira connection
- OpenAI connection
- Database connection
- Port availability

## Step 8: Start the Bot

```bash
# Start Teams bot only
npm run start:teams

# Start both Slack and Teams
npm run start:both

# Development mode with auto-reload
npm run dev:teams
```

## Step 9: Test the Bot

1. Open Microsoft Teams
2. Go to **Chat** and search for your bot
3. Start a conversation with the bot
4. Try these commands:
   - `help` - Show help message
   - `log 2 hours to PROJ-123` - Log time
   - `/mytickets` - Show assigned tickets
   - `/timereport today` - Generate time report

## Troubleshooting

### Common Issues

**1. Bot not responding in Teams**
- Check if messaging endpoint is correct
- Verify bot is properly registered in Azure
- Ensure Teams channel is enabled

**2. Authentication errors**
- Verify TEAMS_APP_ID and TEAMS_APP_PASSWORD are correct
- Check if app is properly registered in Azure AD

**3. Adaptive Cards not showing**
- Ensure you're using Bot Framework v4.x
- Check if adaptive card schema is compatible

**4. ngrok tunnel issues**
- Make sure ngrok is running: `ngrok http 3978`
- Update messaging endpoint in Azure when ngrok URL changes

### Debug Commands

```bash
# Test Teams connection
node scripts/validate-teams-setup.js

# View detailed logs
DEBUG=* npm run start:teams

# Test specific functionality
node scripts/test-teams-messages.js
```

## Teams vs Slack Differences

| Feature | Slack | Teams |
|---------|-------|--------|
| Message Format | Blocks | Adaptive Cards |
| Commands | Slash commands | Text commands |
| Interactions | Button actions | Card actions |
| Authentication | Socket Mode | Bot Framework |
| Hosting | Local/ngrok | Azure Bot Service |

## Production Deployment

For production deployment:

1. **Azure App Service**: Deploy bot to Azure App Service
2. **Application Insights**: Enable logging and monitoring
3. **Bot Analytics**: Track usage and performance
4. **Security**: Use Azure Key Vault for secrets
5. **Scaling**: Configure auto-scaling policies

## API Reference

### Teams-Specific Commands

```javascript
// Natural language examples
"log 3 hours to PROJ-123"
"I worked 2 hours yesterday on bug fixing"
"log 4h to ticket last Friday"
"How many hours did I log today?"
"Show me my time report for this week"

// Slash commands
/timelog - Log time to tickets
/mytickets - Show assigned tickets
/timereport - Generate time reports
/iconconfig - Configure icon display
```

### Teams Message Types

- **Text Messages**: Simple text responses
- **Adaptive Cards**: Rich interactive cards
- **Card Actions**: Button clicks and form submissions
- **Proactive Messages**: Bot-initiated conversations

## Support

For issues specific to Teams integration:

1. Check the [Bot Framework documentation](https://docs.microsoft.com/en-us/azure/bot-service/)
2. Review [Teams app development guide](https://docs.microsoft.com/en-us/microsoftteams/platform/)
3. Test with the validation script: `npm run validate:teams`
4. Check logs for detailed error messages

## Next Steps

- Set up CI/CD pipeline for automated deployments
- Configure monitoring and alerting
- Add more advanced Teams features (tabs, messaging extensions)
- Implement SSO for enterprise environments 