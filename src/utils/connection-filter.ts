import { EventBridgeEvent } from 'aws-lambda';
import { ConnectionRecord } from '../types/connection';

/**
 * Extract event family from event detail type
 */
function extractEventFamily(eventDetailType: string): string {
  return eventDetailType.split('.')[0];
}

/**
 * Filter connections based on event conditions
 * Add your custom filtering logic here
 */
export function filterConnectionsByEvent(connections: ConnectionRecord[], event: EventBridgeEvent<string, any>): ConnectionRecord[] {
  // Example 1: Filter by specific tenantIds for certain event types
  if (event['detail-type'] === 'payment.completed') {
    // Only send payment notifications to premium tenants
    const premiumTenants = ['tenant_premium_1', 'tenant_premium_2', 'tenant_vip'];
    const eventTenantId = event.detail.tenantId || event.detail.clientId;
    
    if (!premiumTenants.includes(eventTenantId)) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Payment event filtered - not a premium tenant',
        tenantId: eventTenantId,
        eventType: event['detail-type'],
      }));
      return []; // No connections should receive this
    }
  }
  
  // Example 2: Filter by user roles (using enhanced connection metadata)
  if (event['detail-type'].startsWith('admin.')) {
    // Only send admin events to admin users
    return connections.filter(conn => {
      return conn.userRole === 'admin';
    });
  }
  
  // Example 3: Filter by event metadata
  if (event.detail.metadata?.priority === 'high') {
    // High priority events go to all connections
    return connections;
  } else if (event.detail.metadata?.priority === 'low') {
    // Low priority events only go to users who opted in
    return connections.filter(conn => {
      return conn.priority === 'high' || conn.priority === 'normal';
    });
  }
  
  // Example 5: Filter by subscription preferences
  const eventFamily = extractEventFamily(event['detail-type']);
  const subscribedConnections = connections.filter(conn => {
    // If no subscriptions specified, assume they want all notifications
    if (!conn.subscriptions || conn.subscriptions.length === 0) {
      return true;
    }
    // Check if user subscribed to this event family
    return conn.subscriptions.includes(eventFamily);
  });
  
  if (subscribedConnections.length < connections.length) {
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Filtered connections by subscription preferences',
      eventFamily,
      originalCount: connections.length,
      subscribedCount: subscribedConnections.length,
    }));
    return subscribedConnections;
  }
  
  // Example 4: Filter by specific entity ownership
  if (event.detail.entityType === 'scan' && event.detail.metadata?.userId) {
    // Only send scan events to the user who performed the scan
    const scanUserId = event.detail.metadata.userId;
    return connections.filter(conn => conn.userId === scanUserId);
  }
  
  // Default: Send to all connections (current behavior)
  return connections;
}

