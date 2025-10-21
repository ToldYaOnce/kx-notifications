# EventBridge Integration Summary

## Overview

This document describes the comprehensive EventBridge integration for the KxGen Notifications & Chat Platform. All chat events are now published to EventBridge for analytics, monitoring, and external integrations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Chat Event Flow                              │
└─────────────────────────────────────────────────────────────────┘

Client WebSocket → onMessage Lambda → DynamoDB (save) → EventBridge
                                              ↓              ↓
                                    WebSocket Broadcast    Chat Event
                                                          Consumer Lambda
                                                              ↓
                                                    Analytics/Integrations
```

## Published Events

### Event Types

| Event Type | Trigger | Published From |
|-----------|---------|----------------|
| `chat.message` | User sends message | `chat-handlers.ts::handleChatMessage` |
| `chat.join` | User joins room | `chat-handlers.ts::handleChatJoin` |
| `chat.leave` | User leaves room | `chat-handlers.ts::handleChatLeave` |
| `chat.createRoom` | Room created | `room-management.ts::createChatRoom` |
| `chat.deleteRoom` | Room archived | `room-management.ts::deleteChatRoom` |

### Event Structure

All events follow this structure:

```typescript
{
  Source: 'kx-event-tracking',
  DetailType: 'chat.{eventType}',
  EventBusName: '<kx-event-bus-name>',
  Time: new Date(timestamp),
  Detail: {
    tenantId: string;
    userId: string;
    userName?: string;
    timestamp: string; // ISO 8601
    connectionId?: string;
    // Event-specific fields...
  }
}
```

## Implementation Details

### 1. EventBridge Publisher Utility

**Location:** `src/utils/eventbridge-publisher.ts`

**Features:**
- Centralized event publishing logic
- Automatic error handling and logging
- Built-in CloudWatch metrics (EMF format)
- Support for batch publishing
- TypeScript type safety

**Usage:**
```typescript
import { publishChatEvent, ChatMessageEventDetail } from '../utils/eventbridge-publisher';

await publishChatEvent('chat.message', {
  tenantId,
  roomId,
  userId,
  userName,
  message,
  messageId,
  timestamp,
  connectionId,
  messageType: 'text',
} as ChatMessageEventDetail);
```

### 2. Chat Event Consumer

**Location:** `src/chat/chat-event-consumer.ts`

**Purpose:**
- Analytics and metrics collection
- Audit logging
- External integrations (webhooks, notifications)
- Data pipelines

**Lambda Configuration:**
- Runtime: Node.js 18.x
- Memory: 512 MB
- Timeout: 30 seconds
- DLQ: Dedicated Dead Letter Queue with 14-day retention

### 3. Infrastructure (CDK)

**Location:** `lib/notifications-stack.ts`

**Components:**
- EventBridge rule matching chat events
- Lambda function for event consumption
- Dead Letter Queue for failed events
- IAM permissions for EventBridge publishing

## Metrics and Monitoring

### Published Metrics

All metrics use CloudWatch Embedded Metrics Format (EMF):

| Metric | Description | Dimensions |
|--------|-------------|------------|
| `ChatEventPublished` | Successful publishes | EventType, TenantId |
| `ChatEventPublishFailed` | Failed publishes | EventType, TenantId, ErrorType |
| `ChatEventProcessed` | Events consumed | EventType, TenantId |
| `ChatMessage` | Messages sent | TenantId, RoomId |
| `ChatJoin` | Room joins | TenantId, RoomId |
| `ChatLeave` | Room leaves | TenantId, RoomId |
| `ChatRoomCreated` | Rooms created | TenantId, RoomType |
| `ChatRoomDeleted` | Rooms deleted | TenantId, RoomType |

### Monitoring Dashboard

Access CloudWatch Logs Insights with queries from `docs/CHAT_EVENTS_MONITORING.md`:
- Message volume by tenant
- User activity tracking
- Room creation trends
- Failed publishing attempts
- Processing latency analysis

## Error Handling

### Publishing Failures

- **Non-blocking:** EventBridge publish failures don't block WebSocket message delivery
- **Logged:** All failures are logged with full context
- **Retried:** Infrastructure retries (via EventBridge native retries)

### Consumer Failures

- **DLQ:** Failed events sent to dedicated Dead Letter Queue
- **Retry Policy:** 2 retry attempts with exponential backoff
- **Max Age:** Events older than 5 minutes are discarded

## Environment Variables

| Variable | Purpose | Set In |
|----------|---------|--------|
| `EVENT_BUS_NAME` | EventBridge bus name | `onMessageFunction` Lambda |

## IAM Permissions

### onMessage Lambda
```json
{
  "Effect": "Allow",
  "Action": ["events:PutEvents"],
  "Resource": ["arn:aws:events:region:account:event-bus/kx-event-tracking"]
}
```

### Chat Event Consumer Lambda
- Basic Lambda execution role
- CloudWatch Logs write access

## Performance Characteristics

### Latency
- EventBridge publish: ~15-50ms
- Lambda invocation: ~5-20ms (warm)
- Total overhead: ~20-70ms per event

### Throughput
- EventBridge: Unlimited (soft limit: 10,000 TPS per account)
- Lambda concurrency: 1000 default (can be increased)

### Cost (per 1M events)
- EventBridge: $1.00
- Lambda invocations: $0.20
- CloudWatch Logs: $2.50
- **Total: ~$3.70/month**

## Testing

### Manual Testing

1. **Send a chat message:**
```javascript
ws.send(JSON.stringify({
  type: 'chat.message',
  channelId: 'test-room',
  userId: 'user123',
  userName: 'Test User',
  message: 'Hello World'
}));
```

2. **Check CloudWatch Logs:**
- OnMessage Lambda: Look for "Chat event published to EventBridge"
- Chat Event Consumer: Look for "Chat event received"

3. **Verify in EventBridge:**
```bash
aws events put-events \
  --entries '[{
    "Source": "kx-event-tracking",
    "DetailType": "chat.message",
    "Detail": "{\"tenantId\":\"test\",\"roomId\":\"room1\",\"userId\":\"user1\",\"message\":\"test\"}"
  }]'
```

### Integration Testing

See `test/notifications-stack.test.ts` for CDK infrastructure tests.

## Migration Notes

### Breaking Changes
- None! This is additive functionality.

### Deployment Steps
1. `npm run build` - Compile TypeScript
2. `cdk diff` - Review changes
3. `cdk deploy` - Deploy infrastructure
4. Monitor CloudWatch Logs for first events

## Future Enhancements

### Potential Extensions
1. **Message Search:** Index messages in OpenSearch/Elasticsearch
2. **Content Moderation:** AI-based content filtering
3. **Analytics Dashboard:** Real-time chat analytics UI
4. **Webhooks:** Configurable webhooks per tenant
5. **Data Export:** S3 archival for compliance
6. **ML Features:** Sentiment analysis, topic detection

### Scaling Considerations
- **High Volume:** Consider SQS buffer between EventBridge and Lambda
- **Multi-Region:** Replicate events across regions for global analytics
- **Long-Term Storage:** Move to S3 for historical data (> 90 days)

## Support

For questions or issues:
1. Check CloudWatch Logs for errors
2. Review DLQ for failed events
3. Consult `docs/CHAT_EVENTS_MONITORING.md` for troubleshooting
4. Check EventBridge rule status in AWS Console

## Related Documentation

- [`CHAT_USAGE.md`](../CHAT_USAGE.md) - Client-side chat usage
- [`CHAT_EVENTS_MONITORING.md`](./CHAT_EVENTS_MONITORING.md) - Monitoring guide
- [`README.md`](../README.md) - Main project documentation


