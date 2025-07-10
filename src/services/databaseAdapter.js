const logger = require('../utils/logger');

class DatabaseAdapter {
  constructor() {
    this.service = null;
    // Better AWS environment detection for Lambda
    this.isAWS = process.env.AWS_LAMBDA_FUNCTION_NAME || 
                 process.env.AWS_EXECUTION_ENV === 'AWS_Lambda_nodejs18.x' ||
                 (process.env.NODE_ENV === 'production' && process.env.DB_SECRET_ARN);
  }

  async initialize() {
    if (this.service && this.service.db) return this.service;

    try {
      if (this.isAWS) {
        // Use Aurora service for AWS deployment
        logger.info('Initializing Aurora database service for AWS...');
        this.service = require('./auroraService');
        await this.service.initialize();
      } else {
        // Use SQLite service for local development
        logger.info('Initializing SQLite database service for local development...');
        const { databaseService } = require('./database');
        this.service = databaseService;
        await this.service.initialize();
      }
      
      return this.service;
    } catch (error) {
      logger.error('Database adapter initialization failed:', error);
      throw error;
    }
  }

  // Map SQLite methods to Aurora methods for compatibility
  async getUserConfiguration(userId, platform = 'slack') {
    await this.initialize();
    
    if (this.isAWS) {
      // Aurora uses different method name and structure
      const config = await this.service.getUserConfig(userId);
      if (!config) return null;
      
      // Convert Aurora format to SQLite format for compatibility
      return {
        user_id: config.user_id,
        platform: platform,
        jira_type: config.jira_server_type || 'server',
        jira_base_url: config.jira_server_url,
        jira_personal_access_token: config.jira_api_token,
        jira_user_id: config.jira_username,
        jira_email: config.jira_username,
        is_configured: config.jira_api_token ? 1 : 0
      };
    } else {
      return await this.service.getUserConfiguration(userId, platform);
    }
  }

  async createOrUpdateUserConfiguration(userId, platform, config) {
    await this.initialize();
    
    if (this.isAWS) {
      // Convert SQLite format to Aurora format
      const auroraConfig = {
        jira_server_url: config.jiraBaseUrl,
        jira_username: config.jiraUserId || config.jiraEmail,
        jira_api_token: config.jiraPersonalAccessToken,
        jira_server_type: config.jiraType || 'server'
      };
      
      return await this.service.saveUserConfig(userId, auroraConfig);
    } else {
      return await this.service.createOrUpdateUserConfiguration(userId, platform, config);
    }
  }

  async deleteUserConfiguration(userId, platform = 'slack') {
    await this.initialize();
    
    if (this.isAWS) {
      return await this.service.deleteUserConfig(userId);
    } else {
      return await this.service.deleteUserConfiguration(userId, platform);
    }
  }

  async logTimeEntry(userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId) {
    await this.initialize();
    
    if (this.isAWS) {
      // Convert hours to time string format that Aurora expects
      const timeSpent = `${hoursLogged}h`;
      return await this.service.saveTimeLog(userId, jiraTicketKey, timeSpent, description, logDate, jiraWorklogId);
    } else {
      return await this.service.logTimeEntry(userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId);
    }
  }

  // Delegate other methods to the underlying service
  async createUserSession(userId, platform, sessionType, sessionData, expiresAt) {
    await this.initialize();
    return await this.service.createUserSession(userId, platform, sessionType, sessionData, expiresAt);
  }

  async getUserSession(userId, platform, sessionType) {
    await this.initialize();
    return await this.service.getUserSession(userId, platform, sessionType);
  }

  async getUserSessionById(sessionId) {
    await this.initialize();
    return await this.service.getUserSessionById(sessionId);
  }

  async updateUserSessionById(sessionId, sessionType, sessionData) {
    await this.initialize();
    return await this.service.updateUserSessionById(sessionId, sessionType, sessionData);
  }

  async deleteUserSessionById(sessionId) {
    await this.initialize();
    return await this.service.deleteUserSessionById(sessionId);
  }

  async deleteUserSession(userId, platform, sessionType) {
    await this.initialize();
    return await this.service.deleteUserSession(userId, platform, sessionType);
  }

  async getUserSetting(userId, platform, settingKey) {
    await this.initialize();
    if (this.isAWS) {
      // Aurora doesn't support user settings yet, return null
      return null;
    }
    return await this.service.getUserSetting(userId, platform, settingKey);
  }

  async setUserSetting(userId, platform, settingKey, settingValue) {
    await this.initialize();
    if (this.isAWS) {
      // Aurora doesn't support user settings yet, return success
      return true;
    }
    return await this.service.setUserSetting(userId, platform, settingKey, settingValue);
  }

  async close() {
    if (this.service && this.service.close) {
      await this.service.close();
    }
  }
}

// Create singleton instance
const databaseAdapter = new DatabaseAdapter();

module.exports = {
  databaseService: databaseAdapter,
  getUserConfiguration: (userId, platform) => databaseAdapter.getUserConfiguration(userId, platform),
  createOrUpdateUserConfiguration: (userId, platform, config) => databaseAdapter.createOrUpdateUserConfiguration(userId, platform, config),
  deleteUserConfiguration: (userId, platform) => databaseAdapter.deleteUserConfiguration(userId, platform),
  logTimeEntry: (userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId) => 
    databaseAdapter.logTimeEntry(userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId),
  createUserSession: (userId, platform, sessionType, sessionData, expiresAt) => 
    databaseAdapter.createUserSession(userId, platform, sessionType, sessionData, expiresAt),
  getUserSession: (userId, platform, sessionType) => databaseAdapter.getUserSession(userId, platform, sessionType),
  getUserSessionById: (sessionId) => databaseAdapter.getUserSessionById(sessionId),
  updateUserSessionById: (sessionId, sessionType, sessionData) => databaseAdapter.updateUserSessionById(sessionId, sessionType, sessionData),
  deleteUserSessionById: (sessionId) => databaseAdapter.deleteUserSessionById(sessionId),
  deleteUserSession: (userId, platform, sessionType) => databaseAdapter.deleteUserSession(userId, platform, sessionType),
  getUserSetting: (userId, platform, settingKey) => databaseAdapter.getUserSetting(userId, platform, settingKey),
  setUserSetting: (userId, platform, settingKey, settingValue) => databaseAdapter.setUserSetting(userId, platform, settingKey, settingValue)
}; 