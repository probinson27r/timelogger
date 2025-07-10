exports.handler = async (event, context) => {
  try {
    // Try to connect to the appropriate database
    const { databaseService } = require('../services/databaseAdapter');
    await databaseService.initialize();

    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'production',
      database: databaseService.isAWS ? 'Aurora PostgreSQL - connected' : 'SQLite - connected',
      region: process.env.AWS_REGION || 'unknown',
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(healthStatus),
    };
  } catch (error) {
    console.error('Health check failed:', error);
    
    const healthStatus = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
      error: error.message,
      database: 'disconnected',
    };

    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(healthStatus),
    };
  }
}; 