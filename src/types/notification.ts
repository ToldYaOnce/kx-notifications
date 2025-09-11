/**
 * Notification payload sent to WebSocket clients
 */
export interface NotificationPayload {
  type: 'notification';
  family: string; // 'scan', 'payment', 'user', 'notification'
  at: string; // ISO timestamp
  data: {
    eventId: string;
    tenantId: string;
    entityId?: string;
    entityType?: string;
    eventType?: string;
    occurredAt?: string;
    metadata?: Record<string, any>;
    // Original event for debugging/development
    originalEvent?: any;
  };
}

