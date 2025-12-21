# CloudWatch Logs Insights Queries for Agent Events

Use these queries to check if agent events are being emitted and processed by the notifier Lambda.

## 1. Check if Agent Events are Being Received

```sql
fields @timestamp, @message
| parse @message '"source":"*"' as source
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| filter @message like /Processing event detailType/
| filter source = "kxgen.agent"
| sort @timestamp desc
| limit 100
```

## 2. Check for Specific Agent Events (Scheduling, Lead Capture, etc.)

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| filter @message like /Processing agent event/
| filter detailType in ["scheduling.booking_requested", "lead.contact_captured", "agent.message.analyzed", "agent.tonality.shifted"]
| sort @timestamp desc
| limit 100
```

## 3. Check Connection Filtering Results for Agent Events

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| parse @message '"originalConnectionCount":*' as originalConnectionCount
| parse @message '"filteredConnectionCount":*' as filteredConnectionCount
| parse @message '"eventSource":"*"' as eventSource
| filter @message like /Connection filtering results/
| filter eventSource = "kxgen.agent"
| sort @timestamp desc
| limit 100
```

## 4. Check if Agent Events are Being Sent to Connections

```sql
fields @timestamp, @message
| parse @message '"tenantId":"*"' as tenantId
| parse @message '"eventId":"*"' as eventId
| parse @message '"successfulSends":*' as totalSent
| parse @message '"failedSends":*' as totalFailed
| parse @message '"notificationFamily":"*"' as notificationFamily
| filter @message like /Lambda handler execution completed successfully/
| filter notificationFamily = "agent"
| sort @timestamp desc
| limit 100
```

## 5. Check for Filtered Out Agent Events (Warnings)

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| parse @message '"originalConnectionCount":*' as originalConnectionCount
| parse @message '"eventSource":"*"' as eventSource
| filter @message like /No connections match event conditions/
| filter eventSource = "kxgen.agent"
| sort @timestamp desc
| limit 100
```

## 6. Check All Agent Events in Last Hour

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"source":"*"' as source
| filter @timestamp > date_sub(now(), 1h)
| filter @message like /kxgen\.agent/ or @message like /"detailType":"agent\./ or @message like /"detailType":"scheduling\./ or @message like /"detailType":"lead\./
| stats count() by detailType
| sort count desc
```

## 7. Check for Missing TenantId (Events Being Skipped)

```sql
fields @timestamp, @message
| parse @message '"eventId":"*"' as eventId
| parse @message '"source":"*"' as source
| filter @message like /No tenantId found in event - skipping notification/
| filter @message like /kxgen\.agent/
| sort @timestamp desc
| limit 100
```

## 8. Comprehensive Agent Event Flow Check

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| filter @timestamp > date_sub(now(), 1h)
| filter @message like /Processing agent event/ or @message like /Connection filtering results/ or @message like /Broadcasting notification/ or @message like /Lambda handler execution completed/
| filter @message like /kxgen\.agent/ or @message like /"notificationFamily":"agent"/
| sort @timestamp desc
| limit 200
```

## 9. Check for Specific Event: scheduling.booking_requested

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| parse @message '"originalConnectionCount":*' as originalConnectionCount
| parse @message '"filteredConnectionCount":*' as filteredConnectionCount
| parse @message '"successfulSends":*' as totalSent
| filter @message like /"detailType":"scheduling\.booking_requested"/
| sort @timestamp desc
| limit 50
```

## 10. Check for Specific Event: lead.contact_captured

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"eventId":"*"' as eventId
| parse @message '"tenantId":"*"' as tenantId
| parse @message '"originalConnectionCount":*' as originalConnectionCount
| parse @message '"filteredConnectionCount":*' as filteredConnectionCount
| parse @message '"successfulSends":*' as totalSent
| filter @message like /"detailType":"lead\.contact_captured"/
| sort @timestamp desc
| limit 50
```

## Quick Check: Are Any Agent Events Being Received?

```sql
fields @timestamp, @message
| parse @message '"detailType":"*"' as detailType
| parse @message '"tenantId":"*"' as tenantId
| filter @message like /Processing agent event/
| stats count() as eventCount by detailType
| sort eventCount desc
```

## How to Use

1. Go to CloudWatch Logs Insights
2. Select your Lambda function log group (e.g., `/aws/lambda/kxgen-{env}-NotificationsStack-NotifierFunction-...`)
3. Paste one of the queries above
4. Adjust the time range (default is last 15 minutes)
5. Run the query

## What to Look For

- **If events are received**: You should see "Processing agent event" logs
- **If connections are found**: You should see "Connection filtering results" with filteredConnectionCount > 0
- **If events are sent**: You should see "Lambda handler execution completed successfully" with totalSent > 0
- **If events are filtered out**: You'll see "No connections match event conditions" warnings

## Troubleshooting

If you see events being received but not sent:
1. Check if `filteredConnectionCount` is 0 → Connection filtering issue
2. Check if `totalSent` is 0 → Connection sending issue
3. Check for errors in the logs around the event processing time

If you don't see any events:
1. Check if events are being emitted to EventBridge at all
2. Check if the EventBridge rule is matching (check EventBridge metrics)
3. Check if the Lambda is being invoked (check Lambda metrics)

