import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Manual transcription request:', JSON.stringify(event, null, 2));

  try {
    const body = JSON.parse(event.body || '{}');
    const { transcriptionId, fileKey, originalFileName, bucketName, source } = body;

    if (!transcriptionId || !fileKey || !originalFileName || !bucketName) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Missing required parameters: transcriptionId, fileKey, originalFileName, bucketName',
        }),
      };
    }

    // Create unique job name
    const jobName = `manual-transcription-${transcriptionId}-${Date.now()}`;
    
    // Determine file format
    const fileExtension = fileKey.split('.').pop()?.toLowerCase();
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
        // AWS Transcribe doesn't support WebM natively
        // We'll need to convert or use a different approach
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            error: 'WebM format not supported by AWS Transcribe',
            details: 'Please convert to MP3, WAV, or M4A format',
            supportedFormats: ['mp3', 'wav', 'm4a'],
          }),
        };
      default:
        mediaFormat = 'mp3';
    }

    // Start transcription job - let AWS manage output location
    const transcribeParams = {
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: mediaFormat,
      Media: {
        MediaFileUri: `s3://${bucketName}/${fileKey}`,
      },
    };

    console.log('Starting transcription job with params:', JSON.stringify(transcribeParams, null, 2));
    
    const transcriptionResult = await transcribeClient.send(
      new StartTranscriptionJobCommand(transcribeParams)
    );

    console.log('Transcription job started:', transcriptionResult);

    // Create record in DynamoDB
    const dynamoParams = {
      TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
      Item: {
        id: { S: transcriptionId },
        jobName: { S: jobName },
        originalFileName: { S: originalFileName },
        status: { S: 'IN_PROGRESS' },
        timestamp: { N: Math.floor(new Date().getTime() / 1000).toString() },
        uploadTimestamp: { S: new Date().toISOString() },
        audioFileKey: { S: fileKey },
        source: { S: source || 'microphone' },
        createdAt: { S: new Date().toISOString() },
        updatedAt: { S: new Date().toISOString() },
      },
    };

    await dynamoClient.send(new PutItemCommand(dynamoParams));
    
    console.log(`Created DynamoDB record for transcription: ${transcriptionId}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        transcriptionId,
        jobName,
        status: 'IN_PROGRESS',
        message: 'Transcription job started successfully',
      }),
    };
  } catch (error) {
    console.error('Error starting manual transcription:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Failed to start transcription job',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
