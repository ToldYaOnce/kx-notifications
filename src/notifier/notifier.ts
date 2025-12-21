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
    const dataString = JSON.stringify(payload);
    await managementClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: dataString,
    }));
    
    // Log successful sends for specific agent events
    if (payload.data.eventType === 'agent.tonality.shifted' || payload.data.eventType === 'lead.created') {
      console.log(JSON.stringify({
        level: 'DEBUG',
        message: `Successfully sent ${payload.data.eventType} event to connection`,
        connectionId,
        eventType: payload.data.eventType,
        payloadSize: dataString.length,
        payloadFamily: payload.family,
      }));
    }
    
    return true;
  } catch (error) {
    if (error instanceof GoneException) {
      // Connection is stale - this is expected and we should ignore it
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Connection gone - ignoring stale connection',
        connectionId,
        eventType: payload.data.eventType,
      }));
      return false;
    }
    
    // Log other errors but don't fail the entire operation
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to send notification to connection',
      connectionId,
      eventType: payload.data.eventType,
      payloadFamily: payload.family,
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
// Track processed event IDs to detect duplicates
const processedEventIds = new Set<string>();
const MAX_TRACKED_EVENTS = 10000; // Prevent memory leak

// Track processed messages to prevent duplicate broadcasts
// Key format: `${messageId}:${channelId}:${userId}` (messageId + channelId + recipient userId)
const processedMessages = new Map<string, number>();
const MAX_TRACKED_MESSAGES = 10000; // Prevent memory leak
const MESSAGE_DEDUP_WINDOW_MS = 60000; // 60 seconds - messages older than this can be re-processed

async function processEventBridgeEvent(eventBridgeEvent: EventBridgeEvent<string, any>): Promise<void> {
  const handlerStartTime = Date.now();
  const timeSinceModuleLoad = handlerStartTime - LAMBDA_MODULE_LOAD_TIME;
  const isColdStart = !(global as any).lambdaInitialized;
  
  // Check for duplicate event processing
  const eventId = eventBridgeEvent.id;
  const isDuplicate = processedEventIds.has(eventId);
  if (isDuplicate) {
    console.log(JSON.stringify({
      level: 'WARN',
      message: 'Duplicate event detected - same eventId processed multiple times',
      eventId,
      source: eventBridgeEvent.source,
      detailType: eventBridgeEvent['detail-type'],
      timestamp: new Date().toISOString(),
    }));
  } else {
    // Track this event ID
    processedEventIds.add(eventId);
    // Prevent memory leak by limiting tracked events
    if (processedEventIds.size > MAX_TRACKED_EVENTS) {
      const firstId = processedEventIds.values().next().value;
      processedEventIds.delete(firstId);
    }
  }
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Lambda handler invocation started',
    source: eventBridgeEvent.source,
    detailType: eventBridgeEvent['detail-type'],
    eventId,
    isDuplicate,
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

    // Extract detailType from event
    const detailType = eventBridgeEvent['detail-type'];

    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Processing event detailType',
      detailType,
      source: eventBridgeEvent.source,
      eventId: eventBridgeEvent.id,
    }));

    // Handle chat.message.received events from fanout Lambda (kx-notifications-messaging)
    // These events are per-participant and need to be sent to the recipient's WebSocket connection
    if (detailType === 'chat.message.received') {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Processing chat.message.received event',
        eventId: eventBridgeEvent.id,
        detail: eventBridgeEvent.detail,
      }));
      const detail = eventBridgeEvent.detail || {};
      const channelId = detail.channelId || detail.conversation_id;
      const userId = detail.userId; // This is the recipient (bot persona ID for user messages, or user ID for agent replies)
      // Try to get senderId from multiple sources (fast-path events may not include it)
      const senderId = detail.senderId || 
                       detail.metadata?.senderId || 
                       (detail.connectionId ? undefined : detail.userId); // Fallback: if no connectionId, assume userId is sender (for backward compatibility)
      const senderType = detail.senderType || detail.metadata?.senderType;
      const originMarker = detail.originMarker || detail.metadata?.originMarker;
      const content = detail.content;
      const messageId = detail.messageId || detail.originalMessageId;

      if (!channelId) {
        console.log(JSON.stringify({
          level: 'WARN',
          message: 'chat.message.received event missing channelId - skipping',
          eventId: eventBridgeEvent.id,
          tenantId,
        }));
        return;
      }

      // chat.message.received events are per-participant (fanout creates one per participant)
      // userId = the participant who should receive this message
      // We should send to that specific user's connection(s), not broadcast to channel
      
      if (!userId) {
        console.log(JSON.stringify({
          level: 'WARN',
          message: 'chat.message.received event missing userId (recipient) - skipping',
          eventId: eventBridgeEvent.id,
          channelId,
          tenantId,
        }));
        return;
      }

      if (!content) {
        console.log(JSON.stringify({
          level: 'WARN',
          message: 'chat.message.received event missing content - skipping',
          eventId: eventBridgeEvent.id,
          channelId,
          userId,
          tenantId,
        }));
        return;
      }

      // Check if this is an agent reply (originMarker=persona or senderType=agent)
      const isAgentReply = originMarker === 'persona' || senderType === 'agent';

      // Deduplication: Check if we've already sent this message to this recipient
      // Key: messageId + channelId + recipient userId (prevents same message to same user via fast-path + slow-path)
      const dedupKey = `${messageId}:${channelId}:${userId}`;
      const now = Date.now();
      const lastSentTime = processedMessages.get(dedupKey);
      
      if (lastSentTime && (now - lastSentTime) < MESSAGE_DEDUP_WINDOW_MS) {
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'Skipping duplicate chat.message.received - already sent to recipient',
          eventId: eventBridgeEvent.id,
          tenantId,
          channelId,
          messageId,
          recipientUserId: userId,
          senderId,
          lastSentTime: new Date(lastSentTime).toISOString(),
          timeSinceLastSent: `${now - lastSentTime}ms`,
        }));
        return;
      }

      // Track this message as processed
      processedMessages.set(dedupKey, now);
      
      // Prevent memory leak by limiting tracked messages
      if (processedMessages.size > MAX_TRACKED_MESSAGES) {
        // Remove oldest entries (simple FIFO - remove first 10% when limit reached)
        const entriesToRemove = Math.floor(MAX_TRACKED_MESSAGES * 0.1);
        const keysToRemove = Array.from(processedMessages.keys()).slice(0, entriesToRemove);
        keysToRemove.forEach(key => processedMessages.delete(key));
      }

      console.log(JSON.stringify({
        level: 'DEBUG',
        message: 'Processing chat.message.received event details',
        eventId: eventBridgeEvent.id,
        userId,
        senderId,
        isAgentReply,
        messageId,
        dedupKey,
      }));

      // Determine the sender for the payload
      // For user messages: senderId should be the user who sent it
      // For agent messages: senderId should be the agent/persona
      // If senderId is missing (fast-path issue), try to infer it
      let payloadSenderId = senderId || detail.metadata?.senderId;
      
      // If still no senderId and we have connectionId, try to look it up (for fast-path user messages)
      if (!payloadSenderId && detail.connectionId && !isAgentReply) {
        try {
          const docClient = getDocClient();
          const connectionResult = await docClient.send(new QueryCommand({
            TableName: CONNECTIONS_TABLE,
            IndexName: 'ConnectionIdIndex',
            KeyConditionExpression: 'connectionId = :connectionId',
            ExpressionAttributeValues: {
              ':connectionId': detail.connectionId,
            },
            Limit: 1,
          }));
          
          if (connectionResult.Items && connectionResult.Items.length > 0) {
            const connection = connectionResult.Items[0] as ConnectionRecord;
            payloadSenderId = connection.userId;
            console.log(JSON.stringify({
              level: 'INFO',
              message: 'Resolved senderId from connectionId',
              eventId: eventBridgeEvent.id,
              connectionId: detail.connectionId,
              resolvedSenderId: payloadSenderId,
            }));
          }
        } catch (error) {
          console.log(JSON.stringify({
            level: 'WARN',
            message: 'Failed to resolve senderId from connectionId',
            eventId: eventBridgeEvent.id,
            connectionId: detail.connectionId,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      
      // Final fallback: for agent replies, userId might be the sender
      if (!payloadSenderId && isAgentReply) {
        payloadSenderId = userId;
      }
      
      // If still no senderId, log warning but continue (frontend may handle it)
      if (!payloadSenderId) {
        console.log(JSON.stringify({
          level: 'WARN',
          message: 'chat.message.received event missing senderId - payload may be incomplete',
          eventId: eventBridgeEvent.id,
          tenantId,
          channelId,
          recipientUserId: userId,
          connectionId: detail.connectionId,
          isAgentReply,
          detailKeys: Object.keys(detail),
        }));
      }

      const messagePayload = {
        type: 'chat.message',
        channelId,
        userId: payloadSenderId, // The sender (who sent the message) - REQUIRED for frontend
        userName: detail.metadata?.userName || detail.userName || payloadSenderId || userId,
        message: content,
        tenantId, // Include tenantId for client filtering
        timestamp: detail.timestamp || eventBridgeEvent.time || new Date().toISOString(),
        messageId: messageId || eventBridgeEvent.id,
        messageType: detail.messageType || 'text',
        metadata: detail.metadata,
      };

      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Sending chat.message.received to recipient',
        eventId: eventBridgeEvent.id,
        tenantId,
        channelId,
        recipientUserId: userId,
        senderId,
        messageId,
        isAgentReply,
      }));

      // Query all connections for the tenant and filter by channel
      // Note: The fanout creates events per participant, but userId might be a bot persona ID
      // which doesn't match connection userIds. Instead, we broadcast to all connections in the channel.
      const docClient = getDocClient();
      const connectionsResult = await docClient.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
        ProjectionExpression: 'connectionId, domainName, stage, userId, chatChannels',
      }));

      const allConnections = connectionsResult.Items || [];
      
      // Filter connections to those in the channel
      // Note: We include the sender's connections - frontend should deduplicate by messageId
      const channelConnections = allConnections.filter((conn: any) => {
        const channels = conn.chatChannels || [];
        return channels.includes(channelId);
      });
      
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Query results for channel',
        eventId: eventBridgeEvent.id,
        tenantId,
        channelId,
        recipientUserId: userId,
        senderId,
        allConnectionsFound: allConnections.length,
        channelConnectionsFound: channelConnections.length,
        connectionIds: channelConnections.map((c: any) => c.connectionId),
      }));
      
      if (channelConnections.length === 0) {
        console.log(JSON.stringify({
          level: 'INFO',
          message: 'No connections found in channel',
          eventId: eventBridgeEvent.id,
          tenantId,
          channelId,
          senderId,
          allConnectionsCount: allConnections.length,
        }));
        
        // If agent reply, don't forward to Router
        if (isAgentReply) {
          return;
        }
        
        // For user messages, Router will still process it via its own subscription
        return;
      }

      const connections = channelConnections;

      // Send message to all connections for this userId (user might have multiple devices)
      const sendPromises = connections.map(async (connection: ConnectionRecord) => {
        try {
          const managementClient = new ApiGatewayManagementApiClient({
            endpoint: `https://${connection.domainName}/${connection.stage}`,
          });
          
          await managementClient.send(new PostToConnectionCommand({
            ConnectionId: connection.connectionId,
            Data: JSON.stringify(messagePayload),
          }));
          
          console.log(JSON.stringify({
            level: 'INFO',
            message: 'Sent message to connection',
            connectionId: connection.connectionId,
            recipientUserId: userId,
            senderId,
            channelId,
            messagePayload: JSON.stringify(messagePayload),
          }));
        } catch (error) {
          if (error instanceof GoneException) {
            console.log(JSON.stringify({
              level: 'WARN',
              message: 'Stale connection - removing',
              connectionId: connection.connectionId,
              userId,
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
              message: 'Failed to send message to connection',
              connectionId: connection.connectionId,
              userId,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      });

      await Promise.allSettled(sendPromises);

      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Completed sending chat.message.received to recipient',
        eventId: eventBridgeEvent.id,
        tenantId,
        userId,
        channelId,
        connectionsSent: connections.length,
        isAgentReply,
      }));

      // Agent replies shouldn't trigger Router processing
      if (isAgentReply) {
        return;
      }
      
      // User messages will be processed by Router via its own EventBridge subscription
      return;
    }

    // Handle channel-based events (presence events from agent)
    // NOTE: chat.message events from kx-event-tracking are already broadcast by onMessage handler
    // We only handle chat.message from kxgen.agent (agent replies) and presence events
    const source = eventBridgeEvent.source;
    const isChannelBasedEvent = 
      detailType === 'chat.received' ||
      detailType === 'chat.read' ||
      detailType === 'chat.typing' ||
      detailType === 'chat.stoppedTyping' ||
      (detailType === 'chat.message' && source === 'kxgen.agent'); // Only handle agent replies

    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Checking if event is channel-based',
      detailType,
      source,
      isChannelBasedEvent,
      eventId: eventBridgeEvent.id,
    }));

    if (isChannelBasedEvent) {
      const detail = eventBridgeEvent.detail || {};
      const channelId = detail.channelId || detail.conversation_id;

      if (!channelId) {
        console.log(JSON.stringify({
          level: 'WARN',
          message: `${detailType} event missing channelId - skipping broadcast`,
          eventId: eventBridgeEvent.id,
          tenantId,
        }));
        return;
      }

      // Build payload based on event type
      let channelPayload: Record<string, any>;
      
      if (detailType === 'chat.message' && source === 'kxgen.agent') {
        // Agent reply message
        const { userId, userName, message, senderId, content, timestamp, text } = detail;
        const messageBody = message ?? content ?? text;

        if (!messageBody || !userId) {
          console.log(JSON.stringify({
            level: 'WARN',
            message: 'chat.message event missing required fields - skipping broadcast',
            eventId: eventBridgeEvent.id,
            channelId,
            userId,
          }));
          return;
        }

        channelPayload = {
          type: 'chat.message',
          channelId,
          userId: senderId || userId,
          userName: userName || senderId || userId,
          message: messageBody,
          timestamp: timestamp || eventBridgeEvent.time || new Date().toISOString(),
          messageId: detail.messageId || eventBridgeEvent.id,
        };

        if (detail.metadata) {
          channelPayload.metadata = detail.metadata;
        }
      } else {
        // Presence events (chat.received, chat.read, chat.typing, chat.stoppedTyping)
        // Match the same structure as chat.message for consistency
        // Map agentId/agentName to userId/userName to match existing working structure
        const presenceUserId = detail.agentId || detail.userId || detail.personaId;
        const presenceUserName = detail.agentName || detail.userName;
        
        channelPayload = {
          type: detailType, // e.g., 'chat.typing', 'chat.read'
          channelId,
          userId: presenceUserId, // Map agentId -> userId for consistency
          userName: presenceUserName, // Map agentName -> userName for consistency
          tenantId,
          timestamp: detail.timestamp || eventBridgeEvent.time || new Date().toISOString(),
          // Include optional fields that may be present
          ...(detail.messageId && { messageId: detail.messageId }),
          ...(detail.messageType && { messageType: detail.messageType }),
          ...(detail.currentChunk && { currentChunk: detail.currentChunk }),
          ...(detail.totalChunks && { totalChunks: detail.totalChunks }),
          // Include metadata if present
          ...(detail.metadata && { metadata: detail.metadata }),
        };
      }

      console.log(JSON.stringify({
        level: 'INFO',
        message: `Broadcasting ${detailType} to channel via notifier`,
        eventId: eventBridgeEvent.id,
        tenantId,
        channelId,
        source,
      }));

      // For presence events, we need to broadcast to all channel participants
      // Query all connections for the tenant and filter by channel (same approach as chat.message.received)
      const docClient = getDocClient();
      const connectionsResult = await docClient.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
      }));

      const allConnections = connectionsResult.Items || [];
      
      // Filter connections to those in the channel
      const channelConnections = allConnections.filter((conn: any) => {
        const channels = conn.chatChannels || [];
        return channels.includes(channelId);
      });
      
      if (channelConnections.length === 0) {
        console.log(JSON.stringify({
          level: 'INFO',
          message: `No connections found in channel - skipping ${detailType} broadcast`,
          tenantId,
          channelId,
          allConnectionsCount: allConnections.length,
        }));
        return;
      }

      const connections = channelConnections;
      
      console.log(JSON.stringify({
        level: 'INFO',
        message: `Broadcasting ${detailType} to channel participants`,
        eventId: eventBridgeEvent.id,
        tenantId,
        channelId,
        allConnectionsFound: allConnections.length,
        channelConnectionsFound: channelConnections.length,
      }));
      const sendPromises = connections.map(async (connection: ConnectionRecord) => {
        try {
          const managementClient = new ApiGatewayManagementApiClient({
            endpoint: `https://${connection.domainName}/${connection.stage}`,
          });
          
          await managementClient.send(new PostToConnectionCommand({
            ConnectionId: connection.connectionId,
            Data: JSON.stringify(channelPayload),
          }));
          
          console.log(JSON.stringify({
            level: 'DEBUG',
            message: `Sent ${detailType} to connection`,
            connectionId: connection.connectionId,
            channelId,
          }));
        } catch (error) {
          if (error instanceof GoneException) {
            console.log(JSON.stringify({
              level: 'WARN',
              message: 'Stale connection - removing',
              connectionId: connection.connectionId,
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
              message: `Failed to send ${detailType} to connection`,
              connectionId: connection.connectionId,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      });

      await Promise.allSettled(sendPromises);

      console.log(JSON.stringify({
        level: 'INFO',
        message: `Completed broadcasting ${detailType} to channel`,
        eventId: eventBridgeEvent.id,
        tenantId,
        channelId,
        connectionsSent: connections.length,
      }));
      
      return; // Early return - don't process as tenant-only event
    }

    // Skip chat.message events from kx-event-tracking (already broadcast by onMessage handler)
    if (detailType === 'chat.message' && source === 'kx-event-tracking') {
      console.log(JSON.stringify({
        level: 'DEBUG',
        message: 'Skipping chat.message from kx-event-tracking (already broadcast by onMessage handler)',
        eventId: eventBridgeEvent.id,
        tenantId,
      }));
      return;
    }

    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Reached generic notification handler',
      detailType,
      source,
      eventId: eventBridgeEvent.id,
      tenantId,
    }));

    // Agent events (business, workflow, analytics) should be forwarded as notifications
    const agentEventTypes = [
      'scheduling.booking_requested',
      'lead.created',
      'agent.goal.activated',
      'agent.goal.completed',
      'agent.data.captured',
      'agent.workflow.state_updated',
      'agent.message.analyzed',
      'agent.tonality.shifted',
      'agent.interest.detected',
      'agent.objection.detected',
    ];
    
    if (agentEventTypes.includes(detailType)) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: `Processing agent event: ${detailType}`,
        eventId: eventBridgeEvent.id,
        tenantId,
        source,
        detailType,
        hasDetail: !!eventBridgeEvent.detail,
        payload: eventBridgeEvent.detail, // Full event payload for debugging
      }));
    }
    
    // All events that reach here (not chat.message.received, not presence events, not skipped) 
    // should be forwarded as generic notifications to all tenant connections
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Processing generic notification event (not chat or presence)',
      detailType,
      source,
      eventId: eventBridgeEvent.id,
      tenantId,
    }));
    
    // Query active connections for this tenant
    const docClient = getDocClient();
    
    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Querying connections for tenant',
      tenantId,
      tableName: CONNECTIONS_TABLE,
      detailType,
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
      detailType,
    }));
    
    // Filter connections based on event conditions
    const filteredConnections = filterConnectionsByEvent(connections, eventBridgeEvent);
    
    console.log(JSON.stringify({
      level: 'DEBUG',
      message: 'Connection filtering results',
      eventId: eventBridgeEvent.id,
      detailType,
      tenantId,
      originalConnectionCount: connections.length,
      filteredConnectionCount: filteredConnections.length,
      eventSource: eventBridgeEvent.source,
    }));
    
    if (filteredConnections.length === 0) {
      console.log(JSON.stringify({
        level: 'WARN',
        message: 'No connections match event conditions - skipping broadcast',
        tenantId,
        detailType,
        originalConnectionCount: connections.length,
        eventId: eventBridgeEvent.id,
        eventSource: eventBridgeEvent.source,
        // Log connection details for debugging
        connections: connections.map(c => ({
          connectionId: c.connectionId,
          userId: c.userId,
          subscriptions: (c as any).subscriptions,
          userRole: (c as any).userRole,
        })),
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
    // Extract family from source - handle both kx-* and kxgen.* patterns
    let family = eventBridgeEvent.source;
    if (family.startsWith('kx-')) {
      family = family.replace(/^kx-/, '').replace(/-/g, '_');
    } else if (family.startsWith('kxgen.')) {
      family = family.replace(/^kxgen\./, '').replace(/\./g, '_');
    } else {
      family = family.replace(/[-.]/g, '_');
    }

    // For analytics events (agent.message.analyzed, agent.tonality.shifted, etc.):
    // The full event detail is preserved in `metadata`, including all nested objects like:
    // - analysis (interestLevel, conversionLikelihood, emotionalTone, primaryIntent)
    // - languageProfile (formality, hypeTolerance, emojiUsage, language)
    // - shift (interestDelta, conversionDelta, toneChanged, direction, magnitude)
    // - conversationAverages (avgInterestLevel, avgConversionLikelihood, etc.)
    // - All other fields from the event detail
    const payload: NotificationPayload = {
      type: 'notification',
      family,
      at: new Date().toISOString(),
      data: {
        eventId: eventBridgeEvent.id,
        tenantId: eventBridgeEvent.detail?.tenantId || 'unknown',
        entityId: eventBridgeEvent.detail?.entityId || eventBridgeEvent.detail?.qrId || eventBridgeEvent.detail?.userId || eventBridgeEvent.detail?.channelId,
        entityType: eventBridgeEvent['detail-type'].split('.')[0],
        eventType: eventBridgeEvent['detail-type'],
        occurredAt: eventBridgeEvent.time,
        metadata: eventBridgeEvent.detail, // Contains ALL detail fields (analysis, languageProfile, shift, etc.)
        originalEvent: eventBridgeEvent // Full original event for reference
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
        detailType,
        eventId: eventBridgeEvent.id,
      }));
      
      // Send to all connections in this group
      const sendPromises = groupConnections.map(async (connection) => {
        // Log what we're sending for debugging (agent events)
        if (detailType === 'agent.tonality.shifted' || detailType === 'lead.created') {
          console.log(JSON.stringify({
            level: 'DEBUG',
            message: `Sending ${detailType} event to connection`,
            connectionId: connection.connectionId,
            detailType,
            eventId: eventBridgeEvent.id,
            payloadType: payload.type,
            payloadFamily: payload.family,
            payloadEventType: payload.data.eventType,
          }));
        }
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
      detailType,
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
