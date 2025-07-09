const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const logger = require('../utils/logger');

class AuroraService {
  constructor() {
    this.pool = null;
    this.secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-southeast-2' });
  }

  async getSecrets() {
    try {
      if (process.env.NODE_ENV === 'development') {
        // For local development, use environment variables
        return {
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          database: process.env.DB_NAME || 'timelogger',
          username: process.env.DB_USER || 'timelogger_admin',
          password: process.env.DB_PASSWORD || 'password'
        };
      }

      // For AWS deployment, fetch from Secrets Manager
      const dbSecretCommand = new GetSecretValueCommand({
        SecretId: process.env.DB_SECRET_ARN
      });
      
      const dbSecretResponse = await this.secretsClient.send(dbSecretCommand);
      const dbCredentials = JSON.parse(dbSecretResponse.SecretString);

      // Debug: Log available fields (without password)
      const availableFields = Object.keys(dbCredentials).filter(key => key !== 'password');
      logger.info('Available secret fields:', availableFields);

      // RDS Aurora creates secrets with these standard fields
      // AWS-managed secrets may not include host, so provide fallback
      const clusterHost = dbCredentials.host || dbCredentials.endpoint || 'timeloggerstack-auroracluster23d869c0-9eppkodzh7fv.cluster-c1agm8g6k440.ap-southeast-2.rds.amazonaws.com';
      
      logger.info(`Using Aurora cluster endpoint: ${clusterHost}`);
      
      return {
        host: clusterHost,
        port: dbCredentials.port || 5432,
        database: dbCredentials.dbname || dbCredentials.database || 'timelogger', // Use the configured database name
        username: dbCredentials.username || dbCredentials.user,
        password: dbCredentials.password
      };
    } catch (error) {
      logger.error('Error fetching database secrets:', error);
      throw error;
    }
  }

  async initialize() {
    try {
      if (this.pool) {
        return this.pool;
      }

      const credentials = await this.getSecrets();
      
      logger.info(`Connecting to Aurora database at ${credentials.host}:${credentials.port}/${credentials.database}`);
      
      this.pool = new Pool({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.username,
        password: credentials.password,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // Increased timeout for Aurora
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });

      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      logger.info('Aurora PostgreSQL database connected successfully');
      return this.pool;
    } catch (error) {
      logger.error('Error initializing Aurora database:', error);
      throw error;
    }
  }

  async createTables() {
    try {
      const pool = await this.initialize();
      
      // Create tables with PostgreSQL syntax in the timelogger database
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_configs (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) UNIQUE NOT NULL,
          jira_server_url TEXT,
          jira_username TEXT,
          jira_api_token TEXT,
          jira_server_type VARCHAR(50) DEFAULT 'cloud',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS time_logs (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          jira_issue_key VARCHAR(255) NOT NULL,
          time_spent VARCHAR(100) NOT NULL,
          description TEXT,
          work_date DATE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          jira_worklog_id VARCHAR(255),
          FOREIGN KEY (user_id) REFERENCES user_configs(user_id) ON DELETE CASCADE
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_user_configs_user_id ON user_configs(user_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_time_logs_user_id ON time_logs(user_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_time_logs_work_date ON time_logs(work_date)
      `);

      // Create sessions table for temporary session storage
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          platform VARCHAR(50) NOT NULL,
          session_type VARCHAR(100) NOT NULL,
          session_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at)
      `);

      // Create processed_events table for deduplication
      await pool.query(`
        CREATE TABLE IF NOT EXISTS processed_events (
          id SERIAL PRIMARY KEY,
          event_key VARCHAR(500) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_processed_events_event_key ON processed_events(event_key)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_processed_events_created_at ON processed_events(created_at)
      `);

      logger.info('Aurora database tables created successfully');
    } catch (error) {
      logger.error('Error creating Aurora database tables:', error);
      throw error;
    }
  }

  async query(text, params = []) {
    try {
      const pool = await this.initialize();
      const result = await pool.query(text, params);
      return result;
    } catch (error) {
      logger.error('Aurora query error:', error);
      throw error;
    }
  }

  async getUserConfig(userId) {
    try {
      const result = await this.query(
        'SELECT * FROM user_configs WHERE user_id = $1',
        [userId]
      );
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting user config:', error);
      throw error;
    }
  }

  async saveUserConfig(userId, config) {
    try {
      const result = await this.query(`
        INSERT INTO user_configs (user_id, jira_server_url, jira_username, jira_api_token, jira_server_type)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          jira_server_url = EXCLUDED.jira_server_url,
          jira_username = EXCLUDED.jira_username,
          jira_api_token = EXCLUDED.jira_api_token,
          jira_server_type = EXCLUDED.jira_server_type,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [userId, config.jira_server_url, config.jira_username, config.jira_api_token, config.jira_server_type]);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error saving user config:', error);
      throw error;
    }
  }

  async deleteUserConfig(userId) {
    try {
      await this.query('DELETE FROM user_configs WHERE user_id = $1', [userId]);
      logger.info(`Deleted config for user ${userId}`);
    } catch (error) {
      logger.error('Error deleting user config:', error);
      throw error;
    }
  }

  async saveTimeLog(userId, issueKey, timeSpent, description, workDate, jiraWorklogId = null) {
    try {
      const result = await this.query(`
        INSERT INTO time_logs (user_id, jira_issue_key, time_spent, description, work_date, jira_worklog_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [userId, issueKey, timeSpent, description, workDate, jiraWorklogId]);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error saving time log:', error);
      throw error;
    }
  }

  async getTimeLogs(userId, startDate = null, endDate = null) {
    try {
      let query = 'SELECT * FROM time_logs WHERE user_id = $1';
      const params = [userId];

      if (startDate && endDate) {
        query += ' AND work_date BETWEEN $2 AND $3';
        params.push(startDate, endDate);
      } else if (startDate) {
        query += ' AND work_date >= $2';
        params.push(startDate);
      } else if (endDate) {
        query += ' AND work_date <= $2';
        params.push(endDate);
      }

      query += ' ORDER BY work_date DESC, created_at DESC';

      const result = await this.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error getting time logs:', error);
      throw error;
    }
  }

  // Session management methods
  async createUserSession(userId, platform, sessionType, sessionData, expiresAt) {
    try {
      const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      
      await this.query(`
        INSERT INTO user_sessions (id, user_id, platform, session_type, session_data, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [sessionId, userId, platform, sessionType, JSON.stringify(sessionData), expiresAt]);
      
      return sessionId;
    } catch (error) {
      logger.error('Error creating user session:', error);
      throw error;
    }
  }

  async getUserSessionById(sessionId) {
    try {
      const result = await this.query(
        'SELECT * FROM user_sessions WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())',
        [sessionId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const session = result.rows[0];
      return {
        id: session.id,
        user_id: session.user_id,
        platform: session.platform,
        session_type: session.session_type,
        session_data: session.session_data,
        created_at: session.created_at,
        expires_at: session.expires_at
      };
    } catch (error) {
      logger.error('Error getting user session by ID:', error);
      throw error;
    }
  }

  async updateUserSessionById(sessionId, sessionType, sessionData) {
    try {
      const result = await this.query(`
        UPDATE user_sessions 
        SET session_type = $2, session_data = $3
        WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())
      `, [sessionId, sessionType, JSON.stringify(sessionData)]);
      
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Error updating user session:', error);
      throw error;
    }
  }

  async deleteUserSessionById(sessionId) {
    try {
      const result = await this.query('DELETE FROM user_sessions WHERE id = $1', [sessionId]);
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Error deleting user session:', error);
      throw error;
    }
  }

  async getUserSession(userId, platform, sessionType) {
    try {
      const result = await this.query(
        'SELECT * FROM user_sessions WHERE user_id = $1 AND platform = $2 AND session_type = $3 AND (expires_at IS NULL OR expires_at > NOW())',
        [userId, platform, sessionType]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const session = result.rows[0];
      return {
        id: session.id,
        user_id: session.user_id,
        platform: session.platform,
        session_type: session.session_type,
        session_data: session.session_data,
        created_at: session.created_at,
        expires_at: session.expires_at
      };
    } catch (error) {
      logger.error('Error getting user session:', error);
      throw error;
    }
  }

  async deleteUserSession(userId, platform, sessionType) {
    try {
      const result = await this.query(
        'DELETE FROM user_sessions WHERE user_id = $1 AND platform = $2 AND session_type = $3',
        [userId, platform, sessionType]
      );
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Error deleting user session:', error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
        logger.info('Aurora database connection closed');
      }
    } catch (error) {
      logger.error('Error closing Aurora database connection:', error);
    }
  }
}

module.exports = new AuroraService();