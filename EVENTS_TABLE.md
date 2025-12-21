# EventBridge Events - kxgen-new-lead-handlers Stack

## WHAT WE EMIT (Publish to EventBridge)

| Event Type | Source | Emitted By | When | Purpose |
|------------|--------|------------|------|---------|
| `chat.message` | `kx-event-tracking` | `handleChatMessage` (chat-handlers.ts) | When user sends a chat message via WebSocket | User message event |
| `chat.join` | `kx-event-tracking` | `handleChatJoin` (chat-handlers.ts) | When user joins a channel via WebSocket | User join event |
| `chat.leave` | `kx-event-tracking` | `handleChatLeave` (chat-handlers.ts) | When user leaves a channel via WebSocket | User leave event |
| `channel.message` | `kx-notifications-messaging` | `ChatEventConsumer` (chat-event-consumer.ts) | Immediately when `chat.message` received | Trigger fanout Lambda for message distribution |

## WHAT WE SUBSCRIBE TO (Listen For)

| Event Type | Source | Subscribed By | Action Taken |
|------------|--------|---------------|--------------|
| `chat.message` | `kx-event-tracking` | `ChatEventConsumer` | Store in DynamoDB + Emit `channel.message` |
| `chat.join` | `kx-event-tracking` | `ChatEventConsumer` | Process for analytics/storage |
| `chat.leave` | `kx-event-tracking` | `ChatEventConsumer` | Process for analytics/storage |
| `chat.createRoom` | `kx-event-tracking` | `ChatEventConsumer` | Process for analytics/storage |
| `chat.deleteRoom` | `kx-event-tracking` | `ChatEventConsumer` | Process for analytics/storage |
| `chat.editMessage` | `kx-event-tracking` | `ChatEventConsumer` | Process for analytics/storage |
| `chat.deleteMessage` | `kx-event-tracking` | `ChatEventConsumer` | Process for analytics/storage |
| `chat.message.received` | `kx-notifications-messaging` | `Notifier` | Broadcast to WebSocket clients |
| `qr.get` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `qr.scanned` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `qr.created` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `notification.sent` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `notification.delivered` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `payment.completed` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `payment.failed` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `user.login` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `user.logout` | `kx-event-tracking` | `Notifier` | Broadcast to WebSocket clients |
| `agent.reply.created` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `chat.received` | `kxgen.agent` | `Notifier` | Broadcast presence events to WebSocket clients |
| `chat.read` | `kxgen.agent` | `Notifier` | Broadcast presence events to WebSocket clients |
| `chat.typing` | `kxgen.agent` | `Notifier` | Broadcast presence events to WebSocket clients |
| `chat.stoppedTyping` | `kxgen.agent` | `Notifier` | Broadcast presence events to WebSocket clients |
| `lead.contact_captured` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `scheduling.booking_requested` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.goal.activated` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.goal.completed` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.data.captured` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.workflow.state_updated` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.message.analyzed` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.tonality.shifted` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.interest.detected` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |
| `agent.objection.detected` | `kxgen.agent` | `Notifier` | Broadcast to WebSocket clients |

