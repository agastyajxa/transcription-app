import { S3Event } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event: S3Event) => {
  console.log('S3 Event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const bucketName = record.s3.bucket.name;
      const objectKey = record.s3.object.key;
      
      console.log(`Processing file: ${objectKey} from bucket: ${bucketName}`);

      // Add small delay to ensure S3 object is fully available
      console.log('Waiting 2 seconds for S3 object to be fully available...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get file metadata with retry logic
      let s3Object;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          const getObjectCommand = new GetObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
          });
          
          s3Object = await s3Client.send(getObjectCommand);
          console.log('Successfully retrieved S3 object metadata');
          break;
        } catch (s3Error) {
          retryCount++;
          console.error(`Attempt ${retryCount} failed to get S3 object:`, s3Error);
          
          if (retryCount >= maxRetries) {
            throw new Error(`Failed to access S3 object after ${maxRetries} attempts: ${s3Error.message}`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      const originalFileName = s3Object.Metadata?.originalfilename || objectKey;
      const uploadTimestamp = s3Object.Metadata?.uploadtimestamp || new Date().toISOString();

      // Create unique job name
      const jobName = `transcription-job-${objectKey.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      
      // Determine file format
      const fileExtension = objectKey.split('.').pop()?.toLowerCase();
      let mediaFormat: string;
      
      switch (fileExtension) {
        case 'mp3':
          mediaFormat = 'mp3';
          break;
        case 'wav':
          mediaFormat = 'wav';
          break;
        case 'm4a':
        case 'mp4':
          mediaFormat = 'm4a';
          break;
        case 'webm':
          // AWS Transcribe doesn't support WebM format
          console.warn('WebM format not supported by AWS Transcribe, skipping transcription job');
          return;
        default:
          mediaFormat = 'mp3';
      }

      // Start transcription job with service role
      const transcribeParams = {
        TranscriptionJobName: jobName,
        LanguageCode: 'en-US', // Can be made configurable
        MediaFormat: mediaFormat,
        Media: {
          MediaFileUri: `s3://${bucketName}/${objectKey}`,
        },
        // Use service role for S3 access
        DataAccessRoleArn: process.env.TRANSCRIBE_SERVICE_ROLE_ARN,
        Settings: {
          MaxSpeakerLabels: 2, // Enable speaker identification for up to 2 speakers
          ShowSpeakerLabels: true,
          ChannelIdentification: false,
        },
      };

      console.log('Starting transcription job with params:', JSON.stringify(transcribeParams, null, 2));
      
      // Create transcription ID first
      const transcriptionId = objectKey.split('.')[0]; // Use file name without extension as ID
      
      try {
        console.log('About to call AWS Transcribe with job name:', jobName);
        console.log('Media URI:', `s3://${bucketName}/${objectKey}`);
        console.log('Output bucket:', process.env.TRANSCRIPTS_BUCKET_NAME);
        
        const transcriptionResult = await transcribeClient.send(
          new StartTranscriptionJobCommand(transcribeParams)
        );

        console.log('✅ Transcription job started successfully!');
        console.log('Job details:', JSON.stringify(transcriptionResult, null, 2));

        // Create initial record in DynamoDB with IN_PROGRESS status
        const dynamoParams = {
          TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
          Item: {
            id: { S: transcriptionId },
            jobName: { S: jobName },
            originalFileName: { S: originalFileName },
            status: { S: 'IN_PROGRESS' },
            timestamp: { N: Math.floor(new Date().getTime() / 1000).toString() },
            uploadTimestamp: { S: uploadTimestamp },
            audioFileKey: { S: objectKey },
            source: { S: objectKey.includes('recording') ? 'microphone' : 'file' },
            createdAt: { S: new Date().toISOString() },
            updatedAt: { S: new Date().toISOString() },
          },
        };

        await dynamoClient.send(new PutItemCommand(dynamoParams));
        
        console.log(`Created DynamoDB record for transcription: ${transcriptionId}`);
        
      } catch (transcribeError) {
        console.error('Failed to start transcription job:', transcribeError);
        
        // Create DynamoDB record with FAILED status
        const dynamoParams = {
          TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
          Item: {
            id: { S: transcriptionId },
            jobName: { S: jobName },
            originalFileName: { S: originalFileName },
            status: { S: 'FAILED' },
            error: { S: `Failed to start transcription: ${transcribeError.message || 'Unknown error'}` },
            timestamp: { N: Math.floor(new Date().getTime() / 1000).toString() },
            uploadTimestamp: { S: uploadTimestamp },
            audioFileKey: { S: objectKey },
            source: { S: objectKey.includes('recording') ? 'microphone' : 'file' },
            createdAt: { S: new Date().toISOString() },
            updatedAt: { S: new Date().toISOString() },
          },
        };

        try {
          await dynamoClient.send(new PutItemCommand(dynamoParams));
          console.log(`Created DynamoDB record with FAILED status for transcription: ${transcriptionId}`);
        } catch (dynamoError) {
          console.error('Failed to create DynamoDB record:', dynamoError);
        }
        
        // Re-throw the error to ensure the Lambda function is marked as failed
        throw transcribeError;
      }

    } catch (error) {
      console.error('Error processing S3 event record:', error);
      // Continue processing other records even if one fails
    }
  }
};
