# Debugging agent.tonality.shifted Events Not Reaching Client

## Quick Debug Queries

Run these queries in CloudWatch Logs Insights to trace the flow:

### 1. Check if events are being received
```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /agent\.tonality\.shifted/
| sort @timestamp desc
| limit 50
```

### 2. Check connection querying
```sql
fields @timestamp, @message
| parse @message '"connectionCount":*' as connectionCount
| parse @message '"detailType":"*"' as detailType
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /Found connections for tenant/ and @message like /agent\.tonality\.shifted/
| sort @timestamp desc
```

### 3. Check connection filtering
```sql
fields @timestamp, @message
| parse @message '"originalConnectionCount":*' as originalConnectionCount
| parse @message '"filteredConnectionCount":*' as filteredConnectionCount
| parse @message '"detailType":"*"' as detailType
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /Connection filtering results/ and @message like /agent\.tonality\.shifted/
| sort @timestamp desc
```

### 4. Check if events are being sent
```sql
fields @timestamp, @message
| parse @message '"successfulSends":*' as successfulSends
| parse @message '"failedSends":*' as failedSends
| parse @message '"detailType":"*"' as detailType
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /Lambda handler execution completed successfully/
| filter @message like /agent\.tonality\.shifted/ or @message like /"notificationFamily":"agent"/
| sort @timestamp desc
```

### 5. Check for send attempts (new detailed logging)
```sql
fields @timestamp, @message
| parse @message '"connectionId":"*"' as connectionId
| parse @message '"detailType":"*"' as detailType
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /Sending tonality event to connection/ or @message like /Successfully sent tonality event/
| sort @timestamp desc
```

### 6. Full trace for a specific event
```sql
fields @timestamp, @message
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /"eventId":"YOUR_EVENT_ID_HERE"/
| sort @timestamp asc
```

## Common Issues to Check

### Issue 1: Events not being received
- **Symptom**: No "Processing agent event" logs for tonality events
- **Check**: EventBridge rule subscription
- **Fix**: Verify `AgentEventsRule` includes `agent.tonality.shifted`

### Issue 2: No connections found
- **Symptom**: "No active connections found for tenant" logs
- **Check**: Connections table has active connections for tenant
- **Fix**: Ensure client is connected via WebSocket

### Issue 3: Connections filtered out
- **Symptom**: `filteredConnectionCount = 0` but `originalConnectionCount > 0`
- **Check**: Connection filtering logic (should NOT filter agent events)
- **Note**: Agent events bypass subscription filtering - check connection-filter.ts

### Issue 4: Sends failing silently
- **Symptom**: `successfulSends = 0` or errors in logs
- **Check**: API Gateway Management API permissions
- **Check**: Connection IDs are valid
- **Check**: Stale connections being removed

### Issue 5: Payload structure issues
- **Check**: Payload family should be `agent` (from `kxgen.agent` source)
- **Check**: Payload type should be `notification`
- **Check**: `payload.data.eventType` should be `agent.tonality.shifted`
- **Check**: `payload.data.metadata` should contain full event detail

## What the Payload Should Look Like

```json
{
  "type": "notification",
  "family": "agent",
  "at": "2024-01-01T12:00:00.000Z",
  "data": {
    "eventId": "...",
    "tenantId": "...",
    "entityId": "...",
    "entityType": "agent",
    "eventType": "agent.tonality.shifted",
    "occurredAt": "2024-01-01T12:00:00.000Z",
    "metadata": {
      // Full event detail including:
      "shift": {
        "interestDelta": ...,
        "conversionDelta": ...,
        "toneChanged": ...,
        "direction": ...,
        "magnitude": ...
      },
      "conversationAverages": {
        "avgInterestLevel": ...,
        "avgConversionLikelihood": ...,
        "dominantEmotionalTone": ...
      },
      // ... all other fields from event.detail
    },
    "originalEvent": { ... }
  }
}
```

## Recent Changes

- Added payload logging for agent events (line 736)
- Added detailed send logging for tonality events (lines 910-920, 26-50)
- Agent events bypass subscription filtering (connection-filter.ts lines 56-87)

