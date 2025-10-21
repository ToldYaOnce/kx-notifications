/**
 * TypeScript interfaces for the Chat Platform
 * 
 * Defines all message types, room types, and data structures
 * used in the full-featured chat platform.
 */

// =============================================================================
// Core Data Types
// =============================================================================

export interface ChatRoom {
  tenantId: string;
  roomId: string;
  roomName: string;
  roomType: 'public' | 'private' | 'dm';
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  memberCount: number;
  members?: string[]; // For private rooms and DMs
  description?: string;
  isArchived?: boolean;
}

export interface ChatMessage {
  roomId: string;
  messageId: string; // timestamp-based for ordering
  tenantId: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
  messageType?: 'text' | 'system' | 'file' | 'image';
  editedAt?: string;
  isDeleted?: boolean;
  replyToMessageId?: string;
  metadata?: Record<string, any>;
}

export interface ConnectionRecord {
  tenantId: string;
  connectionId: string;
  domainName: string;
  stage: string;
  userId?: string;
  userName?: string;
  chatRooms?: string[]; // Array of room IDs this connection is in
  connectedAt: string;
  ttl: number;
}

// =============================================================================
// Client → Server Messages (Incoming)
// =============================================================================

// Basic Chat Operations
export interface ChatJoinMessage {
  type: 'chat.join';
  roomId: string;
  userId: string;
  userName?: string;
}

export interface ChatStartDMMessage {
  type: 'chat.startDM';
  userId: string;
  targetUserId: string;
  userName?: string;
}

export interface ChatSendMessage {
  type: 'chat.message';
  roomId: string;
  userId: string;
  userName?: string;
  message: string;
  messageType?: 'text' | 'system' | 'file' | 'image';
  replyToMessageId?: string;
  metadata?: Record<string, any>;
}

export interface ChatLeaveMessage {
  type: 'chat.leave';
  roomId: string;
  userId: string;
}

// Room Management
export interface CreateRoomMessage {
  type: 'chat.createRoom';
  roomName: string;
  roomType: 'public' | 'private';
  description?: string;
  members?: string[]; // For private rooms
  userId: string;
  userName: string;
}

export interface ListRoomsMessage {
  type: 'chat.listRooms';
  userId: string;
  roomType?: 'public' | 'private' | 'dm';
}

export interface DeleteRoomMessage {
  type: 'chat.deleteRoom';
  roomId: string;
  userId: string;
}

// Message Management
export interface GetHistoryMessage {
  type: 'chat.getHistory';
  roomId: string;
  userId: string;
  limit?: number;
  startFromMessageId?: string; // For pagination
}

export interface DeleteMessageMessage {
  type: 'chat.deleteMessage';
  roomId: string;
  messageId: string;
  userId: string;
}

export interface EditMessageMessage {
  type: 'chat.editMessage';
  roomId: string;
  messageId: string;
  userId: string;
  newMessage: string;
}

export interface SearchMessagesMessage {
  type: 'chat.searchMessages';
  userId: string;
  query: string;
  roomId?: string;
  limit?: number;
}

// Union type for all incoming chat messages
export type IncomingChatMessage = 
  | ChatJoinMessage
  | ChatStartDMMessage
  | ChatSendMessage
  | ChatLeaveMessage
  | CreateRoomMessage
  | ListRoomsMessage
  | DeleteRoomMessage
  | GetHistoryMessage
  | DeleteMessageMessage
  | EditMessageMessage
  | SearchMessagesMessage;

// =============================================================================
// Server → Client Messages (Outgoing)
// =============================================================================

// Chat Events
export interface ChatMessageReceived {
  type: 'chat.message';
  roomId: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
  messageId?: string;
  messageType?: 'text' | 'system' | 'file' | 'image';
  editedAt?: string;
  replyToMessageId?: string;
  metadata?: Record<string, any>;
}

export interface ChatUserJoined {
  type: 'chat.userJoined';
  roomId: string;
  userId: string;
  userName: string;
  timestamp: string;
}

export interface ChatUserLeft {
  type: 'chat.userLeft';
  roomId: string;
  userId: string;
  userName: string;
  timestamp: string;
}

export interface ChatJoinedConfirmation {
  type: 'chat.joined';
  roomId: string;
  room?: ChatRoom;
  message: string;
  timestamp: string;
}

export interface ChatLeftConfirmation {
  type: 'chat.left';
  roomId: string;
  message: string;
  timestamp: string;
}

export interface ChatError {
  type: 'chat.error';
  roomId?: string;
  messageId?: string;
  error: string;
  timestamp: string;
}

// Room Management Responses
export interface RoomCreatedResponse {
  type: 'chat.roomCreated';
  success: boolean;
  room?: ChatRoom;
  error?: string;
  timestamp: string;
}

export interface RoomListResponse {
  type: 'chat.roomList';
  success: boolean;
  rooms?: ChatRoom[];
  error?: string;
  timestamp: string;
}

export interface RoomDeletedResponse {
  type: 'chat.roomDeleted';
  success: boolean;
  roomId: string;
  error?: string;
  timestamp: string;
}

// Message Management Responses
export interface MessageHistoryResponse {
  type: 'chat.messageHistory';
  success: boolean;
  roomId: string;
  messages?: ChatMessage[];
  hasMore?: boolean;
  error?: string;
  timestamp: string;
}

export interface MessageDeletedResponse {
  type: 'chat.messageDeleted';
  success: boolean;
  roomId: string;
  messageId: string;
  error?: string;
  timestamp: string;
}

export interface MessageEditedResponse {
  type: 'chat.messageEdited';
  success: boolean;
  roomId: string;
  messageId: string;
  message?: ChatMessage;
  error?: string;
  timestamp: string;
}

export interface SearchResultsResponse {
  type: 'chat.searchResults';
  success: boolean;
  query: string;
  messages?: ChatMessage[];
  error?: string;
  timestamp: string;
}

// Union type for all outgoing chat messages
export type OutgoingChatMessage = 
  | ChatMessageReceived
  | ChatUserJoined
  | ChatUserLeft
  | ChatJoinedConfirmation
  | ChatLeftConfirmation
  | ChatError
  | RoomCreatedResponse
  | RoomListResponse
  | RoomDeletedResponse
  | MessageHistoryResponse
  | MessageDeletedResponse
  | MessageEditedResponse
  | SearchResultsResponse;

// =============================================================================
// API Response Types
// =============================================================================

export interface ChatApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface RoomApiResponse extends ChatApiResponse<ChatRoom> {}
export interface RoomListApiResponse extends ChatApiResponse<ChatRoom[]> {}
export interface MessageApiResponse extends ChatApiResponse<ChatMessage> {}
export interface MessageListApiResponse extends ChatApiResponse<ChatMessage[]> {}

// =============================================================================
// Utility Types
// =============================================================================

export type RoomType = 'public' | 'private' | 'dm';
export type MessageType = 'text' | 'system' | 'file' | 'image';

export interface RoomMember {
  userId: string;
  userName: string;
  joinedAt: string;
  role?: 'owner' | 'admin' | 'member';
}

export interface MessageStats {
  totalMessages: number;
  lastMessageAt?: string;
}

export interface RoomStats extends MessageStats {
  memberCount: number;
  createdAt: string;
  lastActivity: string;
}

// =============================================================================
// Notification Integration Types
// =============================================================================

export interface NotificationMessage {
  type: 'notification';
  family: string;
  at: string;
  data: {
    eventId: string;
    tenantId: string;
    entityId: string;
    entityType: string;
    eventType: string;
    occurredAt: string;
    metadata?: Record<string, any>;
  };
}

// Union type for all WebSocket messages (notifications + chat)
export type WebSocketMessage = NotificationMessage | IncomingChatMessage | OutgoingChatMessage;

// =============================================================================
// Configuration Types
// =============================================================================

export interface ChatConfig {
  maxRoomsPerUser?: number;
  maxMessageLength?: number;
  messageRetentionDays?: number; // 0 = forever
  allowFileUploads?: boolean;
  allowPrivateRooms?: boolean;
  allowDirectMessages?: boolean;
  moderationEnabled?: boolean;
}

export interface TenantChatSettings {
  tenantId: string;
  config: ChatConfig;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

