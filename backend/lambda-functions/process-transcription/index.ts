import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

interface TranscriptResult {
  jobName: string;
  accountId: string;
  results: {
    transcripts: Array<{
      transcript: string;
    }>;
    items: Array<{
      start_time?: string;
      end_time?: string;
      alternatives: Array<{
        confidence: string;
        content: string;
      }>;
      type: string;
    }>;
    speaker_labels?: {
      speakers: number;
      segments: Array<{
        start_time: string;
        end_time: string;
        speaker_label: string;
        items: Array<{
          start_time: string;
          end_time: string;
          speaker_label: string;
        }>;
      }>;
    };
  };
  status: string;
}

export const handler = async (event: S3Event) => {
  console.log('🎯 Processing transcription results:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const bucketName = record.s3.bucket.name;
      const objectKey = record.s3.object.key;

      console.log(`📄 Processing transcript: ${objectKey} from bucket: ${bucketName}`);

      // Only process JSON files that look like transcription results
      if (!objectKey.endsWith('.json') || (!objectKey.includes('transcription-job-') && !objectKey.includes('manual-transcription-'))) {
        console.log(`⏩ Skipping non-transcription file: ${objectKey}`);
        continue;
      }

      // Get the transcription result from S3
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      });

      let s3Response;
      let retryCount = 0;
      const maxRetries = 3;

      // Retry logic for S3 access (sometimes files take a moment to be available)
      while (retryCount < maxRetries) {
        try {
          s3Response = await s3Client.send(getObjectCommand);
          break;
        } catch (s3Error) {
          retryCount++;
          console.warn(`⚠️  S3 access attempt ${retryCount} failed:`, s3Error);
          
          if (retryCount >= maxRetries) {
            throw new Error(`Failed to access S3 object after ${maxRetries} attempts: ${s3Error}`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }

      const transcriptContent = await s3Response.Body?.transformToString();

      if (!transcriptContent) {
        console.error('❌ No content found in transcript file');
        continue;
      }

      const transcriptResult: TranscriptResult = JSON.parse(transcriptContent);
      console.log(`✅ Parsed transcript result for job: ${transcriptResult.jobName}`);
      console.log(`📊 Status: ${transcriptResult.status}`);

      // Extract the main transcript text
      const transcriptText = transcriptResult.results.transcripts[0]?.transcript || '';
      console.log(`📝 Transcript text: "${transcriptText}"`);
      
      // Calculate confidence score
      const items = transcriptResult.results.items || [];
      const confidenceScores = items
        .filter(item => item.alternatives && item.alternatives.length > 0)
        .map(item => parseFloat(item.alternatives[0].confidence));
      
      const averageConfidence = confidenceScores.length > 0
        ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length
        : 0;

      // Extract duration if available
      const lastItem = items[items.length - 1];
      const duration = lastItem?.end_time ? parseFloat(lastItem.end_time) : 0;

      console.log(`📈 Confidence: ${averageConfidence.toFixed(3)}, Duration: ${duration}s`);

      // Find the corresponding DynamoDB record by job name
      const scanParams = {
        TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
        FilterExpression: 'jobName = :jobName',
        ExpressionAttributeValues: {
          ':jobName': { S: transcriptResult.jobName },
        },
      };

      console.log(`🔍 Searching for DynamoDB record with job name: ${transcriptResult.jobName}`);
      const scanResult = await dynamoClient.send(new ScanCommand(scanParams));
      
      if (!scanResult.Items || scanResult.Items.length === 0) {
        console.warn(`⚠️  No DynamoDB record found for job: ${transcriptResult.jobName}`);
        
        // Try to find by transcription ID extracted from job name
        const jobName = transcriptResult.jobName;
        let transcriptionId = '';

        // Extract ID from job name patterns:
        // transcription-job-{ID}-{timestamp}-webm-{timestamp2}
        // manual-transcription-{ID}-{timestamp}
        const webmIdMatch = jobName.match(/transcription-job-([a-f0-9-]+)-(\d+)-webm-\d+/);
        const manualIdMatch = jobName.match(/manual-transcription-([a-f0-9-]+)-(\d+)/);

        if (webmIdMatch) {
          transcriptionId = webmIdMatch[1] + '-' + webmIdMatch[2];
        } else if (manualIdMatch) {
          transcriptionId = manualIdMatch[1] + '-' + manualIdMatch[2];
        }

        if (transcriptionId) {
          console.log(`🔍 Trying to find record by extracted ID: ${transcriptionId}`);

          const scanByIdParams = {
            TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
            FilterExpression: 'id = :id',
            ExpressionAttributeValues: {
              ':id': { S: transcriptionId },
            },
          };

          const scanByIdResult = await dynamoClient.send(new ScanCommand(scanByIdParams));

          if (scanByIdResult.Items && scanByIdResult.Items.length > 0) {
            console.log(`✅ Found record by ID: ${transcriptionId}`);
            const transcriptionRecord = scanByIdResult.Items[0];
            const actualId = transcriptionRecord.id.S!;

            await updateTranscriptionRecord(actualId, transcriptResult.status, transcriptText, averageConfidence, duration, transcriptResult.jobName);
          } else {
            console.error(`❌ No record found for transcription ID: ${transcriptionId}`);
          }
        } else {
          console.error(`❌ Could not extract transcription ID from job name: ${jobName}`);
        }
        
        continue;
      }

      const transcriptionRecord = scanResult.Items[0];
      const transcriptionId = transcriptionRecord.id.S!;

      console.log(`✅ Found DynamoDB record for transcription: ${transcriptionId}`);

      await updateTranscriptionRecord(transcriptionId, transcriptResult.status, transcriptText, averageConfidence, duration, transcriptResult.jobName);

    } catch (error) {
      console.error('💥 Error processing transcription result:', error);
      // Continue processing other records even if one fails
    }
  }
  
  console.log('🎉 Finished processing all transcription results');
};

async function updateTranscriptionRecord(
  transcriptionId: string, 
  status: string, 
  transcriptText: string, 
  averageConfidence: number, 
  duration: number,
  jobName: string
) {
  try {
    console.log(`📝 Updating DynamoDB record: ${transcriptionId}`);
    
    // Update the DynamoDB record with the transcription result
    const updateParams = {
      TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
      Key: {
        id: { S: transcriptionId },
      },
      UpdateExpression: 'SET #status = :status, #text = :text, #confidence = :confidence, #duration = :duration, #updatedAt = :updatedAt, #completedAt = :completedAt, jobName = :jobName',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#text': 'text',
        '#confidence': 'confidence',
        '#duration': 'duration',
        '#updatedAt': 'updatedAt',
        '#completedAt': 'completedAt',
      },
      ExpressionAttributeValues: {
        ':status': { S: status === 'COMPLETED' ? 'COMPLETED' : 'FAILED' },
        ':text': { S: transcriptText },
        ':confidence': { N: averageConfidence.toString() },
        ':duration': { N: duration.toString() },
        ':updatedAt': { S: new Date().toISOString() },
        ':completedAt': { S: new Date().toISOString() },
        ':jobName': { S: jobName },
      },
    };

    await dynamoClient.send(new UpdateItemCommand(updateParams));
    
    console.log(`✅ Successfully updated DynamoDB record for transcription: ${transcriptionId}`);
    console.log(`📄 Final status: ${status === 'COMPLETED' ? 'COMPLETED' : 'FAILED'}`);
    console.log(`📝 Transcript: "${transcriptText.substring(0, 50)}${transcriptText.length > 50 ? '...' : ''}"`);
    
  } catch (updateError) {
    console.error(`❌ Failed to update DynamoDB record ${transcriptionId}:`, updateError);
    throw updateError;
  }
}
