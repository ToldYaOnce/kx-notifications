import { PutEventsCommand, PutEventsCommandInput } from '@aws-sdk/client-eventbridge';
import { getEventBridgeClient } from './aws-clients';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;

/**
 * Chat event types that can be published to EventBridge
 */
export type ChatEventType = 
  | 'chat.message'
  | 'chat.join'
  | 'chat.leave'
  | 'chat.createRoom'
  | 'chat.deleteRoom'
  | 'chat.editMessage'
  | 'chat.deleteMessage';

/**
 * Base interface for all chat events
 */
export interface BaseChatEvent {
  tenantId: string;
  userId: string;
  userName?: string;
  timestamp: string;
  connectionId?: string;
}

/**
 * Chat message event detail
 */
export interface ChatMessageEventDetail extends BaseChatEvent {
  roomId: string;
  message: string;
  messageId?: string;
  messageType?: 'text' | 'system' | 'file' | 'image';
}

/**
 * Chat join/leave event detail
 */
export interface ChatRoomMembershipEventDetail extends BaseChatEvent {
  roomId: string;
  roomName?: string;
  roomType?: string;
}

/**
 * Chat room management event detail
 */
export interface ChatRoomManagementEventDetail extends BaseChatEvent {
  roomId: string;
  roomName?: string;
  roomType?: 'public' | 'private' | 'dm';
  memberCount?: number;
  action?: string;
}

/**
 * Publish a chat event to EventBridge
 */
export async function publishChatEvent(
  eventType: ChatEventType,
  detail: BaseChatEvent | ChatMessageEventDetail | ChatRoomMembershipEventDetail | ChatRoomManagementEventDetail,
  options?: {
    skipMetrics?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  const startTime = Date.now();
  
  try {
    const eventBridgeClient = getEventBridgeClient();
    
    const input: PutEventsCommandInput = {
      Entries: [{
        Source: 'kx-event-tracking',
        DetailType: eventType,
        Detail: JSON.stringify(detail),
        EventBusName: EVENT_BUS_NAME,
        Time: new Date(detail.timestamp),
      }],
    };
    
    const response = await eventBridgeClient.send(new PutEventsCommand(input));
    
    const duration = Date.now() - startTime;
    
    // Check for failed entries
    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      console.log(JSON.stringify({
        level: 'ERROR',
        message: 'EventBridge publish failed',
        eventType,
        tenantId: detail.tenantId,
        userId: detail.userId,
        failedCount: response.FailedEntryCount,
        entries: response.Entries,
        duration: `${duration}ms`,
      }));
      
      return {
        success: false,
        error: `Failed to publish ${response.FailedEntryCount} entries`,
      };
    }
    
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Chat event published to EventBridge',
      eventType,
      tenantId: detail.tenantId,
      userId: detail.userId,
      duration: `${duration}ms`,
      metric: {
        name: 'ChatEventPublished',
        value: 1,
        unit: 'Count',
        dimensions: {
          EventType: eventType,
          TenantId: detail.tenantId,
        },
      },
    }));
    
    return { success: true };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to publish chat event to EventBridge',
      eventType,
      tenantId: detail.tenantId,
      userId: detail.userId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration: `${duration}ms`,
      metric: {
        name: 'ChatEventPublishFailed',
        value: 1,
        unit: 'Count',
        dimensions: {
          EventType: eventType,
          TenantId: detail.tenantId,
          ErrorType: error instanceof Error ? error.name : 'Unknown',
        },
      },
    }));
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Publish multiple chat events in a batch
 */
export async function publishChatEventBatch(
  events: Array<{
    eventType: ChatEventType;
    detail: BaseChatEvent | ChatMessageEventDetail | ChatRoomMembershipEventDetail | ChatRoomManagementEventDetail;
  }>
): Promise<{ success: boolean; successCount: number; failedCount: number }> {
  const startTime = Date.now();
  
  try {
    const eventBridgeClient = getEventBridgeClient();
    
    const input: PutEventsCommandInput = {
      Entries: events.map(({ eventType, detail }) => ({
        Source: 'kx-event-tracking',
        DetailType: eventType,
        Detail: JSON.stringify(detail),
        EventBusName: EVENT_BUS_NAME,
        Time: new Date(detail.timestamp),
      })),
    };
    
    const response = await eventBridgeClient.send(new PutEventsCommand(input));
    
    const duration = Date.now() - startTime;
    const failedCount = response.FailedEntryCount || 0;
    const successCount = events.length - failedCount;
    
    console.log(JSON.stringify({
      level: failedCount > 0 ? 'WARN' : 'INFO',
      message: 'Chat event batch published to EventBridge',
      totalEvents: events.length,
      successCount,
      failedCount,
      duration: `${duration}ms`,
    }));
    
    return {
      success: failedCount === 0,
      successCount,
      failedCount,
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.log(JSON.stringify({
      level: 'ERROR',
      message: 'Failed to publish chat event batch to EventBridge',
      totalEvents: events.length,
      error: error instanceof Error ? error.message : String(error),
      duration: `${duration}ms`,
    }));
    
    return {
      success: false,
      successCount: 0,
      failedCount: events.length,
    };
  }
}


