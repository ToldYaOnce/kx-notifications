import { APIGatewayEventRequestContext } from 'aws-lambda';
import { UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { getDocClient } from '../utils/aws-clients';
import { publishChatEvent, ChatMessageEventDetail, ChatRoomMembershipEventDetail } from '../utils/eventbridge-publisher';

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

export interface ChatJoinMessage {
  type: 'chat.join';
  channelId: string;
  userId: string;
  userName?: string;
}

export interface ChatMessage {
  type: 'chat.message';
  channelId: string;
  userId: string;
  userName?: string;
  message: string;
  timestamp?: string;
}

export interface ChatLeaveMessage {
  type: 'chat.leave';
  channelId: string;
  userId: string;
}

export interface ConnectionRecord {
  tenantId: string;
  connectionId: string;
  domainName: string;
  stage: string;
  userId?: string;
  userName?: string;
  chatChannels?: string[]; // Array of channel IDs this connection is in
  connectedAt: string;
  ttl: number;
}

/**
 * Handle user joining a chat room
 * Only tracks membership in connection record - no persistent storage
 */
export async function handleChatJoin(
  connectionId: string,
  message: ChatJoinMessage,
  requestContext: APIGatewayEventRequestContext
): Promise<void> {
  const { channelId, userId, userName } = message;
  const { domainName, stage } = requestContext;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'User joining chat room',
    connectionId,
    channelId,
    userId,
    userName,
  }));

  try {
    const docClient = await getDocClient();
    
    // Get the current connection record to extract tenantId
    const connectionResult = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'ConnectionIdIndex',
      KeyConditionExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId,
      },
    }));

    if (!connectionResult.Items || connectionResult.Items.length === 0) {
      console.log(JSON.stringify({
        level: 'WARN',
        message: 'Connection not found for chat join',
        connectionId,
      }));
      return;
    }

    const connection = connectionResult.Items[0] as ConnectionRecord;
    const tenantId = connection.tenantId;
    
    // Update the connection record with chat room membership
    const currentRooms = connection.chatChannels || [];
    if (!currentRooms.includes(channelId)) {
      currentRooms.push(channelId);
      
      await docClient.send(new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: {
          tenantId: connection.tenantId,
          connectionId: connectionId,
        },
        UpdateExpression: 'SET chatChannels = :rooms, userId = :userId, userName = :userName',
        ExpressionAttributeValues: {
          ':rooms': currentRooms,
          ':userId': userId,
          ':userName': userName || userId,
        },
      }));
    }

    // Publish chat.join event to EventBridge (for persistent storage in other stack)
    const joinTimestamp = new Date().toISOString();
    await publishChatEvent('chat.join', {
      tenantId,
      channelId,
      userId,
      userName: userName || userId,
      timestamp: joinTimestamp,
      connectionId,
    } as any);

    // Notify other users in the room that someone joined
    await broadcastToRoom(channelId, {
      type: 'chat.userJoined',
      channelId,
      userId,
      userName: userName || userId,
      timestamp: joinTimestamp,
    }, connectionId); // Exclude the joining user

    // Send confirmation to the joining user
    if (domainName && stage) {
      const apiGw = getApiGwClient(domainName, stage);
      await apiGw.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: 'chat.joined',
          channelId,
          message: `Successfully joined room: ${channelId}`,
          timestamp: joinTimestamp,
        }),
      }));
    }

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'User successfully joined chat room',
      connectionId,
      channelId,
      userId,
    }));

  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Error handling chat join',
      connectionId,
      channelId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

/**
 * Handle sending a chat message
 * Publishes to EventBridge and broadcasts to room - no persistent storage here
 */
export async function handleChatMessage(
  connectionId: string,
  message: ChatMessage,
  requestContext: APIGatewayEventRequestContext
): Promise<void> {
  const { channelId, userId, userName, message: chatMessage } = message;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Processing chat message',
    connectionId,
    channelId,
    userId,
    messageLength: chatMessage.length,
  }));

  try {
    const docClient = await getDocClient();
    
    // Verify the user is in the room (optional security check)
    const connectionResult = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'ConnectionIdIndex',
      KeyConditionExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId,
      },
    }));

    if (!connectionResult.Items || connectionResult.Items.length === 0) {
      console.log(JSON.stringify({
        level: 'WARN',
        message: 'Connection not found for chat message',
        connectionId,
      }));
      return;
    }

    const connection = connectionResult.Items[0] as ConnectionRecord;
    const userRooms = connection.chatChannels || [];
    const tenantId = connection.tenantId;
    
    if (!userRooms.includes(channelId)) {
      console.log(JSON.stringify({
        level: 'WARN',
        message: 'User not in room - cannot send message',
        connectionId,
        channelId,
        userId,
      }));
      return;
    }

    // Publish chat message event to EventBridge (for persistent storage in other stack)
    const timestamp = new Date().toISOString();
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    await publishChatEvent('chat.message', {
      tenantId,
      channelId,
      userId,
      userName: userName || userId,
      message: chatMessage,
      messageId,
      timestamp,
      connectionId,
      messageType: 'text',
    } as any);

    // Broadcast message to all users in the room (real-time)
    const messagePayload = {
      type: 'chat.message',
      channelId,
      userId,
      userName: userName || userId,
      message: chatMessage,
      timestamp,
      messageId,
    };

    await broadcastToRoom(channelId, messagePayload);

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Chat message broadcasted successfully',
      connectionId,
      channelId,
      userId,
      messageId,
    }));

  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Error handling chat message',
      connectionId,
      channelId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

/**
 * Handle user leaving a chat room
 * Only removes from connection record - no persistent storage
 */
export async function handleChatLeave(
  connectionId: string,
  message: ChatLeaveMessage,
  requestContext: APIGatewayEventRequestContext
): Promise<void> {
  const { channelId, userId } = message;
  const { domainName, stage } = requestContext;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'User leaving chat room',
    connectionId,
    channelId,
    userId,
  }));

  try {
    const docClient = await getDocClient();
    
    // Get the current connection record
    const connectionResult = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'ConnectionIdIndex',
      KeyConditionExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId,
      },
    }));

    if (!connectionResult.Items || connectionResult.Items.length === 0) {
      console.log(JSON.stringify({
        level: 'WARN',
        message: 'Connection not found for chat leave',
        connectionId,
      }));
      return;
    }

    const connection = connectionResult.Items[0] as ConnectionRecord;
    const tenantId = connection.tenantId;
    
    // Update the connection record
    const currentRooms = connection.chatChannels || [];
    const updatedRooms = currentRooms.filter(room => room !== channelId);
    
    await docClient.send(new UpdateCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        tenantId: connection.tenantId,
        connectionId: connectionId,
      },
      UpdateExpression: 'SET chatChannels = :rooms',
      ExpressionAttributeValues: {
        ':rooms': updatedRooms,
      },
    }));

    // Publish chat.leave event to EventBridge (for persistent tracking in other stack)
    const leaveTimestamp = new Date().toISOString();
    await publishChatEvent('chat.leave', {
      tenantId,
      channelId,
      userId,
      userName: connection.userName || userId,
      timestamp: leaveTimestamp,
      connectionId,
    } as any);

    // Notify other users in the room that someone left
    await broadcastToRoom(channelId, {
      type: 'chat.userLeft',
      channelId,
      userId,
      userName: connection.userName || userId,
      timestamp: leaveTimestamp,
    }, connectionId); // Exclude the leaving user

    // Send confirmation to the leaving user
    if (domainName && stage) {
      const apiGw = getApiGwClient(domainName, stage);
      await apiGw.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: 'chat.left',
          channelId,
          message: `Successfully left room: ${channelId}`,
          timestamp: leaveTimestamp,
        }),
      }));
    }

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'User successfully left chat room',
      connectionId,
      channelId,
      userId,
    }));

  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Error handling chat leave',
      connectionId,
      channelId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

/**
 * Broadcast a message to all users in a chat room
 */
async function broadcastToRoom(
  channelId: string,
  messagePayload: any,
  excludeConnectionId?: string
): Promise<void> {
  try {
    const docClient = await getDocClient();
    
    // Get all connections in this room
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    
    const scanResult = await docClient.send(new ScanCommand({
      TableName: CONNECTIONS_TABLE,
      FilterExpression: 'contains(chatChannels, :channelId)',
      ExpressionAttributeValues: {
        ':channelId': channelId,
      },
    }));

    if (!scanResult.Items || scanResult.Items.length === 0) {
      console.log(JSON.stringify({
        level: 'DEBUG',
        message: 'No connections found in room',
        channelId,
      }));
      return;
    }

    // Filter out the excluded connection
    const roomConnections = scanResult.Items.filter((connection: any) => 
      connection.connectionId !== excludeConnectionId
    );

    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Broadcasting to room connections',
      channelId,
      connectionCount: roomConnections.length,
      excludeConnectionId,
    }));

    // Send message to each connection in the room
    const sendPromises = roomConnections.map(async (connection: any) => {
      try {
        const apiGw = getApiGwClient(connection.domainName, connection.stage);
        await apiGw.send(new PostToConnectionCommand({
          ConnectionId: connection.connectionId,
          Data: JSON.stringify(messagePayload),
        }));
      } catch (error) {
        // Handle stale connections
        if (error instanceof Error && error.name === 'GoneException') {
          console.log(JSON.stringify({
            level: 'WARN',
            message: 'Stale connection detected - removing from database',
            connectionId: connection.connectionId,
            channelId,
          }));
          
          // Remove stale connection
          await docClient.send(new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: {
              tenantId: connection.tenantId,
              connectionId: connection.connectionId,
            },
          }));
        } else {
          console.log(JSON.stringify({
            level: 'ERROR',
            message: 'Error sending message to connection',
            connectionId: connection.connectionId,
            channelId,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    });

    await Promise.allSettled(sendPromises);

  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Error broadcasting to room',
      channelId,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

