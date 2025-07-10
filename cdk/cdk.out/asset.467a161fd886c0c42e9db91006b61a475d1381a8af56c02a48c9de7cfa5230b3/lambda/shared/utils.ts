import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

export interface AppSecrets {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_APP_TOKEN: string;
  OPENAI_API_KEY: string;
  ENCRYPTION_KEY: string;
  TEAMS_APP_ID?: string;
  TEAMS_APP_PASSWORD?: string;
}

let cachedSecrets: AppSecrets | null = null;

export async function getAppSecrets(): Promise<AppSecrets> {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  if (process.env.NODE_ENV === 'development') {
    // For local development, use environment variables
    cachedSecrets = {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
      SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN!,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
      TEAMS_APP_ID: process.env.TEAMS_APP_ID,
      TEAMS_APP_PASSWORD: process.env.TEAMS_APP_PASSWORD,
    };
    return cachedSecrets;
  }

  try {
    const command = new GetSecretValueCommand({
      SecretId: process.env.APP_SECRETS_ARN,
    });
    
    const response = await secretsClient.send(command);
    cachedSecrets = JSON.parse(response.SecretString!);
    return cachedSecrets!;
  } catch (error) {
    console.error('Error fetching app secrets:', error);
    throw error;
  }
}

export function createResponse(statusCode: number, body: any, headers?: Record<string, string>) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

export function createSlackResponse(text: string, ephemeral: boolean = false) {
  return createResponse(200, {
    text,
    response_type: ephemeral ? 'ephemeral' : 'in_channel',
  });
}

export function parseSlackBody(body: string): any {
  // Handle URL-encoded form data from Slack
  if (body.startsWith('payload=')) {
    const payload = decodeURIComponent(body.substring(8));
    return JSON.parse(payload);
  }
  
  // Handle JSON body
  try {
    return JSON.parse(body);
  } catch {
    // Handle URL-encoded parameters
    const params = new URLSearchParams(body);
    const result: any = {};
    for (const [key, value] of params) {
      result[key] = value;
    }
    return result;
  }
}

export function logLambdaEvent(event: any, context: any) {
  console.log('Lambda Event:', JSON.stringify({
    requestId: context.awsRequestId,
    functionName: context.functionName,
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
    queryStringParameters: event.queryStringParameters,
    body: event.body ? (event.body.length > 1000 ? event.body.substring(0, 1000) + '...' : event.body) : null,
  }, null, 2));
} 