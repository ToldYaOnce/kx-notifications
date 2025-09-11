# Migration from QrEventConsumerStack to NotificationsStack

This document outlines the migration from the original QR-only event processor to the new real-time notifications system with WebSocket support.

## 🔄 What Changed

### Package Name
- **Old**: `kxgen-new-lead-handlers`
- **New**: `@toldyaonce/kx-notifications`

### Stack Name
- **Old**: `QrEventConsumerStack`
- **New**: `NotificationsStack` (deployed as `KxGenNotificationsStack`)

### Architecture Evolution
- **Old**: EventBridge → Lambda (QR processing only)
- **New**: EventBridge → Notifier Lambda → WebSocket API → Connected Clients

### Event Scope
- **Old**: QR events only (`qr.get`, `qr.*`)
- **New**: Multi-family events (`qr.*`, `payment.*`, `user.*`, `notification.*`)

## 📦 Code Migration

### Import Changes

```typescript
// Old
import { QrEventConsumerStack } from './lib/qr-event-consumer-stack';

// New
import { NotificationsStack } from './lib/notifications-stack';
```

### Stack Instantiation

```typescript
// Old
new QrEventConsumerStack(app, 'QrEventConsumerStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

// New
new NotificationsStack(app, 'KxGenNotificationsStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  environment: process.env.ENVIRONMENT || 'dev',
  // Optional: assumeRoleArn for cross-account setup
});
```

## 🚀 Deployment Strategy

### Option 1: Side-by-Side Deployment (Recommended)

1. **Deploy new stack** alongside existing one:
   ```bash
   cdk deploy KxGenNotificationsStack
   ```

2. **Test WebSocket functionality** with existing events

3. **Update client applications** to connect to WebSocket API

4. **Remove old stack** when satisfied:
   ```bash
   cdk destroy QrEventConsumerStack
   ```

### Option 2: Direct Replacement

1. **Destroy old stack**:
   ```bash
   cdk destroy QrEventConsumerStack
   ```

2. **Deploy new stack**:
   ```bash
   cdk deploy KxGenNotificationsStack
   ```

## 🔧 Configuration Changes

### Environment Variables

**New environment variables** for the Notifier Lambda:
- `CONNECTIONS_TABLE` - DynamoDB connections table name
- `WEBSOCKET_API_ID` - WebSocket API ID
- `WEBSOCKET_STAGE` - WebSocket API stage
- `ASSUME_ROLE_ARN` - Optional cross-account role

### EventBridge Pattern

**Old pattern** (QR only):
```typescript
eventPattern: EventBridgeDiscovery.createEventPattern({
  entityTypes: ['qr'],
  eventTypes: ['qr.get'],
})
```

**New pattern** (Multi-family):
```typescript
eventPattern: {
  source: ['kx-event-tracking'],
  detailType: [
    { prefix: 'qr.' },
    { prefix: 'payment.' },
    { prefix: 'user.' },
    { prefix: 'notification.' },
  ],
}
```

## 📊 Output Changes

### Old Output (Direct Processing)
The QR processor directly processed events and logged them:

```typescript
console.log('QR Event received:', {
  eventId: event.detail.eventId,
  clientId: event.detail.clientId,
  qrId: event.detail.entityId,
  formId: event.detail.metadata?.formId
});
```

### New Output (WebSocket Notifications)
Events are transformed into notification payloads and sent to WebSocket clients:

```json
{
  "type": "notification",
  "family": "qr",
  "at": "2025-01-03T15:04:11.944Z",
  "data": {
    "eventId": "uuid",
    "tenantId": "acme",
    "entityId": "qr_123",
    "entityType": "qr",
    "eventType": "qr.get",
    "occurredAt": "2025-01-03T15:04:11.944Z",
    "metadata": {
      "formId": "form_456"
    }
  }
}
```

## 🆕 New Resources

The NotificationsStack creates additional AWS resources:

### DynamoDB Table
- **Name**: `kxgen-{env}-connections`
- **Purpose**: Track active WebSocket connections
- **Keys**: `tenantId` (PK), `connectionId` (SK)

### WebSocket API
- **Type**: API Gateway v2 WebSocket API
- **Routes**: `$connect`, `$disconnect`, `$default`
- **Stage**: `prod` with auto-deploy

### Lambda Functions
- **OnConnect**: Handle WebSocket connections
- **OnDisconnect**: Handle WebSocket disconnections  
- **OnMessage**: Handle WebSocket messages
- **Notifier**: EventBridge → WebSocket broadcaster

### SSM Parameters
- `/kxgen/ws/public-wss` - Public WebSocket URL
- `/kxgen/ws/management-endpoint` - Management API endpoint
- `/kxgen/ws/connections-table` - DynamoDB table name

## 🔒 Permissions Changes

### Old Permissions
- EventBridge → Lambda invocation
- Lambda basic execution role

### New Permissions
- EventBridge → Notifier Lambda invocation
- Notifier Lambda → DynamoDB read access
- Notifier Lambda → API Gateway WebSocket management
- Connect/Disconnect Lambdas → DynamoDB write access
- Optional: Cross-account role assumption (STS)

## 🧪 Testing Migration

### 1. Verify EventBridge Integration
```bash
# Test event should trigger WebSocket notifications
aws events put-events --entries '[
  {
    "Source": "kx-event-tracking",
    "DetailType": "qr.scanned",
    "Detail": "{\"tenantId\":\"test\",\"entityId\":\"qr_123\",\"entityType\":\"qr\",\"eventType\":\"qr.get\"}"
  }
]'
```

### 2. Test WebSocket Connection
```javascript
const ws = new WebSocket('wss://your-api-id.execute-api.region.amazonaws.com/prod?tenantId=test&userId=user1');
ws.onmessage = (event) => {
  console.log('Notification:', JSON.parse(event.data));
};
```

### 3. Verify Multi-Family Support
```bash
# Test payment event
aws events put-events --entries '[
  {
    "Source": "kx-event-tracking", 
    "DetailType": "payment.completed",
    "Detail": "{\"tenantId\":\"test\",\"entityId\":\"pay_123\",\"entityType\":\"payment\",\"eventType\":\"payment.completed\"}"
  }
]'
```

## ⚠️ Breaking Changes

1. **Stack Name**: Must update deployment scripts and references
2. **Event Processing**: No longer direct Lambda processing - events go to WebSocket clients
3. **Dependencies**: New AWS SDK v3 dependencies required
4. **Client Integration**: Must implement WebSocket client to receive notifications
5. **Monitoring**: New Lambda functions and CloudWatch log groups

## 🔄 Rollback Plan

If issues arise during migration:

1. **Keep old stack running** during testing phase
2. **Switch EventBridge rules** back to old Lambda if needed
3. **Maintain both stacks** until confident in new system
4. **Document any custom logic** that needs to be preserved

## 📞 Support

For migration assistance:
- Review the comprehensive README.md
- Check CloudWatch logs for any deployment issues
- Verify EventBridge discovery is working (KxGenStack must be deployed first)
- Test WebSocket connectivity before removing old stack

## ✅ Migration Checklist

- [ ] Deploy NotificationsStack alongside existing QrEventConsumerStack
- [ ] Verify EventBridge rule is triggering Notifier Lambda
- [ ] Test WebSocket connection with valid tenantId/userId
- [ ] Confirm notifications are received for test events
- [ ] Update client applications to use WebSocket API
- [ ] Monitor CloudWatch logs for any errors
- [ ] Verify multi-family event support (QR, payments, users, etc.)
- [ ] Test cross-account setup if applicable
- [ ] Remove old QrEventConsumerStack when satisfied
- [ ] Update deployment scripts and documentation

The migration transforms your simple QR event processor into a powerful real-time notification system that can handle multiple event types and deliver instant WebSocket notifications to connected clients! 🚀


