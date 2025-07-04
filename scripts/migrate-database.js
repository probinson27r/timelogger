#!/usr/bin/env node

/**
 * Database Migration Script for TimeLogger
 * 
 * This script safely migrates the database schema and preserves existing data.
 * Run this when updating from an older version.
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || '')
};

class DatabaseMigrator {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'timelogger.db');
    this.db = null;
  }

  async migrate() {
    try {
      logger.info('Starting database migration...');
      
      // Create backup
      await this.createBackup();
      
      // Connect to database
      await this.connect();
      
      // Run migrations
      await this.runMigrations();
      
      // Verify migrations
      await this.verifyMigrations();
      
      logger.info('✅ Database migration completed successfully!');
      
    } catch (error) {
      logger.error('❌ Migration failed:', error.message);
      throw error;
    } finally {
      if (this.db) {
        this.db.close();
      }
    }
  }

  async createBackup() {
    if (!fs.existsSync(this.dbPath)) {
      logger.info('No existing database found, skipping backup');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = this.dbPath.replace('.db', `_backup_${timestamp}.db`);
    
    try {
      fs.copyFileSync(this.dbPath, backupPath);
      logger.info(`✅ Database backup created: ${backupPath}`);
    } catch (error) {
      logger.error('Failed to create backup:', error.message);
      throw error;
    }
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Failed to connect to database:', err.message);
          reject(err);
        } else {
          logger.info('Connected to database');
          resolve();
        }
      });
    });
  }

  async runMigrations() {
    const migrations = [
      this.addUserIdToPlatformMigration,
      this.addJiraTypeMigration
    ];

    for (const migration of migrations) {
      await migration.call(this);
    }
  }

  async addUserIdToPlatformMigration() {
    logger.info('Running migration: Add user_id to user_sessions table...');
    
    return new Promise((resolve, reject) => {
      // Check if user_id column exists
      this.db.get("PRAGMA table_info(user_sessions)", (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        // Get all columns
        this.db.all("PRAGMA table_info(user_sessions)", (err, columns) => {
          if (err) {
            reject(err);
            return;
          }

          const hasUserId = columns.some(col => col.name === 'user_id');
          
          if (hasUserId) {
            logger.info('✅ user_sessions table already has user_id column');
            resolve();
            return;
          }

          logger.info('Adding user_id column to user_sessions table...');
          
          this.db.serialize(() => {
            // Add the column
            this.db.run("ALTER TABLE user_sessions ADD COLUMN user_id TEXT", (err) => {
              if (err) {
                logger.error('Failed to add user_id column:', err.message);
                reject(err);
                return;
              }

              // Update existing records by extracting user_id from slack_user_id if it exists
              this.db.run(`UPDATE user_sessions 
                          SET user_id = slack_user_id 
                          WHERE slack_user_id IS NOT NULL AND user_id IS NULL`, (err) => {
                if (err) {
                  logger.warn('Could not migrate slack_user_id data:', err.message);
                }
                
                logger.info('✅ user_sessions migration completed');
                resolve();
              });
            });
          });
        });
      });
    });
  }

  async addJiraTypeMigration() {
    logger.info('Running migration: Add jira_type to user_configurations table...');
    
    return new Promise((resolve, reject) => {
      // Check if jira_type column exists
      this.db.all("PRAGMA table_info(user_configurations)", (err, columns) => {
        if (err) {
          reject(err);
          return;
        }

        const hasJiraType = columns.some(col => col.name === 'jira_type');
        
        if (hasJiraType) {
          logger.info('✅ user_configurations table already has jira_type column');
          resolve();
          return;
        }

        logger.info('Adding jira_type column to user_configurations table...');
        
        this.db.serialize(() => {
          // Add the column with default value 'server'
          this.db.run("ALTER TABLE user_configurations ADD COLUMN jira_type TEXT DEFAULT 'server'", (err) => {
            if (err) {
              logger.error('Failed to add jira_type column:', err.message);
              reject(err);
              return;
            }

            // Update existing records to detect type based on URL
            this.db.run(`UPDATE user_configurations 
                        SET jira_type = CASE 
                          WHEN jira_base_url LIKE '%atlassian.net%' THEN 'cloud'
                          ELSE 'server'
                        END 
                        WHERE jira_type IS NULL OR jira_type = 'server'`, (err) => {
              if (err) {
                logger.warn('Could not auto-detect Jira types:', err.message);
              } else {
                logger.info('✅ Auto-detected Jira types for existing configurations');
              }
              
              logger.info('✅ jira_type migration completed');
              resolve();
            });
          });
        });
      });
    });
  }

  async verifyMigrations() {
    logger.info('Verifying database schema...');
    
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Check user_sessions table
        this.db.all("PRAGMA table_info(user_sessions)", (err, columns) => {
          if (err) {
            reject(err);
            return;
          }

          const hasUserId = columns.some(col => col.name === 'user_id');
          if (!hasUserId) {
            reject(new Error('user_sessions table missing user_id column'));
            return;
          }

          // Check user_configurations table
          this.db.all("PRAGMA table_info(user_configurations)", (err, columns) => {
            if (err) {
              reject(err);
              return;
            }

            const hasJiraType = columns.some(col => col.name === 'jira_type');
            if (!hasJiraType) {
              reject(new Error('user_configurations table missing jira_type column'));
              return;
            }

            logger.info('✅ All migrations verified successfully');
            resolve();
          });
        });
      });
    });
  }
}

// Run migration if called directly
if (require.main === module) {
  const migrator = new DatabaseMigrator();
  migrator.migrate()
    .then(() => {
      logger.info('🎉 Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Migration failed:', error.message);
      process.exit(1);
    });
}

module.exports = DatabaseMigrator; 