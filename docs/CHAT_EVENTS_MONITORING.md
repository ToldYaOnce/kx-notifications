# Chat Events Monitoring Guide

## Overview

Chat events are published to EventBridge and consumed by a dedicated Lambda function for analytics, monitoring, and integrations.

## Architecture

```
WebSocket → onMessage Lambda → EventBridge (kx-event-tracking)
                ↓                    ↓
            DynamoDB           Chat Event Consumer Lambda
                ↓                    ↓
          WebSocket Broadcast    CloudWatch Logs/Metrics
```

## Event Types

### Chat Message Events
```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.message",
  "Detail": {
    "tenantId": "string",
    "channelId": "string",
    "userId": "string",
    "userName": "string",
    "message": "string",
    "messageId": "string",
    "timestamp": "ISO 8601",
    "connectionId": "string",
    "messageType": "text"
  }
}
```

### Chat Join Events
```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.join",
  "Detail": {
    "tenantId": "string",
    "channelId": "string",
    "userId": "string",
    "userName": "string",
    "roomName": "string",
    "roomType": "public|private|dm",
    "timestamp": "ISO 8601",
    "connectionId": "string"
  }
}
```

### Chat Leave Events
```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.leave",
  "Detail": {
    "tenantId": "string",
    "channelId": "string",
    "userId": "string",
    "userName": "string",
    "timestamp": "ISO 8601",
    "connectionId": "string"
  }
}
```

### Room Management Events
```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.createRoom",
  "Detail": {
    "tenantId": "string",
    "channelId": "string",
    "roomName": "string",
    "roomType": "public|private",
    "userId": "string",
    "userName": "string",
    "memberCount": number,
    "timestamp": "ISO 8601",
    "action": "create"
  }
}
```

## CloudWatch Metrics

### Embedded Metrics Format

All chat event logs include CloudWatch Embedded Metrics Format (EMF) for automatic metric generation:

```json
{
  "level": "INFO",
  "message": "Chat event published to EventBridge",
  "eventType": "chat.message",
  "tenantId": "acme",
  "userId": "user123",
  "duration": "15ms",
  "metric": {
    "name": "ChatEventPublished",
    "value": 1,
    "unit": "Count",
    "dimensions": {
      "EventType": "chat.message",
      "TenantId": "acme"
    }
  }
}
```

### Available Metrics

| Metric Name | Description | Dimensions |
|------------|-------------|------------|
| `ChatEventPublished` | Event successfully published to EventBridge | EventType, TenantId |
| `ChatEventPublishFailed` | Event failed to publish | EventType, TenantId, ErrorType |
| `ChatEventProcessed` | Event successfully processed by consumer | EventType, TenantId |
| `ChatMessage` | Message sent | TenantId, RoomId |
| `ChatJoin` | User joined room | TenantId, RoomId |
| `ChatLeave` | User left room | TenantId, RoomId |
| `ChatRoomCreated` | Room created | TenantId, RoomType |
| `ChatRoomDeleted` | Room deleted | TenantId, RoomType |

## CloudWatch Logs Insights Queries

### Find All Chat Messages for a Room

```sql
fields @timestamp, detail.userName, detail.message, detail.messageId
| filter `detail-type` = "chat.message"
| filter detail.roomId = "your-room-id"
| sort @timestamp desc
| limit 100
```

### Track User Activity

```sql
fields @timestamp, `detail-type` as eventType, detail.roomId, detail.roomName
| filter detail.userId = "user-id"
| filter `detail-type` in ["chat.message", "chat.join", "chat.leave"]
| sort @timestamp desc
```

### Room Creation Trends

```sql
fields @timestamp, detail.roomName, detail.roomType, detail.userId
| filter `detail-type` = "chat.createRoom"
| stats count() by bin(5m) as time, detail.roomType
| sort time desc
```

### Message Volume by Tenant

```sql
fields @timestamp, detail.tenantId
| filter `detail-type` = "chat.message"
| stats count() as messageCount by detail.tenantId
| sort messageCount desc
```

### Failed Event Publishing

```sql
fields @timestamp, eventType, error, tenantId
| filter level = "ERROR"
| filter message = "Failed to publish chat event to EventBridge"
| stats count() by eventType
```

### Event Processing Latency

```sql
fields @timestamp, eventType, duration
| filter message = "Chat event published to EventBridge"
| parse duration /(?<latency>\d+)ms/
| stats avg(latency) as avgLatency, max(latency) as maxLatency, count() as events by eventType
```

### Active Users in Last Hour

```sql
fields @timestamp, detail.userId, detail.userName
| filter `detail-type` in ["chat.message", "chat.join"]
| filter @timestamp > ago(1h)
| stats count() by detail.userId, detail.userName
| sort count() desc
```

### Top Active Rooms

```sql
fields @timestamp, detail.roomId, detail.roomName
| filter `detail-type` = "chat.message"
| filter @timestamp > ago(24h)
| stats count() as messages by detail.roomId, detail.roomName
| sort messages desc
| limit 20
```

## Monitoring Best Practices

### 1. Set Up CloudWatch Alarms

```typescript
// Example: Alert when event publishing fails
new cloudwatch.Alarm(this, 'ChatEventPublishFailureAlarm', {
  metric: new cloudwatch.Metric({
    namespace: 'ChatEvents',
    metricName: 'ChatEventPublishFailed',
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 10,
  evaluationPeriods: 2,
  alarmDescription: 'Alert when chat events fail to publish to EventBridge',
});
```

### 2. Monitor DLQ Depth

```typescript
const chatEventDLQ = Queue.fromQueueArn(/* ... */);
new cloudwatch.Alarm(this, 'ChatEventDLQAlarm', {
  metric: chatEventDLQ.metricApproximateNumberOfMessagesVisible(),
  threshold: 1,
  evaluationPeriods: 1,
  alarmDescription: 'Alert when messages appear in chat event DLQ',
});
```

### 3. Track Event Processing Duration

Monitor Lambda duration metrics for the Chat Event Consumer:
- p50, p95, p99 latencies
- Throttling errors
- Cold start frequency

## Troubleshooting

### Events Not Being Published

1. Check Lambda logs for `onMessage` function
2. Look for "Failed to publish chat event to EventBridge" errors
3. Verify IAM permissions for `events:PutEvents`
4. Check EventBridge bus name environment variable

### Events Published But Not Consumed

1. Check EventBridge rule is active
2. Verify rule event pattern matches your events
3. Check Chat Event Consumer Lambda logs
4. Look for messages in the DLQ

### High Latency

1. Check Lambda cold starts
2. Review EventBridge to Lambda invocation time
3. Monitor DynamoDB response times
4. Check for throttling

## Custom Integrations

The Chat Event Consumer Lambda can be extended for custom use cases:

```typescript
// Example: Send webhook for every message
async function processChatMessage(event: EventBridgeEvent<string, any>) {
  const { tenantId, roomId, message } = event.detail;
  
  // Send to external webhook
  await fetch('https://your-webhook.com/chat-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'chat.message',
      tenantId,
      roomId,
      message,
      timestamp: new Date().toISOString(),
    }),
  });
}
```

## Cost Optimization

- EventBridge events: $1.00 per million events
- Lambda invocations: Covered by free tier for moderate usage
- CloudWatch Logs: $0.50 per GB ingested
- DLQ storage: Minimal cost for failures

**Estimated cost for 1M messages/month:**
- EventBridge: ~$1.00
- Lambda: ~$0.20 (256MB, 100ms avg)
- CloudWatch Logs: ~$2.50 (5KB per event)
- **Total: ~$3.70/month**


