# @toldyaonce/kx-notifications

**Dual-purpose WebSocket API**: Real-time notifications + chat functionality. A single WebSocket connection handles both EventBridge notifications and peer-to-peer chat messaging.

## 🎯 Architecture Overview

```
EventBridge → Notifier Lambda → WebSocket API → Connected Clients
     ↑              ↓               ↓
Event Publishers   DynamoDB    Client Dashboard
                (Connections)   (Toast Notifications)

Client Messages → Message Handler → Chat Handlers → WebSocket API → Room Members
     ↑              ↓               ↓               ↓
Chat Clients     DynamoDB      Room Logic      Real-time Chat
              (Room Membership)
```

### Components

- **WebSocket API**: API Gateway v2 WebSocket API for real-time client connections
- **DynamoDB**: Tracks active WebSocket connections + chat room memberships per tenant
- **Notifier Lambda**: Consumes EventBridge events and broadcasts to WebSocket clients
- **Chat Handlers**: Process chat messages, room joins/leaves, and user-to-user messaging
- **Connection Handlers**: Manage WebSocket lifecycle (connect/disconnect/message routing)

## 📦 Dependencies

- **@toldyaonce/kx-event-consumers** - EventBridge discovery and consumer utilities
- **aws-cdk-lib** - AWS CDK v2
- **AWS SDK v3** - DynamoDB, API Gateway Management, STS clients

## 🚀 Quick Start

### 1. Deploy the Stack

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Deploy (requires KxGenStack to be deployed first for EventBridge discovery)
cdk deploy KxGenNotificationsStack

# Or with specific environment
ENVIRONMENT=prod cdk deploy KxGenNotificationsStack
```

### 2. Connect a WebSocket Client

#### For Existing Notification-Only Clients (No Changes Required)

```javascript
// Connect to the WebSocket API (UNCHANGED)
const wsUrl = 'wss://your-api-id.execute-api.region.amazonaws.com/prod';
const ws = new WebSocket(`${wsUrl}?tenantId=acme&userId=agent-1`);

ws.onopen = () => {
  console.log('Connected to notifications');
};

// UNCHANGED: Existing notification handling continues to work
ws.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  console.log('Notification received:', notification);
  
  // Show toast notification in UI
  showToast(notification);
};

function showToast(notification) {
  // Example notification structure (UNCHANGED):
  // {
  //   type: 'notification',
  //   family: 'qr',
  //   at: '2025-01-03T15:04:11.944Z',
  //   data: {
  //     eventId: 'uuid',
  //     tenantId: 'acme',
  //     entityId: 'qr_123',
  //     entityType: 'qr',
  //     eventType: 'qr.get',
  //     occurredAt: '2025-01-03T15:04:11.944Z',
  //     metadata: { formId: 'form_456' }
  //   }
  // }
  
  const message = `${notification.family.toUpperCase()}: ${notification.data.eventType}`;
  // Your toast implementation here
  alert(message);
}
```

#### For New Dual-Purpose Clients (Notifications + Chat)

```javascript
// Same connection setup
const wsUrl = 'wss://your-api-id.execute-api.region.amazonaws.com/prod';
const ws = new WebSocket(`${wsUrl}?tenantId=acme&userId=agent-1`);

ws.onopen = () => {
  console.log('Connected to notifications and chat');
  
  // NEW: Optionally join chat rooms after connecting
  joinChatRoom('general');
  startDirectMessage('other-user-id');
};

// ENHANCED: Handle both notifications and chat messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'notification':
      // UNCHANGED: Existing notification handling
      showToast(message);
      break;
      
    // NEW: Chat message types
    case 'chat.message':
      displayChatMessage(message);
      break;
      
    case 'chat.userJoined':
      showUserJoined(message);
      break;
      
    case 'chat.userLeft':
      showUserLeft(message);
      break;
      
    case 'chat.joined':
      console.log(`Successfully joined room: ${message.roomId}`);
      break;
      
    case 'chat.left':
      console.log(`Successfully left room: ${message.roomId}`);
      break;
      
    case 'chat.error':
      console.error(`Chat error: ${message.error}`);
      break;
      
    default:
      console.log('Unknown message type:', message.type);
  }
};

// NEW: Chat functions
function joinChatRoom(roomId) {
  ws.send(JSON.stringify({
    type: 'chat.join',
    channelId: roomId,
    userId: 'agent-1',
    userName: 'Agent Smith'
  }));
}

function startDirectMessage(targetUserId) {
  ws.send(JSON.stringify({
    type: 'chat.startDM',
    userId: 'agent-1',
    targetUserId: targetUserId,
    userName: 'Agent Smith'
  }));
}

function sendChatMessage(roomId, message) {
  ws.send(JSON.stringify({
    type: 'chat.message',
    channelId: roomId,
    userId: 'agent-1',
    userName: 'Agent Smith',
    message: message
  }));
}

function displayChatMessage(msg) {
  console.log(`[${msg.roomId}] ${msg.userName}: ${msg.message}`);
  // Add to your chat UI
}

function showUserJoined(msg) {
  console.log(`${msg.userName} joined ${msg.roomId}`);
}

function showUserLeft(msg) {
  console.log(`${msg.userName} left ${msg.roomId}`);
}
```

### 3. Test with EventBridge Event

```bash
# Publish a test notification event
aws events put-events --entries '[
  {
    "Source": "kx-event-tracking",
    "DetailType": "scan.completed",
    "Detail": "{\"tenantId\":\"acme\",\"entityId\":\"scan_123\",\"entityType\":\"scan\",\"eventType\":\"scan.completed\",\"occurredAt\":\"2025-01-03T15:04:11.944Z\",\"metadata\":{\"formId\":\"form_456\"}}"
  }
]'
```

You should receive a WebSocket notification within 500ms!

## 🏗️ Stack Resources

### DynamoDB Tables

#### `kxgen-{env}-connections`
Tracks active WebSocket connections and chat room memberships:

```typescript
{
  tenantId: string;     // Partition key
  connectionId: string; // Sort key  
  userId: string;       // User within tenant
  userName?: string;    // Display name for chat
  domainName: string;   // API Gateway domain
  stage: string;        // API Gateway stage
  chatRooms?: string[]; // Array of joined channel IDs
  ttl: number;          // Auto-cleanup after 24h
  connectedAt: string;  // ISO timestamp
}
```

**Global Secondary Index**: `ConnectionIdIndex`
- Partition Key: `connectionId`
- Projection: ALL (for efficient chat room lookups)

#### `kxgen-{env}-chat-rooms`
Persistent chat room storage:

```typescript
{
  tenantId: string;     // Partition key
  channelId: string;       // Sort key
  roomName: string;     // Display name
  roomType: 'public' | 'private' | 'dm';
  createdBy: string;    // User who created the room
  createdAt: string;    // ISO timestamp
  lastActivity: string; // Last message timestamp
  memberCount: number;  // Current member count
  members?: string[];   // For private/DM rooms
  description?: string; // Room description
  isArchived?: boolean; // Soft delete flag
}
```

**Global Secondary Index**: `RoomTypeIndex`
- Partition Key: `tenantId`
- Sort Key: `roomType`
- Projection: ALL (for room type filtering)

#### `kxgen-{env}-chat-messages`
Persistent message storage (forever):

```typescript
{
  channelId: string;           // Partition key
  messageId: string;        // Sort key (timestamp-based)
  tenantId: string;         // Tenant isolation
  userId: string;           // Message author
  userName: string;         // Author display name
  message: string;          // Message content
  timestamp: string;        // ISO timestamp
  messageType?: 'text' | 'system' | 'file' | 'image';
  editedAt?: string;        // Edit timestamp
  isDeleted?: boolean;      // Soft delete flag
  replyToMessageId?: string; // Threading support
  metadata?: Record<string, any>; // Extensible data
}
```

**Global Secondary Index**: `UserMessagesIndex`
- Partition Key: `tenantId`
- Sort Key: `userId`
- Projection: ALL (for user message history)

### WebSocket API Routes

- **$connect** → `src/ws/on-connect.ts`
  - Validates `tenantId` and `userId` query params
  - Stores connection in DynamoDB
  - TODO: JWT token validation hook

- **$disconnect** → `src/ws/on-disconnect.ts`
  - Relies on TTL for cleanup (simple approach)
  - Production: Consider GSI on connectionId for efficient cleanup

- **$default** → `src/ws/on-message.ts`
  - Routes client messages by type
  - Handles notifications: ping/pong, acknowledgments, subscriptions
  - Handles chat: join/leave rooms, send messages, start direct messages

### EventBridge Integration

Matches multiple event families:

```typescript
// Supported event patterns
{
  source: ['kx-event-tracking'],
  detailType: [
    'scan.completed',         // Scan events
    'scan.created', 
    'payment.completed',      // Payment events
    'payment.failed',
    'payment.pending',
    'user.login',            // User events
    'user.logout',
    'user.created',
    'notification.sent',     // Notification events
    'notification.delivered'
  ]
}
```

## 📊 Event Structure

### Input (EventBridge)

```json
{
  "source": "kx-event-tracking",
  "detail-type": "scan.completed",
  "detail": {
    "eventId": "uuid",
    "tenantId": "acme",
    "entityId": "scan_123",
    "entityType": "scan", 
    "eventType": "scan.completed",
    "occurredAt": "2025-01-03T15:04:11.944Z",
    "metadata": {
      "formId": "form_456"
    }
  }
}
```

### Output (WebSocket)

```json
{
  "type": "notification",
  "family": "scan",
  "at": "2025-01-03T15:04:11.944Z",
  "data": {
    "eventId": "uuid",
    "tenantId": "acme",
    "entityId": "scan_123",
    "entityType": "scan",
    "eventType": "scan.completed",
    "occurredAt": "2025-01-03T15:04:11.944Z",
    "metadata": {
      "formId": "form_456"
    }
  }
}
```

## 💬 Full Chat Platform

### 🏗️ **Persistent Chat Architecture**

- **Forever Message Storage**: All messages stored permanently in DynamoDB
- **Room Management**: Create, list, join, leave, and delete rooms
- **Message History**: Load previous conversations with pagination
- **Message Operations**: Edit, delete, and search messages
- **Real-time + Persistence**: Live chat with full history

### Room Types

#### 1. Public/Group Rooms
```javascript
// Create a public room
ws.send(JSON.stringify({
  type: 'chat.createRoom',
  roomName: 'Project Alpha',
  roomType: 'public',
  description: 'Discussion for Project Alpha',
  userId: 'user123',
  userName: 'John Doe'
}));

// Join a public room
ws.send(JSON.stringify({
  type: 'chat.join',
  channelId: 'public-1696789012345-abc123def',
  userId: 'user123',
  userName: 'John Doe'
}));
```

#### 2. Private Rooms (Invite-only)
```javascript
// Create a private room with specific members
ws.send(JSON.stringify({
  type: 'chat.createRoom',
  roomName: 'Executive Team',
  roomType: 'private',
  description: 'Private executive discussions',
  members: ['user456', 'user789'], // Invited members
  userId: 'user123',
  userName: 'John Doe'
}));
```

#### 3. Direct Messages (1-on-1 Chat)
```javascript
// Easy way: Server calculates channel ID automatically
ws.send(JSON.stringify({
  type: 'chat.startDM',
  userId: 'user123',
  targetUserId: 'user456',
  userName: 'John Doe'
}));

// Manual way: Calculate deterministic channel ID
function createDMRoom(userId1, userId2) {
  return `dm-${[userId1, userId2].sort().join('-')}`;
}

ws.send(JSON.stringify({
  type: 'chat.join',
  channelId: createDMRoom('user123', 'user456'), // "dm-user123-user456"
  userId: 'user123',
  userName: 'John Doe'
}));
```

### 🔧 **Room Management APIs**

```javascript
// List all accessible rooms
ws.send(JSON.stringify({
  type: 'chat.listRooms',
  userId: 'user123',
  roomType: 'public' // Optional: filter by type
}));

// Delete a room (only room creator)
ws.send(JSON.stringify({
  type: 'chat.deleteRoom',
  channelId: 'public-1696789012345-abc123def',
  userId: 'user123'
}));
```

### 📜 **Message History & Management**

```javascript
// Get message history (with pagination)
ws.send(JSON.stringify({
  type: 'chat.getHistory',
  channelId: 'general',
  userId: 'user123',
  limit: 50,
  startFromMessageId: 'optional-for-pagination'
}));

// Edit a message
ws.send(JSON.stringify({
  type: 'chat.editMessage',
  channelId: 'general',
  messageId: '1696789012345-abc123def',
  userId: 'user123',
  newMessage: 'Updated message content'
}));

// Delete a message
ws.send(JSON.stringify({
  type: 'chat.deleteMessage',
  channelId: 'general',
  messageId: '1696789012345-abc123def',
  userId: 'user123'
}));

// Search messages
ws.send(JSON.stringify({
  type: 'chat.searchMessages',
  userId: 'user123',
  query: 'project deadline',
  channelId: 'general', // Optional: search specific room
  limit: 20
}));
```

### Chat Message Types

#### Outgoing (Client → Server)

```javascript
// Create room
{
  type: 'chat.createRoom',
  roomName: 'Project Alpha',
  roomType: 'public' | 'private',
  description: 'Optional description',
  members: ['user456'], // For private rooms
  userId: 'user123',
  userName: 'John Doe'
}

// List rooms
{
  type: 'chat.listRooms',
  userId: 'user123',
  roomType: 'public' // Optional filter
}

// Join a room
{
  type: 'chat.join',
  channelId: 'general',
  userId: 'user123',
  userName: 'John Doe'
}

// Start direct message (helper)
{
  type: 'chat.startDM',
  userId: 'user123',
  targetUserId: 'user456',
  userName: 'John Doe'
}

// Send message
{
  type: 'chat.message',
  channelId: 'general',
  userId: 'user123',
  userName: 'John Doe',
  message: 'Hello everyone!',
  messageType: 'text', // Optional: 'text', 'system', 'file', 'image'
  replyToMessageId: 'optional-reply-to-id'
}

// Get message history
{
  type: 'chat.getHistory',
  channelId: 'general',
  userId: 'user123',
  limit: 50,
  startFromMessageId: 'optional-pagination'
}

// Edit message
{
  type: 'chat.editMessage',
  channelId: 'general',
  messageId: '1696789012345-abc123def',
  userId: 'user123',
  newMessage: 'Updated content'
}

// Delete message
{
  type: 'chat.deleteMessage',
  channelId: 'general',
  messageId: '1696789012345-abc123def',
  userId: 'user123'
}

// Search messages
{
  type: 'chat.searchMessages',
  userId: 'user123',
  query: 'search term',
  channelId: 'optional-room-filter',
  limit: 20
}

// Leave room
{
  type: 'chat.leave',
  channelId: 'general',
  userId: 'user123'
}

// Delete room
{
  type: 'chat.deleteRoom',
  channelId: 'general',
  userId: 'user123'
}
```

#### Incoming (Server → Client)

```javascript
// Room created
{
  type: 'chat.roomCreated',
  success: true,
  room: {
    channelId: 'public-1696789012345-abc123def',
    roomName: 'Project Alpha',
    roomType: 'public',
    createdBy: 'user123',
    memberCount: 1,
    // ... other room details
  },
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Room list
{
  type: 'chat.roomList',
  success: true,
  rooms: [
    {
      channelId: 'general',
      roomName: 'General Discussion',
      roomType: 'public',
      memberCount: 15,
      lastActivity: '2025-01-03T15:04:11.944Z'
    }
  ],
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Message history
{
  type: 'chat.messageHistory',
  success: true,
  channelId: 'general',
  messages: [
    {
      messageId: '1696789012345-abc123def',
      userId: 'user456',
      userName: 'Jane Smith',
      message: 'Hello everyone!',
      timestamp: '2025-01-03T15:04:11.944Z',
      messageType: 'text'
    }
  ],
  hasMore: false,
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Chat message received (real-time)
{
  type: 'chat.message',
  channelId: 'general',
  userId: 'user456',
  userName: 'Jane Smith',
  message: 'Hello back!',
  messageId: '1696789012345-abc123def',
  timestamp: '2025-01-03T15:04:11.944Z',
  messageType: 'text'
}

// Message edited
{
  type: 'chat.messageEdited',
  success: true,
  channelId: 'general',
  messageId: '1696789012345-abc123def',
  message: {
    // Updated message object
    message: 'Updated content',
    editedAt: '2025-01-03T15:04:11.944Z'
  },
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Message deleted
{
  type: 'chat.messageDeleted',
  success: true,
  channelId: 'general',
  messageId: '1696789012345-abc123def',
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Search results
{
  type: 'chat.searchResults',
  success: true,
  query: 'project deadline',
  messages: [
    // Array of matching messages
  ],
  timestamp: '2025-01-03T15:04:11.944Z'
}

// User joined room
{
  type: 'chat.userJoined',
  channelId: 'general',
  userId: 'user789',
  userName: 'Bob Wilson',
  timestamp: '2025-01-03T15:04:11.944Z'
}

// User left room
{
  type: 'chat.userLeft',
  channelId: 'general',
  userId: 'user789',
  userName: 'Bob Wilson',
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Join confirmation
{
  type: 'chat.joined',
  channelId: 'general',
  room: { /* room details */ },
  message: 'Successfully joined room: Project Alpha',
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Leave confirmation
{
  type: 'chat.left',
  channelId: 'general',
  message: 'Successfully left room: general',
  timestamp: '2025-01-03T15:04:11.944Z'
}

// Error message
{
  type: 'chat.error',
  channelId: 'private-room',
  error: 'Not authorized to join this room',
  timestamp: '2025-01-03T15:04:11.944Z'
}
```

### 🏗️ **Platform Features**

#### **Persistent Storage**
- **Forever message retention**: All messages stored permanently
- **Message history**: Load previous conversations with pagination
- **Message operations**: Edit, delete, search across all messages
- **Room persistence**: Rooms and membership stored in DynamoDB

#### **Room Management**
- **Dynamic room creation**: Create public/private rooms on-demand
- **Room discovery**: List and search available rooms
- **Membership management**: Join, leave, and manage room access
- **Room lifecycle**: Archive rooms instead of hard delete (preserves history)
- **Deterministic DM rooms**: Both users calculate same channel ID independently

#### **Advanced Features**
- **Message search**: Full-text search across messages and rooms
- **Message editing**: Edit messages with edit history tracking
- **Message threading**: Reply to specific messages (replyToMessageId)
- **Message types**: Support text, system, file, and image messages
- **Pagination**: Efficient loading of large message histories

### 🔒 **Security & Authorization**

- **Tenant isolation**: Users only see rooms within their tenant
- **Room-based authorization**: 
  - Public rooms: Anyone in tenant can join
  - Private rooms: Only invited members can join
  - DM rooms: Only the two participants can join
- **Message ownership**: Users can only edit/delete their own messages
- **Connection validation**: Existing WebSocket authentication applies
- **Room membership verification**: Messages only sent to authorized room members

## 🔄 Migration Guide for Existing Clients

### ✅ **Zero Breaking Changes**

**Existing notification-only clients require NO code changes:**

```javascript
// This code continues to work exactly as before
const ws = new WebSocket(`${wsUrl}?tenantId=acme&userId=agent-1`);

ws.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  showToast(notification); // Still works!
};
```

### 🆕 **Optional Chat Enhancement**

**To add chat to existing clients, enhance the message handler:**

```javascript
// BEFORE: Simple notification handler
ws.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  showToast(notification);
};

// AFTER: Enhanced handler with chat support
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'notification') {
    // Existing notification logic (unchanged)
    showToast(message);
  } else if (message.type.startsWith('chat.')) {
    // New chat logic
    handleChatMessage(message);
  }
};

function handleChatMessage(message) {
  switch (message.type) {
    case 'chat.message':
      displayChatMessage(message);
      break;
    case 'chat.userJoined':
      showUserJoined(message);
      break;
    // ... other chat types
  }
}
```

### 📱 **Client Update Strategy**

1. **Phase 1**: Deploy new WebSocket API (existing clients unaffected)
2. **Phase 2**: Update clients to handle chat messages (optional)
3. **Phase 3**: Add chat UI components (when ready)

**No coordination required** - clients can be updated independently.

## 🔧 Configuration

### Environment Variables

- `ENVIRONMENT` - Environment name for resource naming (dev/staging/prod)
- `ASSUME_ROLE_ARN` - Optional cross-account role for EventBridge access

### SSM Parameters (Auto-created)

- `/kxgen/ws/public-wss` - Public WebSocket URL for clients
- `/kxgen/ws/management-endpoint` - Management API endpoint
- `/kxgen/ws/connections-table` - DynamoDB table name

### Stack Outputs

- `WsPublicWss` - WebSocket URL for client connections
- `WsMgmtEndpoint` - Management API endpoint  
- `ConnectionsTableName` - DynamoDB table name
- `NotifierFunctionName` - Notifier Lambda function name
- `RealtimeRuleArn` - EventBridge rule ARN

## 🌐 Custom Domain (Future)

To add a custom domain:

1. **Create ACM certificate** for your domain
2. **Add custom domain** to API Gateway WebSocket API
3. **Update connection handler** to store custom domain name
4. **Update SSM parameters** with custom URLs

The stack is designed to be domain-agnostic by storing `domainName` and `stage` per connection.

## 🔒 Cross-Account Setup

For cross-account EventBridge → WebSocket notifications:

### Option 1: EventBridge Resource Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::SOURCE-ACCOUNT:root"
      },
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:REGION:TARGET-ACCOUNT:event-bus/kx-event-tracking"
    }
  ]
}
```

### Option 2: Cross-Account Role

```typescript
// Deploy with assume role ARN
new NotificationsStack(app, 'KxGenNotificationsStack', {
  assumeRoleArn: 'arn:aws:iam::SOURCE-ACCOUNT:role/NotificationsRole',
});
```

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Integration Testing

1. **Deploy stack**
2. **Connect WebSocket client** with valid tenantId/userId
3. **Publish EventBridge event** with matching tenantId
4. **Verify notification** received within 500ms

### Load Testing

```javascript
// Connect multiple clients
const clients = [];
for (let i = 0; i < 100; i++) {
  const ws = new WebSocket(`${wsUrl}?tenantId=acme&userId=user-${i}`);
  clients.push(ws);
}

// Publish burst of events
for (let i = 0; i < 1000; i++) {
  await publishEvent({ tenantId: 'acme', eventType: 'test.load' });
}
```

## 📈 Monitoring

### CloudWatch Metrics

- **Lambda Invocations**: Notifier function execution count
- **Lambda Duration**: Event processing time
- **Lambda Errors**: Failed notifications
- **WebSocket Connections**: Active connection count
- **API Gateway Metrics**: WebSocket message count, errors

### CloudWatch Logs

- **Notifier**: `/aws/lambda/KxGenNotificationsStack-NotifierFunction-*`
- **Connect**: `/aws/lambda/KxGenNotificationsStack-OnConnectFunction-*`
- **Disconnect**: `/aws/lambda/KxGenNotificationsStack-OnDisconnectFunction-*`
- **Message**: `/aws/lambda/KxGenNotificationsStack-OnMessageFunction-*`

### Structured Logging

All logs use structured JSON format:

```json
{
  "level": "INFO",
  "message": "Notification sent successfully",
  "tenantId": "acme",
  "connectionId": "abc123",
  "eventFamily": "qr",
  "timestamp": "2025-01-03T15:04:11.944Z"
}
```

## ⚡ Performance

### Characteristics

- **Event Delivery**: < 500ms from EventBridge to WebSocket
- **Cold Start**: ~200-500ms for Lambda functions
- **Warm Execution**: ~10-50ms per notification
- **Throughput**: Scales automatically with event volume
- **Connection Limit**: 125,000 concurrent WebSocket connections per API

### Optimization Tips

1. **Connection Pooling**: Reuse API Gateway Management clients
2. **Batch Processing**: Group notifications by endpoint
3. **Error Handling**: Ignore GoneException, retry others
4. **TTL Cleanup**: Rely on DynamoDB TTL for stale connections

## 🔄 Migration from QrEventConsumerStack

### Code Changes

```typescript
// Old
import { QrEventConsumerStack } from './qr-event-consumer-stack';

// New  
import { NotificationsStack } from './notifications-stack';
```

### Deployment

1. **Deploy NotificationsStack** alongside existing QrEventConsumerStack
2. **Test WebSocket functionality** with existing events
3. **Remove QrEventConsumerStack** when satisfied
4. **Update client applications** to connect to WebSocket API

### Breaking Changes

- Stack name changed from `QrEventConsumerStack` to `KxGenNotificationsStack`
- Event processing moved from direct Lambda to WebSocket broadcasting
- New DynamoDB table and WebSocket API resources
- Different output structure (notification payload vs direct processing)

## 🚀 Deployment Commands

```bash
# Development
ENVIRONMENT=dev cdk deploy KxGenNotificationsStack

# Staging  
ENVIRONMENT=staging cdk deploy KxGenNotificationsStack

# Production
ENVIRONMENT=prod cdk deploy KxGenNotificationsStack

# With cross-account role
ASSUME_ROLE_ARN=arn:aws:iam::123456789012:role/NotificationsRole \
  cdk deploy KxGenNotificationsStack

# Destroy stack
cdk destroy KxGenNotificationsStack
```

## 📋 Prerequisites

⚠️ **Critical**: The `KxGenStack` (EventBridge source) must be deployed first in the same AWS account/region for EventBridge discovery to work.

- AWS credentials configured for target account/region
- Node.js 18+ and npm
- AWS CDK v2 installed globally
- EventBridge source stack deployed

## 🎉 Success!

Your **dual-purpose WebSocket system** is now ready! 

### 🔔 **Notifications**: 
When scans complete, payments process, or users take actions, your dashboard will instantly show toast notifications via WebSocket push.

### 💬 **Chat**: 
Users can now engage in real-time chat through the same WebSocket connection:
- **Public rooms** for team communication
- **Direct messages** for 1-on-1 conversations  
- **Multi-room support** for organized discussions
- **Zero infrastructure overhead** - uses existing WebSocket API

### ✅ **Backward Compatible**:
- Existing notification-only clients work unchanged
- No breaking changes to any APIs
- Optional chat enhancement when ready

The system is built for scale, supports multi-tenancy, handles both notifications and chat, and is ready for cross-account deployments. Happy notifying and chatting! 🚀💬

## 🔄 EventBridge Integration

All chat events are now published to EventBridge for analytics, monitoring, and external integrations!

### Published Events

- **`chat.message`** - Every message sent in a room
- **`chat.join`** - User joins a room
- **`chat.leave`** - User leaves a room
- **`chat.createRoom`** - New room created
- **`chat.deleteRoom`** - Room archived/deleted

### Event Flow

```
WebSocket Client → Lambda → DynamoDB → EventBridge (kx-event-tracking)
                      ↓         ↓             ↓
                 Broadcast   Storage    Chat Event Consumer
                             (History)   (Analytics/Integrations)
```

### Use Cases

- 📊 **Analytics**: Track message volume, user engagement, room activity
- 🔍 **Search**: Index messages in OpenSearch/Elasticsearch
- 🤖 **AI/ML**: Sentiment analysis, content moderation, bot triggers
- 📝 **Audit**: Compliance logging and data retention
- 🔔 **Integrations**: Webhooks, external notifications, data pipelines

### Event Payloads

All chat events follow the EventBridge standard format with `Source: "kx-event-tracking"` and include detailed event-specific data.

#### 1. `chat.message` - Message Sent

Published when a user sends a message in a room.

```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.message",
  "EventBusName": "kx-event-tracking",
  "Time": "2025-01-18T10:30:00.000Z",
  "Detail": {
    "tenantId": "acme",
    "channelId": "general",
    "userId": "user123",
    "userName": "John Doe",
    "message": "Hello everyone!",
    "messageId": "1705574400000-abc123def",
    "timestamp": "2025-01-18T10:30:00.000Z",
    "connectionId": "dGVzdC1jb25uZWN0aW9u",
    "messageType": "text"
  }
}
```

**Fields:**
- `tenantId` - Tenant/organization identifier
- `roomId` - Unique room identifier
- `userId` - User who sent the message
- `userName` - Display name of the user
- `message` - Message content
- `messageId` - Unique message identifier (timestamp-based)
- `timestamp` - ISO 8601 timestamp
- `connectionId` - WebSocket connection ID
- `messageType` - Type: `text`, `system`, `file`, or `image`

---

#### 2. `chat.join` - User Joined Room

Published when a user joins a chat room.

```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.join",
  "EventBusName": "kx-event-tracking",
  "Time": "2025-01-18T10:25:00.000Z",
  "Detail": {
    "tenantId": "acme",
    "channelId": "general",
    "userId": "user123",
    "userName": "John Doe",
    "roomName": "General Discussion",
    "roomType": "public",
    "timestamp": "2025-01-18T10:25:00.000Z",
    "connectionId": "dGVzdC1jb25uZWN0aW9u"
  }
}
```

**Fields:**
- `tenantId` - Tenant identifier
- `roomId` - Room identifier
- `userId` - User who joined
- `userName` - User's display name
- `roomName` - Human-readable room name
- `roomType` - Room type: `public`, `private`, or `dm`
- `timestamp` - When user joined
- `connectionId` - WebSocket connection ID

---

#### 3. `chat.leave` - User Left Room

Published when a user leaves a chat room.

```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.leave",
  "EventBusName": "kx-event-tracking",
  "Time": "2025-01-18T11:45:00.000Z",
  "Detail": {
    "tenantId": "acme",
    "channelId": "general",
    "userId": "user123",
    "userName": "John Doe",
    "timestamp": "2025-01-18T11:45:00.000Z",
    "connectionId": "dGVzdC1jb25uZWN0aW9u"
  }
}
```

**Fields:**
- `tenantId` - Tenant identifier
- `roomId` - Room user left
- `userId` - User who left
- `userName` - User's display name
- `timestamp` - When user left
- `connectionId` - WebSocket connection ID

---

#### 4. `chat.createRoom` - Room Created

Published when a new chat room is created.

```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.createRoom",
  "EventBusName": "kx-event-tracking",
  "Time": "2025-01-18T09:00:00.000Z",
  "Detail": {
    "tenantId": "acme",
    "channelId": "public-1705572000000-xyz789",
    "roomName": "Project Alpha",
    "roomType": "public",
    "userId": "user456",
    "userName": "Jane Smith",
    "memberCount": 1,
    "timestamp": "2025-01-18T09:00:00.000Z",
    "action": "create"
  }
}
```

**Fields:**
- `tenantId` - Tenant identifier
- `roomId` - Newly created channel ID
- `roomName` - Name of the room
- `roomType` - Type: `public` or `private`
- `userId` - User who created the room
- `userName` - Creator's display name
- `memberCount` - Initial member count (usually 1)
- `timestamp` - Creation timestamp
- `action` - Always `"create"` for this event

---

#### 5. `chat.deleteRoom` - Room Deleted/Archived

Published when a room is archived (soft deleted).

```json
{
  "Source": "kx-event-tracking",
  "DetailType": "chat.deleteRoom",
  "EventBusName": "kx-event-tracking",
  "Time": "2025-01-18T17:30:00.000Z",
  "Detail": {
    "tenantId": "acme",
    "channelId": "public-1705572000000-xyz789",
    "roomName": "Old Project",
    "roomType": "public",
    "userId": "user456",
    "memberCount": 5,
    "timestamp": "2025-01-18T17:30:00.000Z",
    "action": "archive"
  }
}
```

**Fields:**
- `tenantId` - Tenant identifier
- `roomId` - Room being deleted
- `roomName` - Name of the room
- `roomType` - Type: `public` or `private`
- `userId` - User who deleted the room (must be creator)
- `memberCount` - Number of members at deletion time
- `timestamp` - Deletion timestamp
- `action` - Always `"archive"` (soft delete)

---

### Common Fields

All chat events share these common fields:

| Field | Type | Description | Always Present |
|-------|------|-------------|----------------|
| `tenantId` | string | Tenant/organization identifier | ✅ Yes |
| `userId` | string | User performing the action | ✅ Yes |
| `userName` | string | User's display name | ⚠️ Optional |
| `timestamp` | string | ISO 8601 timestamp | ✅ Yes |
| `connectionId` | string | WebSocket connection ID | ⚠️ Optional |

### Consuming Events

Events can be consumed via:

1. **EventBridge Rules** - Filter and route to Lambda, SQS, SNS, etc.
2. **Chat Event Consumer Lambda** (included) - Pre-built processor for analytics
3. **EventBridge Pipes** - Stream to Kinesis, API Destinations, etc.

Example EventBridge rule pattern:
```json
{
  "source": ["kx-event-tracking"],
  "detail-type": [
    "chat.message",
    "chat.join",
    "chat.leave",
    "chat.createRoom",
    "chat.deleteRoom"
  ],
  "detail": {
    "tenantId": ["acme"]
  }
}
```

### Monitoring

CloudWatch metrics are automatically captured:
- `ChatEventPublished` - Events published per type
- `ChatEventPublishFailed` - Failed publishes
- `ChatMessage`, `ChatJoin`, `ChatLeave` - Activity metrics

**See [`docs/EVENTBRIDGE_INTEGRATION.md`](./docs/EVENTBRIDGE_INTEGRATION.md) for complete details**

## 📚 Additional Resources

- **TypeScript Interfaces**: See `src/types/chat.ts` for complete type definitions
- **Chat Usage Guide**: See `CHAT_USAGE.md` for detailed chat API documentation
- **EventBridge Integration**: See `docs/EVENTBRIDGE_INTEGRATION.md` for event publishing details
- **Monitoring Guide**: See `docs/CHAT_EVENTS_MONITORING.md` for CloudWatch Logs Insights queries
- **Interactive Test Client**: Open `examples/chat-client-example.html` to test both notifications and chat
- **Room Management**: Check `src/chat/room-management.ts` for room operations
- **Message Persistence**: Check `src/chat/message-persistence.ts` for message operations
- **Enhanced Chat Handlers**: See `src/chat/chat-handlers.ts` for real-time logic

## 🆕 What's New in This Version

### 🚀 **Full Chat Platform**
- ✅ **Persistent message storage** - All messages stored forever in DynamoDB
- ✅ **Room management** - Create, list, join, leave, and delete rooms
- ✅ **Message history** - Load previous conversations with pagination
- ✅ **Message operations** - Edit, delete, and search messages
- ✅ **Advanced room types** - Public, private, and direct message rooms
- ✅ **Real-time + persistence** - Live chat with full conversation history

### 🏗️ **Infrastructure Enhancements**
- ✅ **3 DynamoDB tables** - Connections, rooms, and messages
- ✅ **Global Secondary Indexes** - Efficient queries for chat operations
- ✅ **Message persistence** - Forever storage with soft delete
- ✅ **Room lifecycle management** - Archive instead of hard delete
- ✅ **Tenant isolation** - Complete data separation per tenant

### 🔧 **Developer Experience**
- ✅ **Complete TypeScript interfaces** - Full type safety for all chat operations
- ✅ **Comprehensive API** - 12+ message types for full chat functionality
- ✅ **Backward compatibility** - Existing notification clients unchanged
- ✅ **Enhanced documentation** - Complete API reference and examples
- ✅ **Production-ready** - Optimized for scale with proper error handling

### 📱 **Client Features**
- ✅ **Room discovery** - List and search available rooms
- ✅ **Message threading** - Reply to specific messages
- ✅ **Message search** - Full-text search across conversations
- ✅ **Edit/delete messages** - Full message lifecycle management
- ✅ **Multi-room support** - Join multiple rooms simultaneously
- ✅ **Connection state sync** - Automatic room membership tracking