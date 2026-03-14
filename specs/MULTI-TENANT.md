# Multi-Tenant Rex — Specification

> Multiple simultaneous Rex instances, each connected to a different Figma file.

## Problem

Rex binds a single relay to `localhost:7780`. Only one plugin can connect at a time. Designers working across multiple Figma files — or multiple AI sessions targeting different projects — are blocked by this 1:1:1 constraint.

## Solution: Port Pool

Reserve a range of 10 ports (`7780–7789`). Each MCP server instance binds to the first available port. Each plugin instance scans the range and pairs with a relay via a **fileKey handshake**.

```
AI Session A → MCP Server → Relay (:7780) → Plugin (project-alpha.fig)
AI Session B → MCP Server → Relay (:7781) → Plugin (client-site.fig)
AI Session C → MCP Server → Relay (:7782) → Plugin (design-system.fig)
```

Up to 10 simultaneous, fully isolated Rex sessions. Each instance is the same single-tenant relay it is today — no multiplexing, no shared state, no architectural change to the relay itself.

---

## 1. Port Range

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `PORT_RANGE_START` | `7780` | First port in the pool |
| `PORT_RANGE_END` | `7789` | Last port in the pool |
| `PORT_RANGE_SIZE` | `10` | Total available slots |

### Config Change (`src/shared/config.ts`)

The existing `relay.port` config becomes the **preferred** port. If it's taken, the server walks the range until it finds an open one.

```typescript
const RelayConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7780),
  host: z.string().default("127.0.0.1"),
  portRangeStart: z.number().int().default(7780),
  portRangeEnd: z.number().int().default(7789),
});
```

Environment override: `RELAY_PORT` still works — it sets the preferred port but does not disable auto-scan.

---

## 2. Server-Side: Auto-Port Binding

### Startup Sequence (`src/relay/server.ts`)

```
1. Try config.relay.port (default 7780)
2. If EADDRINUSE, try port + 1, port + 2, ... up to portRangeEnd
3. If all 10 ports are taken, fail with clear error:
   "All Rex relay ports (7780–7789) are in use. Close an existing session."
4. Log the bound port — MCP server needs it for stdio transport metadata
```

### Implementation

Replace the single `fastify.listen({ host, port })` call with a loop:

```typescript
async bindToAvailablePort(): Promise<number> {
  const { host, portRangeStart, portRangeEnd } = this.config.relay;

  for (let port = portRangeStart; port <= portRangeEnd; port++) {
    try {
      await this.fastify.listen({ host, port });
      this.logger.info("Relay bound", { host, port });
      return port;
    } catch (err: any) {
      if (err.code === "EADDRINUSE") {
        this.logger.debug("Port in use, trying next", { port });
        continue;
      }
      throw err; // Non-port-conflict errors propagate
    }
  }

  throw new RexError({
    category: ErrorCategory.INTERNAL,
    message: `All Rex relay ports (${portRangeStart}–${portRangeEnd}) are in use`,
    retryable: false,
    suggestion: "Close an existing Rex session to free a port.",
  });
}
```

### Bound Port Exposure

The relay must expose the port it actually bound to, so the MCP server can include it in tool responses and health checks:

```typescript
get boundPort(): number { return this._boundPort; }
```

---

## 3. Plugin-Side: Port Discovery

### Manifest Change (`plugin/manifest.json`)

Whitelist all 10 ports for both HTTP and WebSocket:

```json
{
  "networkAccess": {
    "allowedDomains": [
      "http://localhost:7780", "ws://localhost:7780",
      "http://localhost:7781", "ws://localhost:7781",
      "http://localhost:7782", "ws://localhost:7782",
      "http://localhost:7783", "ws://localhost:7783",
      "http://localhost:7784", "ws://localhost:7784",
      "http://localhost:7785", "ws://localhost:7785",
      "http://localhost:7786", "ws://localhost:7786",
      "http://localhost:7787", "ws://localhost:7787",
      "http://localhost:7788", "ws://localhost:7788",
      "http://localhost:7789", "ws://localhost:7789",
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com"
    ],
    "reasoning": "Local MCP relay server pool (ports 7780-7789) and Google Fonts"
  }
}
```

### Discovery Algorithm (`plugin/code.ts`)

On startup, the plugin scans the port range to find an available relay:

```
1. For each port 7780–7789 (in parallel, 10 concurrent health checks):
   a. GET http://localhost:{port}/health
   b. If responds with { status: "ok" } → candidate relay

2. For each candidate relay (in order, lowest port first):
   a. Check if it already has a connected plugin:
      - Parse health response: connection.state
      - If state === "WAITING" → relay is free → claim it
      - If state !== "WAITING" → relay is occupied → skip

3. Connect to the first free relay via POST /connect (existing handshake)
4. If no free relay found, show "Waiting for AI client..." status
   and retry every 3 seconds (existing retry behavior)
```

### Code Changes (`plugin/code.ts` + `plugin/poller.ts`)

**code.ts** — Replace hardcoded `RELAY_URL`:

```typescript
const PORT_RANGE_START = 7780;
const PORT_RANGE_END = 7789;

async function discoverRelay(): Promise<string | null> {
  // Parallel health check on all ports
  const checks = [];
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    checks.push(checkPort(port));
  }
  const results = await Promise.all(checks);

  // Find first free relay (WAITING state = no plugin connected)
  for (const result of results) {
    if (result && result.free) {
      return result.url;
    }
  }
  return null;
}

async function checkPort(port: number): Promise<{ url: string; free: boolean } | null> {
  const url = `http://localhost:${port}`;
  try {
    const resp = await httpRequest("GET", url + "/health", undefined, undefined, 2000);
    if (resp.status === 200 && resp.body) {
      const health = JSON.parse(resp.body);
      const state = health?.connection?.state;
      return { url, free: state === "WAITING" };
    }
  } catch {}
  return null;
}
```

**Main startup flow:**

```typescript
async function main() {
  figma.showUI(__html__, { visible: true, width: 360, height: 215 });

  var executor = new Executor();
  var relayUrl = await discoverRelay();

  if (!relayUrl) {
    // No relay found — retry loop (same as existing disconnected path)
    reportStatus("disconnected");
    var retryInterval = setInterval(async function() {
      relayUrl = await discoverRelay();
      if (relayUrl) {
        clearInterval(retryInterval);
        await connectToRelay(relayUrl, executor);
      }
    }, 3000);
    return;
  }

  await connectToRelay(relayUrl, executor);
}
```

**Poller** — `baseUrl` is already parameterized. No changes needed.

**WSClient** — `baseUrl` is already parameterized. Just pass the discovered URL.

### UI Status Updates

The plugin UI should show which port it's connected to for debugging:

```
Connected (ws://localhost:7782)
```

Update the `status` message to include the port:

```typescript
figma.ui.postMessage({
  type: "status",
  connected: true,
  transport: "websocket",
  port: 7782,
});
```

---

## 4. Pairing Semantics

### How pairing works

Each relay instance is fully independent. The pairing is first-come-first-served at the port level:

1. **AI client starts** → MCP server spawns → relay binds to first free port (e.g., 7781)
2. **User opens Figma file** → runs Rex plugin → plugin scans ports → finds 7781 is free → connects
3. **Connection established** — relay on 7781 is now claimed, serving that Figma file

### What happens with multiple files

| Scenario | Behavior |
|----------|----------|
| 2 AI sessions, 2 Figma files | Each MCP server gets its own port. Each plugin finds a different free relay. |
| 1 AI session, user switches files | Plugin in new file scans and finds a different relay (or the same relay if user closed the first plugin). |
| Plugin closes (user closes file) | Relay returns to WAITING state. Port is freed for the next plugin. |
| All 10 ports taken | Plugin shows "All Rex slots in use" message. |

### Race condition: two plugins scan simultaneously

Two plugins could both see port 7781 as free and both try to connect. The relay already handles this — `ConnectionManager.connect()` replaces any existing session:

```typescript
// connection.ts line 129
if (this._session) {
  this.logger.warn("Replacing existing session", { ... });
  this.disconnect("replaced by new connection");
}
```

The first plugin gets displaced and its poller detects the auth failure (401), triggering a reconnect scan. It finds another free port. This is a rare edge case that self-heals.

---

## 5. Health Endpoint Enhancement

The `/health` endpoint already returns connection state. No schema change needed, but ensure the response clearly indicates availability:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "connection": {
    "state": "WAITING"        // ← plugin uses this to determine if relay is free
  }
}
```

When a plugin is connected:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "connection": {
    "state": "POLLING",
    "fileKey": "abc123",
    "fileName": "Project Alpha",
    "user": { "name": "JP" }
  }
}
```

---

## 6. Files Changed

| File | Change |
|------|--------|
| `src/shared/config.ts` | Add `portRangeStart`, `portRangeEnd` to RelayConfigSchema |
| `src/relay/server.ts` | Replace `fastify.listen()` with `bindToAvailablePort()` loop |
| `plugin/manifest.json` | Whitelist ports 7780–7789 (HTTP + WS) |
| `plugin/code.ts` | Add `discoverRelay()` port scanner, replace hardcoded `RELAY_URL` |
| `plugin/ui.html` | Show connected port in status display |

### Files NOT changed

| File | Why |
|------|-----|
| `src/relay/connection.ts` | No change — already single-session, already handles replacement |
| `plugin/poller.ts` | No change — `baseUrl` is already parameterized |
| `plugin/ws-client.ts` | No change — `baseUrl` is already parameterized |
| `src/server/mcp-server.ts` | No change — MCP server doesn't know about ports |
| `src/server/tool-router.ts` | No change — tools are port-agnostic |

---

## 7. Edge Cases

### Port exhaustion
All 10 ports are in use. Plugin shows a clear message: *"All Rex slots are in use (10/10). Close a Rex session in another file to free a slot."*

### Stale relays
An MCP server crashes without cleaning up. Its port stays bound until the OS reclaims it (typically immediate on process exit). The plugin's health check will get a connection refused, treating it as unavailable.

### Port overlap with other apps
Unlikely on 7780–7789, but if a non-Rex service is on one of these ports, the health check won't return the expected `{ status: "ok" }` format, so the plugin skips it.

### Hot reload / plugin re-run
User re-runs the Rex plugin in the same Figma file. The plugin scans again, finds its own relay (which may now be in POLLING state since the old plugin just disconnected). The relay's `connect()` method replaces the old session — seamless.

---

## 8. Migration

**Backward compatible.** The default behavior is identical to today — relay binds to 7780, plugin connects to 7780. The port range only activates when 7780 is already taken.

Existing installs with the old manifest (single port) continue working for single-instance use. The updated manifest is needed only for multi-instance support.

---

## 9. Future Considerations

- **Port range could be configurable** via `rex.config.json` for environments where 7780–7789 conflicts with other services.
- **Plugin UI could show a port picker** for manual pairing — not needed now since auto-discovery handles it.
- **A shared relay daemon** (single process, multiple sessions) could replace the port pool if 10 slots aren't enough. This is a larger refactor and not needed for the current use case.
