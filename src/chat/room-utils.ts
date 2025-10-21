/**
 * Utility functions for chat room management
 */

export interface RoomInfo {
  roomId: string;
  type: 'direct' | 'group' | 'public';
  participants: string[];
  createdBy?: string;
  createdAt: string;
}

/**
 * Create a deterministic room ID for direct messages between two users
 * Both users will generate the same room ID regardless of who initiates
 */
export function createDirectMessageRoomId(userId1: string, userId2: string): string {
  if (userId1 === userId2) {
    throw new Error('Cannot create direct message room with same user');
  }
  
  // Sort user IDs to ensure consistent room naming
  const sortedUsers = [userId1, userId2].sort();
  return `dm-${sortedUsers.join('-')}`;
}

/**
 * Create a group chat room ID
 */
export function createGroupRoomId(creatorId: string, roomName?: string): string {
  const timestamp = Date.now();
  const roomSuffix = roomName ? `-${roomName.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  return `group-${creatorId}-${timestamp}${roomSuffix}`;
}

/**
 * Parse room ID to get room info
 */
export function parseRoomId(roomId: string): { type: string; participants?: string[] } {
  if (roomId.startsWith('dm-')) {
    const participants = roomId.substring(3).split('-');
    return { type: 'direct', participants };
  }
  
  if (roomId.startsWith('group-')) {
    return { type: 'group' };
  }
  
  return { type: 'public' };
}

/**
 * Validate if a user can join a room
 */
export function canUserJoinRoom(roomId: string, userId: string): boolean {
  const roomInfo = parseRoomId(roomId);
  
  // For direct messages, only the two participants can join
  if (roomInfo.type === 'direct' && roomInfo.participants) {
    return roomInfo.participants.includes(userId);
  }
  
  // For group and public rooms, allow anyone for now
  // In production, you'd check permissions/invitations
  return true;
}

/**
 * Get display name for a room
 */
export function getRoomDisplayName(roomId: string, currentUserId: string): string {
  const roomInfo = parseRoomId(roomId);
  
  if (roomInfo.type === 'direct' && roomInfo.participants) {
    // For DMs, show the other user's name
    const otherUser = roomInfo.participants.find(id => id !== currentUserId);
    return otherUser || 'Direct Message';
  }
  
  if (roomInfo.type === 'group') {
    return roomId.replace('group-', 'Group: ');
  }
  
  return roomId;
}

