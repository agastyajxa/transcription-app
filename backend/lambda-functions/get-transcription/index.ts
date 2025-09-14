import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { TranscribeClient, GetTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const transcriptionId = event.pathParameters?.id;

    if (!transcriptionId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Transcription ID is required',
        }),
      };
    }

    console.log(`🔍 Checking transcription status for: ${transcriptionId}`);

    const getItemParams = {
      TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
      Key: {
        id: { S: transcriptionId },
      },
    };

    const result = await dynamoClient.send(new GetItemCommand(getItemParams));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Transcription not found',
        }),
      };
    }

    const transcription = unmarshall(result.Item);
    console.log(`Current status: ${transcription.status}`);

    // If status is already COMPLETED or FAILED, return as-is
    if (transcription.status === 'COMPLETED' || transcription.status === 'FAILED') {
      console.log('✅ Transcription already has final status, returning as-is');
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcription: {
            id: transcription.id,
            text: transcription.text,
            source: transcription.source || 'file',
            fileName: transcription.originalFileName,
            originalFileName: transcription.originalFileName,
            status: transcription.status,
            timestamp: transcription.timestamp || Math.floor(Date.now() / 1000),
            confidence: transcription.confidence ? parseFloat(transcription.confidence) : undefined,
            duration: transcription.duration ? parseFloat(transcription.duration) : undefined,
            createdAt: transcription.createdAt,
            updatedAt: transcription.updatedAt,
            completedAt: transcription.completedAt,
          },
        }),
      };
    }

    // If status is IN_PROGRESS, check AWS Transcribe directly
    if (transcription.status === 'IN_PROGRESS' && transcription.jobName) {
      console.log(`🔄 Status is IN_PROGRESS, checking AWS Transcribe job: ${transcription.jobName}`);
      
      try {
        const jobResult = await transcribeClient.send(new GetTranscriptionJobCommand({
          TranscriptionJobName: transcription.jobName
        }));
        
        const job = jobResult.TranscriptionJob;
        console.log(`AWS Transcribe job status: ${job?.TranscriptionJobStatus}`);
        
        if (job?.TranscriptionJobStatus === 'COMPLETED') {
          console.log('✅ AWS Transcribe job is completed! Checking for results...');
          
          // The job is completed, let's try to find and process the result
          if (job.Transcript?.TranscriptFileUri) {
            console.log(`📄 Transcript file URI: ${job.Transcript.TranscriptFileUri}`);
            
            // Extract S3 bucket and key from the URI
            const s3UriMatch = job.Transcript.TranscriptFileUri.match(/s3:\/\/([^\/]+)\/(.+)/);
            if (s3UriMatch) {
              const [, bucket, key] = s3UriMatch;
              console.log(`📥 Fetching transcript from S3: ${bucket}/${key}`);
              
              try {
                const s3Response = await s3Client.send(new GetObjectCommand({
                  Bucket: bucket,
                  Key: key
                }));
                
                const transcriptContent = await s3Response.Body?.transformToString();
                if (transcriptContent) {
                  const transcriptResult = JSON.parse(transcriptContent);
                  const transcriptText = transcriptResult.results.transcripts[0]?.transcript || '';
                  
                  // Calculate confidence and duration
                  const items = transcriptResult.results.items || [];
                  const confidenceScores = items
                    .filter((item: any) => item.alternatives && item.alternatives.length > 0)
                    .map((item: any) => parseFloat(item.alternatives[0].confidence));
                  
                  const averageConfidence = confidenceScores.length > 0
                    ? confidenceScores.reduce((sum: number, score: number) => sum + score, 0) / confidenceScores.length
                    : 0;
                  
                  const lastItem = items[items.length - 1];
                  const duration = lastItem?.end_time ? parseFloat(lastItem.end_time) : 0;
                  
                  console.log(`📝 Extracted transcript: "${transcriptText}"`);
                  
                  // Update the DynamoDB record
                  const updateParams = {
                    TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
                    Key: {
                      id: { S: transcriptionId },
                    },
                    UpdateExpression: 'SET #status = :status, #text = :text, #confidence = :confidence, #duration = :duration, #updatedAt = :updatedAt, #completedAt = :completedAt',
                    ExpressionAttributeNames: {
                      '#status': 'status',
                      '#text': 'text',
                      '#confidence': 'confidence',
                      '#duration': 'duration',
                      '#updatedAt': 'updatedAt',
                      '#completedAt': 'completedAt',
                    },
                    ExpressionAttributeValues: {
                      ':status': { S: 'COMPLETED' },
                      ':text': { S: transcriptText },
                      ':confidence': { N: averageConfidence.toString() },
                      ':duration': { N: duration.toString() },
                      ':updatedAt': { S: new Date().toISOString() },
                      ':completedAt': { S: new Date().toISOString() },
                    },
                  };
                  
                  await dynamoClient.send(new UpdateItemCommand(updateParams));
                  console.log('✅ Updated DynamoDB record with completed transcription');
                  
                  return {
                    statusCode: 200,
                    headers: {
                      'Access-Control-Allow-Origin': '*',
                      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      transcription: {
                        id: transcriptionId,
                        text: transcriptText,
                        source: transcription.source || 'microphone',
                        fileName: transcription.originalFileName,
                        originalFileName: transcription.originalFileName,
                        status: 'COMPLETED',
                        timestamp: transcription.timestamp || Math.floor(Date.now() / 1000),
                        confidence: averageConfidence,
                        duration: duration,
                        createdAt: transcription.createdAt,
                        updatedAt: new Date().toISOString(),
                        completedAt: new Date().toISOString(),
                      },
                    }),
                  };
                }
              } catch (s3Error) {
                console.error('❌ Error fetching transcript from S3:', s3Error);
              }
            }
          }
        } else if (job?.TranscriptionJobStatus === 'FAILED') {
          console.error('❌ AWS Transcribe job failed');
          
          // Update record to FAILED status
          const updateParams = {
            TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
            Key: {
              id: { S: transcriptionId },
            },
            UpdateExpression: 'SET #status = :status, #error = :error, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#error': 'error',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':status': { S: 'FAILED' },
              ':error': { S: job.FailureReason || 'AWS Transcribe job failed' },
              ':updatedAt': { S: new Date().toISOString() },
            },
          };
          
          await dynamoClient.send(new UpdateItemCommand(updateParams));
          
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type,Authorization',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcription: {
                ...transcription,
                status: 'FAILED',
                error: job.FailureReason || 'AWS Transcribe job failed',
                updatedAt: new Date().toISOString(),
              },
            }),
          };
        }
      } catch (transcribeError) {
        console.error('❌ Error checking AWS Transcribe job:', transcribeError);
        // Continue with returning the current status
      }
    }

    // Return current status
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcription: {
          id: transcription.id,
          text: transcription.text,
          source: transcription.source || 'file',
          fileName: transcription.originalFileName,
          originalFileName: transcription.originalFileName,
          status: transcription.status,
          timestamp: transcription.timestamp || Math.floor(Date.now() / 1000),
          confidence: transcription.confidence ? parseFloat(transcription.confidence) : undefined,
          duration: transcription.duration ? parseFloat(transcription.duration) : undefined,
          createdAt: transcription.createdAt,
          updatedAt: transcription.updatedAt,
          completedAt: transcription.completedAt,
        },
      }),
    };
  } catch (error) {
    console.error('Error fetching/fixing transcription:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Internal server error',
      }),
    };
  }
};
