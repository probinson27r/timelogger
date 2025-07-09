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
                FORCE_REBUILD: '2025-07-07-02-20-00', // Force complete rebuild - clear all cached environments
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        };
        // Slack Events Lambda Function
        const slackEventsFunction = new lambda.Function(this, 'SlackEventsFunction', {
            ...commonLambdaProps,
            code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
            handler: 'lambda/slack-events.handler',
            functionName: 'timelogger-slack-events',
            description: 'Handle Slack events (messages, mentions)',
        });
        // Slack Interactions Lambda Function
        const slackInteractionsFunction = new lambda.Function(this, 'SlackInteractionsFunction', {
            ...commonLambdaProps,
            code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
            handler: 'lambda/slack-interactions.handler',
            functionName: 'timelogger-slack-interactions',
            description: 'Handle Slack interactions (buttons, menus)',
        });
        // Slack Commands Lambda Function
        const slackCommandsFunction = new lambda.Function(this, 'SlackCommandsFunction', {
            ...commonLambdaProps,
            code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
            handler: 'lambda/slack-commands.handler',
            functionName: 'timelogger-slack-commands',
            description: 'Handle Slack slash commands',
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
        // Grant database access to Lambda functions
        const lambdaFunctions = [
            slackEventsFunction,
            slackInteractionsFunction,
            slackCommandsFunction,
            healthFunction,
            migrationFunction,
            fixPermissionsFunction,
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
    }
}
exports.TimeLoggerStack = TimeLoggerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGltZWxvZ2dlci1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInRpbWVsb2dnZXItc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQywrRUFBaUU7QUFDakUsMkRBQTZDO0FBRTdDLDJDQUE2QjtBQUM3Qix5REFBMkM7QUFFM0MsTUFBYSxlQUFnQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsbUNBQW1DO1FBQ25DLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQzdDLE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtpQkFDbEM7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFNBQVM7b0JBQ2YsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CO2lCQUMvQztnQkFDRDtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsVUFBVTtvQkFDaEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCO2lCQUM1QzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsZ0NBQWdDO1FBQ2hDLE1BQU0sUUFBUSxHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQy9ELFdBQVcsRUFBRSw4Q0FBOEM7WUFDM0Qsb0JBQW9CLEVBQUU7Z0JBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxRQUFRLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQztnQkFDdEUsaUJBQWlCLEVBQUUsVUFBVTtnQkFDN0IsaUJBQWlCLEVBQUUsU0FBUztnQkFDNUIsWUFBWSxFQUFFLEtBQUs7Z0JBQ25CLGNBQWMsRUFBRSxFQUFFO2FBQ25CO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsaURBQWlEO1FBQ2pELE1BQU0sTUFBTSxHQUFHLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQzVELE1BQU0sRUFBRSxHQUFHLENBQUMscUJBQXFCLENBQUMsY0FBYyxDQUFDO2dCQUMvQyxPQUFPLEVBQUUsR0FBRyxDQUFDLDJCQUEyQixDQUFDLFFBQVE7YUFDbEQsQ0FBQztZQUNGLFdBQVcsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7WUFDakQsTUFBTSxFQUFFLEdBQUcsQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQztZQUNsRCxPQUFPLEVBQUU7Z0JBQ1AsR0FBRyxDQUFDLGVBQWUsQ0FBQyxZQUFZLENBQUMsUUFBUSxFQUFFLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxDQUFDO2FBQ3RFO1lBQ0QsdUJBQXVCLEVBQUUsR0FBRztZQUM1Qix1QkFBdUIsRUFBRSxDQUFDO1lBQzFCLEdBQUc7WUFDSCxVQUFVLEVBQUU7Z0JBQ1YsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCO2FBQzVDO1lBQ0QsbUJBQW1CLEVBQUUsWUFBWTtZQUNqQyxNQUFNLEVBQUU7Z0JBQ04sU0FBUyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQzthQUNoQztZQUNELGtCQUFrQixFQUFFLEtBQUssRUFBRSw2QkFBNkI7WUFDeEQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLCtCQUErQjtTQUMxRSxDQUFDLENBQUM7UUFFSCx1REFBdUQ7UUFDdkQsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDL0QsV0FBVyxFQUFFLG9DQUFvQztZQUNqRCxpQkFBaUIsRUFBRTtnQkFDakIsZUFBZSxFQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLFdBQVcsQ0FBQztnQkFDN0Qsb0JBQW9CLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsV0FBVyxDQUFDO2dCQUNsRSxlQUFlLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsV0FBVyxDQUFDO2dCQUM3RCxjQUFjLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsV0FBVyxDQUFDO2dCQUM1RCxjQUFjLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsa0NBQWtDLENBQUM7Z0JBQ25GLFlBQVksRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7Z0JBQ2pELGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQzthQUN4RDtTQUNGLENBQUMsQ0FBQztRQUVILHVDQUF1QztRQUN2QyxNQUFNLGlCQUFpQixHQUFHO1lBQ3hCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNqQyxVQUFVLEVBQUUsR0FBRztZQUNmLEdBQUc7WUFDSCxVQUFVLEVBQUU7Z0JBQ1YsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CO2FBQy9DO1lBQ0QsV0FBVyxFQUFFO2dCQUNYLGFBQWEsRUFBRSxRQUFRLENBQUMsU0FBUyxFQUFFLG9DQUFvQztnQkFDdkUsZUFBZSxFQUFFLFVBQVUsQ0FBQyxTQUFTO2dCQUNyQyxRQUFRLEVBQUUsWUFBWTtnQkFDdEIsYUFBYSxFQUFFLHFCQUFxQixFQUFFLHlEQUF5RDthQUNoRztZQUNELFlBQVksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVE7U0FDMUMsQ0FBQztRQUVGLCtCQUErQjtRQUMvQixNQUFNLG1CQUFtQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDM0UsR0FBRyxpQkFBaUI7WUFDcEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBQzlELE9BQU8sRUFBRSw2QkFBNkI7WUFDdEMsWUFBWSxFQUFFLHlCQUF5QjtZQUN2QyxXQUFXLEVBQUUsMENBQTBDO1NBQ3hELENBQUMsQ0FBQztRQUVILHFDQUFxQztRQUNyQyxNQUFNLHlCQUF5QixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLEVBQUU7WUFDdkYsR0FBRyxpQkFBaUI7WUFDcEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBQzlELE9BQU8sRUFBRSxtQ0FBbUM7WUFDNUMsWUFBWSxFQUFFLCtCQUErQjtZQUM3QyxXQUFXLEVBQUUsNENBQTRDO1NBQzFELENBQUMsQ0FBQztRQUVILGlDQUFpQztRQUNqQyxNQUFNLHFCQUFxQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDL0UsR0FBRyxpQkFBaUI7WUFDcEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBQzlELE9BQU8sRUFBRSwrQkFBK0I7WUFDeEMsWUFBWSxFQUFFLDJCQUEyQjtZQUN6QyxXQUFXLEVBQUUsNkJBQTZCO1NBQzNDLENBQUMsQ0FBQztRQUVILCtCQUErQjtRQUMvQixNQUFNLGNBQWMsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ2pFLEdBQUcsaUJBQWlCO1lBQ3BCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsQ0FBQztZQUM5RCxPQUFPLEVBQUUsdUJBQXVCO1lBQ2hDLFlBQVksRUFBRSxtQkFBbUI7WUFDakMsV0FBVyxFQUFFLHVCQUF1QjtTQUNyQyxDQUFDLENBQUM7UUFFSCxxQ0FBcUM7UUFDckMsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQ3ZFLEdBQUcsaUJBQWlCO1lBQ3BCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsQ0FBQztZQUM5RCxPQUFPLEVBQUUsMEJBQTBCO1lBQ25DLFlBQVksRUFBRSxzQkFBc0I7WUFDcEMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUNoQyxXQUFXLEVBQUUsOEJBQThCO1NBQzVDLENBQUMsQ0FBQztRQUVILGtDQUFrQztRQUNsQyxNQUFNLHNCQUFzQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDakYsR0FBRyxpQkFBaUI7WUFDcEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBQzlELE9BQU8sRUFBRSxnQ0FBZ0M7WUFDekMsWUFBWSxFQUFFLDRCQUE0QjtZQUMxQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUUscURBQXFEO1lBQ3hGLFdBQVcsRUFBRSwyREFBMkQ7U0FDekUsQ0FBQyxDQUFDO1FBRUgsNENBQTRDO1FBQzVDLE1BQU0sZUFBZSxHQUFHO1lBQ3RCLG1CQUFtQjtZQUNuQix5QkFBeUI7WUFDekIscUJBQXFCO1lBQ3JCLGNBQWM7WUFDZCxpQkFBaUI7WUFDakIsc0JBQXNCO1NBQ3ZCLENBQUM7UUFFRixlQUFlLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFO1lBQzNCLE1BQU0sQ0FBQyxXQUFXLENBQUMsb0JBQW9CLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDNUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLHFDQUFxQztZQUM3RCxVQUFVLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBRXpCLDJDQUEyQztZQUMzQyxFQUFFLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQkFDekMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQkFDeEIsT0FBTyxFQUFFLENBQUMsK0JBQStCLENBQUM7Z0JBQzFDLFNBQVMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVMsQ0FBQzthQUN0RCxDQUFDLENBQUMsQ0FBQztRQUNOLENBQUMsQ0FBQyxDQUFDO1FBRUgscUJBQXFCO1FBQ3JCLE1BQU0sR0FBRyxHQUFHLElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3hELFdBQVcsRUFBRSwwQkFBMEI7WUFDdkMsV0FBVyxFQUFFLCtDQUErQztZQUM1RCwyQkFBMkIsRUFBRTtnQkFDM0IsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFLENBQUMsY0FBYyxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsV0FBVyxDQUFDO2FBQzNFO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsMEVBQTBFO1FBQzFFLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRXBELHdCQUF3QjtRQUN4QixNQUFNLGNBQWMsR0FBRyxhQUFhLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzNELGNBQWMsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQztRQUV4Riw4QkFBOEI7UUFDOUIsTUFBTSxvQkFBb0IsR0FBRyxhQUFhLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ3ZFLG9CQUFvQixDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsSUFBSSxVQUFVLENBQUMsaUJBQWlCLENBQUMseUJBQXlCLENBQUMsQ0FBQyxDQUFDO1FBRXBHLDBCQUEwQjtRQUMxQixNQUFNLGdCQUFnQixHQUFHLGFBQWEsQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDL0QsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7UUFFNUYsd0JBQXdCO1FBQ3hCLE1BQU0sY0FBYyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3RELGNBQWMsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUM7UUFFbEYsaURBQWlEO1FBQ2pELE1BQU0saUJBQWlCLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDNUQsaUJBQWlCLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUM7UUFFekYsMkRBQTJEO1FBQzNELE1BQU0sc0JBQXNCLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUN2RSxzQkFBc0IsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQztRQUVuRyxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsTUFBTSxDQUFDLGVBQWUsQ0FBQyxRQUFRO1lBQ3RDLFdBQVcsRUFBRSxvQ0FBb0M7U0FDbEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRTtZQUNoRCxLQUFLLEVBQUUsTUFBTSxDQUFDLGVBQWUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxrQkFBa0IsQ0FBQztZQUMvRSxXQUFXLEVBQUUsbUNBQW1DO1NBQ2pELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDM0MsS0FBSyxFQUFFLFFBQVEsQ0FBQyxTQUFTO1lBQ3pCLFdBQVcsRUFBRSx3Q0FBd0M7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxTQUFTO1lBQzNCLFdBQVcsRUFBRSxnQ0FBZ0M7U0FDOUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHO1lBQ2QsV0FBVyxFQUFFLG9DQUFvQztTQUNsRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxHQUFHLEdBQUcsQ0FBQyxHQUFHLGNBQWM7WUFDL0IsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQzlDLEtBQUssRUFBRSxHQUFHLEdBQUcsQ0FBQyxHQUFHLG9CQUFvQjtZQUNyQyxXQUFXLEVBQUUsd0JBQXdCO1NBQ3RDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsZ0JBQWdCO1lBQ2pDLFdBQVcsRUFBRSxvQkFBb0I7U0FDbEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsR0FBRyxHQUFHLENBQUMsR0FBRyxRQUFRO1lBQ3pCLFdBQVcsRUFBRSxrQkFBa0I7U0FDaEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsV0FBVztZQUM1QixXQUFXLEVBQUUsd0JBQXdCO1NBQ3RDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDM0MsS0FBSyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsaUJBQWlCO1lBQ2xDLFdBQVcsRUFBRSw0QkFBNEI7U0FDMUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBNVFELDBDQTRRQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcblxuZXhwb3J0IGNsYXNzIFRpbWVMb2dnZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIENyZWF0ZSBWUEMgZm9yIEF1cm9yYSBhbmQgTGFtYmRhXG4gICAgY29uc3QgdnBjID0gbmV3IGVjMi5WcGModGhpcywgJ1RpbWVMb2dnZXJWUEMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBuYXRHYXRld2F5czogMSxcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAncHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGUnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ2lzb2xhdGVkJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBdXJvcmEgRGF0YWJhc2UgU2VjcmV0XG4gICAgY29uc3QgZGJTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdBdXJvcmFTZWNyZXQnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0F1cm9yYSBQb3N0Z3JlU1FMIGNyZWRlbnRpYWxzIGZvciBUaW1lTG9nZ2VyJyxcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgIHNlY3JldFN0cmluZ1RlbXBsYXRlOiBKU09OLnN0cmluZ2lmeSh7IHVzZXJuYW1lOiAndGltZWxvZ2dlcl9hZG1pbicgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAncGFzc3dvcmQnLFxuICAgICAgICBleGNsdWRlQ2hhcmFjdGVyczogJ1wiQC9cXFxcXFwnJyxcbiAgICAgICAgaW5jbHVkZVNwYWNlOiBmYWxzZSxcbiAgICAgICAgcGFzc3dvcmRMZW5ndGg6IDMyLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBdXJvcmEgU2VydmVybGVzcyB2MiBQb3N0Z3JlU1FMIENsdXN0ZXJcbiAgICBjb25zdCBhdXJvcmEgPSBuZXcgcmRzLkRhdGFiYXNlQ2x1c3Rlcih0aGlzLCAnQXVyb3JhQ2x1c3RlcicsIHtcbiAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlQ2x1c3RlckVuZ2luZS5hdXJvcmFQb3N0Z3Jlcyh7XG4gICAgICAgIHZlcnNpb246IHJkcy5BdXJvcmFQb3N0Z3Jlc0VuZ2luZVZlcnNpb24uVkVSXzE1XzQsXG4gICAgICB9KSxcbiAgICAgIGNyZWRlbnRpYWxzOiByZHMuQ3JlZGVudGlhbHMuZnJvbVNlY3JldChkYlNlY3JldCksXG4gICAgICB3cml0ZXI6IHJkcy5DbHVzdGVySW5zdGFuY2Uuc2VydmVybGVzc1YyKCd3cml0ZXInKSxcbiAgICAgIHJlYWRlcnM6IFtcbiAgICAgICAgcmRzLkNsdXN0ZXJJbnN0YW5jZS5zZXJ2ZXJsZXNzVjIoJ3JlYWRlcicsIHsgc2NhbGVXaXRoV3JpdGVyOiB0cnVlIH0pLFxuICAgICAgXSxcbiAgICAgIHNlcnZlcmxlc3NWMk1pbkNhcGFjaXR5OiAwLjUsXG4gICAgICBzZXJ2ZXJsZXNzVjJNYXhDYXBhY2l0eTogMixcbiAgICAgIHZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgIH0sXG4gICAgICBkZWZhdWx0RGF0YWJhc2VOYW1lOiAndGltZWxvZ2dlcicsXG4gICAgICBiYWNrdXA6IHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg3KSxcbiAgICAgIH0sXG4gICAgICBkZWxldGlvblByb3RlY3Rpb246IGZhbHNlLCAvLyBTZXQgdG8gdHJ1ZSBmb3IgcHJvZHVjdGlvblxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gU2V0IHRvIFJFVEFJTiBmb3IgcHJvZHVjdGlvblxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEFwcGxpY2F0aW9uIFNlY3JldHMgZm9yIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgIGNvbnN0IGFwcFNlY3JldHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdBcHBTZWNyZXRzJywge1xuICAgICAgZGVzY3JpcHRpb246ICdBcHBsaWNhdGlvbiBzZWNyZXRzIGZvciBUaW1lTG9nZ2VyJyxcbiAgICAgIHNlY3JldE9iamVjdFZhbHVlOiB7XG4gICAgICAgIFNMQUNLX0JPVF9UT0tFTjogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnQ0hBTkdFX01FJyksXG4gICAgICAgIFNMQUNLX1NJR05JTkdfU0VDUkVUOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KCdDSEFOR0VfTUUnKSxcbiAgICAgICAgU0xBQ0tfQVBQX1RPS0VOOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KCdDSEFOR0VfTUUnKSxcbiAgICAgICAgT1BFTkFJX0FQSV9LRVk6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ0NIQU5HRV9NRScpLFxuICAgICAgICBFTkNSWVBUSU9OX0tFWTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnQ0hBTkdFX01FXzMyX0NIQVJTX0xPTkdfS0VZX0hFUkUnKSxcbiAgICAgICAgVEVBTVNfQVBQX0lEOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KCcnKSxcbiAgICAgICAgVEVBTVNfQVBQX1BBU1NXT1JEOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KCcnKSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDb21tb24gTGFtYmRhIGZ1bmN0aW9uIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBjb21tb25MYW1iZGFQcm9wcyA9IHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgdnBjLFxuICAgICAgdnBjU3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERCX1NFQ1JFVF9BUk46IGRiU2VjcmV0LnNlY3JldEFybiwgLy8gVXNlIHRoZSBDREstbWFuYWdlZCBBdXJvcmEgc2VjcmV0XG4gICAgICAgIEFQUF9TRUNSRVRTX0FSTjogYXBwU2VjcmV0cy5zZWNyZXRBcm4sXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXG4gICAgICAgIEZPUkNFX1JFQlVJTEQ6ICcyMDI1LTA3LTA3LTAyLTIwLTAwJywgLy8gRm9yY2UgY29tcGxldGUgcmVidWlsZCAtIGNsZWFyIGFsbCBjYWNoZWQgZW52aXJvbm1lbnRzXG4gICAgICB9LFxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgfTtcblxuICAgIC8vIFNsYWNrIEV2ZW50cyBMYW1iZGEgRnVuY3Rpb25cbiAgICBjb25zdCBzbGFja0V2ZW50c0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhY2tFdmVudHNGdW5jdGlvbicsIHtcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9zcmMnKSksXG4gICAgICBoYW5kbGVyOiAnbGFtYmRhL3NsYWNrLWV2ZW50cy5oYW5kbGVyJyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RpbWVsb2dnZXItc2xhY2stZXZlbnRzJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGFuZGxlIFNsYWNrIGV2ZW50cyAobWVzc2FnZXMsIG1lbnRpb25zKScsXG4gICAgfSk7XG5cbiAgICAvLyBTbGFjayBJbnRlcmFjdGlvbnMgTGFtYmRhIEZ1bmN0aW9uXG4gICAgY29uc3Qgc2xhY2tJbnRlcmFjdGlvbnNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYWNrSW50ZXJhY3Rpb25zRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9zbGFjay1pbnRlcmFjdGlvbnMuaGFuZGxlcicsXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0aW1lbG9nZ2VyLXNsYWNrLWludGVyYWN0aW9ucycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0hhbmRsZSBTbGFjayBpbnRlcmFjdGlvbnMgKGJ1dHRvbnMsIG1lbnVzKScsXG4gICAgfSk7XG5cbiAgICAvLyBTbGFjayBDb21tYW5kcyBMYW1iZGEgRnVuY3Rpb25cbiAgICBjb25zdCBzbGFja0NvbW1hbmRzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFja0NvbW1hbmRzRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9zbGFjay1jb21tYW5kcy5oYW5kbGVyJyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RpbWVsb2dnZXItc2xhY2stY29tbWFuZHMnLFxuICAgICAgZGVzY3JpcHRpb246ICdIYW5kbGUgU2xhY2sgc2xhc2ggY29tbWFuZHMnLFxuICAgIH0pO1xuXG4gICAgLy8gSGVhbHRoIENoZWNrIExhbWJkYSBGdW5jdGlvblxuICAgIGNvbnN0IGhlYWx0aEZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnSGVhbHRoRnVuY3Rpb24nLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vc3JjJykpLFxuICAgICAgaGFuZGxlcjogJ2xhbWJkYS9oZWFsdGguaGFuZGxlcicsXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0aW1lbG9nZ2VyLWhlYWx0aCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ0hlYWx0aCBjaGVjayBlbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICAvLyBEYXRhYmFzZSBNaWdyYXRpb24gTGFtYmRhIEZ1bmN0aW9uXG4gICAgY29uc3QgbWlncmF0aW9uRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdNaWdyYXRpb25GdW5jdGlvbicsIHtcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9zcmMnKSksXG4gICAgICBoYW5kbGVyOiAnbGFtYmRhL21pZ3JhdGlvbi5oYW5kbGVyJyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RpbWVsb2dnZXItbWlncmF0aW9uJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgZGVzY3JpcHRpb246ICdEYXRhYmFzZSBtaWdyYXRpb24gYW5kIHNldHVwJyxcbiAgICB9KTtcblxuICAgIC8vIEZpeCBQZXJtaXNzaW9ucyBMYW1iZGEgRnVuY3Rpb25cbiAgICBjb25zdCBmaXhQZXJtaXNzaW9uc0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRml4UGVybWlzc2lvbnNGdW5jdGlvbicsIHtcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9zcmMnKSksXG4gICAgICBoYW5kbGVyOiAnbGFtYmRhL2ZpeC1wZXJtaXNzaW9ucy5oYW5kbGVyJyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RpbWVsb2dnZXItZml4LXBlcm1pc3Npb25zJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSwgLy8gSW5jcmVhc2VkIHRpbWVvdXQgZm9yIEF1cm9yYSBTZXJ2ZXJsZXNzIHYyIHNjYWxpbmdcbiAgICAgIGRlc2NyaXB0aW9uOiAnRml4IEF1cm9yYSBkYXRhYmFzZSBwZXJtaXNzaW9ucyBmb3IgdGltZWxvZ2dlcl9hZG1pbiB1c2VyJyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IGRhdGFiYXNlIGFjY2VzcyB0byBMYW1iZGEgZnVuY3Rpb25zXG4gICAgY29uc3QgbGFtYmRhRnVuY3Rpb25zID0gW1xuICAgICAgc2xhY2tFdmVudHNGdW5jdGlvbixcbiAgICAgIHNsYWNrSW50ZXJhY3Rpb25zRnVuY3Rpb24sXG4gICAgICBzbGFja0NvbW1hbmRzRnVuY3Rpb24sXG4gICAgICBoZWFsdGhGdW5jdGlvbixcbiAgICAgIG1pZ3JhdGlvbkZ1bmN0aW9uLFxuICAgICAgZml4UGVybWlzc2lvbnNGdW5jdGlvbixcbiAgICBdO1xuXG4gICAgbGFtYmRhRnVuY3Rpb25zLmZvckVhY2goZm4gPT4ge1xuICAgICAgYXVyb3JhLmNvbm5lY3Rpb25zLmFsbG93RGVmYXVsdFBvcnRGcm9tKGZuKTtcbiAgICAgIGRiU2VjcmV0LmdyYW50UmVhZChmbik7IC8vIEdyYW50IGFjY2VzcyB0byBDREstbWFuYWdlZCBzZWNyZXRcbiAgICAgIGFwcFNlY3JldHMuZ3JhbnRSZWFkKGZuKTtcbiAgICAgIFxuICAgICAgLy8gQWRkIGV4cGxpY2l0IFNlY3JldHMgTWFuYWdlciBwZXJtaXNzaW9uc1xuICAgICAgZm4uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gICAgICAgIHJlc291cmNlczogW2FwcFNlY3JldHMuc2VjcmV0QXJuLCBkYlNlY3JldC5zZWNyZXRBcm5dXG4gICAgICB9KSk7XG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQVBJIEdhdGV3YXlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdUaW1lTG9nZ2VyQVBJJywge1xuICAgICAgcmVzdEFwaU5hbWU6ICdUaW1lTG9nZ2VyIFNsYWNrIEJvdCBBUEknLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBmb3IgVGltZUxvZ2dlciBTbGFjayBib3Qgd2ViaG9va3MnLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbJ0NvbnRlbnQtVHlwZScsICdYLUFtei1EYXRlJywgJ0F1dGhvcml6YXRpb24nLCAnWC1BcGktS2V5J10sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgUm91dGVzIC0gVXNpbmcgTGFtYmRhIGZ1bmN0aW9ucyBkaXJlY3RseSBpbnN0ZWFkIG9mIGFsaWFzZXNcbiAgICBjb25zdCBzbGFja1Jlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3NsYWNrJyk7XG4gICAgXG4gICAgLy8gU2xhY2sgZXZlbnRzIGVuZHBvaW50XG4gICAgY29uc3QgZXZlbnRzUmVzb3VyY2UgPSBzbGFja1Jlc291cmNlLmFkZFJlc291cmNlKCdldmVudHMnKTtcbiAgICBldmVudHNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzbGFja0V2ZW50c0Z1bmN0aW9uKSk7XG5cbiAgICAvLyBTbGFjayBpbnRlcmFjdGlvbnMgZW5kcG9pbnRcbiAgICBjb25zdCBpbnRlcmFjdGlvbnNSZXNvdXJjZSA9IHNsYWNrUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2ludGVyYWN0aW9ucycpO1xuICAgIGludGVyYWN0aW9uc1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNsYWNrSW50ZXJhY3Rpb25zRnVuY3Rpb24pKTtcblxuICAgIC8vIFNsYWNrIGNvbW1hbmRzIGVuZHBvaW50XG4gICAgY29uc3QgY29tbWFuZHNSZXNvdXJjZSA9IHNsYWNrUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2NvbW1hbmRzJyk7XG4gICAgY29tbWFuZHNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzbGFja0NvbW1hbmRzRnVuY3Rpb24pKTtcblxuICAgIC8vIEhlYWx0aCBjaGVjayBlbmRwb2ludFxuICAgIGNvbnN0IGhlYWx0aFJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2hlYWx0aCcpO1xuICAgIGhlYWx0aFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oaGVhbHRoRnVuY3Rpb24pKTtcblxuICAgIC8vIE1pZ3JhdGlvbiBlbmRwb2ludCAoZm9yIG1hbnVhbCBkYXRhYmFzZSBzZXR1cClcbiAgICBjb25zdCBtaWdyYXRpb25SZXNvdXJjZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdtaWdyYXRpb24nKTtcbiAgICBtaWdyYXRpb25SZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihtaWdyYXRpb25GdW5jdGlvbikpO1xuXG4gICAgLy8gRml4IFBlcm1pc3Npb25zIGVuZHBvaW50IChmb3IgZml4aW5nIEF1cm9yYSBwZXJtaXNzaW9ucylcbiAgICBjb25zdCBmaXhQZXJtaXNzaW9uc1Jlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2ZpeC1wZXJtaXNzaW9ucycpO1xuICAgIGZpeFBlcm1pc3Npb25zUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZml4UGVybWlzc2lvbnNGdW5jdGlvbikpO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IGF1cm9yYS5jbHVzdGVyRW5kcG9pbnQuaG9zdG5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1cm9yYSBQb3N0Z3JlU1FMIGNsdXN0ZXIgZW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RhdGFiYXNlV3JpdGVyRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogYXVyb3JhLmNsdXN0ZXJFbmRwb2ludC5ob3N0bmFtZS5yZXBsYWNlKCcuY2x1c3Rlci0nLCAnLndyaXRlci5jbHVzdGVyLScpLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCB3cml0ZXIgZW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RhdGFiYXNlU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IGRiU2VjcmV0LnNlY3JldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBkYXRhYmFzZSBjcmVkZW50aWFscyBzZWNyZXQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwcFNlY3JldHNBcm4nLCB7XG4gICAgICB2YWx1ZTogYXBwU2VjcmV0cy5zZWNyZXRBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgYXBwbGljYXRpb24gc2VjcmV0cycsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpR2F0ZXdheVVybCcsIHtcbiAgICAgIHZhbHVlOiBhcGkudXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBVUkwgZm9yIFNsYWNrIHdlYmhvb2tzJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTbGFja0V2ZW50c1VybCcsIHtcbiAgICAgIHZhbHVlOiBgJHthcGkudXJsfXNsYWNrL2V2ZW50c2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NsYWNrIEV2ZW50cyBBUEkgVVJMJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTbGFja0ludGVyYWN0aW9uc1VybCcsIHtcbiAgICAgIHZhbHVlOiBgJHthcGkudXJsfXNsYWNrL2ludGVyYWN0aW9uc2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NsYWNrIEludGVyYWN0aW9ucyBVUkwnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NsYWNrQ29tbWFuZHNVcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH1zbGFjay9jb21tYW5kc2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NsYWNrIENvbW1hbmRzIFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSGVhbHRoQ2hlY2tVcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH1oZWFsdGhgLFxuICAgICAgZGVzY3JpcHRpb246ICdIZWFsdGggY2hlY2sgVVJMJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNaWdyYXRpb25VcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH1taWdyYXRpb25gLFxuICAgICAgZGVzY3JpcHRpb246ICdEYXRhYmFzZSBtaWdyYXRpb24gVVJMJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdGaXhQZXJtaXNzaW9uc1VybCcsIHtcbiAgICAgIHZhbHVlOiBgJHthcGkudXJsfWZpeC1wZXJtaXNzaW9uc2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ0ZpeCBBdXJvcmEgcGVybWlzc2lvbnMgVVJMJyxcbiAgICB9KTtcbiAgfVxufSAiXX0=