# Hephaestus — Figma MCP Server Specification

> A stable, reliable MCP server for full read/write access to Figma's canvas.
> Named after the Greek god of the forge — craftsmanship through precision.

**Version:** 0.1.0-draft
**Date:** 2026-03-09

---

## Table of Contents

1. [Goals & Non-Goals](#1-goals--non-goals)
2. [Architecture](#2-architecture)
3. [Design Principles](#3-design-principles)
4. [Transport Layer](#4-transport-layer)
5. [Reliability & Error Handling](#5-reliability--error-handling)
6. [Security](#6-security)
7. [Project Structure](#7-project-structure)
8. [Build & Development](#8-build--development)

---

## 1. Goals & Non-Goals

### Goals

- **Full canvas write access** — create, modify, delete any node type with layout, style, and component support
- **Stability over speed** — HTTP polling baseline with optional WebSocket acceleration; never rely on a single persistent connection
- **Atomic composite operations** — create complex node trees in a single tool call that either fully succeeds or fully rolls back
- **Layout as a first-class citizen** — dedicated tools for auto-layout, grid, and constraints (not hidden behind a generic `execute`)
- **Batch everything** — update multiple nodes, create multiple children, set multiple properties in one call
- **Intuitive tool surface** — fewer, smarter tools that accept optional properties rather than many single-purpose tools
- **Predictable error handling** — typed errors, clear retry semantics, and graceful degradation

### Non-Goals

- **Replacing Figma's UI** — Hephaestus is for programmatic design operations, not a design tool
- **Real-time collaboration sync** — no conflict resolution with other editors; operates on current document state
- **Plugin marketplace distribution** — the Figma plugin is a local development relay, not a published plugin
- **Browser/CDP support** — desktop Figma only, no browser-based Figma support
- **Code generation** — no design-to-code features; focused purely on canvas manipulation

---

## 2. Architecture

### System Overview

```
┌─────────────────────────────────────────────────┐
│  Claude Code / AI Client                        │
│  (MCP consumer)                                 │
└────────────────────┬────────────────────────────┘
                     │ MCP protocol (stdio)
                     ▼
┌─────────────────────────────────────────────────┐
│  Hephaestus MCP Server                          │
│  (Node.js / TypeScript)                         │
│                                                 │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │ Tool Router  │  │ Command Queue            │  │
│  │ (MCP tools)  │──│ (id, payload, status)    │  │
│  └─────────────┘  └──────────┬───────────────┘  │
│                              │                  │
│  ┌───────────────────────────┴───────────────┐  │
│  │ Relay Server                              │  │
│  │ ┌─────────────────┐ ┌──────────────────┐  │  │
│  │ │ HTTP endpoint    │ │ WebSocket server │  │  │
│  │ │ (always-on)      │ │ (optional fast)  │  │  │
│  │ └─────────────────┘ └──────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                     │
            Local network (localhost)
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Figma Desktop App                              │
│  ┌───────────────────────────────────────────┐  │
│  │ Hephaestus Plugin (thin relay)            │  │
│  │                                           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐  │  │
│  │  │ Poller   │  │ Executor │  │ WS     │  │  │
│  │  │ (HTTP)   │  │ (figma.*)│  │ Client │  │  │
│  │  └──────────┘  └──────────┘  └────────┘  │  │
│  └───────────────────────────────────────────┘  │
│                       │                         │
│                       ▼                         │
│              Figma Plugin API                   │
│              (figma.* namespace)                │
└─────────────────────────────────────────────────┘
```

### Components

#### 2.1 MCP Server

- **Runtime:** Node.js 20+
- **Language:** TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Transport:** stdio (standard MCP transport)
- **Responsibilities:**
  - Expose MCP tools to the AI client
  - Validate tool inputs (schema validation via Zod)
  - Translate tool calls into plugin commands
  - Manage command lifecycle (queue → send → ack → result)
  - Expose read operations via Figma REST API where possible

#### 2.2 Relay Server

- **Embedded** within the MCP server process (not a separate service)
- **HTTP server** on configurable port (default: `7780`)
- **WebSocket server** on the same port (upgrade path)
- **Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Server status + connection state |
| GET | `/commands` | Plugin polls for pending commands |
| POST | `/results` | Plugin posts command results |
| GET | `/ws` | WebSocket upgrade endpoint |

#### 2.3 Figma Plugin (Relay)

- **Type:** Figma development plugin (not published)
- **UI:** Minimal — connection status indicator only
- **Responsibilities:**
  - Poll `/commands` for pending work (every 300ms)
  - Execute serialized `figma.*` operations
  - Post results to `/results`
  - Optionally upgrade to WebSocket for lower latency
  - Report connection health via heartbeat
- **Zero business logic** — the plugin is a dumb pipe between the relay and `figma.*`

#### 2.4 Figma REST API Client

For read operations that don't require the plugin runtime:

- File data and structure
- Component metadata
- Published variables and styles
- Image exports / screenshots
- Comments (read)
- File version history

REST API calls bypass the plugin entirely, improving reliability for reads.

---

## 3. Design Principles

### 3.1 Fewer tools, more parameters

**Bad:** 6 separate tools to style a node
```
set_fills(nodeId, fills)
set_strokes(nodeId, strokes)
set_effects(nodeId, effects)
set_corner_radius(nodeId, radius)
set_opacity(nodeId, opacity)
resize_node(nodeId, width, height)
```

**Good:** 1 tool with optional parameters
```
update_node(nodeId, {
  fills?, strokes?, effects?, cornerRadius?,
  opacity?, width?, height?
})
```

The AI sends only what it needs. Less tool selection overhead, fewer round trips.

### 3.2 Composite creation

A single `create_frame` call can produce a complete node tree:

```
create_frame({
  name: "Card",
  width: 320,
  autoLayout: { direction: "vertical", padding: 24, spacing: 16 },
  fills: [{ type: "solid", color: "#FFFFFF" }],
  cornerRadius: 12,
  children: [
    { type: "TEXT", name: "Title", text: "Hello", style: { fontSize: 24, fontWeight: 700 } },
    { type: "TEXT", name: "Body", text: "World", style: { fontSize: 16 } },
    { type: "FRAME", name: "Actions", autoLayout: { direction: "horizontal", spacing: 8 }, children: [...] }
  ]
})
```

This is atomic — it either creates the full tree or nothing.

### 3.3 Layout-first

Auto-layout, constraints, and grids are not afterthoughts. They have dedicated tools and are embeddable in composite creation. Every frame-like creation tool accepts layout parameters inline.

### 3.4 Stability over latency

- HTTP polling is always on — it's the reliability backbone
- WebSocket is an optimization, not a requirement
- Every command has a unique ID and is tracked through its lifecycle
- No operation depends on connection persistence

### 3.5 Idempotent where possible

Commands that can be made idempotent (set operations, updates) use idempotency keys. If a command is retried, it produces the same result rather than duplicating work.

---

## 4. Transport Layer

### 4.1 Connection Lifecycle

```
┌──────────┐     plugin starts     ┌──────────────┐
│          │ ──────────────────────▶│              │
│ WAITING  │                       │  POLLING     │
│          │◀────plugin stops──────│  (HTTP only) │
└──────────┘                       └──────┬───────┘
                                          │
                                    WS upgrade succeeds
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │              │
                              ┌───▶│  CONNECTED   │
                              │    │  (WS + HTTP)  │
                              │    └──────┬───────┘
                              │           │
                         WS reconnects    │ WS drops
                              │           │
                              │           ▼
                              │    ┌──────────────┐
                              │    │              │
                              └────│  DEGRADED    │
                                   │  (HTTP only) │
                                   └──────────────┘
```

**States:**

| State | HTTP Polling | WebSocket | Behavior |
|-------|-------------|-----------|----------|
| WAITING | Server listening | Not connected | No commands processed; tools return "not connected" |
| POLLING | Active | Not connected | Commands sent via HTTP polling; ~300ms latency |
| CONNECTED | Active (fallback) | Active | Commands sent via WS; <50ms latency |
| DEGRADED | Active | Dropped, reconnecting | Commands sent via HTTP; WS attempting reconnect |

**Key rule:** The system is fully functional in POLLING and DEGRADED states. WebSocket is never required.

### 4.2 HTTP Polling Protocol

**Plugin polls for commands:**
```
GET /commands
Headers:
  X-Plugin-Id: <unique-plugin-instance-id>
  X-Plugin-File: <figma-file-key>

Response 200:
{
  "commands": [
    {
      "id": "cmd_a1b2c3",
      "type": "CREATE_NODE",
      "payload": { ... },
      "timestamp": 1741500000000,
      "ttl": 30000
    }
  ]
}

Response 204: (no pending commands)
```

**Plugin posts results:**
```
POST /results
Headers:
  X-Plugin-Id: <unique-plugin-instance-id>
Content-Type: application/json

{
  "id": "cmd_a1b2c3",
  "status": "success",
  "result": { "nodeId": "123:456", "name": "Card" },
  "duration": 45,
  "timestamp": 1741500000045
}
```

**Polling interval:**
- Default: 300ms
- When commands are pending: 100ms (burst mode)
- When idle for >10s: 500ms (throttle mode)
- Adaptive based on command queue depth

### 4.3 WebSocket Protocol

**Upgrade:**
```
GET /ws
Connection: Upgrade
Upgrade: websocket
X-Plugin-Id: <unique-plugin-instance-id>
```

**Message format (bidirectional):**
```json
{
  "type": "command" | "result" | "ping" | "pong" | "ack",
  "id": "msg_xyz",
  "payload": { ... },
  "timestamp": 1741500000000
}
```

**Heartbeat:**
- Server sends `ping` every 5 seconds
- Plugin must respond with `pong` within 3 seconds
- 2 missed pongs = connection considered dead → fall back to DEGRADED

**Reconnection:**
- Exponential backoff: 500ms, 1s, 2s, 4s, 8s, max 15s
- On reconnect, plugin re-identifies and any queued commands are re-sent
- No special "reconnection" state — the system just operates in DEGRADED mode until WS is back

### 4.4 Command Lifecycle

```
QUEUED ──▶ SENT ──▶ ACKNOWLEDGED ──▶ COMPLETED
  │          │          │                │
  │          │          │                ▼
  │          │          │            (success result)
  │          │          │
  │          ▼          ▼
  │       TIMEOUT    TIMEOUT
  │          │          │
  │          ▼          ▼
  │       RETRY      RETRY
  │       (1x)       (1x)
  │          │          │
  ▼          ▼          ▼
EXPIRED    FAILED     FAILED
```

| State | Description |
|-------|-------------|
| QUEUED | Command created, waiting to be picked up by plugin |
| SENT | Delivered to plugin (via HTTP response or WS message) |
| ACKNOWLEDGED | Plugin confirmed receipt (implicit for HTTP, explicit `ack` for WS) |
| COMPLETED | Result received (success or error) |
| TIMEOUT | No response within TTL (default: 30s) |
| RETRY | Automatic retry (max 1 retry per command) |
| FAILED | Retries exhausted or unrecoverable error |
| EXPIRED | Command TTL exceeded before it was sent (stale) |

---

## 5. Reliability & Error Handling

### 5.1 Error Categories

```typescript
enum ErrorCategory {
  // Connection errors — transient, auto-retry
  CONNECTION_LOST = "CONNECTION_LOST",
  PLUGIN_NOT_RUNNING = "PLUGIN_NOT_RUNNING",
  COMMAND_TIMEOUT = "COMMAND_TIMEOUT",

  // Figma API errors — may be retryable
  NODE_NOT_FOUND = "NODE_NOT_FOUND",
  INVALID_OPERATION = "INVALID_OPERATION",
  FONT_NOT_LOADED = "FONT_NOT_LOADED",
  READ_ONLY_PROPERTY = "READ_ONLY_PROPERTY",

  // Validation errors — never retry, fix input
  INVALID_PARAMS = "INVALID_PARAMS",
  SCHEMA_VIOLATION = "SCHEMA_VIOLATION",

  // Internal errors — bug in Hephaestus
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERIALIZATION_ERROR = "SERIALIZATION_ERROR",
}
```

### 5.2 Error Response Format

Every tool error returns a structured object:

```json
{
  "error": {
    "category": "NODE_NOT_FOUND",
    "message": "Node '123:456' does not exist in the current document",
    "commandId": "cmd_a1b2c3",
    "retryable": false,
    "suggestion": "Use get_selection or search the document to find the correct node ID"
  }
}
```

### 5.3 Retry Policy

| Error Category | Auto-Retry | Max Retries | Backoff |
|---------------|-----------|-------------|---------|
| CONNECTION_LOST | Yes | 2 | 1s, 3s |
| COMMAND_TIMEOUT | Yes | 1 | immediate |
| FONT_NOT_LOADED | Yes (after font load attempt) | 1 | 2s |
| NODE_NOT_FOUND | No | — | — |
| INVALID_PARAMS | No | — | — |
| INTERNAL_ERROR | No | — | — |

### 5.4 Atomic Transactions

Composite operations (e.g., `create_frame` with children) execute as atomic transactions:

1. **Begin:** Plugin creates all nodes in memory
2. **Validate:** Check all operations succeeded
3. **Commit:** If all succeeded, nodes are committed to the document
4. **Rollback:** If any failed, all created nodes are deleted

The plugin implements this with try/catch around the full operation:

```javascript
// Plugin-side pseudo-code
async function executeComposite(commands) {
  const createdNodes = [];
  try {
    for (const cmd of commands) {
      const node = await execute(cmd);
      createdNodes.push(node);
    }
    return { status: "success", nodes: createdNodes.map(serialize) };
  } catch (error) {
    // Rollback: delete all created nodes
    for (const node of createdNodes) {
      node.remove();
    }
    return { status: "error", error: serialize(error) };
  }
}
```

### 5.5 Idempotency

Commands include an optional `idempotencyKey`. If the plugin receives a command with a key it has already processed, it returns the cached result instead of re-executing.

- Keys are stored in a bounded LRU cache (max 500 entries, 5-minute TTL)
- Only applicable to write operations
- Read operations are naturally idempotent

### 5.6 Font Handling

Text operations often fail because fonts aren't loaded. Hephaestus handles this proactively:

1. Before any text operation, the command includes the required `fontName`
2. The plugin calls `figma.loadFontAsync(fontName)` before setting text
3. If font loading fails, returns `FONT_NOT_LOADED` with the font name
4. Common fonts are pre-loaded on plugin start (Inter, Plus Jakarta Sans, Roboto)

---

## 6. Security

### 6.1 Local Only

- Relay server binds to `127.0.0.1` only (not `0.0.0.0`)
- No external network access from the relay
- Plugin communicates only with localhost

### 6.2 Plugin Authentication

- On first connection, plugin sends a shared secret (configured at MCP server start)
- All subsequent requests include the secret in `X-Auth-Token` header
- Secret is generated per session (random 32-byte hex string)
- Prevents other local processes from issuing commands

### 6.3 Code Execution Safety

The `execute` escape-hatch tool (raw `figma.*` code) has safeguards:

- Code is validated before execution (no `eval` of arbitrary strings beyond figma.* scope)
- Execution timeout: 10 seconds (configurable, max 30s)
- No access to network APIs (`fetch`, `XMLHttpRequest`) from executed code
- No access to `__html__` (plugin UI manipulation)

### 6.4 Rate Limiting

- Max 100 commands per second (prevents runaway loops)
- Max 10 concurrent pending commands (backpressure)
- If limits are exceeded, new commands are queued with a warning

---

## 7. Project Structure

```
hephaestus/
├── package.json
├── tsconfig.json
├── .eslintrc.json
│
├── src/
│   ├── index.ts                  # Entry point — starts MCP server + relay
│   │
│   ├── server/
│   │   ├── mcp-server.ts         # MCP server setup, tool registration
│   │   └── tool-router.ts        # Routes tool calls to handlers
│   │
│   ├── tools/
│   │   ├── index.ts              # Tool registry (all tool definitions)
│   │   ├── schemas.ts            # Zod schemas for all tool inputs
│   │   │
│   │   ├── read/
│   │   │   ├── get-node.ts       # Get node data
│   │   │   ├── get-selection.ts  # Get current selection
│   │   │   ├── get-page.ts       # Get page/document structure
│   │   │   ├── search.ts         # Search nodes by name/type
│   │   │   ├── screenshot.ts     # Capture node/page screenshot
│   │   │   └── get-styles.ts     # Get styles and variables
│   │   │
│   │   ├── write/
│   │   │   ├── create-node.ts    # Composite node creation
│   │   │   ├── update-node.ts    # Batch node property updates
│   │   │   ├── delete-node.ts    # Node deletion
│   │   │   ├── clone-node.ts     # Node duplication
│   │   │   ├── set-text.ts       # Text content and styling
│   │   │   └── execute.ts        # Raw figma.* escape hatch
│   │   │
│   │   ├── layout/
│   │   │   ├── auto-layout.ts    # Auto-layout configuration
│   │   │   ├── layout-child.ts   # Child sizing/alignment in AL
│   │   │   ├── grid.ts           # Layout grids
│   │   │   └── constraints.ts    # Constraints for non-AL frames
│   │   │
│   │   ├── components/
│   │   │   ├── instantiate.ts    # Component instance creation
│   │   │   ├── properties.ts     # Component property management
│   │   │   └── variants.ts       # Variant management
│   │   │
│   │   └── variables/
│   │       ├── collections.ts    # Variable collection CRUD
│   │       ├── variables.ts      # Variable CRUD
│   │       └── tokens.ts         # Design token setup
│   │
│   ├── relay/
│   │   ├── server.ts             # HTTP + WS relay server
│   │   ├── command-queue.ts      # Command lifecycle management
│   │   ├── connection.ts         # Connection state machine
│   │   └── heartbeat.ts          # Heartbeat / health monitoring
│   │
│   ├── rest-api/
│   │   ├── client.ts             # Figma REST API client
│   │   ├── files.ts              # File data endpoints
│   │   ├── components.ts         # Component endpoints
│   │   ├── variables.ts          # Variables endpoints
│   │   └── images.ts             # Image export endpoints
│   │
│   └── shared/
│       ├── types.ts              # Shared type definitions
│       ├── errors.ts             # Error types and factories
│       ├── logger.ts             # Structured logging
│       └── config.ts             # Configuration management
│
├── plugin/
│   ├── manifest.json             # Figma plugin manifest
│   ├── code.ts                   # Plugin main (runs in Figma sandbox)
│   ├── ui.html                   # Minimal UI (connection status)
│   ├── poller.ts                 # HTTP polling logic
│   ├── executor.ts               # Command execution engine
│   ├── ws-client.ts              # Optional WebSocket client
│   └── tsconfig.json
│
└── tests/
    ├── unit/
    │   ├── command-queue.test.ts
    │   ├── connection.test.ts
    │   ├── schemas.test.ts
    │   └── tool-handlers.test.ts
    ├── integration/
    │   ├── relay.test.ts
    │   └── plugin-mock.test.ts
    └── fixtures/
        └── sample-commands.json
```

---

## 8. Build & Development

### 8.1 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.x (strict) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| HTTP server | `fastify` (lightweight, fast) |
| WebSocket | `ws` |
| Validation | `zod` |
| Build | `tsup` (server) + `esbuild` (plugin) |
| Test | `vitest` |
| Lint | `eslint` + `prettier` |

### 8.2 Configuration

Hephaestus is configured via environment variables and/or a config file:

```json
// hephaestus.config.json
{
  "relay": {
    "port": 7780,
    "host": "127.0.0.1"
  },
  "polling": {
    "defaultInterval": 300,
    "burstInterval": 100,
    "idleInterval": 500,
    "idleThreshold": 10000
  },
  "websocket": {
    "enabled": true,
    "heartbeatInterval": 5000,
    "heartbeatTimeout": 3000,
    "reconnectBackoff": [500, 1000, 2000, 4000, 8000, 15000]
  },
  "commands": {
    "defaultTtl": 30000,
    "maxRetries": 1,
    "maxConcurrent": 10,
    "maxPerSecond": 100
  },
  "figma": {
    "personalAccessToken": "${FIGMA_PAT}",
    "preloadFonts": ["Inter", "Plus Jakarta Sans"]
  }
}
```

### 8.3 Installation & Usage

```bash
# Install
npm install -g hephaestus-figma

# Or run from source
git clone <repo>
cd hephaestus
npm install
npm run build

# Start the MCP server (stdio mode for Claude Code)
npx hephaestus

# Or add to Claude Code MCP config
# ~/.claude/settings.json
{
  "mcpServers": {
    "hephaestus": {
      "command": "npx",
      "args": ["hephaestus"],
      "env": {
        "FIGMA_PAT": "your-personal-access-token"
      }
    }
  }
}
```

**Plugin setup:**
1. Open Figma Desktop
2. Plugins → Development → Import plugin from manifest
3. Select `hephaestus/plugin/manifest.json`
4. Run the plugin in any file you want to work with

---

*Continued in [API.md](./API.md) (tool definitions) and [PROTOCOL.md](./PROTOCOL.md) (plugin protocol).*
