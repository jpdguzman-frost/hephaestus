# Rex Bug Spec: Session Reliability for Long-Running Design Sessions

## Problem

Rex sessions degrade during extended use (2+ hours). Two symptoms, one root cause:

1. **Chat goes dark** — Messages sent from Figma plugin aren't received by the MCP client. Plugin UI shows "unavailable." User has to manually prompt Claude to re-listen.
2. **Commands fail** — WebSocket closes with code 1001, server goes DEGRADED, all commands time out even though HTTP polling is available.

Both are caused by the same fundamental constraint: **the system doesn't gracefully handle blocking on either end of the connection.**

### The Single-Thread Problem

```
MCP Client (Claude)                     Plugin (Figma)
─────────────────                       ───────────────
Can only execute ONE tool at a time     Single-threaded JavaScript runtime

When busy with execute/screenshot/      When busy with figma.createNode/
agent, can't call wait_for_chat         figma.getNodeById, can't respond
                                        to WebSocket heartbeat pings
↓                                       ↓
Chat messages queue up silently         Server kills WS connection (code 1001)
Plugin UI shows "unavailable"           State goes DEGRADED
User thinks session is dead             Commands stuck in queue
```

**Bug 2 makes Bug 1 worse:** When WS drops, the server degrades to HTTP-only polling. HTTP polling is slower, which means `wait_for_chat` timeouts happen more frequently, which means more gaps where chat messages are missed.

---

## Evidence

### Chat Disconnect (Bug 1)
Encountered 2026-03-18 during a 4+ hour design session involving:
- Multiple parallel agent launches
- Heavy use of `execute` for complex node manipulation
- Frequent `screenshot` calls (large payloads)
- Repeated `wait_for_chat` timeout cycles with no message delivery

### WebSocket 1001 Close (Bug 2)
Reported by external user:
```
[INFO] Client joined channel: ojq2gfp3
[INFO] WebSocket closed for client client_1773820996971_x8jbs4h: Code 1001, Reason: No reason provided
[DEBUG] Removed client from channel ojq2gfp3 due to connection close
```
Rex status at time of failure:
```json
{
  "state": "DEGRADED",
  "transport": { "http": true, "websocket": false },
  "queue": { "pending": 0, "inFlight": 0, "completed": 1, "failed": 2 }
}
```

---

## Root Cause Analysis

### Server-Side: Heartbeat Kills Its Own Connection

**Location:** `src/relay/server.ts:835`, `src/relay/heartbeat.ts:161-196`

The heartbeat monitor has a 5-second ping interval, 3-second pong timeout, and triggers degradation after 2 missed pongs. During any `figma.*` API call, the plugin **physically cannot** process pings. Any command taking >10 seconds guarantees a WS close.

```
0s   - Server sends ping #1
2s   - Server sends ping #2 (plugin blocked in figma.createNode)
5s   - Pong timeout #1 detected
7s   - Server sends ping #3
10s  - Pong timeout #2 → SERVER CLOSES WS WITH 1001
```

### Server-Side: Commands Stuck After Degradation

**Location:** `src/relay/server.ts:492-498`

```typescript
sendCommand(command: Command): Promise<CommandResult> {
  const promise = this.queue.enqueue(command);
  // Only pushes via WS — which is FALSE in DEGRADED state
  if (this.connection.isWebSocketActive && this.wsClient?.readyState === WebSocket.OPEN) {
    this.pushCommandViaWs(command);
  }
  return promise;
}
```

Commands are enqueued but **never actively pushed** via HTTP. They wait for the plugin to poll. But the plugin may be waiting for WS reconnection instead of polling HTTP.

### Client-Side: Chat Polling Gap

**Location:** `src/relay/server.ts:393-423`, `src/tools/read/wait-for-chat.ts`

`wait_for_chat` uses 30-second long-polling. When it times out, the MCP client must immediately re-call it. But if Claude is busy executing tools (building screens, running agents, processing screenshots), there's a gap where **no one is listening** for chat messages. The plugin UI shows "unavailable" after a 5-second grace period.

### Plugin-Side: WS Reconnection Blocks HTTP Polling

**Location:** `plugin/ws-client.ts:104-111`

When WS closes, the plugin schedules reconnection with exponential backoff (500ms → 1s → 2s → 4s → 8s → 15s). During backoff, the HTTP poller doesn't know WS is down and doesn't accelerate. After 3-4 failed reconnection cycles, cumulative wait exceeds 45 seconds.

### Plugin-Side: No Visibility Into Server State

The connection state machine (`WAITING → POLLING → CONNECTED → DEGRADED`) is server-side only. The plugin cannot distinguish between "server is healthy but WS dropped" and "server is unreachable."

### Server-Side: Unbounded Chat Inbox

**Location:** `src/relay/server.ts:60`

`chatInbox` has no size limit. In very long sessions with polling gaps, queued messages can grow unbounded, causing memory pressure.

---

## Ten Failure Points (Prioritized)

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | Heartbeat timeout too aggressive for single-threaded plugin | `heartbeat.ts:43` | **P0** |
| 2 | Commands not re-pushed to HTTP during DEGRADED | `server.ts:492-498` | **P0** |
| 3 | Chat polling gap when MCP client is busy | `server.ts:393-423` | **P1** |
| 4 | WS reconnection doesn't signal HTTP poller to accelerate | `ws-client.ts:104` | **P1** |
| 5 | Plugin unaware of DEGRADED state | `connection.ts:193` | **P1** |
| 6 | Unbounded chatInbox growth | `server.ts:60` | **P2** |
| 7 | No `hasPendingChat` flag in get_status | `server.ts` | **P2** |
| 8 | Close code 1001 misleading | `server.ts:835` | **P3** |
| 9 | Plugin UI shows "unavailable" instead of "buffered" | `plugin/ui.html` | **P3** |
| 10 | Chat waiter timer leak on crash | `server.ts:61` | **P3** |

---

## Solution: 10 Fixes

### Fix 1: Pause Heartbeat During Command Execution (P0)

**Files:** `src/relay/heartbeat.ts`, `src/relay/server.ts`

The heartbeat must not ping while the plugin is executing a command.

```typescript
// heartbeat.ts — add pause/resume
private heartbeatPaused = false;

pauseWsHeartbeat(): void {
  this.heartbeatPaused = true;
}

resumeWsHeartbeat(): void {
  this.heartbeatPaused = false;
  this.missedPongs = 0; // Reset after command completes
}

// In ping interval handler:
private startPingInterval(): void {
  this.pingTimer = setInterval(() => {
    if (this.heartbeatPaused) return; // Skip ping during command execution
    // ... existing ping logic
  }, this.heartbeatInterval);
}
```

```typescript
// server.ts — wire up pause/resume around command lifecycle
sendCommand(command: Command): Promise<CommandResult> {
  this.heartbeat.pauseWsHeartbeat();
  const promise = this.queue.enqueue(command);
  promise.finally(() => this.heartbeat.resumeWsHeartbeat());
  // ... existing push logic
  return promise;
}
```

**Additionally**, extend the baseline heartbeat timeout as a safety net:

```typescript
// heartbeat.ts — relax timings
private readonly heartbeatInterval = 10000;  // 5s → 10s
private readonly heartbeatTimeout = 8000;    // 3s → 8s
private readonly maxMissedPongs = 3;         // 2 → 3
```

**Why:** Eliminates the root cause. Plugin can execute commands without WS dying.

### Fix 2: Force HTTP Fallback on WS Close (P0)

**Files:** `plugin/ws-client.ts`, `plugin/poller.ts`, `plugin/code.ts`

When WS drops, the HTTP poller must immediately take over at burst rate.

```typescript
// poller.ts — add high-priority mode
private highPriority = false;

setHighPriorityMode(enabled: boolean): void {
  this.highPriority = enabled;
  if (enabled) {
    this.currentInterval = 100; // Burst rate
    this.forceImmediatePoll();
  }
}

forceImmediatePoll(): void {
  if (this.pollTimer) clearTimeout(this.pollTimer);
  this.poll();
}

private getNextInterval(): number {
  if (this.highPriority) return 100;
  // ... existing adaptive logic
}
```

```typescript
// ws-client.ts — on close, notify poller
case "ws-close":
  this._isConnected = false;
  this.notifyStatus(false);
  if (this.onDegraded) this.onDegraded(); // NEW
  // Flush pending WS messages to HTTP
  if (this.pendingQueue.length > 0) {
    for (const msg of this.pendingQueue) {
      this.flushToHttp(msg);
    }
    this.pendingQueue = [];
  }
  if (this.shouldReconnect) this.scheduleReconnect();
  break;
```

```typescript
// code.ts — wire up
ws.onDegraded = () => {
  poller.forceImmediatePoll();
  poller.setHighPriorityMode(true);
};

ws.onReconnected = () => {
  poller.setHighPriorityMode(false);
};
```

**Why:** Commands continue executing via HTTP within 100ms of WS dropping, instead of waiting for WS reconnection.

### Fix 3: Chat Message Persistence and Awareness (P1)

**File:** `src/relay/server.ts`

Add pending chat awareness so the MCP client can discover messages without active polling:

```typescript
private hasPendingChat: boolean = false;

enqueueChatMessage(message: ChatMessage): void {
  this.hasPendingChat = true;
  // ... existing waiter/queue logic
}

// Expose in get_status response:
return {
  // ... existing fields
  chat: {
    pendingMessages: this.chatInbox.length,
    hasPending: this.hasPendingChat,
  }
};
```

**Enhanced timeout response:**

```typescript
// In wait_for_chat timeout response:
return {
  status: 'timeout',
  message: 'No chat message received within timeout period.',
  pendingCount: this.chatInbox.length,
  _hint: 'IMPORTANT: Call wait_for_chat again immediately.',
  _urgency: this.chatInbox.length > 0 ? 'has_pending' : 'idle',
};
```

**Why:** The MCP client can check `get_status` to discover pending messages and decide whether to prioritize re-polling or finish current work.

### Fix 4: Signal DEGRADED State to Plugin (P1)

**File:** `src/relay/server.ts`

Include connection state in HTTP poll responses:

```typescript
// In GET /commands handler:
const response: PollResponse = {
  commands: pending,
  state: this.connection.currentState, // "CONNECTED" | "DEGRADED" | "POLLING"
  transport: {
    websocket: this.connection.isWebSocketActive,
    http: true,
  }
};
```

```typescript
// plugin/poller.ts — use state info
if (response.state === 'DEGRADED' && !this.highPriority) {
  this.setHighPriorityMode(true);
}
if (response.state === 'CONNECTED' && this.highPriority) {
  this.setHighPriorityMode(false);
}
```

**Why:** Closes the information gap between server-side state and plugin behavior.

### Fix 5: WS Reconnection Strategy Per Close Code (P1)

**File:** `src/relay/server.ts:835`

Use custom close code instead of misleading 1001:

```typescript
// Server-initiated heartbeat degradation
ws.close(4000, "Heartbeat timeout — degrading to HTTP");

// Graceful server shutdown
ws.close(1001, "Server shutting down");
```

**File:** `plugin/ws-client.ts`

Adapt reconnection strategy by close code:

```typescript
case "ws-close":
  if (msg.code === 4000) {
    // Heartbeat degradation — don't rush to reconnect
    this.scheduleReconnect(5000); // Fixed 5s delay
  } else if (msg.code === 1001) {
    // Server going away — don't reconnect
    this.shouldReconnect = false;
  } else {
    // Network error — use exponential backoff
    this.scheduleReconnect(); // 500ms → 1s → 2s → 4s → 8s → 15s
  }
```

**Why:** Different close reasons need different recovery strategies.

### Fix 6: Bounded Chat Inbox (P2)

**File:** `src/relay/server.ts`

```typescript
private static readonly MAX_CHAT_INBOX_SIZE = 50;

enqueueChatMessage(message: ChatMessage): void {
  if (this.chatInbox.length >= RelayServer.MAX_CHAT_INBOX_SIZE) {
    this.chatInbox.shift(); // Drop oldest
    logger.warn('Chat inbox overflow — dropped oldest message');
  }
  // ... existing logic
}
```

**Why:** Prevents unbounded memory growth in very long sessions.

### Fix 7: Plugin "BUFFERED" Chat State (P3)

**File:** `plugin/ui.html`

```
Chat states:
- CONNECTED: Active waiter, messages delivered instantly
- BUFFERED: No active waiter, messages queued for next poll (30s grace)
- UNAVAILABLE: Server unreachable or session expired
```

Show "BUFFERED" instead of "UNAVAILABLE" when the server is reachable but no waiter is active. Extend grace period from 5s to 30s.

**Why:** "Buffered" tells the user their message is safe, just delayed. Reduces false alarm anxiety.

### Fix 8: Chat Waiter Cleanup on Crash (P3)

**File:** `src/relay/server.ts`

```typescript
constructor() {
  process.on('SIGTERM', () => this.cleanupChatWaiters());
  process.on('SIGINT', () => this.cleanupChatWaiters());
}

private cleanupChatWaiters(): void {
  for (const waiter of this.chatWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(null);
  }
  this.chatWaiters = [];
}
```

**Why:** Prevents timer leaks if process terminates during a long session.

### Fix 9: WebSocket Push for Chat (P3 — Long-term)

**File:** `src/relay/server.ts`

When a WebSocket connection is active, push chat messages directly instead of requiring long-poll:

```typescript
private mcpChatCallback: ((message: ChatMessage) => void) | null = null;

registerMcpChatCallback(callback: (message: ChatMessage) => void): void {
  this.mcpChatCallback = callback;
}

enqueueChatMessage(message: ChatMessage): void {
  if (this.mcpChatCallback) {
    this.mcpChatCallback(message);
    return;
  }
  // Fall back to existing waiter/queue logic
}
```

**Why:** Eliminates the chat polling gap entirely. The proper long-term fix.

### Fix 10: Bun PATH Detection (P3)

**File:** Launcher script / README

```bash
# Check common Bun install locations
if ! command -v bun &> /dev/null; then
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  else
    echo "Error: Bun not found. Install with: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi
```

**Why:** Users on fresh Bun installs hit `command not found` (exit 127) because PATH isn't updated.

---

## Testing

### Test 1: Long Command Execution (Fix 1)
1. Connect via WS
2. Execute command taking >15 seconds
3. **Expected:** WS stays connected, no heartbeat timeout logs

### Test 2: Graceful Degradation (Fixes 2, 4)
1. Kill WS connection artificially
2. **Expected:** HTTP polling takes over within 100ms, commands continue

### Test 3: Chat During Tool Execution (Fixes 3, 7)
1. Start a long tool execution (agent, screenshot)
2. Send chat message from Figma during execution
3. **Expected:** Plugin shows "BUFFERED," message delivered when tool completes

### Test 4: WS Recovery (Fix 5)
1. Trigger DEGRADED state
2. Wait for reconnection
3. **Expected:** WS reconnects within 5s, state returns to CONNECTED, poller resumes adaptive mode

### Test 5: Session Endurance (Fixes 6, 8)
1. Run a 4+ hour session with continuous chat and commands
2. **Expected:** No memory growth, no timer leaks, consistent responsiveness

---

## Implementation Order

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P0 | 1. Pause heartbeat during execution | 1 hr | Eliminates WS disconnect root cause |
| P0 | 2. Force HTTP fallback on WS close | 30 min | Seamless command failover |
| P1 | 3. Chat pending awareness in get_status | 30 min | MCP client discovers missed messages |
| P1 | 4. Signal DEGRADED in poll responses | 30 min | Plugin adapts to server state |
| P1 | 5. Custom close codes + strategy | 30 min | Smart reconnection per failure type |
| P2 | 6. Bounded chatInbox | 15 min | Prevents memory bloat |
| P3 | 7. Plugin BUFFERED state | 30 min | Better UX during polling gaps |
| P3 | 8. Waiter cleanup on crash | 15 min | Prevents timer leaks |
| P3 | 9. WebSocket push for chat | 2-4 hrs | Eliminates chat polling gap |
| P3 | 10. Bun PATH detection | 15 min | Smoother first-run experience |

**Total estimated effort:** 6-8 hours for complete fix.
**P0 fixes alone (1-2):** 1.5 hours — resolves the most critical failures.
