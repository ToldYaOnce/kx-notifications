# Breaking Changes - channelId Standardization

## Overview

**Date:** October 19, 2025  
**Change:** Standardized all chat APIs to use `channelId` instead of `roomId`

## What Changed

### Before (Inconsistent ❌)
- WebSocket API used `roomId`
- EventBridge used `channelId`
- Mapping happened inside Lambda (confusing!)

### After (Consistent ✅)
- **Everything uses `channelId`**
- No mapping needed
- Clear and maintainable

## Impact on Clients

### WebSocket Messages (BREAKING CHANGE)

**Old Format:**
```json
{
  "type": "chat.message",
  "roomId": "general",        // ❌ Old field name
  "userId": "user123",
  "message": "Hello"
}
```

**New Format:**
```json
{
  "type": "chat.message",
  "channelId": "general",     // ✅ New field name
  "userId": "user123",
  "message": "Hello"
}
```

### All Affected Message Types

Update these fields in your client code:

| Message Type | Old Field | New Field |
|-------------|-----------|-----------|
| `chat.join` | `roomId` | `channelId` |
| `chat.message` | `roomId` | `channelId` |
| `chat.leave` | `roomId` | `channelId` |
| `chat.startDM` | *(unchanged)* | *(unchanged)* |
| `chat.userJoined` | `roomId` | `channelId` |
| `chat.userLeft` | `roomId` | `channelId` |
| `chat.joined` | `roomId` | `channelId` |
| `chat.left` | `roomId` | `channelId` |

### Migration Example

**JavaScript/TypeScript Client:**
```diff
function sendMessage(roomId, message) {
  ws.send(JSON.stringify({
    type: 'chat.message',
-   roomId: roomId,
+   channelId: roomId,  // Just rename the field
    userId: currentUserId,
    userName: currentUserName,
    message: message
  }));
}

function joinRoom(roomId) {
  ws.send(JSON.stringify({
    type: 'chat.join',
-   roomId: roomId,
+   channelId: roomId,  // Just rename the field
    userId: currentUserId,
    userName: currentUserName
  }));
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'chat.message':
-     console.log(`Message in ${msg.roomId}: ${msg.message}`);
+     console.log(`Message in ${msg.channelId}: ${msg.message}`);
      break;
  }
};
```

## Internal Changes

### DynamoDB Connection Record

**Field renamed:**
```diff
{
  "tenantId": "acme",
  "connectionId": "xyz123",
- "chatRooms": ["general", "support"],
+ "chatChannels": ["general", "support"],
  // ...
}
```

### EventBridge Events

**No change needed** - Already using `channelId` ✅

## Deployment

This change was deployed on October 19, 2025.

**Stack:** `KxGenNotificationsStack`  
**Version:** 2.0 (channelId standardization)

## Rollback

If you need to rollback, you can:

1. Revert to previous commit
2. Change all `channelId` back to `roomId` in client code
3. Redeploy the old version

**Not recommended** - Better to update clients once than maintain confusing dual naming.

## Questions?

The change eliminates the "where the fuck is the conversion happening" problem by removing all conversions. Everything is now `channelId` everywhere.

## Checklist for Client Updates

- [ ] Update message sending code to use `channelId`
- [ ] Update channel join/leave code to use `channelId`
- [ ] Update message handler to expect `channelId` in broadcasts
- [ ] Update any channel/room selectors to use `channelId`
- [ ] Test all chat functionality
- [ ] Deploy updated client code

---

**TL;DR:** Find and replace `roomId` with `channelId` in your client code. That's it! 🎯


