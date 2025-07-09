# AWS Aurora Deployment Guide

This guide will help you deploy the TimeLogger Slack bot to AWS using Aurora PostgreSQL database and Lambda functions.

## Architecture Overview

The AWS deployment uses:
- **Aurora Serverless v2 PostgreSQL** - Scalable database with automatic scaling
- **AWS Lambda** - Serverless functions for Slack event handling
- **API Gateway** - REST API endpoints for Slack webhooks
- **AWS Secrets Manager** - Secure storage for credentials
- **VPC** - Network isolation for security
- **AWS CDK** - Infrastructure as Code for deployment

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured with your credentials
3. **Node.js** (version 18 or later)
4. **AWS CDK CLI** installed globally
5. **Slack App** already configured (from main setup)

## Installation Steps

### 1. Install Dependencies

```bash
# Install main project dependencies
npm install

# Install CDK dependencies
npm run aws:install
```

### 2. Configure AWS CLI

```bash
# Configure AWS credentials
aws configure

# Bootstrap CDK (only needed once per account/region)
npm run aws:bootstrap
```

### 3. Update Secrets in AWS

After deployment, you'll need to update the application secrets in AWS Secrets Manager:

1. Go to AWS Secrets Manager console
2. Find the secret named "TimeLoggerStack-AppSecrets-XXXXX"
3. Update the following values:
   - `SLACK_BOT_TOKEN`: Your Slack bot token (starts with `xoxb-`)
   - `SLACK_SIGNING_SECRET`: Your Slack signing secret
   - `SLACK_APP_TOKEN`: Your Slack app token (starts with `xapp-`)
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `ENCRYPTION_KEY`: A 32-character encryption key for Jira credentials

### 4. Deploy Infrastructure

```bash
# Build and deploy the stack
npm run aws:build
npm run aws:deploy
```

This will create:
- Aurora PostgreSQL cluster
- Lambda functions
- API Gateway endpoints
- VPC and networking
- Secrets Manager secrets

### 5. Initialize Database

After deployment, call the migration endpoint to set up database tables:

```bash
# Get the migration URL from CDK outputs
curl -X POST https://YOUR_API_GATEWAY_URL/migration
```

### 6. Update Slack App Configuration

Update your Slack app configuration with the new AWS endpoints:

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Select your TimeLogger app
3. Update the following URLs (replace `YOUR_API_GATEWAY_URL` with actual URL from CDK outputs):
   - **Event Subscriptions URL**: `https://YOUR_API_GATEWAY_URL/slack/events`
   - **Interactivity Request URL**: `https://YOUR_API_GATEWAY_URL/slack/interactions`
   - **Slash Commands URLs**: `https://YOUR_API_GATEWAY_URL/slack/commands`

## Environment Configuration

### Local Development

For local development with Aurora database, create a `.env.aws` file:

```env
NODE_ENV=development
AWS_REGION=us-east-1
DB_HOST=your-aurora-endpoint.cluster-xxxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=timelogger
DB_USER=timelogger_admin
DB_PASSWORD=your_db_password
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
OPENAI_API_KEY=your-openai-key
ENCRYPTION_KEY=your-32-character-key
```

Run locally with:
```bash
NODE_ENV=development node -r dotenv/config src/launcher.js dotenv_config_path=.env.aws
```

## Cost Optimization

The Aurora Serverless v2 configuration is optimized for cost:
- **Minimum Capacity**: 0.5 ACU (Aurora Capacity Units)
- **Maximum Capacity**: 2 ACU
- **Auto-scaling**: Scales based on demand
- **Auto-pause**: Database can pause when idle (not enabled by default for production)

Estimated monthly costs (us-east-1):
- Aurora Serverless v2: $20-40/month (depending on usage)
- Lambda: $0-5/month (first 1M requests free)
- API Gateway: $0-10/month (depending on usage)
- Secrets Manager: $0.40/secret/month
- VPC/NAT Gateway: $30-45/month

## Monitoring and Logs

### CloudWatch Logs
- Lambda function logs: `/aws/lambda/timelogger-*`
- API Gateway logs: Available in API Gateway console

### Health Check
Monitor the health endpoint: `https://YOUR_API_GATEWAY_URL/health`

### Database Monitoring
- Aurora Performance Insights
- CloudWatch metrics for Aurora

## Troubleshooting

### Common Issues

1. **Database Connection Timeout**
   - Check security groups allow Lambda access to Aurora
   - Verify VPC configuration

2. **Secrets Access Denied**
   - Ensure Lambda execution role has Secrets Manager permissions
   - Check the secret ARN in environment variables

3. **Slack Events Not Working**
   - Verify API Gateway URLs in Slack app configuration
   - Check Lambda function logs for errors

### Debug Commands

```bash
# View CDK stack status
cd cdk && npx cdk list

# View stack outputs
cd cdk && npx cdk outputs

# Tail Lambda logs
aws logs tail /aws/lambda/timelogger-slack-events --follow

# Test health endpoint
curl https://YOUR_API_GATEWAY_URL/health
```

## Backup and Recovery

Aurora automatically creates:
- **Daily backups** with 7-day retention
- **Point-in-time recovery** up to the last 5 minutes
- **Automated snapshots** before major changes

## Security Features

- **VPC Isolation**: Database in private subnets
- **Secrets Manager**: Encrypted credential storage
- **SSL/TLS**: Encrypted connections to database
- **IAM Roles**: Least privilege access for Lambda functions
- **Security Groups**: Network-level access control

## Scaling

The solution automatically scales:
- **Aurora**: Scales from 0.5 to 2 ACU based on load
- **Lambda**: Scales automatically with concurrent requests
- **API Gateway**: Handles high request volumes

For higher capacity needs, adjust in `cdk/lib/timelogger-stack.ts`:
```typescript
serverlessV2MinCapacity: 0.5,  // Increase for minimum capacity
serverlessV2MaxCapacity: 16,   // Increase for maximum capacity
```

## Cleanup

To remove all AWS resources:

```bash
npm run aws:destroy
```

This will delete:
- Aurora cluster and database
- Lambda functions
- API Gateway
- VPC and networking resources
- Secrets (with deletion protection if enabled)

**Note**: Database deletion protection is disabled for easier cleanup. Enable it for production by setting `deletionProtection: true` in the CDK stack.

## Support

For issues specific to AWS deployment:
1. Check CloudWatch logs for Lambda functions
2. Verify Aurora cluster status in RDS console
3. Test API Gateway endpoints directly
4. Review Slack app configuration and webhook URLs 