#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NotificationsStack } from '../lib/notifications-stack';

const app = new cdk.App();

new NotificationsStack(app, 'KxGenNotificationsStack', {
  /* EventBridge discovery requires account/region to be specified for SSM parameter lookup */
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },
  
  /* Environment for resource naming (dev, staging, prod) */
  environment: process.env.ENVIRONMENT || 'dev',
  
  /* Optional: Cross-account role ARN for EventBridge → WebSocket notifications */
  // assumeRoleArn: 'arn:aws:iam::ACCOUNT:role/CrossAccountNotificationsRole',

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});
