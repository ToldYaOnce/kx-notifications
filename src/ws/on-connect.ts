import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConnectionRecord } from '../types/connection';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

/**
 * WebSocket $connect handler
 * 
 * Extracts tenantId, userId, and optional token from query parameters
 * and stores the connection in DynamoDB for real-time notifications.
 * 
 * Query parameters:
 * - tenantId (required): Tenant identifier for multi-tenancy
 * - userId (required): User identifier within the tenant
 * - token (optional): JWT token for authentication (TODO: implement validation)
 * 
 * Connection URL example:
 * wss://api-id.execute-api.region.amazonaws.com/prod?tenantId=acme&userId=agent-1&token=jwt-here
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const domainName = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'WebSocket connection attempt',
    connectionId,
    domainName,
    stage,
    queryParams: event.queryStringParameters,
  }));
  
  try {
    // Extract required parameters
    const tenantId = event.queryStringParameters?.tenantId;
    const userId = event.queryStringParameters?.userId;
    const token = event.queryStringParameters?.token; // Optional JWT token
    
    // Extract optional filtering parameters
    const userRole = event.queryStringParameters?.userRole; // 'admin', 'user', 'viewer'
    const subscriptions = event.queryStringParameters?.subscriptions?.split(','); // 'payments,scans,notifications'
    const priority = event.queryStringParameters?.priority; // 'high', 'normal', 'low'
    const deviceType = event.queryStringParameters?.deviceType; // 'mobile', 'web', 'desktop'
    
    if (!tenantId || !userId) {
      console.log(JSON.stringify({
        level: 'ERROR',
        message: 'Missing required query parameters',
        connectionId,
        tenantId,
        userId,
      }));
      
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required query parameters: tenantId and userId are required',
        }),
      };
    }
    
    // TODO: JWT token validation
    // When implementing JWT validation:
    // 1. Verify token signature using public key
    // 2. Check token expiration
    // 3. Validate tenantId and userId claims match query params
    // 4. Check user permissions for real-time notifications
    if (token) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'JWT token provided but validation not implemented',
        connectionId,
        tenantId,
        userId,
        tokenLength: token.length,
      }));
    }
    
    // Store connection in DynamoDB
    const ttl = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours TTL
    const connectionRecord: ConnectionRecord = {
      tenantId,
      connectionId,
      userId,
      domainName,
      stage,
      ttl,
      connectedAt: new Date().toISOString(),
      // Optional filtering metadata
      ...(userRole && { userRole }),
      ...(subscriptions && { subscriptions }),
      ...(priority && { priority }),
      ...(deviceType && { deviceType }),
    };
    
    await docClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: connectionRecord,
    }));
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'WebSocket connection established',
      connectionId,
      tenantId,
      userId,
      ttl,
    }));
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Connected successfully',
        connectionId,
        tenantId,
        userId,
      }),
    };
    
  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to establish WebSocket connection',
      connectionId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error during connection',
      }),
    };
  }
};

