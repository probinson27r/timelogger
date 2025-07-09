// Conditional database service - use Aurora on AWS, SQLite locally
if (process.env.NODE_ENV === 'production' && process.env.DB_SECRET_ARN) {
  // Running on AWS - use the database adapter
  module.exports = require('./databaseAdapter');
  return;
}

// Original SQLite implementation for local development
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = process.env.DB_PATH || './data/timelogger.db';
    this.encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  // Encryption methods for storing sensitive data
  encrypt(text) {
    if (!text) return null;
    try {
      const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return encrypted;
    } catch (error) {
      logger.error('Error encrypting data:', error);
      return null;
    }
  }

  decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
      // Handle any format - try different approaches
      
      // First try: if it has a colon, try just the second part (removing IV prefix)
      if (encryptedText.includes(':')) {
        const parts = encryptedText.split(':');
        if (parts.length === 2) {
          try {
            const encrypted = parts[1]; // Ignore IV, just use encrypted part
            const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
          } catch (error) {
            // If this fails, continue to next method
            logger.warn('Colon-separated decryption failed, trying direct method');
          }
        }
      }
      
      // Second try: direct decryption (for legacy format without colon)
      try {
        const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch (directError) {
        // Final fallback failed
      }
      
      logger.warn('All decryption methods failed, token may need to be reconfigured');
      return null;
      
    } catch (error) {
      logger.error('Error decrypting data:', error);
      return null;
    }
  }

  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Create database connection
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Error opening database:', err);
          throw err;
        }
        logger.info('Connected to SQLite database');
      });

      // Create tables
      await this.createTables();
    } catch (error) {
      logger.error('Database initialization error:', error);
      throw error;
    }
  }

  async createTables() {
    const createUserConfigurationsTable = `
      CREATE TABLE IF NOT EXISTS user_configurations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE NOT NULL,
        platform TEXT NOT NULL,
        jira_type TEXT NOT NULL,
        jira_base_url TEXT,
        jira_personal_access_token TEXT,
        jira_user_id TEXT,
        jira_email TEXT,
        is_configured BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createUserSessionsTable = `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        session_type TEXT NOT NULL,
        session_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      )
    `;

    const createTimeLogsTable = `
      CREATE TABLE IF NOT EXISTS time_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        jira_ticket_key TEXT NOT NULL,
        hours_logged REAL NOT NULL,
        description TEXT,
        log_date DATE NOT NULL,
        jira_worklog_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createUserSettingsTable = `
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform, setting_key)
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(createUserConfigurationsTable);
        this.db.run(createUserSessionsTable);
        this.db.run(createTimeLogsTable);
        this.db.run(createUserSettingsTable, (err) => {
          if (err) {
            logger.error('Error creating tables:', err);
            reject(err);
          } else {
            logger.info('Database tables created successfully');
            resolve();
          }
        });
      });
    });
  }

  async getUserConfiguration(userId, platform = 'slack') {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM user_configurations WHERE user_id = ? AND platform = ?',
        [userId, platform],
        (err, row) => {
          if (err) {
            logger.error('Error getting user configuration:', err);
            reject(err);
          } else {
            if (row && row.jira_personal_access_token) {
              row.jira_personal_access_token = this.decrypt(row.jira_personal_access_token);
            }
            resolve(row);
          }
        }
      );
    });
  }

  async createOrUpdateUserConfiguration(userId, platform, config) {
    const {
      jiraType = 'server',
      jiraBaseUrl,
      jiraPersonalAccessToken,
      jiraUserId,
      jiraEmail
    } = config;

    return new Promise((resolve, reject) => {
      // Encrypt the PAT/API token before storing
      const encryptedToken = this.encrypt(jiraPersonalAccessToken);
      
      this.db.run(
        `INSERT OR REPLACE INTO user_configurations 
         (user_id, platform, jira_type, jira_base_url, jira_personal_access_token, jira_user_id, jira_email, is_configured, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [userId, platform, jiraType, jiraBaseUrl, encryptedToken, jiraUserId, jiraEmail],
        function(err) {
          if (err) {
            logger.error('Error creating/updating user configuration:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async deleteUserConfiguration(userId, platform = 'slack') {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM user_configurations WHERE user_id = ? AND platform = ?',
        [userId, platform],
        function(err) {
          if (err) {
            logger.error('Error deleting user configuration:', err);
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  async createUserSession(userId, platform, sessionType, sessionData, expiresAt) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO user_sessions 
         (user_id, platform, session_type, session_data, expires_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, platform, sessionType, JSON.stringify(sessionData), expiresAt],
        function(err) {
          if (err) {
            logger.error('Error creating user session:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async getUserSession(userId, platform, sessionType) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM user_sessions 
         WHERE user_id = ? AND platform = ? AND session_type = ? 
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         ORDER BY created_at DESC LIMIT 1`,
        [userId, platform, sessionType],
        (err, row) => {
          if (err) {
            logger.error('Error getting user session:', err);
            reject(err);
          } else {
            if (row && row.session_data) {
              row.session_data = JSON.parse(row.session_data);
            }
            resolve(row);
          }
        }
      );
    });
  }

  async getUserSessionById(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM user_sessions 
         WHERE id = ? 
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        [sessionId],
        (err, row) => {
          if (err) {
            logger.error('Error getting user session by ID:', err);
            reject(err);
          } else {
            if (row && row.session_data) {
              row.session_data = JSON.parse(row.session_data);
            }
            resolve(row);
          }
        }
      );
    });
  }

  async deleteUserSession(userId, platform, sessionType) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM user_sessions WHERE user_id = ? AND platform = ? AND session_type = ?',
        [userId, platform, sessionType],
        function(err) {
          if (err) {
            logger.error('Error deleting user session:', err);
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  async updateUserSessionById(sessionId, sessionType, sessionData) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE user_sessions SET session_type = ?, session_data = ? WHERE id = ?',
        [sessionType, JSON.stringify(sessionData), sessionId],
        function(err) {
          if (err) {
            logger.error('Error updating user session by ID:', err);
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  async deleteUserSessionById(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM user_sessions WHERE id = ?',
        [sessionId],
        function(err) {
          if (err) {
            logger.error('Error deleting user session by ID:', err);
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  async logTimeEntry(userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO time_logs 
         (user_id, platform, jira_ticket_key, hours_logged, description, log_date, jira_worklog_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId],
        function(err) {
          if (err) {
            logger.error('Error logging time entry:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async getUserSetting(userId, platform, settingKey) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT setting_value FROM user_settings WHERE user_id = ? AND platform = ? AND setting_key = ?',
        [userId, platform, settingKey],
        (err, row) => {
          if (err) {
            logger.error('Error getting user setting:', err);
            reject(err);
          } else {
            resolve(row ? row.setting_value : null);
          }
        }
      );
    });
  }

  async setUserSetting(userId, platform, settingKey, settingValue) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO user_settings 
         (user_id, platform, setting_key, setting_value, updated_at) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, platform, settingKey, settingValue],
        function(err) {
          if (err) {
            logger.error('Error setting user setting:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async close() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db.close((err) => {
          if (err) {
            logger.error('Error closing database:', err);
            reject(err);
          } else {
            logger.info('Database connection closed');
            resolve();
          }
        });
      });
    }
  }
}

const databaseService = new DatabaseService();

async function initializeDatabase() {
  await databaseService.initialize();
}

// Convenience functions for easier imports
async function getUserConfiguration(userId, platform = 'slack') {
  return await databaseService.getUserConfiguration(userId, platform);
}

async function createOrUpdateUserConfiguration(userId, platform, config) {
  return await databaseService.createOrUpdateUserConfiguration(userId, platform, config);
}

async function deleteUserConfiguration(userId, platform = 'slack') {
  return await databaseService.deleteUserConfiguration(userId, platform);
}

async function createUserSession(userId, platform, sessionType, sessionData, expiresAt) {
  return await databaseService.createUserSession(userId, platform, sessionType, sessionData, expiresAt);
}

async function getUserSession(userId, platform, sessionType) {
  return await databaseService.getUserSession(userId, platform, sessionType);
}

async function getUserSessionById(sessionId) {
  return await databaseService.getUserSessionById(sessionId);
}

async function deleteUserSession(userId, platform, sessionType) {
  return await databaseService.deleteUserSession(userId, platform, sessionType);
}

async function updateUserSessionById(sessionId, sessionType, sessionData) {
  return await databaseService.updateUserSessionById(sessionId, sessionType, sessionData);
}

async function deleteUserSessionById(sessionId) {
  return await databaseService.deleteUserSessionById(sessionId);
}

async function logTimeEntry(userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId) {
  return await databaseService.logTimeEntry(userId, platform, jiraTicketKey, hoursLogged, description, logDate, jiraWorklogId);
}

async function getUserSetting(userId, platform, settingKey) {
  return await databaseService.getUserSetting(userId, platform, settingKey);
}

async function setUserSetting(userId, platform, settingKey, settingValue) {
  return await databaseService.setUserSetting(userId, platform, settingKey, settingValue);
}

module.exports = {
  databaseService,
  initializeDatabase,
  getUserConfiguration,
  createOrUpdateUserConfiguration,
  deleteUserConfiguration,
  createUserSession,
  getUserSession,
  getUserSessionById,
  deleteUserSession,
  updateUserSessionById,
  deleteUserSessionById,
  logTimeEntry,
  getUserSetting,
  setUserSetting
}; 