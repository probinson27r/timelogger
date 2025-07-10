exports.handler = async (event, context) => {
  console.log('Migration event:', JSON.stringify(event, null, 2));

  try {
    // Initialize database service (will auto-detect Aurora vs SQLite)
    const { databaseService } = require('../services/databaseAdapter');
    
    console.log('Starting database migration...');
    
    // Initialize the appropriate database service
    await databaseService.initialize();
    
    // If Aurora, create the specific tables; if SQLite, use existing createTables
    if (databaseService.isAWS && databaseService.service.createTables) {
      await databaseService.service.createTables();
    }
    
    const result = {
      status: 'success',
      message: 'Database migration completed successfully',
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
      database: databaseService.isAWS ? 'Aurora PostgreSQL' : 'SQLite',
      tables: databaseService.isAWS ? ['user_configs', 'time_logs'] : ['user_configurations', 'user_sessions', 'time_logs', 'user_settings'],
    };

    console.log('Database migration completed:', result);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };

  } catch (error) {
    console.error('Database migration failed:', error);
    
    const result = {
      status: 'error',
      message: 'Database migration failed',
      error: error.message,
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
    };

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };
  }
}; 