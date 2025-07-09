const logger = require('../utils/logger');

class DatabaseAdapter {
  constructor() {
    this.service = null;
    // Better AWS environment detection for Lambda
    this.isAWS = process.env.AWS_LAMBDA_FUNCTION_NAME || 
                 process.env.AWS_EXECUTION_ENV === 'AWS_Lambda_nodejs18.x' ||
                 (process.env.NODE_ENV === 'production' && process.env.DB_SECRET_ARN);
  }

// ... existing code ...
} 