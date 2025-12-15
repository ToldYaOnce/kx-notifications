import { APIGatewayEventRequestContext } from 'aws-lambda';
import { UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { getDocClient } from '../utils/aws-clients';
import { publishChatEvent, ChatMessageEventDetail, ChatRoomMembershipEventDetail } from '../utils/eventbridge-publisher';
import { broadcastToChatRoom } from '../utils/chat-broadcast';

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
    await broadcastToChatRoom(channelId, {
      type: 'chat.userJoined',
      channelId,
      userId,
      userName: userName || userId,
      timestamp: joinTimestamp,
    }, { excludeConnectionId: connectionId }); // Exclude the joining user

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
): Promise<{ success: boolean; error?: string; errorCode?: string }> {
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
      return { success: false, error: 'Connection not found', errorCode: 'CONNECTION_NOT_FOUND' };
    }

    const connection = connectionResult.Items[0] as ConnectionRecord;
    let userRooms = connection.chatChannels || [];
    const tenantId = connection.tenantId;
    
    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Connection state',
      connectionId,
      userId: connection.userId,
      userName: connection.userName,
      currentRooms: userRooms,
      targetChannel: channelId,
      isInRoom: userRooms.includes(channelId),
    }));
    
    // Generate timestamp and messageId for EventBridge publish
    const timestamp = new Date().toISOString();
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Auto-join the user to the channel if they're not already in it
    // This is a reasonable UX - if someone sends a message to a channel, they should be in it
    if (!userRooms.includes(channelId)) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'User not in room - auto-joining them to the channel',
        connectionId,
        channelId,
        userId,
      }));
      
      // Add channelId to chatChannels array
      userRooms = [...userRooms, channelId];
      
      // Update the connection record
      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
      await docClient.send(new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: {
          tenantId: connection.tenantId,
          connectionId: connectionId,
        },
        UpdateExpression: 'SET chatChannels = :rooms',
        ExpressionAttributeValues: {
          ':rooms': userRooms,
        },
      }));
      
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'User auto-joined to channel',
        connectionId,
        channelId,
        updatedRooms: userRooms,
      }));
    }

    // Publish chat message event to EventBridge (for persistent storage in other stack)
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

    await broadcastToChatRoom(channelId, messagePayload);

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Chat message broadcasted successfully',
      connectionId,
      channelId,
      userId,
      messageId,
    }));
    
    return { success: true };

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
    await broadcastToChatRoom(channelId, {
      type: 'chat.userLeft',
      channelId,
      userId,
      userName: connection.userName || userId,
      timestamp: leaveTimestamp,
    }, { excludeConnectionId: connectionId }); // Exclude the leaving user

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

