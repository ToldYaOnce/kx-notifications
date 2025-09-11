# 🎯 WebSocket Notification Filtering Guide

This guide shows you how to implement conditional broadcasting for your WebSocket notifications based on various criteria.

## 🚀 Quick Start

The filtering system is now built into your Notifier Lambda. Here's how to use it:

### 1. **Basic Connection (No Filtering)**
```javascript
// All notifications for this tenant
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=user_456');
```

### 2. **Role-Based Filtering**
```javascript
// Only admin notifications
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=admin_user&userRole=admin');

// Regular user notifications
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=regular_user&userRole=user');
```

### 3. **Subscription-Based Filtering**
```javascript
// Only payment and scan notifications
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=user_456&subscriptions=payments,scans');

// All notification types
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=user_456&subscriptions=payments,scans,notifications,users');
```

### 4. **Priority-Based Filtering**
```javascript
// High priority notifications only
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=user_456&priority=high');

// Normal priority (gets high + normal)
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=user_456&priority=normal');
```

### 5. **Combined Filtering**
```javascript
// Admin user who only wants payment notifications on mobile
const ws = new WebSocket('wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=admin_user&userRole=admin&subscriptions=payments&deviceType=mobile&priority=high');
```

## 🔧 Current Filtering Rules

The system now includes these filtering rules in `src/notifier/notifier.ts`:

### **1. Premium Tenant Filter**
```typescript
// Only premium tenants get payment notifications
if (event['detail-type'] === 'payment.completed') {
  const premiumTenants = ['tenant_premium_1', 'tenant_premium_2', 'tenant_vip'];
  // Filters out non-premium tenants
}
```

### **2. Admin Event Filter**
```typescript
// Only admin users get admin.* events
if (event['detail-type'].startsWith('admin.')) {
  return connections.filter(conn => conn.userRole === 'admin');
}
```

### **3. Priority Filter**
```typescript
// High priority events go to everyone
// Low priority events only go to users with high/normal priority preference
if (event.detail.metadata?.priority === 'low') {
  return connections.filter(conn => 
    conn.priority === 'high' || conn.priority === 'normal'
  );
}
```

### **4. Subscription Filter**
```typescript
// Users only get events they subscribed to
const eventFamily = extractEventFamily(event['detail-type']); // 'payment', 'scan', etc.
return connections.filter(conn => {
  if (!conn.subscriptions) return true; // Default: all events
  return conn.subscriptions.includes(eventFamily);
});
```

### **5. Entity Ownership Filter**
```typescript
// Scan events only go to the user who performed the scan
if (event.detail.entityType === 'scan' && event.detail.metadata?.userId) {
  const scanUserId = event.detail.metadata.userId;
  return connections.filter(conn => conn.userId === scanUserId);
}
```

## 🎨 Custom Filtering Examples

### **Example 1: Department-Based Filtering**
```typescript
// Add to filterConnectionsByEvent function
if (event.detail.metadata?.department) {
  const eventDepartment = event.detail.metadata.department;
  return connections.filter(conn => {
    // Assume userId format: "dept_sales_user123"
    return conn.userId.includes(`dept_${eventDepartment}_`);
  });
}
```

### **Example 2: Geographic Filtering**
```typescript
// Add to filterConnectionsByEvent function
if (event.detail.metadata?.region) {
  const eventRegion = event.detail.metadata.region;
  return connections.filter(conn => {
    // You'd need to store user region in connection metadata
    return conn.region === eventRegion || conn.region === 'global';
  });
}
```

### **Example 3: Time-Based Filtering**
```typescript
// Add to filterConnectionsByEvent function
const currentHour = new Date().getHours();
return connections.filter(conn => {
  if (!conn.notificationPrefs?.quietHours) return true;
  
  const quietStart = parseInt(conn.notificationPrefs.quietHours.start);
  const quietEnd = parseInt(conn.notificationPrefs.quietHours.end);
  
  // Skip notifications during quiet hours
  return currentHour < quietStart || currentHour > quietEnd;
});
```

### **Example 4: Event Frequency Limiting**
```typescript
// Add to filterConnectionsByEvent function
if (event.detail.metadata?.frequency === 'high') {
  // Only send high-frequency events to users who opted in
  return connections.filter(conn => 
    conn.notificationPrefs?.enableHighFrequency === true
  );
}
```

## 🚀 Testing Your Filters

### **1. Test Connection with Filters**
```bash
# Test admin connection
wscat -c "wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=admin_user&userRole=admin"

# Test subscription filtering
wscat -c "wss://your-api.execute-api.us-east-1.amazonaws.com/prod?tenantId=tenant_123&userId=user_456&subscriptions=payments,scans"
```

### **2. Publish Test Events**
```bash
# High priority payment event (should go to all connections)
aws events put-events --entries '[{
  "Source": "kx-event-tracking",
  "DetailType": "payment.completed",
  "Detail": "{\"tenantId\":\"tenant_123\",\"entityId\":\"payment_789\",\"metadata\":{\"priority\":\"high\"}}"
}]'

# Admin event (should only go to admin users)
aws events put-events --entries '[{
  "Source": "kx-event-tracking", 
  "DetailType": "admin.user.created",
  "Detail": "{\"tenantId\":\"tenant_123\",\"entityId\":\"user_new\"}"
}]'

# Low priority scan event (should be filtered based on user preferences)
aws events put-events --entries '[{
  "Source": "kx-event-tracking",
  "DetailType": "scan.completed", 
  "Detail": "{\"tenantId\":\"tenant_123\",\"entityId\":\"scan_456\",\"metadata\":{\"priority\":\"low\",\"userId\":\"user_456\"}}"
}]'
```

### **3. Check CloudWatch Logs**
Look for these log messages in `/aws/lambda/KxGenNotificationsStack-NotifierFunction-*`:

```json
{
  "level": "INFO",
  "message": "Filtered connections by subscription preferences",
  "eventFamily": "payment",
  "originalCount": 5,
  "subscribedCount": 2
}
```

```json
{
  "level": "INFO", 
  "message": "Broadcasting notification to connection groups",
  "tenantId": "tenant_123",
  "originalConnections": 5,
  "filteredConnections": 2,
  "notificationFamily": "payment"
}
```

## 🔄 Deploy Your Changes

After modifying the filtering logic:

```bash
# Build and deploy
npm run build
cdk deploy

# Or if using standalone
npm run deploy:standalone
```

## 🎯 Next Steps

1. **Customize the filtering logic** in `src/notifier/notifier.ts`
2. **Add more connection metadata** in `src/ws/on-connect.ts`
3. **Test with different connection parameters**
4. **Monitor CloudWatch logs** to see filtering in action
5. **Add more sophisticated rules** based on your business needs

The system is now ready for sophisticated conditional broadcasting! 🚀

