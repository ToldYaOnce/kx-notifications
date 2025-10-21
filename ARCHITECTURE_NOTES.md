# Architecture Notes

## Terminology: `channelId` vs `roomId`

**Decision:** Use `channelId` everywhere for consistency.

### Why `channelId`?

1. **Consistency with Consumer Stack** - The storage stack expects `channelId`
2. **No Mapping Confusion** - Same field name everywhere eliminates "where's the conversion?" questions
3. **Scalable Terminology** - "Channel" is more generic than "room" (supports chat rooms, notification channels, etc.)
4. **Single Source of Truth** - One name, one concept

### What Changed

**Before (Inconsistent):**
```
WebSocket API: roomId → Lambda: roomId → EventBridge: channelId ❌ Confusing!
```

**After (Consistent):**
```
WebSocket API: channelId → Lambda: channelId → EventBridge: channelId ✅ Clear!
```

### Client Contract

Clients should use `channelId` in all chat operations:

**Join a channel:**
```json
{
  "type": "chat.join",
  "channelId": "general",
  "userId": "user123",
  "userName": "John Doe"
}
```

**Send a message:**
```json
{
  "type": "chat.message",
  "channelId": "general",
  "userId": "user123",
  "userName": "John Doe",
  "message": "Hello!"
}
```

**Leave a channel:**
```json
{
  "type": "chat.leave",
  "channelId": "general",
  "userId": "user123"
}
```

### Internal Implementation

**Connection Record (DynamoDB):**
```typescript
interface ConnectionRecord {
  tenantId: string;
  connectionId: string;
  chatChannels?: string[];  // ✅ Uses "chatChannels"
  // ...
}
```

**EventBridge Events:**
```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.message",
  "Detail": {
    "channelId": "general",  // ✅ Uses "channelId"
    "userId": "user123",
    "message": "Hello!"
  }
}
```

**WebSocket Broadcasts:**
```json
{
  "type": "chat.message",
  "channelId": "general",  // ✅ Uses "channelId"
  "userId": "user123",
  "message": "Hello!"
}
```

### No More Mapping!

All layers use the same field name:
- ✅ Client sends `channelId`
- ✅ Lambda receives `channelId`
- ✅ EventBridge receives `channelId`
- ✅ Storage stack receives `channelId`
- ✅ Clients receive `channelId` in broadcasts

### Migration Note

If you have existing clients using `roomId`, they need to update to `channelId`. This is a **breaking change** but necessary for long-term maintainability.

**Simple client update:**
```diff
ws.send(JSON.stringify({
  type: 'chat.message',
- roomId: 'general',
+ channelId: 'general',
  userId: 'user123',
  message: 'Hello'
}));
```


