import { EventBridgeEvent } from 'aws-lambda';
import { NotificationPayload } from '../types/notification';

/**
 * Create a notification payload from an EventBridge event
 */
export function createNotificationPayload(event: EventBridgeEvent<string, any>): NotificationPayload {
  // Extract basic information from the event
  const eventSource = event.source;
  const eventDetailType = event['detail-type'];
  const eventDetail = event.detail;

  // Generate a basic notification based on event type
  let title = 'New Event';
  let content = `Event ${eventDetailType} occurred`;
  let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';

  // Customize based on event detail type
  switch (eventDetailType) {
    case 'qr.get':
      title = '🔍 QR Code Accessed';
      content = `QR code ${eventDetail.qrId || 'unknown'} was accessed`;
      priority = 'low';
      break;
    
    case 'qr.scanned':
      title = '📱 QR Code Scanned';
      content = `QR code ${eventDetail.qrId || 'unknown'} was scanned`;
      priority = 'medium';
      break;
    
    case 'qr.created':
      title = '✨ QR Code Created';
      content = `New QR code ${eventDetail.qrId || 'unknown'} was created`;
      priority = 'low';
      break;
    
    case 'notification.sent':
      title = '📤 Notification Sent';
      content = 'A notification has been sent';
      priority = 'low';
      break;
    
    case 'notification.delivered':
      title = '✅ Notification Delivered';
      content = 'A notification has been delivered';
      priority = 'low';
      break;
    
    case 'payment.completed':
      title = '💳 Payment Completed';
      content = `Payment of $${eventDetail.amount || '0.00'} completed`;
      priority = 'high';
      break;
    
    case 'payment.failed':
      title = '❌ Payment Failed';
      content = `Payment of $${eventDetail.amount || '0.00'} failed`;
      priority = 'critical';
      break;
    
    case 'user.login':
      title = '👋 User Login';
      content = `User ${eventDetail.username || eventDetail.userId || 'unknown'} logged in`;
      priority = 'low';
      break;
    
    case 'user.logout':
      title = '👋 User Logout';
      content = `User ${eventDetail.username || eventDetail.userId || 'unknown'} logged out`;
      priority = 'low';
      break;
    
    case 'form.submitted':
      title = '📝 Form Submitted';
      content = `Form ${eventDetail.formName || eventDetail.formId || 'unknown'} was submitted`;
      priority = 'medium';
      break;
    
    default:
      // Use the detail type as the title for unknown events
      title = `${eventDetailType.replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
      content = `Event ${eventDetailType} occurred`;
      priority = 'medium';
  }

  return {
    type: 'notification',
    family: eventSource.replace(/^kx-/, '').replace(/-/g, '_'),
    at: new Date().toISOString(),
    data: {
      eventId: event.id,
      tenantId: eventDetail?.tenantId || 'unknown',
      entityId: eventDetail?.entityId || eventDetail?.qrId || eventDetail?.userId,
      entityType: eventDetailType.split('.')[0],
      eventType: eventDetailType,
      occurredAt: event.time,
      metadata: eventDetail,
      originalEvent: event
    }
  };
}

/**
 * Extract tenant ID from event detail
 */
export function extractTenantId(eventDetail: any): string | null {
  // Try common tenant ID field names
  return eventDetail.tenantId || 
         eventDetail.tenant_id || 
         eventDetail.organizationId || 
         eventDetail.organization_id || 
         null;
}

/**
 * Extract user ID from event detail
 */
export function extractUserId(eventDetail: any): string | null {
  // Try common user ID field names
  return eventDetail.userId || 
         eventDetail.user_id || 
         eventDetail.username || 
         eventDetail.email || 
         null;
}

/**
 * Extract client ID from event detail
 */
export function extractClientId(eventDetail: any): string | null {
  // Try common client ID field names
  return eventDetail.clientId || 
         eventDetail.client_id || 
         eventDetail.deviceId || 
         eventDetail.device_id || 
         null;
}

/**
 * Determine if an event should trigger a notification
 */
export function shouldNotify(event: EventBridgeEvent<string, any>): boolean {
  // Skip internal AWS events
  if (event.source.startsWith('aws.')) {
    return false;
  }

  // Skip test events
  if (event.source === 'test' || event['detail-type'].includes('test')) {
    return false;
  }

  // Allow all other events
  return true;
}

/**
 * Get notification priority based on event type
 */
export function getNotificationPriority(eventDetailType: string): 'low' | 'medium' | 'high' | 'critical' {
  // Critical events
  if (eventDetailType.includes('failed') || 
      eventDetailType.includes('error') || 
      eventDetailType.includes('critical')) {
    return 'critical';
  }

  // High priority events
  if (eventDetailType.includes('payment') || 
      eventDetailType.includes('order') || 
      eventDetailType.includes('alert')) {
    return 'high';
  }

  // Low priority events
  if (eventDetailType.includes('login') || 
      eventDetailType.includes('logout') || 
      eventDetailType.includes('view') || 
      eventDetailType.includes('get')) {
    return 'low';
  }

  // Default to medium priority
  return 'medium';
}
