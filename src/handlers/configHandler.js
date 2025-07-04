const { 
  getUserConfiguration, 
  createOrUpdateUserConfiguration, 
  deleteUserConfiguration 
} = require('../services/database');
const UserJiraService = require('../services/userJiraService');
const logger = require('../utils/logger');

class ConfigHandler {
  /**
   * Check if user has configured Jira access
   */
  async isUserConfigured(userId, platform) {
    try {
      const config = await getUserConfiguration(userId, platform);
      return config && config.is_configured;
    } catch (error) {
      logger.error('Error checking user configuration:', error);
      return false;
    }
  }

  /**
   * Get user's Jira configuration
   */
  async getUserConfig(userId, platform) {
    try {
      const config = await getUserConfiguration(userId, platform);
      return config;
    } catch (error) {
      logger.error('Error getting user configuration:', error);
      return null;
    }
  }

  /**
   * Set up user's Jira configuration
   */
  async setupUserConfig(userId, platform, jiraBaseUrl, jiraAccessToken, userEmail = null) {
    try {
      // Validate input
      if (!jiraBaseUrl || !jiraAccessToken) {
        return {
          success: false,
          error: 'Jira base URL and access token are required'
        };
      }

      // Clean up the URL
      jiraBaseUrl = jiraBaseUrl.trim();
      if (!jiraBaseUrl.startsWith('http://') && !jiraBaseUrl.startsWith('https://')) {
        jiraBaseUrl = 'https://' + jiraBaseUrl;
      }
      
      // Remove trailing slash
      jiraBaseUrl = jiraBaseUrl.replace(/\/$/, '');

      // Auto-detect Jira type based on URL
      const jiraType = this.detectJiraType(jiraBaseUrl);
      
      // For Jira Cloud, email is required
      if (jiraType === 'cloud' && !userEmail) {
        return {
          success: false,
          error: 'Email address is required for Jira Cloud. Usage: `/jiraconfig <jira-url> <api-token> <email>`'
        };
      }

      // Test the configuration
      const testConfig = {
        jira_type: jiraType,
        jira_base_url: jiraBaseUrl,
        jira_personal_access_token: jiraAccessToken.trim(),
        jira_email: userEmail ? userEmail.trim() : null
      };

      const jiraService = new UserJiraService(testConfig);
      const connectionTest = await jiraService.testConnection();

      if (!connectionTest.success) {
        const errorMessage = jiraType === 'cloud' 
          ? `Failed to connect to Jira Cloud: ${connectionTest.error}. Make sure you're using your email and API token (not password).`
          : `Failed to connect to Jira Server: ${connectionTest.error}. Make sure you're using a valid Personal Access Token.`;
        
        return {
          success: false,
          error: errorMessage
        };
      }

      // Save configuration
      const config = {
        jiraType,
        jiraBaseUrl,
        jiraPersonalAccessToken: jiraAccessToken.trim(),
        jiraUserId: connectionTest.user.accountId,
        jiraEmail: connectionTest.user.emailAddress
      };

      await createOrUpdateUserConfiguration(userId, platform, config);

      const typeMessage = jiraType === 'cloud' ? 'Jira Cloud' : 'Jira Server/Data Center';
      return {
        success: true,
        user: connectionTest.user,
        jiraType: jiraType,
        message: `Successfully configured ${typeMessage} access for ${connectionTest.user.displayName} (${connectionTest.user.emailAddress})`
      };
    } catch (error) {
      logger.error('Error setting up user configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Auto-detect Jira type based on URL
   */
  detectJiraType(jiraBaseUrl) {
    // Jira Cloud URLs typically follow the pattern: https://company.atlassian.net
    if (jiraBaseUrl.includes('.atlassian.net')) {
      return 'cloud';
    }
    
    // Everything else is considered Server/Data Center
    return 'server';
  }

  /**
   * Remove user's Jira configuration
   */
  async removeUserConfig(userId, platform) {
    try {
      await deleteUserConfiguration(userId, platform);
      return {
        success: true,
        message: 'Jira configuration removed successfully'
      };
    } catch (error) {
      logger.error('Error removing user configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get user's Jira service instance
   */
  async getUserJiraService(userId, platform) {
    try {
      const config = await getUserConfiguration(userId, platform);
      if (!config || !config.is_configured) {
        return null;
      }
      
      return new UserJiraService(config);
    } catch (error) {
      logger.error('Error creating user Jira service:', error);
      return null;
    }
  }

  /**
   * Test user's Jira connection
   */
  async testUserConnection(userId, platform) {
    try {
      const jiraService = await this.getUserJiraService(userId, platform);
      if (!jiraService) {
        return {
          success: false,
          error: 'No Jira configuration found. Please set up your Jira access first.'
        };
      }

      const result = await jiraService.testConnection();
      return result;
    } catch (error) {
      logger.error('Error testing user connection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get user's configuration status
   */
  async getUserConfigStatus(userId, platform) {
    try {
      const config = await getUserConfiguration(userId, platform);
      
      if (!config || !config.is_configured) {
        return {
          configured: false,
          message: 'No Jira configuration found.'
        };
      }

      // Test connection
      const connectionTest = await this.testUserConnection(userId, platform);
      
      return {
        configured: true,
        jiraBaseUrl: config.jira_base_url,
        jiraEmail: config.jira_email,
        connectionWorking: connectionTest.success,
        connectionError: connectionTest.success ? null : connectionTest.error,
        user: connectionTest.user || null
      };
    } catch (error) {
      logger.error('Error getting user configuration status:', error);
      return {
        configured: false,
        error: error.message
      };
    }
  }

  /**
   * Generate setup instructions for user
   */
  generateSetupInstructions(platform = 'slack') {
    const platformCommand = platform === 'teams' ? '/jiraconfig' : '/jiraconfig';
    
    return {
      title: 'Jira Configuration Setup',
      cloudInstructions: {
        title: 'For Jira Cloud (*.atlassian.net)',
        steps: [
          '1. Go to your Atlassian Account Settings',
          '2. Create an API Token in Security section',
          '3. Use: `' + platformCommand + ' <jira-url> <api-token> <your-email>`',
          'Example: `' + platformCommand + ' https://mycompany.atlassian.net abcd1234efgh5678 user@company.com`'
        ]
      },
      serverInstructions: {
        title: 'For Jira Server/Data Center',
        steps: [
          '1. Go to your Jira profile settings',
          '2. Create a Personal Access Token',
          '3. Use: `' + platformCommand + ' <jira-url> <personal-access-token>`',
          'Example: `' + platformCommand + ' https://jira.mycompany.com abcd1234efgh5678`'
        ]
      },
      instructions: [
        '1. **Create a Personal Access Token in Jira:**',
        '   • Go to your Jira profile settings',
        '   • Navigate to "Security" → "Personal Access Tokens"',
        '   • Create a new token with appropriate permissions',
        '   • Copy the token (you won\'t see it again)',
        '',
        '2. **Configure the bot with your Jira details:**',
        `   • Use: \`${platformCommand} <jira-url> <personal-access-token>\``,
        '   • Example: `/jiraconfig https://mycompany.atlassian.net abcd1234efgh5678`',
        '',
        '3. **Your Jira URL should be:**',
        '   • For Jira Cloud: `https://yourcompany.atlassian.net`',
        '   • For Jira Server: `https://jira.yourcompany.com`',
        '',
        '4. **Security:**',
        '   • Your token is encrypted and stored securely',
        '   • Only you can access your Jira data',
        '   • Use `/jiraconfig remove` to delete your configuration'
      ]
    };
  }

  /**
   * Save user's icon set preference
   */
  async saveUserIconSet(userId, platform, iconSet) {
    try {
      const { setIconSet } = require('../utils/iconConfig');
      await setIconSet(userId, platform, iconSet);
      logger.info(`Icon set updated for user ${userId} on ${platform}: ${iconSet}`);
    } catch (error) {
      logger.error('Error saving user icon set:', error);
      throw error;
    }
  }
}

module.exports = new ConfigHandler(); 