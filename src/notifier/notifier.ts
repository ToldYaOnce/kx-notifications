import { EventBridgeEvent, SQSEvent, SQSRecord } from 'aws-lambda';
import { QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';

// Types and interfaces
import { ConnectionRecord } from '../types/connection';
import { NotificationPayload } from '../types/notification';

// Utilities
import { initializeClients, getDocClient, getManagementClient } from '../utils/aws-clients';
import { filterConnectionsByEvent } from '../utils/connection-filter';
import { withWarmup, isWarmupEvent } from '../utils/lambda-warmer';

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

// Lambda module load timestamp
const LAMBDA_MODULE_LOAD_TIME = Date.now();
console.log(JSON.stringify({
  level: 'INFO',
  message: 'Lambda module loaded',
  timestamp: new Date().toISOString(),
  moduleLoadTime: LAMBDA_MODULE_LOAD_TIME,
  processStartTime: process.uptime() * 1000, // Convert to ms
}));

// Pre-initialize clients outside the handler to avoid cold start delays
const clientInitPromise = initializeClients();

// Track initialization completion
clientInitPromise.then(() => {
  const initCompleteTime = Date.now();
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Client initialization completed during module load',
    timestamp: new Date().toISOString(),
    initDuration: `${initCompleteTime - LAMBDA_MODULE_LOAD_TIME}ms`,
    totalModuleLoadTime: `${initCompleteTime - LAMBDA_MODULE_LOAD_TIME}ms`,
  }));
}).catch((error) => {
  console.log(JSON.stringify({
    level: 'ERROR',
    message: 'Client initialization failed during module load',
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }));
});

/**
 * Process a single EventBridge event from SQS
 */
async function processEventBridgeEvent(eventBridgeEvent: EventBridgeEvent<string, any>): Promise<void> {
  const handlerStartTime = Date.now();
  const timeSinceModuleLoad = handlerStartTime - LAMBDA_MODULE_LOAD_TIME;
  const isColdStart = !(global as any).lambdaInitialized;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Lambda handler invocation started',
    source: eventBridgeEvent.source,
    detailType: eventBridgeEvent['detail-type'],
    eventId: eventBridgeEvent.id,
    tenantId: eventBridgeEvent.detail.tenantId || eventBridgeEvent.detail.clientId,
    timestamp: new Date().toISOString(),
    handlerStartTime,
    timeSinceModuleLoad: `${timeSinceModuleLoad}ms`,
    coldStart: isColdStart,
    processUptime: `${process.uptime() * 1000}ms`,
  }));
  
  // Mark as initialized to detect cold starts
  (global as any).lambdaInitialized = true;
  
  try {
    // Ensure clients are initialized with timeout protection
    const clientInitStartTime = Date.now();
    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Starting client initialization check',
      timestamp: new Date().toISOString(),
      timeSinceHandlerStart: `${clientInitStartTime - handlerStartTime}ms`,
    }));
    
    const initTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Client initialization timeout')), 45000)
    );
    
    await Promise.race([clientInitPromise, initTimeout]);
    
    const clientInitEndTime = Date.now();
    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Client initialization check completed',
      timestamp: new Date().toISOString(),
      clientInitDuration: `${clientInitEndTime - clientInitStartTime}ms`,
      totalTimeSinceHandlerStart: `${clientInitEndTime - handlerStartTime}ms`,
    }));
    
    // Extract tenant ID from event
    const tenantId = eventBridgeEvent.detail.tenantId || eventBridgeEvent.detail.clientId;
    if (!tenantId) {
      console.log(JSON.stringify({
        level: 'WARN',
        message: 'No tenantId found in event - skipping notification',
        eventId: eventBridgeEvent.id,
        detail: eventBridgeEvent.detail,
      }));
      return;
    }
    
    // Query active connections for this tenant
    const docClient = getDocClient();
    
    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Querying connections for tenant',
      tenantId,
      tableName: CONNECTIONS_TABLE,
    }));
    
    const connectionsResult = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
      },
      ProjectionExpression: 'connectionId, domainName, stage, userId',
    }));
    
    const connections = connectionsResult.Items as ConnectionRecord[];
    
    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Found connections for tenant',
      tenantId,
      connectionCount: connections.length,
      connections: connections.map(c => ({ 
        connectionId: c.connectionId, 
        domainName: c.domainName, 
        stage: c.stage 
      })),
    }));
    
    if (!connections || connections.length === 0) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'No active connections found for tenant',
        tenantId,
        eventId: eventBridgeEvent.id,
      }));
      return;
    }
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Found active connections for tenant',
      tenantId,
      connectionCount: connections.length,
      eventId: eventBridgeEvent.id,
    }));
    
    // Filter connections based on event conditions
    const filteredConnections = filterConnectionsByEvent(connections, eventBridgeEvent);
    
    if (filteredConnections.length === 0) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'No connections match event conditions - skipping broadcast',
        tenantId,
        originalConnectionCount: connections.length,
        eventId: eventBridgeEvent.id,
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
      family: eventBridgeEvent.source.replace(/^kx-/, '').replace(/-/g, '_'),
      at: new Date().toISOString(),
      data: {
        eventId: eventBridgeEvent.id,
        tenantId: eventBridgeEvent.detail?.tenantId || 'unknown',
        entityId: eventBridgeEvent.detail?.entityId || eventBridgeEvent.detail?.qrId || eventBridgeEvent.detail?.userId,
        entityType: eventBridgeEvent['detail-type'].split('.')[0],
        eventType: eventBridgeEvent['detail-type'],
        occurredAt: eventBridgeEvent.time,
        metadata: eventBridgeEvent.detail,
        originalEvent: eventBridgeEvent
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
    
    const handlerEndTime = Date.now();
    const totalHandlerDuration = handlerEndTime - handlerStartTime;
    const totalTimeSinceModuleLoad = handlerEndTime - LAMBDA_MODULE_LOAD_TIME;
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Lambda handler execution completed successfully',
      tenantId,
      eventId: eventBridgeEvent.id,
      totalConnections: connections.length,
      successfulSends: totalSent,
      failedSends: totalFailed,
      notificationFamily: payload.family,
      handlerDuration: `${totalHandlerDuration}ms`,
      totalTimeSinceModuleLoad: `${totalTimeSinceModuleLoad}ms`,
      timestamp: new Date().toISOString(),
      coldStart: isColdStart,
      processUptime: `${process.uptime() * 1000}ms`,
    }));
    
  } catch (error) {
    const handlerErrorTime = Date.now();
    const totalHandlerDuration = handlerErrorTime - handlerStartTime;
    const totalTimeSinceModuleLoad = handlerErrorTime - LAMBDA_MODULE_LOAD_TIME;
    
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Lambda handler execution failed',
      eventId: eventBridgeEvent.id,
      tenantId: eventBridgeEvent.detail?.tenantId || eventBridgeEvent.detail?.clientId || 'unknown',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      handlerDuration: `${totalHandlerDuration}ms`,
      totalTimeSinceModuleLoad: `${totalTimeSinceModuleLoad}ms`,
      timestamp: new Date().toISOString(),
      coldStart: isColdStart,
      processUptime: `${process.uptime() * 1000}ms`,
    }));
    
    // IMPORTANT: DO throw for initialization failures - we want EventBridge retries
    // Only swallow WebSocket delivery failures, not system failures
    if (error instanceof Error && (
      error.message.includes('Client initialization timeout') ||
      error.message.includes('timeout') ||
      error.message.includes('Unable to assume role') ||
      error.message.includes('No credentials')
    )) {
      console.log(JSON.stringify({
        level: 'ERROR',
        message: 'System failure - will trigger EventBridge retry',
        error: error.message,
      }));
      throw error; // This will trigger EventBridge retry
    }
  }
}

/**
 * Main Lambda handler for SQS → EventBridge → WebSocket notifications
 * Processes EventBridge events delivered via SQS for better reliability
 */
const sqsHandler = async (event: SQSEvent): Promise<void> => {
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'SQS Lambda invocation started',
    recordCount: event.Records.length,
    timestamp: new Date().toISOString(),
  }));

  // Process each SQS record (should be 1 due to batchSize: 1)
  for (const record of event.Records) {
    try {
      // Parse the EventBridge event from SQS message body
      const eventBridgeEvent: EventBridgeEvent<string, any> = JSON.parse(record.body);
      
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Processing SQS record',
        sqsMessageId: record.messageId,
        eventBridgeEventId: eventBridgeEvent.id,
        source: eventBridgeEvent.source,
        detailType: eventBridgeEvent['detail-type'],
      }));

      // Process the EventBridge event
      await processEventBridgeEvent(eventBridgeEvent);

    } catch (error) {
      console.log(JSON.stringify({
        level: 'ERROR',
        message: 'Failed to process SQS record',
        sqsMessageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));
      
      // Throw to trigger SQS retry mechanism
      throw error;
    }
  }
};

// Export the EventBridge handler with warmup support
export const handler = withWarmup(async (event: EventBridgeEvent<string, any>) => {
  await processEventBridgeEvent(event);
});

// Add a simple test export to verify the Lambda is working
export const testHandler = async (event: any) => {
  console.log('TEST HANDLER INVOKED:', JSON.stringify(event, null, 2));
  return { statusCode: 200, body: 'Lambda is working!' };
};
