import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

export class TimeLoggerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC for Aurora and Lambda
    const vpc = new ec2.Vpc(this, 'TimeLoggerVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Create Aurora Database Secret
    const dbSecret = new secretsmanager.Secret(this, 'AuroraSecret', {
      description: 'Aurora PostgreSQL credentials for TimeLogger',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'timelogger_admin' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Create Aurora Serverless v2 PostgreSQL Cluster
    const aurora = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      credentials: rds.Credentials.fromSecret(dbSecret),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      readers: [
        rds.ClusterInstance.serverlessV2('reader', { scaleWithWriter: true }),
      ],
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      defaultDatabaseName: 'timelogger',
      backup: {
        retention: cdk.Duration.days(7),
      },
      deletionProtection: false, // Set to true for production
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Set to RETAIN for production
    });

    // Create Application Secrets for environment variables
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      description: 'Application secrets for TimeLogger',
      secretObjectValue: {
        SLACK_BOT_TOKEN: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        SLACK_SIGNING_SECRET: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        SLACK_APP_TOKEN: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        OPENAI_API_KEY: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        ENCRYPTION_KEY: cdk.SecretValue.unsafePlainText('CHANGE_ME_32_CHARS_LONG_KEY_HERE'),
        TEAMS_APP_ID: cdk.SecretValue.unsafePlainText(''),
        TEAMS_APP_PASSWORD: cdk.SecretValue.unsafePlainText(''),
      },
    });

    // Common Lambda function configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn, // Use the CDK-managed Aurora secret
        APP_SECRETS_ARN: appSecrets.secretArn,
        NODE_ENV: 'production',
        FORCE_REBUILD: '2025-07-09-01-15-00-FORCE-REFRESH-ALL-LAMBDAS', // Force refresh all Lambda versions to eliminate caching issues
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    };

    // Slack Events Lambda Function
    const slackEventsFunction = new lambda.Function(this, 'SlackEventsFunction', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      handler: 'lambda/slack-events.handler',
      functionName: 'timelogger-slack-events',
      description: 'Handle Slack events (messages, mentions) - Fixed v2025-07-07-NULL-CHECK',
    });

    // Slack Interactions Lambda Function
    const slackInteractionsFunction = new lambda.Function(this, 'SlackInteractionsFunction', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      handler: 'lambda/slack-interactions.handler',
      functionName: 'timelogger-slack-interactions',
      description: 'Handle Slack interactions (buttons, menus) - Fixed v2025-07-07-NULL-CHECK',
    });

    // Slack Commands Lambda Function
    const slackCommandsFunction = new lambda.Function(this, 'SlackCommandsFunction', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      handler: 'lambda/slack-commands.handler',
      functionName: 'timelogger-slack-commands',
      description: 'Handle Slack slash commands - Fixed v2025-07-07-NULL-CHECK',
    });

    // Health Check Lambda Function
    const healthFunction = new lambda.Function(this, 'HealthFunction', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      handler: 'lambda/health.handler',
      functionName: 'timelogger-health',
      description: 'Health check endpoint',
    });

    // Database Migration Lambda Function
    const migrationFunction = new lambda.Function(this, 'MigrationFunction', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      handler: 'lambda/migration.handler',
      functionName: 'timelogger-migration',
      timeout: cdk.Duration.minutes(5),
      description: 'Database migration and setup',
    });

    // Fix Permissions Lambda Function
    const fixPermissionsFunction = new lambda.Function(this, 'FixPermissionsFunction', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      handler: 'lambda/fix-permissions.handler',
      functionName: 'timelogger-fix-permissions',
      timeout: cdk.Duration.minutes(10), // Increased timeout for Aurora Serverless v2 scaling
      description: 'Fix Aurora database permissions for timelogger_admin user',
    });

    // Debug Version Lambda Function
    const debugVersionFunction = new lambda.Function(this, 'DebugVersionFunction', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      handler: 'lambda/debug-version.handler',
      functionName: 'timelogger-debug-version',
      description: 'Debug endpoint to check code version',
    });

    // Grant database access to Lambda functions
    const lambdaFunctions = [
      slackEventsFunction,
      slackInteractionsFunction,
      slackCommandsFunction,
      healthFunction,
      migrationFunction,
      fixPermissionsFunction,
      debugVersionFunction,
    ];

    lambdaFunctions.forEach(fn => {
      aurora.connections.allowDefaultPortFrom(fn);
      dbSecret.grantRead(fn); // Grant access to CDK-managed secret
      appSecrets.grantRead(fn);
      
      // Add explicit Secrets Manager permissions
      fn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [appSecrets.secretArn, dbSecret.secretArn]
      }));
    });

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'TimeLoggerAPI', {
      restApiName: 'TimeLogger Slack Bot API',
      description: 'API Gateway for TimeLogger Slack bot webhooks',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // API Gateway Routes - Using Lambda functions directly instead of aliases
    const slackResource = api.root.addResource('slack');
    
    // Slack events endpoint
    const eventsResource = slackResource.addResource('events');
    eventsResource.addMethod('POST', new apigateway.LambdaIntegration(slackEventsFunction));

    // Slack interactions endpoint
    const interactionsResource = slackResource.addResource('interactions');
    interactionsResource.addMethod('POST', new apigateway.LambdaIntegration(slackInteractionsFunction));

    // Slack commands endpoint
    const commandsResource = slackResource.addResource('commands');
    commandsResource.addMethod('POST', new apigateway.LambdaIntegration(slackCommandsFunction));

    // Health check endpoint
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', new apigateway.LambdaIntegration(healthFunction));

    // Migration endpoint (for manual database setup)
    const migrationResource = api.root.addResource('migration');
    migrationResource.addMethod('POST', new apigateway.LambdaIntegration(migrationFunction));

    // Fix Permissions endpoint (for fixing Aurora permissions)
    const fixPermissionsResource = api.root.addResource('fix-permissions');
    fixPermissionsResource.addMethod('POST', new apigateway.LambdaIntegration(fixPermissionsFunction));

    // Debug Version endpoint
    const debugVersionResource = api.root.addResource('debug-version');
    debugVersionResource.addMethod('GET', new apigateway.LambdaIntegration(debugVersionFunction));

    // Outputs
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: aurora.clusterEndpoint.hostname,
      description: 'Aurora PostgreSQL cluster endpoint',
    });

    new cdk.CfnOutput(this, 'DatabaseWriterEndpoint', {
      value: aurora.clusterEndpoint.hostname.replace('.cluster-', '.writer.cluster-'),
      description: 'Aurora PostgreSQL writer endpoint',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: dbSecret.secretArn,
      description: 'ARN of the database credentials secret',
    });

    new cdk.CfnOutput(this, 'AppSecretsArn', {
      value: appSecrets.secretArn,
      description: 'ARN of the application secrets',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL for Slack webhooks',
    });

    new cdk.CfnOutput(this, 'SlackEventsUrl', {
      value: `${api.url}slack/events`,
      description: 'Slack Events API URL',
    });

    new cdk.CfnOutput(this, 'SlackInteractionsUrl', {
      value: `${api.url}slack/interactions`,
      description: 'Slack Interactions URL',
    });

    new cdk.CfnOutput(this, 'SlackCommandsUrl', {
      value: `${api.url}slack/commands`,
      description: 'Slack Commands URL',
    });

    new cdk.CfnOutput(this, 'HealthCheckUrl', {
      value: `${api.url}health`,
      description: 'Health check URL',
    });

    new cdk.CfnOutput(this, 'MigrationUrl', {
      value: `${api.url}migration`,
      description: 'Database migration URL',
    });

    new cdk.CfnOutput(this, 'FixPermissionsUrl', {
      value: `${api.url}fix-permissions`,
      description: 'Fix Aurora permissions URL',
    });

    new cdk.CfnOutput(this, 'DebugVersionUrl', {
      value: `${api.url}debug-version`,
      description: 'Debug version URL',
    });
  }
} 