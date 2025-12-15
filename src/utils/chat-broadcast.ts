import { DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { getDocClient } from './aws-clients';

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

const apiGwClients = new Map<string, ApiGatewayManagementApiClient>();

function getApiGwClient(domainName: string, stage: string): ApiGatewayManagementApiClient {
  const key = `${domainName}/${stage}`;
  if (!apiGwClients.has(key)) {
    apiGwClients.set(key, new ApiGatewayManagementApiClient({
      endpoint: `https://${domainName}/${stage}`,
    }));
  }
  return apiGwClients.get(key)!;
}

interface BroadcastOptions {
  excludeConnectionId?: string;
}

export async function broadcastToChatRoom(
  channelId: string,
  messagePayload: any,
  options: BroadcastOptions & { tenantId?: string } = {}
): Promise<void> {
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'broadcastToChatRoom ENTRY',
    channelId,
    tenantId: options.tenantId,
    excludeConnectionId: options.excludeConnectionId,
    payloadType: messagePayload?.type,
    timestamp: new Date().toISOString(),
  }));

  const { excludeConnectionId, tenantId } = options;

  try {
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'broadcastToChatRoom: Getting DynamoDB client',
      channelId,
      connectionsTable: CONNECTIONS_TABLE,
    }));

    const docClient = await getDocClient();
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

    let connections: any[] = [];

    // If tenantId is provided, query by tenantId (more efficient than scan)
    // Otherwise, scan all connections (less efficient but works)
    if (tenantId) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'broadcastToChatRoom: Querying connections by tenantId',
        channelId,
        tenantId,
      }));

      const queryResult = await docClient.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
      }));

      connections = queryResult.Items || [];
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'broadcastToChatRoom: Query by tenantId completed',
        channelId,
        tenantId,
        itemsFound: connections.length,
      }));
    } else {
      // Fallback: scan all connections (less efficient)
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'broadcastToChatRoom: Scanning all connections (no tenantId provided)',
        channelId,
      }));

      const scanResult = await docClient.send(new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        FilterExpression: '((attribute_exists(chatChannels) AND contains(chatChannels, :channelId)) OR (attribute_exists(chatRooms) AND contains(chatRooms, :channelId)))',
        ExpressionAttributeValues: {
          ':channelId': channelId,
        },
      }));

      connections = scanResult.Items || [];
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'broadcastToChatRoom: Scan completed',
        channelId,
        itemsFound: connections.length,
        scannedCount: scanResult.ScannedCount || 0,
      }));
    }

    if (connections.length === 0) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'No connections found',
        channelId,
        tenantId,
      }));
      return;
    }

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'broadcastToChatRoom: Filtering connections by channel',
      channelId,
      totalItems: connections.length,
      excludeConnectionId,
    }));

    // Filter connections that are in this channel
    // For backward compatibility: if chatChannels is missing/empty, we include ALL connections for the tenant
    // This handles connections created before chatChannels was added
    const roomConnections = connections.filter((connection: any) => {
      if (connection.connectionId === excludeConnectionId) {
        return false;
      }

      // If connection has chatChannels/chatRooms, check if it includes this channelId
      const channels = connection.chatChannels || connection.chatRooms;
      
      // If chatChannels attribute doesn't exist (backward compatibility), include all connections
      // This is a temporary fix until all connections are migrated to have chatChannels
      const hasChannelsAttribute = connection.hasOwnProperty('chatChannels') || connection.hasOwnProperty('chatRooms');
      
      if (!hasChannelsAttribute) {
        // No chatChannels attribute - include it (backward compatibility)
        return true;
      }
      
      // chatChannels exists - check if it includes this channelId
      // If it's an empty array, don't include (user hasn't joined any channels)
      if (!channels || channels.length === 0) {
        return false;
      }
      
      return channels.includes(channelId);
    });

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'broadcastToChatRoom: Filtering completed',
      channelId,
      connectionCount: roomConnections.length,
      totalScanned: scanResult.Items.length,
      excludeConnectionId,
    }));

    if (roomConnections.length === 0) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'broadcastToChatRoom: No connections to send to, returning early',
        channelId,
      }));
      return;
    }

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'broadcastToChatRoom: Starting WebSocket sends',
      channelId,
      connectionCount: roomConnections.length,
      connectionIds: roomConnections.map((c: any) => c.connectionId),
    }));

    const sendPromises = roomConnections.map(async (connection: any) => {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'broadcastToChatRoom: Sending to connection',
        channelId,
        connectionId: connection.connectionId,
        domainName: connection.domainName,
        stage: connection.stage,
      }));

      try {
        const apiGw = getApiGwClient(connection.domainName, connection.stage);
        await apiGw.send(new PostToConnectionCommand({
          ConnectionId: connection.connectionId,
          Data: JSON.stringify(messagePayload),
        }));

        console.log(JSON.stringify({
          level: 'INFO',
          message: 'broadcastToChatRoom: Successfully sent to connection',
          channelId,
          connectionId: connection.connectionId,
        }));
      } catch (error) {
        if (error instanceof Error && error.name === 'GoneException') {
          console.log(JSON.stringify({
            level: 'WARN',
            message: 'Stale connection detected - removing from database',
            connectionId: connection.connectionId,
            channelId,
          }));

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

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'broadcastToChatRoom: Waiting for all sends to complete',
      channelId,
      promiseCount: sendPromises.length,
    }));

    const results = await Promise.allSettled(sendPromises);

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'broadcastToChatRoom: All sends completed',
      channelId,
      successful,
      failed,
      total: results.length,
    }));

  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'broadcastToChatRoom: Exception occurred',
      channelId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    throw error;
  }

  console.log(JSON.stringify({
    level: 'INFO',
    message: 'broadcastToChatRoom EXIT',
    channelId,
    timestamp: new Date().toISOString(),
  }));
}


