/**
 * Connection record from DynamoDB
 */
export interface ConnectionRecord {
  tenantId: string;
  connectionId: string;
  userId: string;
  domainName: string;
  stage: string;
  ttl: number;
  connectedAt: string;
  // Optional: Enhanced metadata for filtering
  userRole?: string;           // 'admin', 'user', 'viewer'
  subscriptions?: string[];    // ['payments', 'scans', 'notifications']
  priority?: string;           // 'high', 'normal', 'low'
  deviceType?: string;         // 'mobile', 'web', 'desktop'
  notificationPrefs?: {
    enableSound: boolean;
    enablePush: boolean;
    quietHours?: { start: string; end: string; };
  };
}

