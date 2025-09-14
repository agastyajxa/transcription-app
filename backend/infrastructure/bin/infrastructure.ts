#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TranscriptionStack } from '../lib/infrastructure-stack';

const app = new cdk.App();
new TranscriptionStack(app, 'TranscriptionStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },
  description: 'Audio transcription service with AWS Transcribe, S3, DynamoDB, and Lambda',
});
