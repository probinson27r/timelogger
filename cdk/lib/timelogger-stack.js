"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeLoggerStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const rds = __importStar(require("aws-cdk-lib/aws-rds"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const path = __importStar(require("path"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
class TimeLoggerStack extends cdk.Stack {
    constructor(scope, id, props) {
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
exports.TimeLoggerStack = TimeLoggerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGltZWxvZ2dlci1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInRpbWVsb2dnZXItc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQywrRUFBaUU7QUFDakUsMkRBQTZDO0FBRTdDLDJDQUE2QjtBQUM3Qix5REFBMkM7QUFFM0MsTUFBYSxlQUFnQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsbUNBQW1DO1FBQ25DLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQzdDLE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtpQkFDbEM7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFNBQVM7b0JBQ2YsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CO2lCQUMvQztnQkFDRDtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsVUFBVTtvQkFDaEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCO2lCQUM1QzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsZ0NBQWdDO1FBQ2hDLE1BQU0sUUFBUSxHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FB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QUU7WUFDeEMsS0FBSyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsUUFBUTtZQUN6QixXQUFXLEVBQUUsa0JBQWtCO1NBQ2hDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxHQUFHLEdBQUcsQ0FBQyxHQUFHLFdBQVc7WUFDNUIsV0FBVyxFQUFFLHdCQUF3QjtTQUN0QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzNDLEtBQUssRUFBRSxHQUFHLEdBQUcsQ0FBQyxHQUFHLGlCQUFpQjtZQUNsQyxXQUFXLEVBQUUsNEJBQTRCO1NBQzFDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsZUFBZTtZQUNoQyxXQUFXLEVBQUUsbUJBQW1CO1NBQ2pDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQS9SRCwwQ0ErUkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyByZHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5cbmV4cG9ydCBjbGFzcyBUaW1lTG9nZ2VyU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgVlBDIGZvciBBdXJvcmEgYW5kIExhbWJkYVxuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdUaW1lTG9nZ2VyVlBDJywge1xuICAgICAgbWF4QXpzOiAyLFxuICAgICAgbmF0R2F0ZXdheXM6IDEsXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3B1YmxpYycsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdwcml2YXRlJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdpc29sYXRlZCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQXVyb3JhIERhdGFiYXNlIFNlY3JldFxuICAgIGNvbnN0IGRiU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnQXVyb3JhU2VjcmV0Jywge1xuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCBjcmVkZW50aWFscyBmb3IgVGltZUxvZ2dlcicsXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzoge1xuICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoeyB1c2VybmFtZTogJ3RpbWVsb2dnZXJfYWRtaW4nIH0pLFxuICAgICAgICBnZW5lcmF0ZVN0cmluZ0tleTogJ3Bhc3N3b3JkJyxcbiAgICAgICAgZXhjbHVkZUNoYXJhY3RlcnM6ICdcIkAvXFxcXFxcJycsXG4gICAgICAgIGluY2x1ZGVTcGFjZTogZmFsc2UsXG4gICAgICAgIHBhc3N3b3JkTGVuZ3RoOiAzMixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQXVyb3JhIFNlcnZlcmxlc3MgdjIgUG9zdGdyZVNRTCBDbHVzdGVyXG4gICAgY29uc3QgYXVyb3JhID0gbmV3IHJkcy5EYXRhYmFzZUNsdXN0ZXIodGhpcywgJ0F1cm9yYUNsdXN0ZXInLCB7XG4gICAgICBlbmdpbmU6IHJkcy5EYXRhYmFzZUNsdXN0ZXJFbmdpbmUuYXVyb3JhUG9zdGdyZXMoe1xuICAgICAgICB2ZXJzaW9uOiByZHMuQXVyb3JhUG9zdGdyZXNFbmdpbmVWZXJzaW9uLlZFUl8xNV80LFxuICAgICAgfSksXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21TZWNyZXQoZGJTZWNyZXQpLFxuICAgICAgd3JpdGVyOiByZHMuQ2x1c3Rlckluc3RhbmNlLnNlcnZlcmxlc3NWMignd3JpdGVyJyksXG4gICAgICByZWFkZXJzOiBbXG4gICAgICAgIHJkcy5DbHVzdGVySW5zdGFuY2Uuc2VydmVybGVzc1YyKCdyZWFkZXInLCB7IHNjYWxlV2l0aFdyaXRlcjogdHJ1ZSB9KSxcbiAgICAgIF0sXG4gICAgICBzZXJ2ZXJsZXNzVjJNaW5DYXBhY2l0eTogMC41LFxuICAgICAgc2VydmVybGVzc1YyTWF4Q2FwYWNpdHk6IDIsXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICB9LFxuICAgICAgZGVmYXVsdERhdGFiYXNlTmFtZTogJ3RpbWVsb2dnZXInLFxuICAgICAgYmFja3VwOiB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksXG4gICAgICB9LFxuICAgICAgZGVsZXRpb25Qcm90ZWN0aW9uOiBmYWxzZSwgLy8gU2V0IHRvIHRydWUgZm9yIHByb2R1Y3Rpb25cbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIFNldCB0byBSRVRBSU4gZm9yIHByb2R1Y3Rpb25cbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBcHBsaWNhdGlvbiBTZWNyZXRzIGZvciBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICBjb25zdCBhcHBTZWNyZXRzID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnQXBwU2VjcmV0cycsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXBwbGljYXRpb24gc2VjcmV0cyBmb3IgVGltZUxvZ2dlcicsXG4gICAgICBzZWNyZXRPYmplY3RWYWx1ZToge1xuICAgICAgICBTTEFDS19CT1RfVE9LRU46IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ0NIQU5HRV9NRScpLFxuICAgICAgICBTTEFDS19TSUdOSU5HX1NFQ1JFVDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnQ0hBTkdFX01FJyksXG4gICAgICAgIFNMQUNLX0FQUF9UT0tFTjogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnQ0hBTkdFX01FJyksXG4gICAgICAgIE9QRU5BSV9BUElfS0VZOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KCdDSEFOR0VfTUUnKSxcbiAgICAgICAgRU5DUllQVElPTl9LRVk6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ0NIQU5HRV9NRV8zMl9DSEFSU19MT05HX0tFWV9IRVJFJyksXG4gICAgICAgIFRFQU1TX0FQUF9JRDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnJyksXG4gICAgICAgIFRFQU1TX0FQUF9QQVNTV09SRDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnJyksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ29tbW9uIExhbWJkYSBmdW5jdGlvbiBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgY29tbW9uTGFtYmRhUHJvcHMgPSB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIHZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEQl9TRUNSRVRfQVJOOiBkYlNlY3JldC5zZWNyZXRBcm4sIC8vIFVzZSB0aGUgQ0RLLW1hbmFnZWQgQXVyb3JhIHNlY3JldFxuICAgICAgICBBUFBfU0VDUkVUU19BUk46IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICBGT1JDRV9SRUJVSUxEOiAnMjAyNS0wNy0wOS0wMS0xNS0wMC1GT1JDRS1SRUZSRVNILUFMTC1MQU1CREFTJywgLy8gRm9yY2UgcmVmcmVzaCBhbGwgTGFtYmRhIHZlcnNpb25zIHRvIGVsaW1pbmF0ZSBjYWNoaW5nIGlzc3Vlc1xuICAgICAgfSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH07XG5cbiAgICAvLyBTbGFjayBFdmVudHMgTGFtYmRhIEZ1bmN0aW9uXG4gICAgY29uc3Qgc2xhY2tFdmVudHNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYWNrRXZlbnRzRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9zbGFjay1ldmVudHMuaGFuZGxlcicsXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0aW1lbG9nZ2VyLXNsYWNrLWV2ZW50cycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0hhbmRsZSBTbGFjayBldmVudHMgKG1lc3NhZ2VzLCBtZW50aW9ucykgLSBGaXhlZCB2MjAyNS0wNy0wNy1OVUxMLUNIRUNLJyxcbiAgICB9KTtcblxuICAgIC8vIFNsYWNrIEludGVyYWN0aW9ucyBMYW1iZGEgRnVuY3Rpb25cbiAgICBjb25zdCBzbGFja0ludGVyYWN0aW9uc0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhY2tJbnRlcmFjdGlvbnNGdW5jdGlvbicsIHtcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9zcmMnKSksXG4gICAgICBoYW5kbGVyOiAnbGFtYmRhL3NsYWNrLWludGVyYWN0aW9ucy5oYW5kbGVyJyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RpbWVsb2dnZXItc2xhY2staW50ZXJhY3Rpb25zJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGFuZGxlIFNsYWNrIGludGVyYWN0aW9ucyAoYnV0dG9ucywgbWVudXMpIC0gRml4ZWQgdjIwMjUtMDctMDctTlVMTC1DSEVDSycsXG4gICAgfSk7XG5cbiAgICAvLyBTbGFjayBDb21tYW5kcyBMYW1iZGEgRnVuY3Rpb25cbiAgICBjb25zdCBzbGFja0NvbW1hbmRzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFja0NvbW1hbmRzRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9zbGFjay1jb21tYW5kcy5oYW5kbGVyJyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RpbWVsb2dnZXItc2xhY2stY29tbWFuZHMnLFxuICAgICAgZGVzY3JpcHRpb246ICdIYW5kbGUgU2xhY2sgc2xhc2ggY29tbWFuZHMgLSBGaXhlZCB2MjAyNS0wNy0wNy1OVUxMLUNIRUNLJyxcbiAgICB9KTtcblxuICAgIC8vIEhlYWx0aCBDaGVjayBMYW1iZGEgRnVuY3Rpb25cbiAgICBjb25zdCBoZWFsdGhGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0hlYWx0aEZ1bmN0aW9uJywge1xuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL3NyYycpKSxcbiAgICAgIGhhbmRsZXI6ICdsYW1iZGEvaGVhbHRoLmhhbmRsZXInLFxuICAgICAgZnVuY3Rpb25OYW1lOiAndGltZWxvZ2dlci1oZWFsdGgnLFxuICAgICAgZGVzY3JpcHRpb246ICdIZWFsdGggY2hlY2sgZW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgLy8gRGF0YWJhc2UgTWlncmF0aW9uIExhbWJkYSBGdW5jdGlvblxuICAgIGNvbnN0IG1pZ3JhdGlvbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWlncmF0aW9uRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9taWdyYXRpb24uaGFuZGxlcicsXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0aW1lbG9nZ2VyLW1pZ3JhdGlvbicsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGF0YWJhc2UgbWlncmF0aW9uIGFuZCBzZXR1cCcsXG4gICAgfSk7XG5cbiAgICAvLyBGaXggUGVybWlzc2lvbnMgTGFtYmRhIEZ1bmN0aW9uXG4gICAgY29uc3QgZml4UGVybWlzc2lvbnNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0ZpeFBlcm1pc3Npb25zRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9maXgtcGVybWlzc2lvbnMuaGFuZGxlcicsXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0aW1lbG9nZ2VyLWZpeC1wZXJtaXNzaW9ucycsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksIC8vIEluY3JlYXNlZCB0aW1lb3V0IGZvciBBdXJvcmEgU2VydmVybGVzcyB2MiBzY2FsaW5nXG4gICAgICBkZXNjcmlwdGlvbjogJ0ZpeCBBdXJvcmEgZGF0YWJhc2UgcGVybWlzc2lvbnMgZm9yIHRpbWVsb2dnZXJfYWRtaW4gdXNlcicsXG4gICAgfSk7XG5cbiAgICAvLyBEZWJ1ZyBWZXJzaW9uIExhbWJkYSBGdW5jdGlvblxuICAgIGNvbnN0IGRlYnVnVmVyc2lvbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRGVidWdWZXJzaW9uRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9kZWJ1Zy12ZXJzaW9uLmhhbmRsZXInLFxuICAgICAgZnVuY3Rpb25OYW1lOiAndGltZWxvZ2dlci1kZWJ1Zy12ZXJzaW9uJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGVidWcgZW5kcG9pbnQgdG8gY2hlY2sgY29kZSB2ZXJzaW9uJyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IGRhdGFiYXNlIGFjY2VzcyB0byBMYW1iZGEgZnVuY3Rpb25zXG4gICAgY29uc3QgbGFtYmRhRnVuY3Rpb25zID0gW1xuICAgICAgc2xhY2tFdmVudHNGdW5jdGlvbixcbiAgICAgIHNsYWNrSW50ZXJhY3Rpb25zRnVuY3Rpb24sXG4gICAgICBzbGFja0NvbW1hbmRzRnVuY3Rpb24sXG4gICAgICBoZWFsdGhGdW5jdGlvbixcbiAgICAgIG1pZ3JhdGlvbkZ1bmN0aW9uLFxuICAgICAgZml4UGVybWlzc2lvbnNGdW5jdGlvbixcbiAgICAgIGRlYnVnVmVyc2lvbkZ1bmN0aW9uLFxuICAgIF07XG5cbiAgICBsYW1iZGFGdW5jdGlvbnMuZm9yRWFjaChmbiA9PiB7XG4gICAgICBhdXJvcmEuY29ubmVjdGlvbnMuYWxsb3dEZWZhdWx0UG9ydEZyb20oZm4pO1xuICAgICAgZGJTZWNyZXQuZ3JhbnRSZWFkKGZuKTsgLy8gR3JhbnQgYWNjZXNzIHRvIENESy1tYW5hZ2VkIHNlY3JldFxuICAgICAgYXBwU2VjcmV0cy5ncmFudFJlYWQoZm4pO1xuICAgICAgXG4gICAgICAvLyBBZGQgZXhwbGljaXQgU2VjcmV0cyBNYW5hZ2VyIHBlcm1pc3Npb25zXG4gICAgICBmbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYXBwU2VjcmV0cy5zZWNyZXRBcm4sIGRiU2VjcmV0LnNlY3JldEFybl1cbiAgICAgIH0pKTtcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBUEkgR2F0ZXdheVxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ1RpbWVMb2dnZXJBUEknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ1RpbWVMb2dnZXIgU2xhY2sgQm90IEFQSScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IGZvciBUaW1lTG9nZ2VyIFNsYWNrIGJvdCB3ZWJob29rcycsXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxuICAgICAgICBhbGxvd0hlYWRlcnM6IFsnQ29udGVudC1UeXBlJywgJ1gtQW16LURhdGUnLCAnQXV0aG9yaXphdGlvbicsICdYLUFwaS1LZXknXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBUEkgR2F0ZXdheSBSb3V0ZXMgLSBVc2luZyBMYW1iZGEgZnVuY3Rpb25zIGRpcmVjdGx5IGluc3RlYWQgb2YgYWxpYXNlc1xuICAgIGNvbnN0IHNsYWNrUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnc2xhY2snKTtcbiAgICBcbiAgICAvLyBTbGFjayBldmVudHMgZW5kcG9pbnRcbiAgICBjb25zdCBldmVudHNSZXNvdXJjZSA9IHNsYWNrUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2V2ZW50cycpO1xuICAgIGV2ZW50c1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNsYWNrRXZlbnRzRnVuY3Rpb24pKTtcblxuICAgIC8vIFNsYWNrIGludGVyYWN0aW9ucyBlbmRwb2ludFxuICAgIGNvbnN0IGludGVyYWN0aW9uc1Jlc291cmNlID0gc2xhY2tSZXNvdXJjZS5hZGRSZXNvdXJjZSgnaW50ZXJhY3Rpb25zJyk7XG4gICAgaW50ZXJhY3Rpb25zUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc2xhY2tJbnRlcmFjdGlvbnNGdW5jdGlvbikpO1xuXG4gICAgLy8gU2xhY2sgY29tbWFuZHMgZW5kcG9pbnRcbiAgICBjb25zdCBjb21tYW5kc1Jlc291cmNlID0gc2xhY2tSZXNvdXJjZS5hZGRSZXNvdXJjZSgnY29tbWFuZHMnKTtcbiAgICBjb21tYW5kc1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNsYWNrQ29tbWFuZHNGdW5jdGlvbikpO1xuXG4gICAgLy8gSGVhbHRoIGNoZWNrIGVuZHBvaW50XG4gICAgY29uc3QgaGVhbHRoUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnaGVhbHRoJyk7XG4gICAgaGVhbHRoUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihoZWFsdGhGdW5jdGlvbikpO1xuXG4gICAgLy8gTWlncmF0aW9uIGVuZHBvaW50IChmb3IgbWFudWFsIGRhdGFiYXNlIHNldHVwKVxuICAgIGNvbnN0IG1pZ3JhdGlvblJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ21pZ3JhdGlvbicpO1xuICAgIG1pZ3JhdGlvblJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKG1pZ3JhdGlvbkZ1bmN0aW9uKSk7XG5cbiAgICAvLyBGaXggUGVybWlzc2lvbnMgZW5kcG9pbnQgKGZvciBmaXhpbmcgQXVyb3JhIHBlcm1pc3Npb25zKVxuICAgIGNvbnN0IGZpeFBlcm1pc3Npb25zUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnZml4LXBlcm1pc3Npb25zJyk7XG4gICAgZml4UGVybWlzc2lvbnNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihmaXhQZXJtaXNzaW9uc0Z1bmN0aW9uKSk7XG5cbiAgICAvLyBEZWJ1ZyBWZXJzaW9uIGVuZHBvaW50XG4gICAgY29uc3QgZGVidWdWZXJzaW9uUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnZGVidWctdmVyc2lvbicpO1xuICAgIGRlYnVnVmVyc2lvblJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZGVidWdWZXJzaW9uRnVuY3Rpb24pKTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGF0YWJhc2VFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiBhdXJvcmEuY2x1c3RlckVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCBjbHVzdGVyIGVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZVdyaXRlckVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IGF1cm9yYS5jbHVzdGVyRW5kcG9pbnQuaG9zdG5hbWUucmVwbGFjZSgnLmNsdXN0ZXItJywgJy53cml0ZXIuY2x1c3Rlci0nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXVyb3JhIFBvc3RncmVTUUwgd3JpdGVyIGVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZVNlY3JldEFybicsIHtcbiAgICAgIHZhbHVlOiBkYlNlY3JldC5zZWNyZXRBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgZGF0YWJhc2UgY3JlZGVudGlhbHMgc2VjcmV0JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcHBTZWNyZXRzQXJuJywge1xuICAgICAgdmFsdWU6IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIGFwcGxpY2F0aW9uIHNlY3JldHMnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlVcmwnLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEdhdGV3YXkgVVJMIGZvciBTbGFjayB3ZWJob29rcycsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2xhY2tFdmVudHNVcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH1zbGFjay9ldmVudHNgLFxuICAgICAgZGVzY3JpcHRpb246ICdTbGFjayBFdmVudHMgQVBJIFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2xhY2tJbnRlcmFjdGlvbnNVcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH1zbGFjay9pbnRlcmFjdGlvbnNgLFxuICAgICAgZGVzY3JpcHRpb246ICdTbGFjayBJbnRlcmFjdGlvbnMgVVJMJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTbGFja0NvbW1hbmRzVXJsJywge1xuICAgICAgdmFsdWU6IGAke2FwaS51cmx9c2xhY2svY29tbWFuZHNgLFxuICAgICAgZGVzY3JpcHRpb246ICdTbGFjayBDb21tYW5kcyBVUkwnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0hlYWx0aENoZWNrVXJsJywge1xuICAgICAgdmFsdWU6IGAke2FwaS51cmx9aGVhbHRoYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGVhbHRoIGNoZWNrIFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTWlncmF0aW9uVXJsJywge1xuICAgICAgdmFsdWU6IGAke2FwaS51cmx9bWlncmF0aW9uYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGF0YWJhc2UgbWlncmF0aW9uIFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRml4UGVybWlzc2lvbnNVcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH1maXgtcGVybWlzc2lvbnNgLFxuICAgICAgZGVzY3JpcHRpb246ICdGaXggQXVyb3JhIHBlcm1pc3Npb25zIFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGVidWdWZXJzaW9uVXJsJywge1xuICAgICAgdmFsdWU6IGAke2FwaS51cmx9ZGVidWctdmVyc2lvbmAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RlYnVnIHZlcnNpb24gVVJMJyxcbiAgICB9KTtcbiAgfVxufSAiXX0=