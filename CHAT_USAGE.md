# Full Chat Platform Usage Guide

This document provides comprehensive information about using the **full-featured chat platform** in the KxGen Notifications WebSocket API.

## 🏗️ Overview

The chat platform provides:
- **Persistent message storage** - All messages stored forever
- **Room management** - Create, list, join, leave, delete rooms
- **Message history** - Load previous conversations with pagination
- **Message operations** - Edit, delete, search messages
- **Real-time communication** - Live chat with WebSocket push
- **Multi-room support** - Join multiple rooms simultaneously

## 🔌 Connection

Chat uses the same WebSocket connection as notifications:

```javascript
const ws = new WebSocket(`wss://your-api-id.execute-api.region.amazonaws.com/prod?tenantId=acme&userId=agent-1`);
```

## 💬 Message Types

### 📤 Client to Server

#### Room Management

**Create Room**
```javascript
{
  "type": "chat.createRoom",
  "roomName": "Project Alpha",
  "roomType": "public", // or "private"
  "description": "Discussion for Project Alpha",
  "members": ["user456", "user789"], // For private rooms only
  "userId": "user123",
  "userName": "John Doe"
}
```

**List Rooms**
```javascript
{
  "type": "chat.listRooms",
  "userId": "user123",
  "roomType": "public" // Optional: filter by type
}
```

**Delete Room**
```javascript
{
  "type": "chat.deleteRoom",
  "channelId": "public-1696789012345-abc123def",
  "userId": "user123"
}
```

#### Room Operations

**Join Room**
```javascript
{
  "type": "chat.join",
  "channelId": "general",
  "userId": "user123",
  "userName": "John Doe"
}
```

**Leave Room**
```javascript
{
  "type": "chat.leave",
  "channelId": "general",
  "userId": "user123"
}
```

**Start Direct Message**
```javascript
{
  "type": "chat.startDM",
  "userId": "user123",
  "targetUserId": "user456",
  "userName": "John Doe"
}
```

#### Message Operations

**Send Message**
```javascript
{
  "type": "chat.message",
  "channelId": "general",
  "userId": "user123",
  "userName": "John Doe",
  "message": "Hello everyone!",
  "messageType": "text", // Optional: "text", "system", "file", "image"
  "replyToMessageId": "1696789012345-abc123def" // Optional: for threading
}
```

**Get Message History**
```javascript
{
  "type": "chat.getHistory",
  "channelId": "general",
  "userId": "user123",
  "limit": 50,
  "startFromMessageId": "1696789012345-abc123def" // Optional: for pagination
}
```

**Edit Message**
```javascript
{
  "type": "chat.editMessage",
  "channelId": "general",
  "messageId": "1696789012345-abc123def",
  "userId": "user123",
  "newMessage": "Updated message content"
}
```

**Delete Message**
```javascript
{
  "type": "chat.deleteMessage",
  "channelId": "general",
  "messageId": "1696789012345-abc123def",
  "userId": "user123"
}
```

**Search Messages**
```javascript
{
  "type": "chat.searchMessages",
  "userId": "user123",
  "query": "project deadline",
  "channelId": "general", // Optional: search specific room
  "limit": 20
}
```

### 📥 Server to Client

#### Room Management Responses

**Room Created**
```javascript
{
  "type": "chat.roomCreated",
  "success": true,
  "room": {
    "channelId": "public-1696789012345-abc123def",
    "roomName": "Project Alpha",
    "roomType": "public",
    "createdBy": "user123",
    "createdAt": "2025-01-03T15:04:11.944Z",
    "memberCount": 1,
    "description": "Discussion for Project Alpha"
  },
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Room List**
```javascript
{
  "type": "chat.roomList",
  "success": true,
  "rooms": [
    {
      "channelId": "general",
      "roomName": "General Discussion",
      "roomType": "public",
      "memberCount": 15,
      "lastActivity": "2025-01-03T15:04:11.944Z",
      "createdBy": "admin",
      "createdAt": "2025-01-01T10:00:00.000Z"
    }
  ],
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Room Deleted**
```javascript
{
  "type": "chat.roomDeleted",
  "success": true,
  "channelId": "public-1696789012345-abc123def",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

#### Message History & Operations

**Message History**
```javascript
{
  "type": "chat.messageHistory",
  "success": true,
  "channelId": "general",
  "messages": [
    {
      "messageId": "1696789012345-abc123def",
      "userId": "user456",
      "userName": "Jane Smith",
      "message": "Hello everyone!",
      "timestamp": "2025-01-03T15:04:11.944Z",
      "messageType": "text"
    }
  ],
  "hasMore": false,
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Message Edited**
```javascript
{
  "type": "chat.messageEdited",
  "success": true,
  "channelId": "general",
  "messageId": "1696789012345-abc123def",
  "message": {
    "messageId": "1696789012345-abc123def",
    "message": "Updated content",
    "editedAt": "2025-01-03T15:04:11.944Z"
  },
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Message Deleted**
```javascript
{
  "type": "chat.messageDeleted",
  "success": true,
  "channelId": "general",
  "messageId": "1696789012345-abc123def",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Search Results**
```javascript
{
  "type": "chat.searchResults",
  "success": true,
  "query": "project deadline",
  "messages": [
    {
      "messageId": "1696789012345-abc123def",
      "channelId": "general",
      "userId": "user456",
      "userName": "Jane Smith",
      "message": "The project deadline is next Friday",
      "timestamp": "2025-01-03T15:04:11.944Z"
    }
  ],
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

#### Real-time Events

**Message Received**
```javascript
{
  "type": "chat.message",
  "channelId": "general",
  "userId": "user456",
  "userName": "Jane Smith",
  "message": "Hello back!",
  "messageId": "1696789012345-abc123def",
  "timestamp": "2025-01-03T15:04:11.944Z",
  "messageType": "text"
}
```

**User Joined**
```javascript
{
  "type": "chat.userJoined",
  "channelId": "general",
  "userId": "user789",
  "userName": "Bob Wilson",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**User Left**
```javascript
{
  "type": "chat.userLeft",
  "channelId": "general",
  "userId": "user789",
  "userName": "Bob Wilson",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Join Confirmation**
```javascript
{
  "type": "chat.joined",
  "channelId": "general",
  "room": {
    "channelId": "general",
    "roomName": "General Discussion",
    "roomType": "public",
    "memberCount": 16
  },
  "message": "Successfully joined room: General Discussion",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Leave Confirmation**
```javascript
{
  "type": "chat.left",
  "channelId": "general",
  "message": "Successfully left room: general",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

**Error**
```javascript
{
  "type": "chat.error",
  "channelId": "private-room",
  "error": "Not authorized to join this room",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

## 🏠 Room Types

### Public Rooms
- **Access**: Anyone in the tenant can join
- **Creation**: Created via `chat.createRoom` with `roomType: "public"`
- **Room ID**: Auto-generated (e.g., `public-1696789012345-abc123def`)
- **Features**: Persistent, searchable, room history

### Private Rooms
- **Access**: Only invited members can join
- **Creation**: Created via `chat.createRoom` with `roomType: "private"` and `members` array
- **Room ID**: Auto-generated (e.g., `private-1696789012345-abc123def`)
- **Features**: Member management, invitation-only, persistent history

### Direct Messages
- **Access**: Only two specific users can participate
- **Creation**: Auto-created via `chat.startDM` or manual `chat.join`
- **Room ID**: Deterministic format: `dm-{userId1}-{userId2}` (sorted alphabetically)
- **Features**: 1-on-1 conversations, automatic room creation

### 🔑 Creating Room IDs

```javascript
// For direct messages between two users (deterministic)
function createDirectMessageRoomId(userId1, userId2) {
  return `dm-${[userId1, userId2].sort().join('-')}`;
}

// Examples:
createDirectMessageRoomId('alice', 'bob'); // "dm-alice-bob"
createDirectMessageRoomId('bob', 'alice'); // "dm-alice-bob" (same result)

// Public/Private rooms use auto-generated IDs:
// "public-1696789012345-abc123def"
// "private-1696789012345-xyz789ghi"
```

## 💻 Example Implementation

```javascript
class FullChatClient {
  constructor(wsUrl, tenantId, userId, userName) {
    this.ws = new WebSocket(`${wsUrl}?tenantId=${tenantId}&userId=${userId}`);
    this.userId = userId;
    this.userName = userName;
    this.joinedRooms = new Set();
    this.rooms = new Map(); // Store room details
    this.messageHistory = new Map(); // Store message history per room
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
  }
  
  handleMessage(message) {
    switch (message.type) {
      // Real-time events
      case 'chat.message':
        this.displayMessage(message);
        this.addToHistory(message.roomId, message);
        break;
      case 'chat.userJoined':
        this.displayUserJoined(message);
        break;
      case 'chat.userLeft':
        this.displayUserLeft(message);
        break;
      
      // Room management responses
      case 'chat.roomCreated':
        if (message.success && message.room) {
          this.rooms.set(message.room.roomId, message.room);
          console.log(`Room created: ${message.room.roomName}`);
        }
        break;
      case 'chat.roomList':
        if (message.success && message.rooms) {
          message.rooms.forEach(room => {
            this.rooms.set(room.roomId, room);
          });
          console.log(`Loaded ${message.rooms.length} rooms`);
        }
        break;
      case 'chat.joined':
        this.joinedRooms.add(message.roomId);
        if (message.room) {
          this.rooms.set(message.roomId, message.room);
        }
        console.log(`Joined room: ${message.room?.roomName || message.roomId}`);
        break;
      case 'chat.left':
        this.joinedRooms.delete(message.roomId);
        console.log(`Left room: ${message.roomId}`);
        break;
      
      // Message management responses
      case 'chat.messageHistory':
        if (message.success && message.messages) {
          this.loadMessageHistory(message.roomId, message.messages);
          console.log(`Loaded ${message.messages.length} messages for ${message.roomId}`);
        }
        break;
      case 'chat.messageEdited':
        if (message.success) {
          console.log(`Message edited in ${message.roomId}`);
        }
        break;
      case 'chat.messageDeleted':
        if (message.success) {
          console.log(`Message deleted in ${message.roomId}`);
        }
        break;
      case 'chat.searchResults':
        if (message.success && message.messages) {
          console.log(`Found ${message.messages.length} messages for "${message.query}"`);
          this.displaySearchResults(message.messages);
        }
        break;
      
      case 'chat.error':
        console.error(`Chat error: ${message.error}`);
        break;
    }
  }
  
  // Room Management
  createRoom(roomName, roomType = 'public', description = '', members = []) {
    this.ws.send(JSON.stringify({
      type: 'chat.createRoom',
      roomName,
      roomType,
      description,
      members,
      userId: this.userId,
      userName: this.userName
    }));
  }
  
  listRooms(roomType = null) {
    this.ws.send(JSON.stringify({
      type: 'chat.listRooms',
      userId: this.userId,
      roomType
    }));
  }
  
  deleteRoom(roomId) {
    this.ws.send(JSON.stringify({
      type: 'chat.deleteRoom',
      roomId,
      userId: this.userId
    }));
  }
  
  // Room Operations
  joinRoom(roomId) {
    this.ws.send(JSON.stringify({
      type: 'chat.join',
      roomId,
      userId: this.userId,
      userName: this.userName
    }));
  }
  
  leaveRoom(roomId) {
    this.ws.send(JSON.stringify({
      type: 'chat.leave',
      roomId,
      userId: this.userId
    }));
  }
  
  startDirectMessage(targetUserId) {
    this.ws.send(JSON.stringify({
      type: 'chat.startDM',
      userId: this.userId,
      targetUserId,
      userName: this.userName
    }));
  }
  
  // Message Operations
  sendMessage(roomId, message, replyToMessageId = null) {
    if (!this.joinedRooms.has(roomId)) {
      console.error(`Not in room: ${roomId}`);
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'chat.message',
      roomId,
      userId: this.userId,
      userName: this.userName,
      message,
      messageType: 'text',
      replyToMessageId
    }));
  }
  
  getMessageHistory(roomId, limit = 50, startFromMessageId = null) {
    this.ws.send(JSON.stringify({
      type: 'chat.getHistory',
      roomId,
      userId: this.userId,
      limit,
      startFromMessageId
    }));
  }
  
  editMessage(roomId, messageId, newMessage) {
    this.ws.send(JSON.stringify({
      type: 'chat.editMessage',
      roomId,
      messageId,
      userId: this.userId,
      newMessage
    }));
  }
  
  deleteMessage(roomId, messageId) {
    this.ws.send(JSON.stringify({
      type: 'chat.deleteMessage',
      roomId,
      messageId,
      userId: this.userId
    }));
  }
  
  searchMessages(query, roomId = null, limit = 20) {
    this.ws.send(JSON.stringify({
      type: 'chat.searchMessages',
      userId: this.userId,
      query,
      roomId,
      limit
    }));
  }
  
  // Helper Methods
  addToHistory(roomId, message) {
    if (!this.messageHistory.has(roomId)) {
      this.messageHistory.set(roomId, []);
    }
    this.messageHistory.get(roomId).push(message);
  }
  
  loadMessageHistory(roomId, messages) {
    this.messageHistory.set(roomId, messages);
  }
  
  displayMessage(message) {
    const roomName = this.rooms.get(message.roomId)?.roomName || message.roomId;
    const editedFlag = message.editedAt ? ' (edited)' : '';
    console.log(`[${roomName}] ${message.userName}: ${message.message}${editedFlag}`);
  }
  
  displayUserJoined(message) {
    const roomName = this.rooms.get(message.roomId)?.roomName || message.roomId;
    console.log(`[${roomName}] ${message.userName} joined the room`);
  }
  
  displayUserLeft(message) {
    const roomName = this.rooms.get(message.roomId)?.roomName || message.roomId;
    console.log(`[${roomName}] ${message.userName} left the room`);
  }
  
  displaySearchResults(messages) {
    messages.forEach(msg => {
      const roomName = this.rooms.get(msg.roomId)?.roomName || msg.roomId;
      console.log(`[${roomName}] ${msg.userName}: ${msg.message} (${msg.timestamp})`);
    });
  }
}

// Usage Example
const chat = new FullChatClient(
  'wss://your-api-id.execute-api.region.amazonaws.com/prod',
  'acme',
  'user123',
  'John Doe'
);

// Initialize: List available rooms
chat.listRooms();

// Create a new project room
chat.createRoom('Project Alpha', 'public', 'Discussion for Project Alpha');

// Join a room and load history
chat.joinRoom('general');
chat.getMessageHistory('general', 50);

// Send a message
chat.sendMessage('general', 'Hello everyone!');

// Start a direct message
chat.startDirectMessage('user456');

// Search for messages
chat.searchMessages('project deadline');

// Edit a message (you need the messageId from the message history)
// chat.editMessage('general', '1696789012345-abc123def', 'Updated message');

// Delete a message
// chat.deleteMessage('general', '1696789012345-abc123def');
```

## 🔒 Security & Authorization

### Tenant Isolation
- **Complete separation**: Users can only access rooms and messages within their tenant
- **Data isolation**: All DynamoDB operations include tenant-based filtering
- **Cross-tenant protection**: No data leakage between tenants

### Room-Based Authorization
- **Public rooms**: Anyone in the tenant can join and participate
- **Private rooms**: Only invited members can join and see messages
- **Direct messages**: Only the two specified users can participate
- **Room creation**: Any user can create public rooms, private rooms require member specification

### Message Security
- **Ownership validation**: Users can only edit/delete their own messages
- **Room membership**: Messages only sent to authorized room members
- **Soft deletes**: Deleted messages are marked as deleted, not permanently removed
- **Edit history**: Message edits are tracked with timestamps

### Connection Security
- **WebSocket authentication**: Existing tenant/user validation applies
- **Connection state**: Room membership tied to active connections
- **Stale connection cleanup**: Automatic removal of disconnected users

## 🏗️ Platform Capabilities

### ✅ **Implemented Features**
- **Persistent message storage** - All messages stored forever
- **Room management** - Create, list, join, leave, delete rooms
- **Message history** - Load previous conversations with pagination
- **Message operations** - Edit, delete, search messages
- **Real-time communication** - Live WebSocket messaging
- **Multi-room support** - Join multiple rooms simultaneously
- **Message threading** - Reply to specific messages
- **Full-text search** - Search across all accessible messages
- **Soft deletes** - Messages archived, not permanently deleted
- **Room types** - Public, private, and direct message rooms
- **Tenant isolation** - Complete data separation
- **Authorization** - Room-based access control

### 🕰️ **Future Enhancements**
- **User presence indicators** - Online/offline status
- **Typing indicators** - Real-time typing notifications
- **File sharing** - Upload and share files in messages
- **Message reactions** - Emoji reactions to messages
- **Push notifications** - Mobile/desktop notifications
- **Message formatting** - Rich text, markdown support
- **Voice messages** - Audio message support
- **Video calls** - Integrated video calling
- **Screen sharing** - Share screens in rooms
- **Message encryption** - End-to-end encryption
- **Admin controls** - Moderation and admin features
- **Analytics** - Usage statistics and insights

## 🔧 Troubleshooting

### Common Issues

1. **Messages not appearing**
   - Ensure you've joined the room before sending messages
   - Check that the WebSocket connection is active
   - Verify the room ID is correct
   - For private rooms, ensure you're an invited member

2. **Cannot join room**
   - For DM rooms, ensure your userId is part of the room ID
   - For private rooms, check that you're in the members list
   - Verify your WebSocket connection is authenticated
   - Check room exists by listing rooms first

3. **Message history not loading**
   - Ensure you've joined the room before requesting history
   - Check the room ID is correct
   - Verify you have access to the room
   - Try with a smaller limit parameter

4. **Cannot edit/delete messages**
   - Ensure you own the message (same userId)
   - Check the messageId is correct
   - Verify the message hasn't already been deleted
   - Ensure you're still in the room

5. **Room creation fails**
   - Check room name is not empty
   - For private rooms, ensure members array is valid
   - Verify you have permission to create rooms
   - Check for duplicate room names (if applicable)

6. **Search not working**
   - Ensure query is not empty
   - Check you have access to the rooms being searched
   - Try with a simpler search term
   - Verify the room filter (if used) is correct

### Debug Tips

- **Enable detailed logging**: Log all WebSocket messages for debugging
- **Check browser Network tab**: Verify WebSocket connection status
- **Validate message format**: Ensure JSON structure matches API specification
- **Test incrementally**: Start with basic operations (list rooms, join, send message)
- **Use room list**: Always list rooms first to see available rooms
- **Check message history**: Load history to see persistent messages
- **Monitor real-time events**: Watch for join/leave notifications
- **Test with different room types**: Try public, private, and DM rooms

### Performance Considerations

- **Message history pagination**: Use reasonable limits (50-100 messages)
- **Search query optimization**: Use specific search terms for better performance
- **Room membership**: Leave rooms you're not actively using
- **Connection management**: Handle reconnections gracefully
- **Error handling**: Implement retry logic for failed operations

## 📚 API Reference

### Complete Message Type Reference

| Message Type | Direction | Purpose | Persistence |
|--------------|-----------|---------|-------------|
| `chat.createRoom` | Client → Server | Create new room | ✅ Room stored |
| `chat.listRooms` | Client → Server | List accessible rooms | ✅ From storage |
| `chat.deleteRoom` | Client → Server | Archive room | ✅ Soft delete |
| `chat.join` | Client → Server | Join room | ✅ Membership tracked |
| `chat.leave` | Client → Server | Leave room | ✅ Membership updated |
| `chat.startDM` | Client → Server | Start direct message | ✅ Auto-creates DM room |
| `chat.message` | Client → Server | Send message | ✅ Message stored |
| `chat.getHistory` | Client → Server | Get message history | ✅ From storage |
| `chat.editMessage` | Client → Server | Edit message | ✅ Edit tracked |
| `chat.deleteMessage` | Client → Server | Delete message | ✅ Soft delete |
| `chat.searchMessages` | Client → Server | Search messages | ✅ From storage |
| `chat.roomCreated` | Server → Client | Room creation result | - |
| `chat.roomList` | Server → Client | Room list response | - |
| `chat.roomDeleted` | Server → Client | Room deletion result | - |
| `chat.messageHistory` | Server → Client | Message history response | - |
| `chat.messageEdited` | Server → Client | Message edit result | - |
| `chat.messageDeleted` | Server → Client | Message delete result | - |
| `chat.searchResults` | Server → Client | Search results response | - |
| `chat.message` | Server → Client | Real-time message | - |
| `chat.userJoined` | Server → Client | User joined notification | - |
| `chat.userLeft` | Server → Client | User left notification | - |
| `chat.joined` | Server → Client | Join confirmation | - |
| `chat.left` | Server → Client | Leave confirmation | - |
| `chat.error` | Server → Client | Error response | - |

### Data Storage

- **Messages**: Stored forever in `chat-messages` table
- **Rooms**: Stored in `chat-rooms` table with soft delete
- **Connections**: Temporary storage in `connections` table with TTL
- **Search**: Full-text search across all stored messages
- **History**: Paginated access to all historical messages

For complete implementation details, see the main README.md file and TypeScript interfaces in `src/types/chat.ts`.

## 💻 Examples & Resources

### Interactive Examples
- **`examples/chat-client-example.html`** - Complete working chat client
- **`src/types/chat.ts`** - Full TypeScript interface definitions
- **`README.md`** - Complete platform documentation

### Code Examples
- **Basic chat client** - Simple message sending and receiving
- **Full platform client** - Complete room and message management
- **Room management** - Create, list, join, leave rooms
- **Message operations** - History, edit, delete, search
- **Real-time events** - Handle live chat notifications

### Testing
1. Open `examples/chat-client-example.html` in your browser
2. Connect to your WebSocket endpoint
3. Test room creation, joining, messaging
4. Try message history, editing, and search
5. Test with multiple browser tabs for real-time chat

### Integration
- Use the `FullChatClient` class as a starting point
- Customize message handling for your UI framework
- Implement proper error handling and reconnection logic
- Add UI components for room lists, message history, and search
- Consider implementing offline message queuing

This **full-featured chat platform** provides enterprise-grade real-time communication with persistent storage, comprehensive room management, and advanced message operations. The robust API design makes it easy to integrate with any frontend framework, mobile app, or desktop application while maintaining scalability and security.

**Key Benefits:**
- ✅ **Zero data loss** - All messages stored permanently
- ✅ **Scalable architecture** - Built on AWS serverless technologies
- ✅ **Complete feature set** - Room management, message operations, search
- ✅ **Real-time + persistence** - Live chat with full conversation history
- ✅ **Enterprise security** - Tenant isolation and role-based access
- ✅ **Developer friendly** - Comprehensive TypeScript interfaces and documentation