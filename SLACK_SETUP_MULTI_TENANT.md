# Slack App Setup - Multi-Tenant Time Logger Bot

## 🚀 **Quick Setup Guide**

### **1. Create New Slack App**
1. Go to [Slack API Console](https://api.slack.com/apps)
2. Click **"Create New App"**
3. Choose **"From an app manifest"**
4. Select your workspace
5. Copy and paste the content from `slack-app-manifest.yml`
6. Review and create the app

### **2. Get Your Tokens**
After creating the app, you'll need these tokens for your `.env` file:

```bash
# From "Basic Information" > "App Credentials"
SLACK_SIGNING_SECRET=your_signing_secret_here

# From "OAuth & Permissions" > "Bot User OAuth Token"
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# From "Basic Information" > "App-Level Tokens" (create one with connections:write scope)
SLACK_APP_TOKEN=xapp-your-app-token-here
```

### **3. Install App to Workspace**
1. Go to **"OAuth & Permissions"**
2. Click **"Install to Workspace"**
3. Authorize the app
4. Copy the **Bot User OAuth Token**

### **4. Enable Socket Mode**
1. Go to **"Socket Mode"** in the sidebar
2. Enable Socket Mode
3. Create an App-Level Token with `connections:write` scope
4. Copy the token (starts with `xapp-`)

## 🔧 **New Multi-Tenant Features**

### **`/jiraconfig` Command**
- **Purpose**: Each user configures their own Jira access
- **Usage**: `/jiraconfig https://company.atlassian.net your-personal-access-token`
- **Security**: Personal Access Tokens are encrypted per-user
- **Flexibility**: Supports any Jira instance (Cloud, Server, Enterprise)

### **Enhanced Commands**
All existing commands now work with per-user configurations:
- `/timelog` - Uses user's personal Jira access
- `/mytickets` - Shows user's own assigned tickets  
- `/timereport` - Reports user's personal time logs
- `/iconconfig` - Per-user icon preferences

## 🛡️ **Security & Privacy**

### **Multi-Tenant Benefits**
- ✅ **User Isolation**: Each user only sees their own data
- ✅ **Secure Storage**: PATs encrypted with AES-256-CBC
- ✅ **No Shared Secrets**: No global Jira credentials
- ✅ **Cross-Platform**: Same config works in Teams too

### **Data Protection**
- Personal Access Tokens are encrypted before storage
- Each user authenticates with their own Jira account
- No shared access to tickets or time logs
- Users can remove their config anytime

## 📋 **User Onboarding Flow**

### **First-Time Setup**
1. **User tries bot**: Gets setup prompt if unconfigured
2. **User runs**: `/jiraconfig https://company.atlassian.net their-token`
3. **Bot validates**: Tests connection and saves encrypted config
4. **Ready to use**: All features now available with personal access

### **Daily Usage**
```bash
# Natural language time logging
"Log 3 hours to PROJ-123 working on authentication feature"
"I worked 2 hours yesterday on bug fixes"

# Quick ticket access
/mytickets

# Time reporting
/timereport week
```

## 🔄 **Deployment Options**

### **Socket Mode (Development)**
- Uses the manifest as-is
- Perfect for local development
- No public URLs required
- Real-time WebSocket connection

### **Events API (Production)**
- Update URLs in manifest to your domain
- Requires public HTTPS endpoints
- Better for production deployments
- More scalable for large teams

## 🎯 **Next Steps**

1. **Create the app** using the manifest
2. **Copy tokens** to your `.env` file
3. **Set ENCRYPTION_KEY** (32+ characters)
4. **Test locally** with `npm run dev:slack`
5. **Deploy** and invite team members
6. **Train users** on the `/jiraconfig` setup

## 💡 **Pro Tips**

- **Encryption Key**: Generate with `openssl rand -hex 32`
- **PAT Permissions**: Users need Jira project access and work log permissions
- **Icon Sets**: Users can customize with `/iconconfig minimal`
- **Cross-Platform**: Same user config works in Teams too
- **Monitoring**: Check logs for configuration issues

---

## 🆘 **Troubleshooting**

### **Common Issues**
- **"Setup Required"**: User needs to run `/jiraconfig`
- **"Connection Failed"**: Check Jira URL and PAT validity
- **"No Tickets"**: User may not have assigned tickets
- **"Encryption Error"**: Ensure `ENCRYPTION_KEY` is set

### **Support Commands**
```bash
# Check configuration status
/jiraconfig

# View available commands  
help

# Update icon preferences
/iconconfig text
```

Ready to deploy your multi-tenant Time Logger bot! 🚀 