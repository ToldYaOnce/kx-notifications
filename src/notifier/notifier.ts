import { EventBridgeEvent } from 'aws-lambda';
import { QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';

// Types and interfaces
import { ConnectionRecord } from '../types/connection';
import { NotificationPayload } from '../types/notification';

// Utilities
import { initializeClients, getDocClient, getManagementClient } from '../utils/aws-clients';
import { filterConnectionsByEvent } from '../utils/connection-filter';

// Environment variables
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;


/**
 * Send notification to a specific WebSocket connection
 */
async function sendToConnection(
  managementClient: ApiGatewayManagementApiClient,
  connectionId: string,
  payload: NotificationPayload
): Promise<boolean> {
  try {
    await managementClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(payload),
    }));
    
    return true;
  } catch (error) {
    if (error instanceof GoneException) {
      // Connection is stale - this is expected and we should ignore it
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Connection gone - ignoring stale connection',
        connectionId,
      }));
      return false;
    }
    
    // Log other errors but don't fail the entire operation
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to send notification to connection',
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
}

/**
 * Main Lambda handler for EventBridge → WebSocket notifications
 */
export const handler = async (event: EventBridgeEvent<string, any>): Promise<void> => {
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Processing EventBridge notification',
    source: event.source,
    detailType: event['detail-type'],
    eventId: event.id,
    tenantId: event.detail.tenantId || event.detail.clientId,
  }));
  
  try {
    // Initialize clients (handles cross-account role assumption if needed)
    await initializeClients();
    
    // Extract tenant ID from event
    const tenantId = event.detail.tenantId || event.detail.clientId;
    if (!tenantId) {
      console.log(JSON.stringify({
        level: 'WARN',
        message: 'No tenantId found in event - skipping notification',
        eventId: event.id,
        detail: event.detail,
      }));
      return;
    }
    
    // Query active connections for this tenant
    const docClient = getDocClient();
    const connectionsResult = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
      },
      ProjectionExpression: 'connectionId, domainName, stage, userId',
    }));
    
    const connections = connectionsResult.Items as ConnectionRecord[];
    
    if (!connections || connections.length === 0) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'No active connections found for tenant',
        tenantId,
        eventId: event.id,
      }));
      return;
    }
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Found active connections for tenant',
      tenantId,
      connectionCount: connections.length,
      eventId: event.id,
    }));
    
    // Filter connections based on event conditions
    const filteredConnections = filterConnectionsByEvent(connections, event);
    
    if (filteredConnections.length === 0) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'No connections match event conditions - skipping broadcast',
        tenantId,
        originalConnectionCount: connections.length,
        eventId: event.id,
      }));
      return;
    }
    
    // Group filtered connections by (domainName, stage) for efficient client management
    const connectionGroups = new Map<string, ConnectionRecord[]>();
    
    for (const connection of filteredConnections) {
      const key = `${connection.domainName}:${connection.stage}`;
      if (!connectionGroups.has(key)) {
        connectionGroups.set(key, []);
      }
      connectionGroups.get(key)!.push(connection);
    }
    
    // Create notification payload
    const payload: NotificationPayload = {
      type: 'notification',
      family: event.source.replace(/^kx-/, '').replace(/-/g, '_'),
      at: new Date().toISOString(),
      data: {
        eventId: event.id,
        tenantId: event.detail?.tenantId || 'unknown',
        entityId: event.detail?.entityId || event.detail?.qrId || event.detail?.userId,
        entityType: event['detail-type'].split('.')[0],
        eventType: event['detail-type'],
        occurredAt: event.time,
        metadata: event.detail,
        originalEvent: event
      }
    };
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Broadcasting notification to connection groups',
      tenantId,
      groupCount: connectionGroups.size,
      originalConnections: connections.length,
      filteredConnections: filteredConnections.length,
      notificationFamily: payload.family,
    }));
    
    // Send notifications to each group
    let totalSent = 0;
    let totalFailed = 0;
    
    for (const [groupKey, groupConnections] of connectionGroups) {
      const [domainName, stage] = groupKey.split(':');
      const managementClient = getManagementClient(domainName, stage);
      
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Sending notifications to connection group',
        domainName,
        stage,
        connectionCount: groupConnections.length,
      }));
      
      // Send to all connections in this group
      const sendPromises = groupConnections.map(async (connection) => {
        const success = await sendToConnection(managementClient, connection.connectionId, payload);
        if (success) {
          totalSent++;
        } else {
          totalFailed++;
        }
        return success;
      });
      
      await Promise.all(sendPromises);
    }
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Notification broadcasting completed',
      tenantId,
      eventId: event.id,
      totalConnections: connections.length,
      successfulSends: totalSent,
      failedSends: totalFailed,
      notificationFamily: payload.family,
    }));
    
  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to process EventBridge notification',
      eventId: event.id,
      tenantId: event.detail.tenantId || event.detail.clientId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    
    // Don't throw - we don't want to trigger EventBridge retries for WebSocket failures
    // The event has been processed, even if some notifications failed to send
  }
};
