#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TimeLoggerStack } from '../lib/timelogger-stack';

const app = new cdk.App();
new TimeLoggerStack(app, 'TimeLoggerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'TimeLogger Slack Bot with Aurora database',
}); 