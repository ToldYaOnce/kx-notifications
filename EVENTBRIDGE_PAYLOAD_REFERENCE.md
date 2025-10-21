# EventBridge Payload Reference

## What We Send to EventBridge

### Complete Format

```typescript
await eventBridge.putEvents({
  Entries: [{
    EventBusName: 'KxGen-events-bus',     // ✅ From env var EVENT_BUS_NAME
    Source: 'kx-event-tracking',          // ✅ Matches exactly
    DetailType: 'chat.message',           // ✅ Matches exactly
    Detail: JSON.stringify({
      channelId: "b4064348-aa08-4434-9aff-ebf86d2ba2d0",
      userId: "1478d468-d0a1-70e4-ec4f-f380529a6265",
      userName: "David Glass",
      message: "asdasdasd",
      tenantId: "tenant_1757418497028_g9o6mnb4m",
      messageId: "1729346400000-xyz123",
      timestamp: "2025-10-19T13:45:00.000Z",
      connectionId: "abc123xyz",
      messageType: "text"
    }),
    Time: new Date("2025-10-19T13:45:00.000Z")
  }]
});
```

---

## Field Mapping

### What Client Sends (WebSocket)
```json
{
  "type": "chat.message",
  "channelId": "b4064348-aa08-4434-9aff-ebf86d2ba2d0",
  "userId": "1478d468-d0a1-70e4-ec4f-f380529a6265",
  "userName": "David Glass",
  "message": "asdasdasd",
  "tenantId": "tenant_1757418497028_g9o6mnb4m"
}
```

### What Goes to EventBridge
```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.message",
  "Detail": {
    "channelId": "b4064348-aa08-4434-9aff-ebf86d2ba2d0",  // ✅ Same as client
    "userId": "1478d468-d0a1-70e4-ec4f-f380529a6265",
    "userName": "David Glass",
    "message": "asdasdasd",
    "tenantId": "tenant_1757418497028_g9o6mnb4m",
    "messageId": "1729346400000-xyz123",                  // ✅ Added by Lambda
    "timestamp": "2025-10-19T13:45:00.000Z",              // ✅ Added by Lambda
    "connectionId": "abc123xyz",                          // ✅ Added by Lambda
    "messageType": "text"                                 // ✅ Added by Lambda
  }
}
```

### What Consumer Stack Receives (EXACT MATCH ✅)
```typescript
{
  channelId: "b4064348-aa08-4434-9aff-ebf86d2ba2d0",
  userId: "1478d468-d0a1-70e4-ec4f-f380529a6265",
  userName: "David Glass",
  message: "asdasdasd",
  tenantId: "tenant_1757418497028_g9o6mnb4m"
  // Plus our additional metadata fields
}
```

---

## All Event Types

### 1. chat.message

**Required Fields:**
- `channelId` ✅
- `userId` ✅
- `userName` ✅
- `message` ✅
- `tenantId` ✅

**Added by Lambda:**
- `messageId`
- `timestamp`
- `connectionId`
- `messageType`

---

### 2. chat.join

**Required Fields:**
- `channelId` ✅
- `userId` ✅
- `userName` ✅
- `tenantId` ✅

**Added by Lambda:**
- `timestamp`
- `connectionId`

---

### 3. chat.leave

**Required Fields:**
- `channelId` ✅
- `userId` ✅
- `userName` ✅
- `tenantId` ✅

**Added by Lambda:**
- `timestamp`
- `connectionId`

---

## Zero Conversion!

```
Client → Lambda → EventBridge → Consumer
  ↓        ↓         ↓            ↓
channelId → channelId → channelId → channelId

NO MAPPING ANYWHERE! ✅
```

---

## Code Locations

### Publishing Code
- **File:** `src/chat/chat-handlers.ts`
- **Function:** `handleChatMessage()` (line ~236)
- **Utility:** `src/utils/eventbridge-publisher.ts`

### Consumer Code (Other Stack)
- Receives events with `channelId` field
- No conversion needed
- Direct database write

---

## Testing

### Send Test Message

```javascript
ws.send(JSON.stringify({
  type: 'chat.message',
  channelId: 'test-channel',
  userId: 'user123',
  userName: 'Test User',
  message: 'Hello EventBridge!',
  tenantId: 'tenant_test'
}));
```

### Check CloudWatch Logs

**Look for:**
```json
{
  "message": "Chat event published to EventBridge",
  "eventType": "chat.message",
  "tenantId": "tenant_test"
}
```

### Verify in Consumer Stack

Consumer should receive:
```json
{
  "channelId": "test-channel",
  "userId": "user123",
  "userName": "Test User",
  "message": "Hello EventBridge!",
  "tenantId": "tenant_test"
}
```

---

## Summary

✅ **No more `roomId` anywhere**  
✅ **Everything uses `channelId`**  
✅ **No conversion/mapping logic**  
✅ **Client → EventBridge → Consumer: All use same field names**  
✅ **Deployed and live**  

The "where the fuck is the conversion happening" problem is **completely eliminated**! 🎉


