import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DynamoDBClient, ScanCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { TranscribeClient, GetTranscriptionJobCommand, ListTranscriptionJobsCommand } from '@aws-sdk/client-transcribe';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });

const TRANSCRIPTS_BUCKET = 'transcription-results-110068290700-ap-south-1';
const TRANSCRIPTIONS_TABLE = 'transcriptions';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('🔧 Auto-fix service triggered');

  try {
    const results = await autoFixAllTranscriptions();
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Auto-fix completed',
        ...results,
      }),
    };
  } catch (error) {
    console.error('💥 Auto-fix service error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: false,
        error: 'Auto-fix service failed',
        details: error.message,
      }),
    };
  }
};

async function autoFixAllTranscriptions() {
  console.log('🔄 Starting auto-fix process...');
  
  let processedCount = 0;
  let fixedCount = 0;
  let createdCount = 0;
  
  try {
    // 1. Get all completed transcription jobs from AWS Transcribe
    const listJobsResponse = await transcribeClient.send(new ListTranscriptionJobsCommand({
      Status: 'COMPLETED',
      MaxResults: 100, // Get recent completed jobs
    }));

    const completedJobs = listJobsResponse.TranscriptionJobSummaries || [];

    if (completedJobs.length === 0) {
      console.log('No completed transcription jobs found');
      return { processedCount: 0, fixedCount: 0, createdCount: 0 };
    }

    console.log(`Found ${completedJobs.length} completed transcription jobs`);
    
    // 2. Get all DynamoDB records that are IN_PROGRESS
    const scanParams = {
      TableName: TRANSCRIPTIONS_TABLE,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': { S: 'IN_PROGRESS' },
      },
    };
    
    const scanResult = await dynamoClient.send(new ScanCommand(scanParams));
    const inProgressRecords = scanResult.Items || [];
    
    console.log(`Found ${inProgressRecords.length} IN_PROGRESS records in DynamoDB`);
    
    // 3. Process each completed transcription job
    for (const jobSummary of completedJobs) {
      try {
        processedCount++;
        const jobName = jobSummary.TranscriptionJobName!;

        // Get full job details including transcript URI
        const jobResponse = await transcribeClient.send(new GetTranscriptionJobCommand({
          TranscriptionJobName: jobName,
        }));

        const transcriptUri = jobResponse.TranscriptionJob?.Transcript?.TranscriptFileUri;
        if (!transcriptUri) {
          console.log(`No transcript URI for job: ${jobName}`);
          continue;
        }

        // Fetch the transcript from the AWS-managed S3 bucket
        const transcriptContent = await fetch(transcriptUri).then(res => res.text());
        const transcriptResult = JSON.parse(transcriptContent);
        const transcriptText = transcriptResult.results.transcripts[0]?.transcript || '';
          
          // Calculate confidence and duration
          const items = transcriptResult.results.items || [];
          const confidenceScores = items
            .filter(item => item.alternatives && item.alternatives.length > 0)
            .map(item => parseFloat(item.alternatives[0].confidence));
          
          const averageConfidence = confidenceScores.length > 0
            ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length
            : 0;
          
          const lastItem = items[items.length - 1];
          const duration = lastItem?.end_time ? parseFloat(lastItem.end_time) : 0;
          
          // Extract transcription ID from job name
          let transcriptionId = '';

          // Try different patterns for job names
          const webmIdMatch = jobName.match(/transcription-job-([a-f0-9-]+)-(\\d+)-webm-\\d+/);
          const manualIdMatch = jobName.match(/manual-transcription-([a-f0-9-]+)-(\\d+)/);

          if (webmIdMatch) {
            transcriptionId = webmIdMatch[1] + '-' + webmIdMatch[2];
          } else if (manualIdMatch) {
            transcriptionId = manualIdMatch[1] + '-' + manualIdMatch[2];
          } else {
            // Fallback extraction
            transcriptionId = jobName
              .replace(/^transcription-job-/, '')
              .replace(/^manual-transcription-/, '')
              .replace(/-webm-\\d+$/, '');
          }
          
          // Check if record exists and needs updating
          const existingRecord = inProgressRecords.find(record => 
            record.id.S === transcriptionId || 
            (record.jobName && record.jobName.S === jobName)
          );
          
          if (existingRecord) {
            // Update existing IN_PROGRESS record
            const updateParams = {
              TableName: TRANSCRIPTIONS_TABLE,
              Key: {
                id: { S: existingRecord.id.S! },
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
                ':status': { S: 'COMPLETED' },
                ':text': { S: transcriptText },
                ':confidence': { N: averageConfidence.toString() },
                ':duration': { N: duration.toString() },
                ':updatedAt': { S: new Date().toISOString() },
                ':completedAt': { S: new Date().toISOString() },
                ':jobName': { S: jobName },
              },
            };
            
            await dynamoClient.send(new UpdateItemCommand(updateParams));
            fixedCount++;
            console.log(`✅ Fixed record: ${existingRecord.id.S} - "${transcriptText}"`);
            
          } else if (transcriptionId) {
            // Create new record if it doesn't exist
            const putParams = {
              TableName: TRANSCRIPTIONS_TABLE,
              Item: {
                id: { S: transcriptionId },
                jobName: { S: jobName },
                originalFileName: { S: 'voice-recording-' + transcriptionId.split('-').pop() + '.webm' },
                status: { S: 'COMPLETED' },
                text: { S: transcriptText },
                confidence: { N: averageConfidence.toString() },
                duration: { N: duration.toString() },
                timestamp: { N: Math.floor(new Date().getTime() / 1000).toString() },
                uploadTimestamp: { S: new Date().toISOString() },
                audioFileKey: { S: transcriptionId + '.webm' },
                source: { S: 'microphone' },
                createdAt: { S: new Date().toISOString() },
                updatedAt: { S: new Date().toISOString() },
                completedAt: { S: new Date().toISOString() },
              },
            };
            
            await dynamoClient.send(new PutItemCommand(putParams));
            createdCount++;
            console.log(`➕ Created record: ${transcriptionId} - "${transcriptText}"`);
          }
          
        } catch (itemError) {
          console.error(`❌ Error processing job ${jobSummary.TranscriptionJobName}:`, itemError);
        }
    }
    
    console.log(`🎉 Auto-fix complete! Processed: ${processedCount}, Fixed: ${fixedCount}, Created: ${createdCount}`);
    
    return { processedCount, fixedCount, createdCount };
    
  } catch (error) {
    console.error('💥 Auto-fix process error:', error);
    throw error;
  }
}
