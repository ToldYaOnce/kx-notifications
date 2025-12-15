import { EventBridgeEvent } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getEventBridgeClient } from '../utils/aws-clients';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;

/**
 * Chat Event Consumer Lambda
 * 
 * Processes chat events from EventBridge for:
 * - Analytics and metrics
 * - Audit logging
 * - External integrations (webhooks, notifications)
 * - Data pipelines
 * - Publishing to kx-notifications EventBridge for fanout Lambda
 */

export const handler = async (event: EventBridgeEvent<string, any>): Promise<void> => {
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Chat event received',
    eventId: event.id,
    source: event.source,
    detailType: event['detail-type'],
    time: event.time,
    detail: event.detail,
  }));

  try {
    const eventType = event['detail-type'];
    const detail = event.detail;

    // Process different chat event types
    switch (eventType) {
      case 'chat.message':
        await processChatMessage(event);
        break;
      
      case 'chat.join':
        await processChatJoin(event);
        break;
      
      case 'chat.leave':
        await processChatLeave(event);
        break;
      
      case 'chat.createRoom':
        await processChatRoomCreated(event);
        break;
      
      case 'chat.deleteRoom':
        await processChatRoomDeleted(event);
        break;
      
      default:
        console.log(JSON.stringify({
          level: 'DEBUG',
          message: 'Unknown chat event type',
          eventType,
        }));
    }

    // Emit CloudWatch metrics
    emitMetrics(eventType, detail.tenantId);

  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to process chat event',
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    
    // Don't throw - we don't want to trigger retries for processing errors
    // Only infrastructure/system errors should trigger retries
  }
};

/**
 * Process chat message events
 * Use cases: Message analytics, content moderation, search indexing
 * Also publishes to EventBridge for fanout Lambda (kx-notifications-messaging)
 */
async function processChatMessage(event: EventBridgeEvent<string, any>): Promise<void> {
  const detail = event.detail;
  const { tenantId, channelId, userId, userName, message, messageId, timestamp, connectionId, messageType, metadata } = detail;
  const roomId = channelId || detail.roomId; // Support both channelId and roomId
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Processing chat message',
    tenantId,
    roomId,
    userId,
    messageId,
    messageLength: message?.length,
    timestamp,
    metric: {
      name: 'ChatMessage',
      value: 1,
      unit: 'Count',
      dimensions: {
        TenantId: tenantId,
        RoomId: roomId,
      },
    },
  }));

  // Publish to EventBridge for fanout Lambda (kx-notifications-messaging)
  // The fanout Lambda will determine which bot participants should receive chat.message.available
  try {
    if (!EVENT_BUS_NAME) {
      console.log(JSON.stringify({
        level: 'ERROR',
        message: 'EVENT_BUS_NAME environment variable not set - cannot publish channel message for fanout',
        tenantId,
        channelId,
      }));
      return; // Early return - can't proceed without event bus name
    }

    const eventBridgeClient = getEventBridgeClient();
    
    // Extract originMarker from metadata if present (to preserve agent message markers)
    const originMarker = metadata?.originMarker || 
                        (metadata?.isAgentGenerated === true ? 'persona' : undefined);
    
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'kx-notifications-messaging',
        DetailType: 'channel.message', // Fanout Lambda subscribes to this detail type
        Detail: JSON.stringify({
          tenantId,
          channelId: roomId || channelId,
          messageId,
          timestamp: timestamp || event.time || new Date().toISOString(),
          metadata: {
            ...metadata,
            ...(originMarker && { originMarker }),
            // Remove legacy flag if present
            ...(metadata?.isAgentGenerated !== undefined && { isAgentGenerated: undefined }),
          },
          // Include all original message fields for fanout processing
          content: message || detail.content,
          senderId: userId,
          senderType: metadata?.senderType || metadata?.userType || 'user',
        }),
        EventBusName: EVENT_BUS_NAME,
        Time: new Date(timestamp || event.time),
      }],
    }));

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Published channel message to EventBridge for fanout',
      tenantId,
      channelId: roomId || channelId,
      messageId,
      originMarker,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to publish channel message to EventBridge for fanout',
      tenantId,
      channelId: roomId || channelId,
      error: error instanceof Error ? error.message : String(error),
    }));
    // Don't throw - analytics should continue even if fanout publish fails
  }

  // TODO: Add custom processing logic here:
  // - Store in analytics database
  // - Index for search
  // - Check for content moderation
  // - Update activity metrics
  // - Trigger external webhooks
}

/**
 * Process user join events
 * Use cases: User activity tracking, room analytics
 */
async function processChatJoin(event: EventBridgeEvent<string, any>): Promise<void> {
  const { tenantId, roomId, userId, userName, roomName, timestamp } = event.detail;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Processing chat join',
    tenantId,
    roomId,
    userId,
    userName,
    roomName,
    timestamp,
    metric: {
      name: 'ChatJoin',
      value: 1,
      unit: 'Count',
      dimensions: {
        TenantId: tenantId,
        RoomId: roomId,
      },
    },
  }));

  // TODO: Add custom processing logic here:
  // - Update room activity metrics
  // - Track user engagement
  // - Send welcome messages
}

/**
 * Process user leave events
 * Use cases: Session tracking, churn analytics
 */
async function processChatLeave(event: EventBridgeEvent<string, any>): Promise<void> {
  const { tenantId, roomId, userId, userName, timestamp } = event.detail;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Processing chat leave',
    tenantId,
    roomId,
    userId,
    userName,
    timestamp,
    metric: {
      name: 'ChatLeave',
      value: 1,
      unit: 'Count',
      dimensions: {
        TenantId: tenantId,
        RoomId: roomId,
      },
    },
  }));

  // TODO: Add custom processing logic here:
  // - Calculate session duration
  // - Update activity metrics
}

/**
 * Process room creation events
 * Use cases: Room analytics, tenant usage tracking
 */
async function processChatRoomCreated(event: EventBridgeEvent<string, any>): Promise<void> {
  const { tenantId, roomId, roomName, roomType, userId, userName, timestamp } = event.detail;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Processing room creation',
    tenantId,
    roomId,
    roomName,
    roomType,
    createdBy: userId,
    timestamp,
    metric: {
      name: 'ChatRoomCreated',
      value: 1,
      unit: 'Count',
      dimensions: {
        TenantId: tenantId,
        RoomType: roomType,
      },
    },
  }));

  // TODO: Add custom processing logic here:
  // - Track room creation trends
  // - Send notifications to admins
  // - Update tenant usage quotas
}

/**
 * Process room deletion events
 * Use cases: Cleanup, archival, analytics
 */
async function processChatRoomDeleted(event: EventBridgeEvent<string, any>): Promise<void> {
  const { tenantId, roomId, roomName, roomType, userId, timestamp } = event.detail;
  
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Processing room deletion',
    tenantId,
    roomId,
    roomName,
    roomType,
    deletedBy: userId,
    timestamp,
    metric: {
      name: 'ChatRoomDeleted',
      value: 1,
      unit: 'Count',
      dimensions: {
        TenantId: tenantId,
        RoomType: roomType,
      },
    },
  }));

  // TODO: Add custom processing logic here:
  // - Archive room data
  // - Clean up resources
  // - Update analytics
}

/**
 * Emit CloudWatch metrics
 */
function emitMetrics(eventType: string, tenantId: string): void {
  console.log(JSON.stringify({
    level: 'METRIC',
    metric: {
      name: 'ChatEventProcessed',
      value: 1,
      unit: 'Count',
      dimensions: {
        EventType: eventType,
        TenantId: tenantId,
      },
    },
  }));
}


