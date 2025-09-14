import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

interface UploadRequest {
  fileName: string;
  fileType: string;
  fileSize?: number;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Request body is required',
        }),
      };
    }

    const { fileName, fileType, fileSize }: UploadRequest = JSON.parse(event.body);

    // Validate input
    if (!fileName || !fileType) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'fileName and fileType are required',
        }),
      };
    }

    // Check file type
    const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/mp4', 'audio/webm'];
    if (!allowedTypes.includes(fileType)) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Invalid file type. Supported types: MP3, WAV, M4A, MP4, WebM',
        }),
      };
    }

    // Check file size (200MB limit for stability)
    const maxFileSize = 200 * 1024 * 1024; // 200MB
    if (fileSize && fileSize > maxFileSize) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'File size too large. Maximum size is 200MB. For longer recordings, please split into 1-hour segments.',
        }),
      };
    }

    // Generate unique file key
    const fileExtension = fileName.split('.').pop() || 'audio';
    const uniqueFileName = `${randomUUID()}-${Date.now()}.${fileExtension}`;

    // Create pre-signed URL
    const command = new PutObjectCommand({
      Bucket: process.env.AUDIO_BUCKET_NAME!,
      Key: uniqueFileName,
      ContentType: fileType,
      Metadata: {
        originalFileName: fileName,
        uploadTimestamp: new Date().toISOString(),
      },
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300, // 5 minutes
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uploadUrl: signedUrl,
        fileKey: uniqueFileName,
        expiresIn: 300,
      }),
    };
  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    
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
