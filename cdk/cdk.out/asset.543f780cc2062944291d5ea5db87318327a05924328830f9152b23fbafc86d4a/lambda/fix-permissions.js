const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-southeast-2' });

async function getAuroraSecret() {
  const dbSecretCommand = new GetSecretValueCommand({
    SecretId: process.env.DB_SECRET_ARN
  });
  
  const dbSecretResponse = await secretsClient.send(dbSecretCommand);
  return JSON.parse(dbSecretResponse.SecretString);
}

async function fixAuroraPermissions() {
  const dbCredentials = await getAuroraSecret();
  
  console.log('Aurora secret credentials:', {
    host: dbCredentials.host,
    port: dbCredentials.port,
    username: dbCredentials.username,
    dbname: dbCredentials.dbname,
    password: dbCredentials.password ? `${dbCredentials.password.substring(0, 5)}...` : 'MISSING'
  });
  
  console.log('Full secret keys:', Object.keys(dbCredentials));

  // timelogger_admin IS the master user - connect directly
  // Aurora Serverless v2 may need time to scale up, so use longer timeouts
  const pool = new Pool({
    host: dbCredentials.host || 'timeloggerstack-auroracluster23d869c0-9eppkodzh7fv.cluster-c1agm8g6k440.ap-southeast-2.rds.amazonaws.com',
    port: dbCredentials.port || 5432,
    database: 'postgres', // Connect to postgres database
    user: dbCredentials.username, // timelogger_admin is the master user
    password: dbCredentials.password, // Master password from secret
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60000, // 60 seconds for Aurora Serverless v2 scaling
    idleTimeoutMillis: 30000,
    max: 1, // Single connection for testing
  });

  try {
    console.log('Connecting to Aurora postgres database as timelogger_admin (master user)...');
    console.log('Connection details:', {
      host: dbCredentials.host || 'timeloggerstack-auroracluster23d869c0-9eppkodzh7fv.cluster-c1agm8g6k440.ap-southeast-2.rds.amazonaws.com',
      port: dbCredentials.port || 5432,
      database: 'postgres',
      user: dbCredentials.username,
      connectionTimeout: '60s'
    });
    
    console.log('Note: Aurora Serverless v2 may take up to 60 seconds to scale up from zero...');
    
    // Test connection with retry for Aurora Serverless v2 scaling
    let connected = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (!connected && attempts < maxAttempts) {
      attempts++;
      try {
        console.log(`Connection attempt ${attempts}/${maxAttempts}...`);
        const testResult = await pool.query('SELECT version()');
        console.log('Connected successfully!');
        console.log('PostgreSQL version:', testResult.rows[0].version);
        connected = true;
      } catch (connectionError) {
        console.log(`Connection attempt ${attempts} failed:`, connectionError.message);
        if (attempts < maxAttempts) {
          console.log('Waiting 10 seconds before retry (Aurora may be scaling up)...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        } else {
          throw connectionError;
        }
      }
    }
    
    // Check what users exist
    const userCheck = await pool.query(`
      SELECT usename, usecreatedb, usesuper, userepl, valuntil
      FROM pg_user 
      ORDER BY usename
    `);
    
    console.log('All users in database:');
    userCheck.rows.forEach(user => {
      console.log(`- ${user.usename} (createdb: ${user.usecreatedb}, superuser: ${user.usesuper}, replication: ${user.userepl})`);
    });
    
    // Check current user permissions
    const currentUser = await pool.query('SELECT current_user, session_user');
    console.log('Current user:', currentUser.rows[0]);
    
    // timelogger_admin is the master user, so no need to create or grant permissions
    console.log('✅ timelogger_admin is the master user with full privileges');
    
    // Close postgres connection
    await pool.end();
    
    const timeloggerPool = new Pool({
      host: dbCredentials.host || 'timeloggerstack-auroracluster23d869c0-9eppkodzh7fv.cluster-c1agm8g6k440.ap-southeast-2.rds.amazonaws.com',
      port: dbCredentials.port || 5432,
      database: 'timelogger',
      user: dbCredentials.username, // timelogger_admin is the master user
      password: dbCredentials.password, // Master password from secret
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 60000, // 60 seconds for Aurora Serverless v2 scaling
      idleTimeoutMillis: 30000,
      max: 1, // Single connection for testing
    });
    
    console.log('Connecting to timelogger database as timelogger_admin (master user)...');
    
    // Test connection to timelogger database
    await timeloggerPool.query('SELECT 1');
    console.log('✅ Successfully connected to timelogger database');
    
    // Since timelogger_admin is the master user, create the required tables
    console.log('Creating TimeLogger application tables...');
    
    // Create user_configs table
    await timeloggerPool.query(`
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
    console.log('✅ Created user_configs table');

    // Create time_logs table
    await timeloggerPool.query(`
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
    console.log('✅ Created time_logs table');

    // Create indexes
    await timeloggerPool.query(`CREATE INDEX IF NOT EXISTS idx_user_configs_user_id ON user_configs(user_id)`);
    await timeloggerPool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_user_id ON time_logs(user_id)`);
    await timeloggerPool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_work_date ON time_logs(work_date)`);
    console.log('✅ Created database indexes');
    
    // timelogger_admin is the master user and already has all permissions
    console.log('✅ timelogger_admin (master user) has all schema permissions');
    
    // Test basic operations with timelogger_admin (master user)
    console.log('Testing database operations...');
    
    await timeloggerPool.query(`
      INSERT INTO user_configs (user_id, jira_server_url, jira_username, jira_api_token) 
      VALUES ('test_user', 'https://test.atlassian.net', 'test@example.com', 'test_token')
      ON CONFLICT (user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `);
    console.log('✅ Can insert/update user configs');
    
    // Test time log insertion
    await timeloggerPool.query(`
      INSERT INTO time_logs (user_id, jira_issue_key, time_spent, description, work_date) 
      VALUES ('test_user', 'TEST-123', '1h', 'Test time log', CURRENT_DATE)
    `);
    console.log('✅ Can insert time logs');
    
    // Clean up test data
    await timeloggerPool.query('DELETE FROM time_logs WHERE user_id = $1', ['test_user']);
    await timeloggerPool.query('DELETE FROM user_configs WHERE user_id = $1', ['test_user']);
    console.log('✅ Can delete test data');
    
    await timeloggerPool.end();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Aurora database setup completed successfully! timelogger_admin (master user) authenticated and tables created.',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
}

exports.handler = async (event) => {
  return await fixAuroraPermissions();
}; 