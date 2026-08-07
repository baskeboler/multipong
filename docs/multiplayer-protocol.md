# Multiplayer protocol

This SDL-style state diagram describes the Socket.IO protocol implemented by
`src/shared/protocol.ts` and orchestrated by `src/server/multiplayer.ts`. The
server owns every lobby and match transition; clients send commands and render
the snapshots the server publishes.

```mermaid
flowchart TB
    Socket([Socket.IO connected])

    subgraph Lobby[Session and lobby process]
        direction LR
        Idle[Idle session<br/>session:ready + lobby:state]
        Queue[Quick queue<br/>lobby:state queueing]
        Room[Private room<br/>lobby:state + room code]
        Allocated([Match allocated<br/>match:ready + initial snapshot])

        Idle -->|C to S: queue:join| Queue
        Queue -->|C to S: queue:leave| Idle
        Queue -->|opponent found| Allocated
        Idle -->|C to S: room:create| Room
        Room -->|leave or room expires| Idle
        Room -->|peer joins code| Allocated
        Idle -->|C to S: room:join code| Allocated
    end

    subgraph Match[Server-authoritative match process]
        direction LR
        Countdown[Countdown<br/>3 seconds]
        Playing[Playing<br/>60 Hz simulation]
        Point[Point pause<br/>1 second]
        Paused[Paused<br/>20-second reconnect grace]
        Resume{Restore<br/>prior phase}
        Finished[Finished<br/>final snapshot + match:ended]

        Countdown -->|timer| Playing
        Playing -->|point; score below 7| Point
        Point -->|timer and serve| Playing
        Playing -->|first to 7| Finished
        Countdown & Playing & Point -->|player disconnects| Paused
        Paused -->|sessionToken before deadline| Resume
        Resume -->|countdown| Countdown
        Resume -->|playing| Playing
        Resume -->|point pause| Point
        Paused -->|deadline; forfeit| Finished
        Countdown & Playing & Point -->|C to S: match:leave; forfeit| Finished
        Finished -->|both C to S: match:rematch| Countdown
    end

    Socket -->|C to S: session:register; ack Result| Idle
    Socket -->|auth sessionToken; session:ready resumed| Idle
    Socket -->|token for active match| Resume
    Socket -->|token for completed match| Finished
    Allocated --> Countdown
    Finished -->|match:leave or 5-minute cleanup| Idle

    Wire[Active-match wire loop<br/>C to S: reliable match:input direction + sequence<br/>S to C: volatile dynamic snapshot at 30 Hz]
    Rules[Acknowledged commands use Result T<br/>Zod validates payloads<br/>inputs are ordered and capped at 120 per second]
    Rematch[First rematch request<br/>S to C: match:rematch-state<br/>second request restarts the match]

    Wire -.-> Playing
    Rules -.-> Idle
    Rules -.-> Playing
    Rematch -.-> Finished

    classDef transport fill:#102a43,color:#ffffff,stroke:#102a43,stroke-width:2px;
    classDef lobby fill:#e3f2fd,color:#102a43,stroke:#1971c2,stroke-width:2px;
    classDef active fill:#fff3bf,color:#3d3100,stroke:#e67700,stroke-width:2px;
    classDef paused fill:#ffe8cc,color:#512b00,stroke:#f08c00,stroke-width:2px;
    classDef ended fill:#ffe3e3,color:#5f1b1b,stroke:#c92a2a,stroke-width:2px;
    classDef note fill:#f1f3f5,color:#343a40,stroke:#868e96,stroke-dasharray:5 4;

    class Socket transport;
    class Idle,Queue,Room,Allocated lobby;
    class Countdown,Playing,Point,Resume active;
    class Paused paused;
    class Finished ended;
    class Wire,Rules,Rematch note;
```

`C->S` denotes a client-to-server event and `S->C` a server-to-client event.
Except for `match:input`, client commands use Socket.IO acknowledgements with
the shared `Result<T>` envelope. `server:error` is part of the declared shared
contract, while current command failures are returned through acknowledgements.

`match:ready` carries immutable player identity once. Repeated
`match:snapshot` payloads contain only dynamic simulation state and acknowledge
the latest processed input sequence for each player. Periodic snapshots are
volatile because a newer full state supersedes an older packet; initial,
reconnect, final, and rematch snapshots remain reliable.

The client renders remote state against the authoritative tick timeline with a
67–150 ms adaptive interpolation buffer. It may extrapolate for at most 50 ms.
The local paddle is predicted immediately and reconciled when its input
sequence appears in an authoritative snapshot.
