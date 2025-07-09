// Debug endpoint to check what version is running
exports.handler = async (event) => {
  console.log('Debug version check - Environment variables:', process.env);
  
  try {
    // Check if the messageHandler has the fix
    const messageHandler = require('../handlers/messageHandler');
    const fs = require('fs');
    const path = require('path');
    
    // Read the actual file content to see if it has the null check
    const filePath = path.join(__dirname, '../handlers/messageHandler.js');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Check for the null check fix
    const hasNullCheck = fileContent.includes('parsedDate.date && parsedDate.date.isAfter');
    const hasOldCode = fileContent.includes('parsedDate.date.isAfter(moment()') && !hasNullCheck;
    
    const versionInfo = {
      timestamp: new Date().toISOString(),
      environment: {
        FORCE_REBUILD: process.env.FORCE_REBUILD,
        NODE_ENV: process.env.NODE_ENV
      },
      codeAnalysis: {
        hasNullCheckFix: hasNullCheck,
        hasOldBuggyCode: hasOldCode,
        fileSize: fileContent.length
      },
      lambdaInfo: {
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
        memorySize: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
      }
    };
    
    console.log('Version info:', JSON.stringify(versionInfo, null, 2));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(versionInfo, null, 2)
    };
    
  } catch (error) {
    console.error('Error checking version:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  }
}; 