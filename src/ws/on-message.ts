import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  handleChatJoin, 
  handleChatMessage, 
  handleChatLeave,
  ChatJoinMessage,
  ChatMessage,
  ChatLeaveMessage 
} from '../chat/chat-handlers';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { getDocClient } from '../utils/aws-clients';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

let apiGwClient: ApiGatewayManagementApiClient;

function getApiGwClient(domainName: string, stage: string): ApiGatewayManagementApiClient {
  if (!apiGwClient) {
    apiGwClient = new ApiGatewayManagementApiClient({
      endpoint: `https://${domainName}/${stage}`,
    });
  }
  return apiGwClient;
}

/**
 * WebSocket $default (message) handler
 * 
 * Handles incoming messages from WebSocket clients.
 * Currently a no-op that just logs messages for debugging.
 * 
 * Future enhancements could include:
 * - Message acknowledgments
 * - Client-to-server commands
 * - Heartbeat/ping-pong
 * - Real-time chat or collaboration features
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const domainName = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;
  const routeKey = event.requestContext.routeKey!;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'WebSocket message received',
    connectionId,
    domainName,
    stage,
    routeKey,
    body: event.body,
    bodyLength: event.body?.length || 0,
  }));
  
  try {
    // Parse message if it's JSON
    let messageData;
    if (event.body) {
      try {
        messageData = JSON.parse(event.body);
      } catch (parseError) {
        messageData = { raw: event.body };
      }
    }
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'WebSocket message parsed',
      connectionId,
      messageType: messageData?.type || 'unknown',
      messageData,
    }));
    
    // TODO: Implement message handling logic
    // Examples of what you might handle here:
    // 
    // 1. Acknowledgment messages:
    //    { type: 'ack', notificationId: 'uuid' }
    //    → Update notification status in database
    // 
    // 2. Heartbeat/ping:
    //    { type: 'ping' }
    //    → Respond with { type: 'pong' }
    // 
    // 3. Client commands:
    //    { type: 'subscribe', topics: ['scans', 'payments'] }
    //    → Update subscription preferences
    // 
    // 4. Status updates:
    //    { type: 'status', status: 'online' | 'away' | 'busy' }
    //    → Update user presence
    
    switch (messageData?.type) {
      case 'ping':
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Ping received - responding with pong',
          connectionId,
        }));
        // In a real implementation, you'd send a pong response here
        // using ApiGatewayManagementApiClient.postToConnection()
        break;
        
      case 'ack':
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Acknowledgment received',
          connectionId,
          notificationId: messageData.notificationId,
        }));
        // TODO: Update notification acknowledgment status in database
        break;
        
      case 'subscribe':
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Subscription request received',
          connectionId,
          topics: messageData.topics,
        }));
        // TODO: Update subscription preferences for this connection
        break;

      // NEW: Chat functionality
      case 'chat.join':
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Chat join request received',
          connectionId,
          channelId: messageData.channelId,
          userId: messageData.userId,
        }));
        await handleChatJoin(connectionId, messageData as ChatJoinMessage, event.requestContext);
        break;

      case 'chat.startDM':
        // Helper: Start direct message with another user
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Direct message start request received',
          connectionId,
          userId: messageData.userId,
          targetUserId: messageData.targetUserId,
        }));
        
        if (messageData.userId && messageData.targetUserId) {
          // Create deterministic DM room ID from user IDs
          const [user1, user2] = [messageData.userId, messageData.targetUserId].sort();
          const dmRoomId = `dm-${user1}-${user2}`;
          const joinMessage: ChatJoinMessage = {
            type: 'chat.join',
            channelId: dmRoomId,
            userId: messageData.userId,
            userName: messageData.userName
          };
          await handleChatJoin(connectionId, joinMessage, event.requestContext);
        }
        break;

      case 'chat.message':
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Chat message received',
          connectionId,
          channelId: messageData.channelId,
          userId: messageData.userId,
          messageLength: messageData.message?.length || 0,
        }));
        await handleChatMessage(connectionId, messageData as ChatMessage, event.requestContext);
        break;

      case 'chat.leave':
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Chat leave request received',
          connectionId,
          channelId: messageData.channelId,
          userId: messageData.userId,
        }));
        await handleChatLeave(connectionId, messageData as ChatLeaveMessage, event.requestContext);
        break;

      // Note: Room and message management (create, list, history, etc.) 
      // should be handled by the other stack via EventBridge events
      // This stack only handles real-time messaging via WebSocket
        
      default:
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Unknown message type - ignoring',
          connectionId,
          messageType: messageData?.type,
        }));
        break;
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Message received',
        connectionId,
        timestamp: new Date().toISOString(),
      }),
    };
    
  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Error processing WebSocket message',
      connectionId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error processing message',
        connectionId,
      }),
    };
  }
};

// Helper function to get tenant ID from connection
async function getTenantIdFromConnection(connectionId: string): Promise<string | null> {
  try {
    const docClient = await getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'ConnectionIdIndex',
      KeyConditionExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId,
      },
    }));
    
    return result.Items?.[0]?.tenantId || null;
  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to get tenant ID from connection',
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

// Helper function to send response to connection
async function sendToConnection(
  connectionId: string,
  data: any,
  requestContext: any
): Promise<void> {
  try {
    const { domainName, stage } = requestContext;
    if (domainName && stage) {
      const apiGw = getApiGwClient(domainName, stage);
      await apiGw.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(data),
      }));
    }
  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to send message to connection',
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

// Note: Room and message management functions removed
// All persistent storage operations (create/list/delete rooms, message history, etc.)
// are handled by the other stack via EventBridge events
// This stack only handles real-time WebSocket messaging
