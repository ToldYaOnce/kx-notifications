# EventBridge Events Delta: README vs Implementation

This document compares the events documented in `kx-langchain-agent` README with what we actually subscribe to and forward to WebSocket clients.

## Events from `kxgen.agent` Source

| Event Type | Documented? | Subscribed? | Forwarded as Chat Message? | Forwarded as Notification? | Status |
|------------|-------------|-------------|----------------------------|----------------------------|--------|
| `agent.reply.created` | ✅ Yes | ✅ Yes | ❌ **NO** | ✅ Yes (generic) | ⚠️ **MISMATCH** - Should be chat message |
| `chat.received` | ✅ Yes | ✅ Yes | ✅ Yes (`chat.received`) | ❌ No | ✅ Match |
| `chat.read` | ✅ Yes | ✅ Yes | ✅ Yes (`chat.read`) | ❌ No | ✅ Match |
| `chat.typing` | ✅ Yes | ✅ Yes | ✅ Yes (`chat.typing`) | ❌ No | ✅ Match |
| `chat.stoppedTyping` | ✅ Yes | ✅ Yes | ✅ Yes (`chat.stoppedTyping`) | ❌ No | ✅ Match |
| `lead.contact_captured` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `scheduling.booking_requested` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `agent.goal.activated` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `agent.goal.completed` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `agent.data.captured` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `agent.workflow.state_updated` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `agent.message.analyzed` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match<br/>**📊 Includes `languageProfile` (formality, hypeTolerance, emojiUsage, language)** |
| `agent.tonality.shifted` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match<br/>**📊 Sentiment/tonality shift detection** |
| `agent.interest.detected` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `agent.objection.detected` | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes (generic) | ✅ Match |
| `agent.error` | ✅ Yes (in diagram) | ❌ **NO** | ❌ No | ❌ No | ⚠️ **MISSING** |
| `agent.trace` | ✅ Yes (in diagram) | ❌ **NO** | ❌ No | ❌ No | ⚠️ **MISSING** |

## Language & Tonality Events

These events are properly subscribed and forwarded:

| Event Type | Description | Language/Tonality Data | Status |
|------------|-------------|----------------------|--------|
| `agent.message.analyzed` | Message tonality & engagement analysis | ✅ **`languageProfile`**: formality, hypeTolerance, emojiUsage, language<br/>✅ **`analysis`**: interestLevel, conversionLikelihood, emotionalTone | ✅ Subscribed & Forwarded (generic notification) |
| `agent.tonality.shifted` | Sentiment shift detection | ✅ **`shift`**: interestDelta, conversionDelta, toneChanged, direction, magnitude<br/>✅ **`conversationAverages`**: avgInterestLevel, avgConversionLikelihood, dominantEmotionalTone | ✅ Subscribed & Forwarded (generic notification) |

**Note**: Both events are forwarded as generic notifications (not chat messages), which is correct since they're analytics/monitoring events, not chat UI events.

## Additional Events We Subscribe To (Not in README)

| Event Type | Source | Subscribed? | Forwarded as Chat Message? | Forwarded as Notification? |
|------------|--------|-------------|----------------------------|----------------------------|
| `chat.message.received` | `kx-notifications-messaging` | ✅ Yes | ✅ Yes (`chat.message`) | ❌ No |

## Summary

### ✅ Correctly Implemented
- All presence events (`chat.received`, `chat.read`, `chat.typing`, `chat.stoppedTyping`) are subscribed and forwarded as chat messages
- All business/workflow/analytics events are subscribed and forwarded as generic notifications
- **Language/Tonality Events:**
  - `agent.message.analyzed` - Includes `languageProfile` (formality, hypeTolerance, emojiUsage, language) ✅
  - `agent.tonality.shifted` - Sentiment shift detection ✅
- `chat.message.received` from fanout is correctly handled as a chat message

### ⚠️ Issues Found

1. **`agent.reply.created` Mismatch**
   - **Status**: Subscribed ✅ but NOT forwarded as chat message ❌
   - **Current behavior**: Falls through to generic notification handler
   - **Expected behavior**: Should be forwarded as `chat.message` type (like agent replies should appear in chat UI)
   - **Impact**: Agent replies won't appear in chat UI if they come as `agent.reply.created` events
   - **Note**: The code handles `chat.message` from `kxgen.agent`, but if the agent emits `agent.reply.created` instead, it won't match

2. **Missing Subscriptions**
   - **`agent.error`**: Documented in README diagram but not subscribed
   - **`agent.trace`**: Documented in README diagram but not subscribed
   - **Impact**: Error and trace events won't be forwarded to WebSocket clients
   - **Recommendation**: If these should be forwarded (even as generic notifications), add them to `AgentEventsRule`

### 🤔 Questions to Consider

1. Does the agent actually emit `agent.reply.created` events, or does it emit `chat.message` with source `kxgen.agent`?
   - If it emits `agent.reply.created`, we should add handling for it to forward as `chat.message`
   - If it emits `chat.message`, then the current implementation is correct

2. Should `agent.error` and `agent.trace` be forwarded to WebSocket clients?
   - These are typically used for monitoring/debugging
   - May not need real-time forwarding to end users

3. Are there any other events documented in the README that should be forwarded as chat messages instead of generic notifications?

## Chat Message Forwarding Logic

Events forwarded as **chat messages** (with `type: 'chat.*'`):
- `chat.message.received` → `chat.message`
- `chat.received` → `chat.received`
- `chat.read` → `chat.read`
- `chat.typing` → `chat.typing`
- `chat.stoppedTyping` → `chat.stoppedTyping`
- `chat.message` (from `kxgen.agent`) → `chat.message`

All other events are forwarded as **generic notifications** (with `type: 'notification'`).

