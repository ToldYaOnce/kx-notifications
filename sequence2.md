~~~mermaid
sequenceDiagram
    participant UI as WebSocket Client
    participant WS as OnMessage Lambda
    participant EB1 as EventBridge (kx-event-tracking)
    participant CC as ChatEventConsumer Lambda
    participant DB as Messages DynamoDB
    participant EB2 as EventBridge (kx-notifications)
    participant Fanout as Fan-out Lambda
    participant NO as Notifier Lambda
    participant Clients as WebSocket Clients
    participant Router as LangChain Router
    participant Agent as LangChain Agent

    UI->>WS: send chat.message
    WS->>EB1: PutEvents chat.message<br/>userType=user
    EB1->>CC: invoke with chat.message
    CC->>DB: persist message record
    CC->>EB2: PutEvents channel message<br/>metadata.originMarker=undefined
    EB2->>Fanout: invoke channel fan-out
    Fanout->>EB2: PutEvents chat.message.available<br/>metadata.originMarker=undefined
    EB2->>NO: deliver chat.message.available
    NO->>Clients: broadcast chat.message & notification
    NO->>Router: forward chat.message.available<br/>metadata.originMarker=undefined
    Router->>Agent: invoke agent runtime
    Agent->>EB1: PutEvents chat.message<br/>originMarker=persona
    EB1->>CC: invoke with agent reply
    CC->>DB: persist agent reply
    CC->>EB2: PutEvents channel message<br/>metadata.originMarker=persona
    EB2->>Fanout: invoke channel fan-out (persona)
    Fanout->>EB2: PutEvents chat.message.available<br/>originMarker=persona
    EB2->>NO: deliver agent reply to channel
    NO->>Clients: broadcast agent reply
    NO-->>Router: forward chat.message.available<br/>originMarker=persona (ignored)

    note over Router,Agent: Router skips any chat.message.available with originMarker=persona
    note over Fanout,NO: Fan-out preserves originMarker for downstream consumers
~~~ 
