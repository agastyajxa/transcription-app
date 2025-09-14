import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

interface TranscriptionItem {
  id: string;
  text?: string;
  source: 'microphone' | 'file';
  fileName?: string;
  originalFileName?: string;
  status: string;
  timestamp: number;
  confidence?: number;
  duration?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit || '20');
    const status = queryParams.status; // 'COMPLETED', 'IN_PROGRESS', 'FAILED'

    let scanParams: any = {
      TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
      Limit: limit,
    };

    // Add status filter if provided
    if (status) {
      scanParams.FilterExpression = '#status = :status';
      scanParams.ExpressionAttributeNames = {
        '#status': 'status',
      };
      scanParams.ExpressionAttributeValues = marshall({
        ':status': status,
      });
    }

    // Use GSI to get items by status and timestamp for better performance
    if (status) {
      const queryParams = {
        TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
        IndexName: 'timestamp-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': status,
        }),
        ScanIndexForward: false, // Sort by timestamp descending (newest first)
        Limit: limit,
      };

      const queryResult = await dynamoClient.send(new QueryCommand(queryParams));
      const items = queryResult.Items?.map(item => unmarshall(item)) || [];

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptions: items.map(formatTranscriptionItem),
          count: items.length,
          lastEvaluatedKey: queryResult.LastEvaluatedKey,
        }),
      };
    } else {
      // If no status filter, scan the table
      const scanResult = await dynamoClient.send(new ScanCommand(scanParams));
      const items = scanResult.Items?.map(item => unmarshall(item)) || [];

      // Sort by timestamp descending (newest first)
      items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptions: items.map(formatTranscriptionItem),
          count: items.length,
          lastEvaluatedKey: scanResult.LastEvaluatedKey,
        }),
      };
    }
  } catch (error) {
    console.error('Error fetching transcriptions:', error);

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

function formatTranscriptionItem(item: any): TranscriptionItem {
  return {
    id: item.id,
    text: item.text,
    source: item.source || 'file',
    fileName: item.originalFileName,
    originalFileName: item.originalFileName,
    status: item.status,
    timestamp: item.timestamp || Math.floor(Date.now() / 1000),
    confidence: item.confidence ? parseFloat(item.confidence) : undefined,
    duration: item.duration ? parseFloat(item.duration) : undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
  };
}
