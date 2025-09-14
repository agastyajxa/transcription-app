import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('🗑️ Delete transcription request:', JSON.stringify(event, null, 2));

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
          error: 'Missing transcription ID',
        }),
      };
    }

    console.log(`🗑️ Deleting transcription: ${transcriptionId}`);

    // Delete from DynamoDB
    const deleteParams = {
      TableName: process.env.TRANSCRIPTIONS_TABLE_NAME!,
      Key: {
        id: { S: transcriptionId },
      },
    };

    await dynamoClient.send(new DeleteItemCommand(deleteParams));

    console.log(`✅ Successfully deleted transcription: ${transcriptionId}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Transcription deleted successfully',
        transcriptionId,
      }),
    };
  } catch (error) {
    console.error('💥 Error deleting transcription:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Failed to delete transcription',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};