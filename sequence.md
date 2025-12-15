~~~mermaid
sequenceDiagram
    participant UI as WebSocket Client
    participant WS as OnMessage Lambda
    participant EB1 as EventBridge (kx-event-tracking)
    participant CC as ChatEventConsumer Lambda
    participant DB as Messages DynamoDB
    participant EB2 as EventBridge (kx-notifications)
    participant NO as Notifier Lambda
    participant Clients as WebSocket Clients
    participant Router as LangChain Router
    participant Agent as LangChain Agent

    UI->>WS: send chat.message
    WS->>EB1: PutEvents chat.message
    EB1->>CC: invoke with chat.message
    CC->>DB: store message record
    CC->>EB2: PutEvents chat.message.available
    EB2->>NO: invoke notifier
    NO->>Clients: broadcast chat.message
    NO->>Router: forward chat.message.available
    Router->>Agent: invoke agent runtime
    Agent->>EB1: PutEvents chat.message (agent reply)
    EB1->>CC: invoke (agent message)

    note over NO,Router: Agent sees the same chat via chat.message.available
    note over Router,Agent: Guard needed to ignore agent-generated chat.message events
~~~