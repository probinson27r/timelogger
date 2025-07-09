const { Pool } = require('pg');

async function fixAuroraPermissions() {
  const pool = new Pool({
    host: 'timeloggerstack-auroracluster23d869c0-9eppkodzh7fv.cluster-c1agm8g6k440.ap-southeast-2.rds.amazonaws.com',
    port: 5432,
    database: 'postgres', // Connect to postgres database as superuser
    user: 'postgres',
    password: 'Timelogger1234567',
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to Aurora as postgres superuser...');
    
    // Test connection
    const testResult = await pool.query('SELECT version()');
    console.log('Connected successfully!');
    console.log('PostgreSQL version:', testResult.rows[0].version);
    
    // Check if timelogger_admin user exists
    const userCheck = await pool.query(`
      SELECT usename, usecreatedb, usesuper, userepl 
      FROM pg_user 
      WHERE usename = 'timelogger_admin'
    `);
    
    if (userCheck.rows.length === 0) {
      console.log('Creating timelogger_admin user...');
      await pool.query(`
        CREATE USER timelogger_admin WITH PASSWORD '88;7~EHw~6*+;CvBqjN[g7WQn0R&b7ov'
      `);
    } else {
      console.log('timelogger_admin user already exists');
      console.log('User details:', userCheck.rows[0]);
    }
    
    // Grant necessary permissions to timelogger_admin
    console.log('Granting permissions to timelogger_admin...');
    
    // Grant connection permission to timelogger database
    await pool.query(`GRANT CONNECT ON DATABASE timelogger TO timelogger_admin`);
    
    // Switch to timelogger database
    await pool.end();
    
    const timeloggerPool = new Pool({
      host: 'timeloggerstack-auroracluster23d869c0-9eppkodzh7fv.cluster-c1agm8g6k440.ap-southeast-2.rds.amazonaws.com',
      port: 5432,
      database: 'timelogger',
      user: 'postgres',
      password: 'Timelogger1234567',
      ssl: { rejectUnauthorized: false }
    });
    
    console.log('Connected to timelogger database...');
    
    // Grant schema permissions
    await timeloggerPool.query(`GRANT USAGE ON SCHEMA public TO timelogger_admin`);
    await timeloggerPool.query(`GRANT CREATE ON SCHEMA public TO timelogger_admin`);
    
    // Grant table permissions (current and future)
    await timeloggerPool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO timelogger_admin`);
    await timeloggerPool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO timelogger_admin`);
    
    // Grant default privileges for future objects
    await timeloggerPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO timelogger_admin`);
    await timeloggerPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO timelogger_admin`);
    
    console.log('Permissions granted successfully!');
    
    // Test timelogger_admin permissions
    console.log('Testing timelogger_admin permissions...');
    
    await timeloggerPool.end();
    
    const testPool = new Pool({
      host: 'timeloggerstack-auroracluster23d869c0-9eppkodzh7fv.cluster-c1agm8g6k440.ap-southeast-2.rds.amazonaws.com',
      port: 5432,
      database: 'timelogger',
      user: 'timelogger_admin',
      password: '88;7~EHw~6*+;CvBqjN[g7WQn0R&b7ov',
      ssl: { rejectUnauthorized: false }
    });
    
    // Test basic operations
    await testPool.query('SELECT 1');
    console.log('✅ timelogger_admin can connect and query');
    
    // Test table creation
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS test_permissions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100)
      )
    `);
    console.log('✅ timelogger_admin can create tables');
    
    // Test insert
    await testPool.query(`INSERT INTO test_permissions (name) VALUES ('test')`);
    console.log('✅ timelogger_admin can insert data');
    
    // Test select
    const result = await testPool.query('SELECT * FROM test_permissions');
    console.log('✅ timelogger_admin can select data:', result.rows);
    
    // Clean up test table
    await testPool.query('DROP TABLE test_permissions');
    console.log('✅ timelogger_admin can drop tables');
    
    await testPool.end();
    
    console.log('🎉 All permissions configured successfully!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixAuroraPermissions(); 