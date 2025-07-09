// Lambda-compatible logger - uses Winston locally, console.log in Lambda
let logger;

// Check if we're in Lambda environment
const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;

if (isLambda) {
  // Lambda environment - use console fallback
  logger = {
    info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
    error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
    debug: (message, ...args) => console.debug(`[DEBUG] ${message}`, ...args),
    log: (level, message, ...args) => console.log(`[${level.toUpperCase()}] ${message}`, ...args)
  };
} else {
  try {
    // Try to use Winston (for local development)
    const winston = require('winston');

    logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'slack-jira-timelogger' },
      transports: [
        // Write all logs with importance level of `error` or less to `error.log`
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        // Write all logs with importance level of `info` or less to `combined.log`
        new winston.transports.File({ filename: 'logs/combined.log' })
      ]
    });

    // If we're not in production then log to the console with the format:
    // `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
    if (process.env.NODE_ENV !== 'production') {
      logger.add(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }
  } catch (error) {
    // Winston not available - use console fallback
    logger = {
      info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
      warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
      error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
      debug: (message, ...args) => console.debug(`[DEBUG] ${message}`, ...args),
      log: (level, message, ...args) => console.log(`[${level.toUpperCase()}] ${message}`, ...args)
    };
  }
}

module.exports = logger; 