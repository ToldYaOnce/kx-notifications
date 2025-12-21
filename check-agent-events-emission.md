# Check if Agent Events are Being Emitted

Use these CloudWatch Logs Insights queries to check if the agent is actually emitting events.

## Prerequisites

You'll need to check the **agent Lambda logs**, not the notifier logs. The agent Lambda function name should be something like:
- `kxgen-{env}-DelayedRepliesStack-AgentFunction-...`
- Or check your agent stack for the Lambda function name

## Query 1: Check for `lead.contact_captured` Events

```sql
fields @timestamp, @message
| parse @message '"detail-type":"*"' as detailType
| parse @message '"source":"*"' as source
| filter @timestamp > date_sub(now(), 24h)
| filter source = "kxgen.agent" and detailType = "lead.contact_captured"
| stats count() as eventCount by bin(5m)
| sort @timestamp desc
```

## Query 2: Check for `scheduling.booking_requested` Events

```sql
fields @timestamp, @message
| parse @message '"detail-type":"*"' as detailType
| parse @message '"source":"*"' as source
| filter @timestamp > date_sub(now(), 24h)
| filter source = "kxgen.agent" and detailType = "scheduling.booking_requested"
| stats count() as eventCount by bin(5m)
| sort @timestamp desc
```

## Query 3: Check ALL Events from kxgen.agent Source (Summary)

```sql
fields @timestamp, @message
| parse @message '"detail-type":"*"' as detailType
| parse @message '"source":"*"' as source
| filter @timestamp > date_sub(now(), 24h)
| filter source = "kxgen.agent"
| stats count() as eventCount by detailType
| sort eventCount desc
```

## Query 4: Check for Specific Events with Full Details

```sql
fields @timestamp, @message
| parse @message '"detail-type":"*"' as detailType
| parse @message '"id":"*"' as eventId
| parse @message '"source":"*"' as source
| parse @message '"tenantId":"*"' as tenantId
| filter @timestamp > date_sub(now(), 24h)
| filter source = "kxgen.agent"
| filter detailType in ["lead.contact_captured", "scheduling.booking_requested"]
| sort @timestamp desc
| limit 100
```

## Query 5: Check EventBridge PutEvents Calls (Agent Emitting Events)

If the agent logs show event emission attempts, check for PutEvents API calls:

```sql
fields @timestamp, @message
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /PutEvents/ or @message like /lead.contact_captured/ or @message like /scheduling.booking_requested/
| sort @timestamp desc
| limit 100
```

## Query 6: Check for Goal Completion Logs (That Should Trigger Events)

```sql
fields @timestamp, @message
| filter @timestamp > date_sub(now(), 24h)
| filter @message like /goal.*complete/ or @message like /ALL CONTACT INFO COMPLETE/ or @message like /trigger_scheduling_flow/
| sort @timestamp desc
| limit 100
```

## How to Use

1. Go to CloudWatch Logs Insights
2. Select your **Agent Lambda** log group (NOT the notifier log group)
   - Look for log groups like `/aws/lambda/kxgen-{env}-DelayedRepliesStack-AgentFunction-...`
   - Or `/aws/lambda/kxgen-{env}-...-AgentFunction-...`
3. Paste one of the queries above
4. Adjust the time range (default is last 15 minutes, but these queries check last 24 hours)
5. Run the query

## What to Look For

- **If events are emitted**: You'll see EventBridge event JSON structures with `"detail-type":"lead.contact_captured"` or `"detail-type":"scheduling.booking_requested"`
- **If events are NOT emitted**: You won't see these event types, but Query 6 might show goal completion logs without corresponding events

## Alternative: Check EventBridge Directly

You can also check EventBridge metrics and logs:

1. Go to Amazon EventBridge Console
2. Navigate to **Event buses** → Select your event bus
3. Go to **Metrics** tab
4. Look for events with detail-type `lead.contact_captured` or `scheduling.booking_requested`
5. Go to **Rules** tab and check if rules are matching events (check the `kxgen-agent-events-notifications` rule)

## Troubleshooting

If events are not being emitted:
1. Check if the goals are completing (Query 6)
2. Check if the goal configuration has the correct `onComplete` actions
3. Check agent code for errors when emitting events
4. Verify the event bus name in agent configuration matches your actual event bus


