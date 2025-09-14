import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export class TranscriptionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Buckets
    const audioBucket = new s3.Bucket(this, 'AudioFilesBucket', {
      bucketName: `transcription-audio-files-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: ['*'], // In production, restrict this to your domain
        allowedHeaders: ['*'],
        exposedHeaders: ['ETag'],
        maxAge: 3000,
      }],
      lifecycleRules: [{
        id: 'DeleteOldAudioFiles',
        expiration: cdk.Duration.days(30), // Clean up audio files after 30 days
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
      }],
    });

    const transcriptsBucket = new s3.Bucket(this, 'TranscriptsBucket', {
      bucketName: `transcription-results-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      lifecycleRules: [{
        id: 'DeleteOldTranscripts',
        expiration: cdk.Duration.days(90), // Keep transcripts longer
      }],
    });

    // DynamoDB Table
    const transcriptionsTable = new dynamodb.Table(this, 'TranscriptionsTable', {
      tableName: 'transcriptions',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Add GSI for querying by timestamp (for listing recent transcriptions)
    transcriptionsTable.addGlobalSecondaryIndex({
      indexName: 'timestamp-index',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    // Create IAM service role for AWS Transcribe
    const transcribeServiceRole = new iam.Role(this, 'TranscribeServiceRole', {
      assumedBy: new iam.ServicePrincipal('transcribe.amazonaws.com'),
      description: 'Service role for AWS Transcribe to access S3 buckets',
      inlinePolicies: {
        TranscribeS3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:GetBucketLocation',
                's3:ListBucket',
              ],
              resources: [audioBucket.bucketArn, `${audioBucket.bucketArn}/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:PutObject',
                's3:PutObjectAcl',
                's3:GetBucketLocation',
                's3:ListBucket',
              ],
              resources: [transcriptsBucket.bucketArn, `${transcriptsBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    // Lambda function for generating pre-signed URLs
    const presignedUrlFunction = new NodejsFunction(this, 'PresignedUrlFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/presigned-url/index.ts'),
      environment: {
        AUDIO_BUCKET_NAME: audioBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Lambda function to start transcription
    const startTranscriptionFunction = new NodejsFunction(this, 'StartTranscriptionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/start-transcription/index.ts'),
      environment: {
        AUDIO_BUCKET_NAME: audioBucket.bucketName,
        TRANSCRIPTS_BUCKET_NAME: transcriptsBucket.bucketName,
        TRANSCRIPTIONS_TABLE_NAME: transcriptionsTable.tableName,
        TRANSCRIBE_SERVICE_ROLE_ARN: transcribeServiceRole.roleArn,
      },
      timeout: cdk.Duration.seconds(60),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Lambda function to process completed transcriptions
    const processTranscriptionFunction = new NodejsFunction(this, 'ProcessTranscriptionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/process-transcription/index.ts'),
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: transcriptionsTable.tableName,
        TRANSCRIPTS_BUCKET_NAME: transcriptsBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(60),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Lambda function to get transcriptions
    const getTranscriptionsFunction = new NodejsFunction(this, 'GetTranscriptionsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/get-transcriptions/index.ts'),
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: transcriptionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Lambda function to get single transcription
    const getTranscriptionFunction = new NodejsFunction(this, 'GetTranscriptionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/get-transcription/index.ts'),
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: transcriptionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Lambda function to manually start transcription jobs
    const manualStartTranscriptionFunction = new NodejsFunction(this, 'ManualStartTranscriptionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/manual-start-transcription/index.ts'),
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: transcriptionsTable.tableName,
        TRANSCRIPTS_BUCKET_NAME: transcriptsBucket.bucketName,
        TRANSCRIBE_SERVICE_ROLE_ARN: transcribeServiceRole.roleArn,
      },
      timeout: cdk.Duration.seconds(60),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Lambda function to auto-fix stuck transcriptions
    const autoFixTranscriptionsFunction = new NodejsFunction(this, 'AutoFixTranscriptionsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/auto-fix-transcriptions/index.ts'),
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: transcriptionsTable.tableName,
        TRANSCRIPTS_BUCKET_NAME: transcriptsBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(300), // 5 minutes for processing all transcriptions
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Lambda function to delete transcriptions
    const deleteTranscriptionFunction = new NodejsFunction(this, 'DeleteTranscriptionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda-functions/delete-transcription/index.ts'),
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: transcriptionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // IAM Permissions
    audioBucket.grantReadWrite(presignedUrlFunction);
    audioBucket.grantRead(startTranscriptionFunction);
    audioBucket.grantRead(manualStartTranscriptionFunction); // Fix: Grant read access to audio bucket
    transcriptsBucket.grantReadWrite(startTranscriptionFunction);
    transcriptsBucket.grantRead(processTranscriptionFunction);
    transcriptionsTable.grantWriteData(startTranscriptionFunction);
    transcriptionsTable.grantWriteData(processTranscriptionFunction);
    transcriptionsTable.grantReadData(getTranscriptionsFunction);
    transcriptionsTable.grantReadData(getTranscriptionFunction);
    transcriptionsTable.grantWriteData(manualStartTranscriptionFunction);
    transcriptionsTable.grantFullAccess(autoFixTranscriptionsFunction);
    transcriptsBucket.grantRead(autoFixTranscriptionsFunction);
    transcriptionsTable.grantWriteData(deleteTranscriptionFunction);

    // Grant Transcribe permissions
    const transcribePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartTranscriptionJob',
        'transcribe:GetTranscriptionJob',
        'transcribe:ListTranscriptionJobs',
      ],
      resources: ['*'],
    });

    startTranscriptionFunction.addToRolePolicy(transcribePolicy);
    processTranscriptionFunction.addToRolePolicy(transcribePolicy);
    manualStartTranscriptionFunction.addToRolePolicy(transcribePolicy);
    autoFixTranscriptionsFunction.addToRolePolicy(transcribePolicy);

    // Add IAM permissions for Lambda to assume role for transcribe service
    const transcribePassRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:PassRole',
      ],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'transcribe.amazonaws.com',
        },
      },
    });

    startTranscriptionFunction.addToRolePolicy(transcribePassRolePolicy);
    manualStartTranscriptionFunction.addToRolePolicy(transcribePassRolePolicy);

    // Grant AWS Transcribe service permission to read from audio bucket and write to transcripts bucket
    const transcribeServicePrincipal = new iam.ServicePrincipal('transcribe.amazonaws.com');

    audioBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [transcribeServicePrincipal],
      actions: [
        's3:GetObject',
        's3:GetBucketLocation',
        's3:ListBucket',
      ],
      resources: [audioBucket.bucketArn, `${audioBucket.bucketArn}/*`],
    }));

    transcriptsBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [transcribeServicePrincipal],
      actions: [
        's3:PutObject',
        's3:PutObjectAcl',
        's3:GetBucketLocation',
        's3:ListBucket',
      ],
      resources: [transcriptsBucket.bucketArn, `${transcriptsBucket.bucketArn}/*`],
    }));

    // Also grant Lambda functions write access to transcripts bucket for manual transcriptions
    transcriptsBucket.grantWrite(manualStartTranscriptionFunction);

    // S3 Event Notifications
    audioBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(startTranscriptionFunction),
      { suffix: '.mp3' }
    );
    audioBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(startTranscriptionFunction),
      { suffix: '.wav' }
    );
    audioBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(startTranscriptionFunction),
      { suffix: '.m4a' }
    );
    // Note: WebM format removed as AWS Transcribe doesn't support it
    // Users can upload MP3, WAV, M4A files for real transcription

    transcriptsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processTranscriptionFunction),
      { suffix: '.json' }
    );

    // API Gateway
    const api = new apigateway.RestApi(this, 'TranscriptionApi', {
      restApiName: 'Transcription Service API',
      description: 'API for audio transcription service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // In production, restrict this
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // API Endpoints
    const uploadEndpoint = api.root.addResource('upload-url');
    uploadEndpoint.addMethod('POST', new apigateway.LambdaIntegration(presignedUrlFunction));

    const transcriptionsEndpoint = api.root.addResource('transcriptions');
    transcriptionsEndpoint.addMethod('GET', new apigateway.LambdaIntegration(getTranscriptionsFunction));
    
    const transcriptionEndpoint = transcriptionsEndpoint.addResource('{id}');
    transcriptionEndpoint.addMethod('GET', new apigateway.LambdaIntegration(getTranscriptionFunction));
    transcriptionEndpoint.addMethod('DELETE', new apigateway.LambdaIntegration(deleteTranscriptionFunction));

    const manualTranscriptionEndpoint = api.root.addResource('manual-transcription');
    manualTranscriptionEndpoint.addMethod('POST', new apigateway.LambdaIntegration(manualStartTranscriptionFunction));
    
    const autoFixEndpoint = api.root.addResource('auto-fix');
    autoFixEndpoint.addMethod('POST', new apigateway.LambdaIntegration(autoFixTranscriptionsFunction));

    // Output important values
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'AudioBucketName', {
      value: audioBucket.bucketName,
      description: 'S3 bucket for audio files',
    });

    new cdk.CfnOutput(this, 'TranscriptsBucketName', {
      value: transcriptsBucket.bucketName,
      description: 'S3 bucket for transcription results',
    });

    new cdk.CfnOutput(this, 'TranscriptionsTableName', {
      value: transcriptionsTable.tableName,
      description: 'DynamoDB table for transcription metadata',
    });
  }
}
