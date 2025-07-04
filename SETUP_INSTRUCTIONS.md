# 🚀 Time Logger Bot - Complete Setup Guide

## 📋 **Overview**

This multi-tenant Time Logger bot allows each user to securely configure their own Jira access. No shared credentials needed!

## 🔧 **Quick Start (Recommended)**

### **1. Interactive Environment Setup**
```bash
npm run setup-env
```
This will guide you through setting up your `.env` file with proper encryption keys.

### **2. Manual Environment Setup**
If you prefer manual setup:
```bash
# Copy the template
cp env.example .env

# Generate encryption key
openssl rand -hex 32

# Edit .env and fill in your values
nano .env
```

## 📱 **Slack App Setup**

### **Step 1: Create Slack App**
1. Go to [Slack API Console](https://api.slack.com/apps)
2. Click **"Create New App"**
3. Choose **"From an app manifest"**
4. Select your workspace
5. Copy content from `slack-app-manifest.yml`
6. Paste and create the app

### **Step 2: Get Tokens**
From your new Slack app:

```bash
# Basic Information > App Credentials
SLACK_SIGNING_SECRET=your_signing_secret

# OAuth & Permissions > Bot User OAuth Token  
SLACK_BOT_TOKEN=xoxb-your-bot-token

# Basic Information > App-Level Tokens (create with connections:write)
SLACK_APP_TOKEN=xapp-your-app-token
```

### **Step 3: Install to Workspace**
1. Go to **OAuth & Permissions**
2. Click **"Install to Workspace"**
3. Authorize the app

## 🤖 **OpenAI Setup**

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Add to your `.env`:
```bash
OPENAI_API_KEY=sk-your-api-key
```

## 🔐 **Security Configuration**

Your `.env` file needs a secure encryption key:

```bash
# Generate with OpenSSL
openssl rand -hex 32

# Add to .env
ENCRYPTION_KEY=your-64-character-hex-key
```

This key encrypts all user Personal Access Tokens for maximum security.

## 🔄 **Database Migration (Existing Installations)**

If you're upgrading from a previous version, you may need to migrate your database:

### **Check if Migration is Needed**
```bash
# Test current setup
npm run test-multi-tenant
```

If you see errors about missing `user_id` columns, run the migration:

### **Backup & Migrate**
```bash
# 1. Backup your existing database (recommended)
cp data/timelogger.db data/timelogger.db.backup

# 2. Run the migration
npm run migrate-db

# 3. Verify migration success
npm run test-multi-tenant
```

### **What the Migration Does**
- ✅ Updates table structures for multi-tenant support
- ✅ Preserves all existing time logs and sessions
- ✅ Converts existing data to new format (defaults to 'slack' platform)
- ✅ Removes deprecated tables
- ✅ Maintains data integrity throughout

**Note:** The migration is safe and reversible (with your backup). All existing user data will be preserved.

## 🧪 **Validation & Testing**

### **Test Multi-Tenant Setup**
```bash
npm run test-multi-tenant
```

### **Validate Configuration**
```bash
npm run validate
```

### **Start the Bot**
```bash
# Slack only
npm run start:slack

# Teams only  
npm run start:teams

# Both platforms
npm run start:both
```

## 👥 **User Onboarding**

Once deployed, users configure their own Jira access:

### **First-Time Setup**
```bash
/jiraconfig https://company.atlassian.net user-personal-access-token
```

### **Daily Usage**
```bash
# Natural language time logging
"Log 3 hours to PROJ-123 working on authentication"
"I worked 2 hours yesterday on bug fixes"

# Quick commands
/mytickets        # Show assigned tickets
/timereport week  # Generate time report
/iconconfig text  # Change icon style
```

## 🛡️ **Security Features**

- ✅ **Per-User Encryption**: Each user's PAT encrypted separately
- ✅ **No Shared Secrets**: Zero shared Jira credentials
- ✅ **User Isolation**: Users only see their own data
- ✅ **Cross-Platform**: Same security on Slack & Teams
- ✅ **Easy Cleanup**: Users can remove config anytime

## 🔄 **Optional: Teams Setup**

For Microsoft Teams support, follow `TEAMS_SETUP.md`:

```bash
# Validate Teams configuration
npm run validate:teams

# Start Teams bot
npm run start:teams
```

## 📊 **Available Commands**

| Command | Description | Example |
|---------|-------------|---------|
| `/jiraconfig` | Setup personal Jira access | `/jiraconfig https://company.atlassian.net token123` |
| `/timelog` | Log time to tickets | `/timelog 3h to PROJ-123 fixing bugs` |
| `/mytickets` | Show assigned tickets | `/mytickets` |
| `/timereport` | Generate time reports | `/timereport week` |
| `/iconconfig` | Configure icon display | `/iconconfig minimal` |

## 🆘 **Troubleshooting**

### **Common Issues**

**"Setup Required" Message**
- User needs to run `/jiraconfig` first
- Each user must configure their own Jira access

**"Connection Failed"**
- Check Jira URL format (`https://company.atlassian.net`)
- Verify Personal Access Token is valid
- Ensure user has project permissions

**"No Tickets Found"**
- User may not have assigned tickets in Jira
- Check ticket assignment in Jira

**"Encryption Error"**
- Ensure `ENCRYPTION_KEY` is set in `.env`
- Key must be 64 hex characters (32 bytes)

### **Validation Commands**
```bash
# Test multi-tenant functionality
npm run test-multi-tenant

# Validate Slack configuration
npm run validate

# Validate Teams configuration  
npm run validate:teams
```

## 🚀 **Production Deployment**

### **Environment Variables**
```bash
NODE_ENV=production
LOG_LEVEL=warn
PORT=3000

# Use secure key management
ENCRYPTION_KEY=use-azure-key-vault-or-aws-secrets
```

### **Security Checklist**
- [ ] Strong encryption key (32+ bytes)
- [ ] Secure `.env` file permissions
- [ ] Regular security audits
- [ ] Monitor authentication logs
- [ ] User access reviews

## 💡 **Pro Tips**

- **Icon Customization**: Users can personalize with `/iconconfig`
- **Natural Language**: Bot understands "yesterday", "last Friday", etc.
- **Cross-Platform**: Same user config works on Slack & Teams
- **Time Formats**: Supports "3h", "2.5 hours", "30 minutes"
- **Bulk Operations**: Log time to multiple tickets easily

## 📞 **Support**

### **For Administrators**
- Check application logs in `logs/` directory
- Monitor user configuration status
- Review encryption key security

### **For Users**
- Use `/jiraconfig` for setup help
- Send "help" message to bot for commands
- Contact admin for permissions issues

---

## 🎉 **You're Ready!**

Your multi-tenant Time Logger bot is configured and ready for deployment. Users can now securely log time to their own Jira tickets without sharing credentials!

**Next Steps:**
1. Deploy to your chosen platform
2. Train users on `/jiraconfig` setup
3. Monitor logs for any issues
4. Enjoy secure, personalized time tracking! 🚀 