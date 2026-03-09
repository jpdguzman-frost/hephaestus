# Hephaestus — Plugin Communication Protocol

> Defines the wire format, command execution model, and plugin implementation
> requirements for the Figma relay plugin.

---

## Table of Contents

1. [Command Wire Format](#1-command-wire-format)
2. [Result Wire Format](#2-result-wire-format)
3. [Command Types](#3-command-types)
4. [Plugin Execution Model](#4-plugin-execution-model)
5. [Serialization Rules](#5-serialization-rules)
6. [Font Loading Protocol](#6-font-loading-protocol)
7. [Atomic Transactions](#7-atomic-transactions)
8. [Connection Handshake](#8-connection-handshake)
9. [Health & Diagnostics](#9-health--diagnostics)
10. [Plugin Implementation Guide](#10-plugin-implementation-guide)

---

## 1. Command Wire Format

Every command from the MCP server to the plugin uses this envelope:

```typescript
interface Command {
  /** Unique command ID (UUID v4) */
  id: string;

  /** Command type — maps to a plugin executor function */
  type: CommandType;

  /** Command-specific payload */
  payload: Record<string, unknown>;

  /** Unix timestamp (ms) when the command was created */
  timestamp: number;

  /** Time-to-live in ms — command expires if not executed within this window */
  ttl: number;

  /** Optional idempotency key for retry safety */
  idempotencyKey?: string;

  /** Whether this command is part of an atomic batch */
  atomic?: boolean;

  /** Batch ID if this command is part of a batch */
  batchId?: string;

  /** Sequence number within a batch (for ordering) */
  batchSeq?: number;

  /** Total commands in the batch */
  batchTotal?: number;
}
```

**Example:**
```json
{
  "id": "cmd_8f2a1b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "type": "CREATE_NODE",
  "payload": {
    "type": "FRAME",
    "name": "Card",
    "parentId": "0:1",
    "size": { "width": 320, "height": 200 },
    "fills": [{ "type": "solid", "color": "#FFFFFF" }],
    "autoLayout": {
      "direction": "vertical",
      "spacing": 16,
      "padding": 24
    }
  },
  "timestamp": 1741500000000,
  "ttl": 30000
}
```

---

## 2. Result Wire Format

Every result from the plugin back to the MCP server:

```typescript
interface CommandResult {
  /** Matches the command ID */
  id: string;

  /** Execution status */
  status: "success" | "error";

  /** Result data (on success) */
  result?: Record<string, unknown>;

  /** Error details (on failure) */
  error?: {
    category: ErrorCategory;
    message: string;
    figmaError?: string;       // Raw Figma error if available
    nodeId?: string;           // Node that caused the error
    retryable: boolean;
    suggestion?: string;
  };

  /** Execution duration in ms */
  duration: number;

  /** Unix timestamp (ms) when execution completed */
  timestamp: number;

  /** Batch ID if this is part of a batch */
  batchId?: string;

  /** Sequence number within batch */
  batchSeq?: number;
}
```

**Success example:**
```json
{
  "id": "cmd_8f2a1b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "status": "success",
  "result": {
    "nodeId": "456:789",
    "name": "Card",
    "type": "FRAME",
    "children": [
      { "nodeId": "456:790", "name": "Title", "type": "TEXT" }
    ]
  },
  "duration": 23,
  "timestamp": 1741500000023
}
```

**Error example:**
```json
{
  "id": "cmd_8f2a1b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "status": "error",
  "error": {
    "category": "FONT_NOT_LOADED",
    "message": "Font 'Custom Font' could not be loaded",
    "figmaError": "Font family 'Custom Font' is not available",
    "retryable": true,
    "suggestion": "Ensure the font is installed or use a system font like 'Inter'"
  },
  "duration": 1502,
  "timestamp": 1741500001502
}
```

---

## 3. Command Types

Each command type maps to a specific executor function in the plugin.

### Node Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `CREATE_NODE` | Create node (optionally with children) | `type`, `parentId`, `name`, `size`, `fills`, `autoLayout`, `children` |
| `UPDATE_NODE` | Update node properties | `nodeId`, any updatable properties |
| `DELETE_NODES` | Delete one or more nodes | `nodeIds` |
| `CLONE_NODE` | Duplicate a node | `nodeId`, `parentId`, `position` |
| `REPARENT_NODE` | Move node to new parent | `nodeId`, `parentId`, `index` |
| `REORDER_CHILDREN` | Reorder children (z-index) | `parentId`, `childIds` |

### Text Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `SET_TEXT` | Set text content and style | `nodeId`, `text`, `style`, `styleRanges` |

### Visual Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `SET_FILLS` | Set fill paints | `nodeId`, `fills` |
| `SET_STROKES` | Set stroke paints | `nodeId`, `strokes`, `strokeWeight`, `strokeAlign` |
| `SET_EFFECTS` | Set effects | `nodeId`, `effects` |
| `SET_CORNER_RADIUS` | Set corner radius | `nodeId`, `radius` |

### Layout Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `SET_AUTO_LAYOUT` | Configure auto-layout | `nodeId`, `direction`, `spacing`, `padding`, `primaryAxisAlign`, ... |
| `SET_LAYOUT_CHILD` | Configure child layout behavior | `nodeId`, `alignSelf`, `grow`, `positioning` |
| `BATCH_SET_LAYOUT_CHILDREN` | Configure multiple children | `parentId`, `children` |
| `SET_LAYOUT_GRID` | Set layout grids | `nodeId`, `grids` |
| `SET_CONSTRAINTS` | Set constraints | `nodeId`, `horizontal`, `vertical` |

### Component Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `INSTANTIATE_COMPONENT` | Create component instance | `componentKey`, `nodeId`, `variant`, `overrides` |
| `SET_INSTANCE_PROPERTIES` | Update instance properties | `nodeId`, `properties` |
| `CREATE_COMPONENT` | Convert frame to component | `nodeId`, `description` |
| `CREATE_COMPONENT_SET` | Combine into variant group | `componentIds`, `name` |
| `ADD_COMPONENT_PROPERTY` | Add property | `nodeId`, `name`, `type`, `defaultValue` |
| `EDIT_COMPONENT_PROPERTY` | Edit property | `nodeId`, `propertyName`, `name`, `defaultValue` |
| `DELETE_COMPONENT_PROPERTY` | Remove property | `nodeId`, `propertyName` |
| `SET_DESCRIPTION` | Set description | `nodeId`, `description` |

### Variable Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `CREATE_VARIABLE_COLLECTION` | Create collection | `name`, `initialModeName`, `additionalModes` |
| `DELETE_VARIABLE_COLLECTION` | Delete collection | `collectionId` |
| `CREATE_VARIABLES` | Create variables (batch) | `collectionId`, `variables` |
| `UPDATE_VARIABLES` | Update values (batch) | `updates` |
| `DELETE_VARIABLE` | Delete variable | `variableId` |
| `RENAME_VARIABLE` | Rename variable | `variableId`, `newName` |
| `ADD_MODE` | Add mode | `collectionId`, `modeName` |
| `RENAME_MODE` | Rename mode | `collectionId`, `modeId`, `newName` |
| `SETUP_DESIGN_TOKENS` | Full token setup | `collectionName`, `modes`, `tokens` |

### Page Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `CREATE_PAGE` | Create page | `name`, `index` |
| `RENAME_PAGE` | Rename page | `pageId`, `name` |
| `DELETE_PAGE` | Delete page | `pageId` |
| `SET_CURRENT_PAGE` | Switch active page | `pageId` |

### Read Commands (plugin-only)

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `GET_NODE` | Get node data | `nodeIds`, `depth`, `properties` |
| `GET_SELECTION` | Get selection | `includeChildren`, `depth` |
| `SEARCH_NODES` | Search nodes | `query`, `type`, `withinId`, `limit` |
| `SCREENSHOT` | Capture image | `nodeId`, `format`, `scale` |

### Utility Commands

| CommandType | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `EXECUTE` | Run arbitrary code | `code`, `timeout` |
| `PING` | Health check | (none) |

---

## 4. Plugin Execution Model

### 4.1 Executor Registry

The plugin maintains a map of command types to executor functions:

```typescript
type Executor = (payload: Record<string, unknown>) => Promise<unknown>;

const executors: Map<CommandType, Executor> = new Map([
  ["CREATE_NODE", executeCreateNode],
  ["UPDATE_NODE", executeUpdateNode],
  ["SET_AUTO_LAYOUT", executeSetAutoLayout],
  // ... all command types
]);
```

### 4.2 Execution Flow

```
Command received
       │
       ▼
  ┌─────────────┐
  │ Check TTL   │──── expired ──▶ discard, return EXPIRED error
  └──────┬──────┘
         │ valid
         ▼
  ┌─────────────┐
  │ Check       │──── duplicate ──▶ return cached result
  │ idempotency │
  └──────┬──────┘
         │ new
         ▼
  ┌─────────────┐
  │ Lookup      │──── not found ──▶ return INVALID_OPERATION error
  │ executor    │
  └──────┬──────┘
         │ found
         ▼
  ┌─────────────┐
  │ Pre-process │
  │ (font load, │
  │  resolve    │
  │  refs)      │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ Execute     │──── error ──▶ serialize error, return
  │ (figma.*)   │
  └──────┬──────┘
         │ success
         ▼
  ┌─────────────┐
  │ Serialize   │
  │ result      │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ Cache result│
  │ (if idemp.) │
  └──────┬──────┘
         │
         ▼
    Return result
```

### 4.3 Sequential Execution

Commands are executed **sequentially** (one at a time) to avoid race conditions in Figma's plugin API. The plugin processes commands in FIFO order from the queue.

Exception: Read commands (`GET_NODE`, `SEARCH_NODES`, `SCREENSHOT`) can be interleaved with pending write commands if marked as `priority: "read"`.

### 4.4 Timeout Enforcement

Each command execution has a timeout (from the command's `ttl` or a default of 30s):

```typescript
async function executeWithTimeout(executor: Executor, payload: unknown, timeout: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const result = await Promise.race([
      executor(payload),
      new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new TimeoutError(`Command timed out after ${timeout}ms`))
        );
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
```

---

## 5. Serialization Rules

### 5.1 Node Serialization

When returning node data, the plugin serializes Figma nodes into plain objects:

```typescript
interface SerializedNode {
  nodeId: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number;
  opacity?: number;
  // Only included if present:
  fills?: SerializedPaint[];
  strokes?: SerializedPaint[];
  effects?: SerializedEffect[];
  cornerRadius?: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  autoLayout?: SerializedAutoLayout;
  constraints?: { horizontal: string; vertical: string };
  children?: SerializedNode[];  // only if depth > 0
  // Text-specific:
  characters?: string;
  textStyle?: SerializedTextStyle;
  // Component-specific:
  componentKey?: string;
  componentProperties?: Record<string, { type: string; value: string | boolean }>;
}
```

### 5.2 Color Serialization

Figma uses `{ r: number, g: number, b: number }` (0-1 range). Hephaestus converts:

```typescript
// Figma → Hephaestus
function colorToHex(color: RGB, opacity?: number): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, "0");
  const g = Math.round(color.g * 255).toString(16).padStart(2, "0");
  const b = Math.round(color.b * 255).toString(16).padStart(2, "0");
  if (opacity !== undefined && opacity < 1) {
    const a = Math.round(opacity * 255).toString(16).padStart(2, "0");
    return `#${r}${g}${b}${a}`.toUpperCase();
  }
  return `#${r}${g}${b}`.toUpperCase();
}

// Hephaestus → Figma
function hexToColor(hex: string): { color: RGB; opacity: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const opacity = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
  return { color: { r, g, b }, opacity };
}
```

### 5.3 Auto-Layout Serialization

```typescript
// Figma → Hephaestus
function serializeAutoLayout(node: FrameNode): SerializedAutoLayout | undefined {
  if (node.layoutMode === "NONE") return undefined;
  return {
    direction: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
    wrap: node.layoutWrap === "WRAP",
    spacing: node.itemSpacing,
    padding: {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft,
    },
    primaryAxisAlign: mapAxisAlign(node.primaryAxisAlignItems),
    counterAxisAlign: mapCounterAlign(node.counterAxisAlignItems),
    primaryAxisSizing: node.primaryAxisSizingMode === "AUTO" ? "hug" : "fixed",
    counterAxisSizing: node.counterAxisSizingMode === "AUTO" ? "hug" : "fixed",
  };
}

// Hephaestus → Figma
function applyAutoLayout(node: FrameNode, params: AutoLayoutParams): void {
  if (params.enabled === false) {
    node.layoutMode = "NONE";
    return;
  }

  node.layoutMode = params.direction === "horizontal" ? "HORIZONTAL" : "VERTICAL";

  if (params.wrap !== undefined) {
    node.layoutWrap = params.wrap ? "WRAP" : "NO_WRAP";
  }

  if (params.spacing !== undefined) {
    if (params.spacing === "auto") {
      node.primaryAxisAlignItems = "SPACE_BETWEEN";
    } else {
      node.itemSpacing = params.spacing;
    }
  }

  if (params.padding !== undefined) {
    if (typeof params.padding === "number") {
      node.paddingTop = params.padding;
      node.paddingRight = params.padding;
      node.paddingBottom = params.padding;
      node.paddingLeft = params.padding;
    } else {
      node.paddingTop = params.padding.top;
      node.paddingRight = params.padding.right;
      node.paddingBottom = params.padding.bottom;
      node.paddingLeft = params.padding.left;
    }
  }

  if (params.primaryAxisAlign) {
    node.primaryAxisAlignItems = mapAlignToFigma(params.primaryAxisAlign);
  }
  if (params.counterAxisAlign) {
    node.counterAxisAlignItems = mapCounterAlignToFigma(params.counterAxisAlign);
  }
  if (params.primaryAxisSizing) {
    node.primaryAxisSizingMode = params.primaryAxisSizing === "hug" ? "AUTO" : "FIXED";
  }
  if (params.counterAxisSizing) {
    node.counterAxisSizingMode = params.counterAxisSizing === "hug" ? "AUTO" : "FIXED";
  }
}
```

### 5.4 Circular Reference Prevention

Figma's node tree can have circular references (e.g., component instances referencing their main component). The serializer uses a depth limit and a `seen` set:

```typescript
function serializeNode(node: SceneNode, depth: number, seen = new Set<string>()): SerializedNode {
  if (seen.has(node.id)) {
    return { nodeId: node.id, name: node.name, type: node.type, circular: true };
  }
  seen.add(node.id);

  const result: SerializedNode = {
    nodeId: node.id,
    name: node.name,
    type: node.type,
    // ... other properties
  };

  if (depth > 0 && "children" in node) {
    result.children = node.children.map(child =>
      serializeNode(child, depth - 1, seen)
    );
  }

  return result;
}
```

---

## 6. Font Loading Protocol

Text operations require fonts to be loaded before setting characters or styles.

### 6.1 Pre-loading

On plugin start, common fonts are pre-loaded:

```typescript
const PRELOAD_FONTS = [
  { family: "Inter", style: "Regular" },
  { family: "Inter", style: "Medium" },
  { family: "Inter", style: "Semi Bold" },
  { family: "Inter", style: "Bold" },
  { family: "Plus Jakarta Sans", style: "Regular" },
  { family: "Plus Jakarta Sans", style: "Medium" },
  { family: "Plus Jakarta Sans", style: "Semi Bold" },
  { family: "Plus Jakarta Sans", style: "Bold" },
];

async function preloadFonts() {
  for (const font of PRELOAD_FONTS) {
    try {
      await figma.loadFontAsync(font);
    } catch {
      console.warn(`Could not preload font: ${font.family} ${font.style}`);
    }
  }
}
```

### 6.2 On-Demand Loading

Before any text mutation, the executor loads the required font:

```typescript
async function ensureFont(node: TextNode, fontName?: FontName): Promise<void> {
  // If setting new font, load it
  if (fontName) {
    await figma.loadFontAsync(fontName);
    return;
  }

  // Otherwise, load the font(s) already used by the text node
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  for (const font of fonts) {
    await figma.loadFontAsync(font);
  }
}
```

### 6.3 Font Name Resolution

Hephaestus accepts simplified font specifications and resolves them:

```typescript
// Input: { fontFamily: "Inter", fontWeight: 700 }
// Resolved: { family: "Inter", style: "Bold" }

const WEIGHT_TO_STYLE: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

function resolveFontName(family: string, weight: number = 400): FontName {
  return { family, style: WEIGHT_TO_STYLE[weight] || "Regular" };
}
```

---

## 7. Atomic Transactions

### 7.1 Single-Command Atomicity

For composite commands (e.g., `CREATE_NODE` with children), the executor wraps the entire operation:

```typescript
async function executeCreateNode(payload: CreateNodePayload): Promise<SerializedNode> {
  const created: SceneNode[] = [];

  try {
    const root = createSingleNode(payload);
    created.push(root);

    if (payload.children) {
      for (const childPayload of payload.children) {
        const child = await executeCreateNode(childPayload);
        root.appendChild(child.raw);
        created.push(child.raw);
      }
    }

    applyProperties(root, payload);
    return serializeNode(root, 1);

  } catch (error) {
    // Rollback: remove all created nodes
    for (const node of created.reverse()) {
      try { node.remove(); } catch { /* already removed */ }
    }
    throw error;
  }
}
```

### 7.2 Batch Atomicity

For `batch_execute` with `atomic: true`, the MCP server sends all commands with the same `batchId`. The plugin collects all results and only commits if all succeed:

```typescript
async function executeBatch(commands: Command[]): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  const createdNodes: SceneNode[] = [];
  const originalStates: Map<string, NodeState> = new Map();

  try {
    for (const cmd of commands) {
      // Capture pre-state for update commands
      if (cmd.type === "UPDATE_NODE") {
        originalStates.set(cmd.payload.nodeId, captureState(cmd.payload.nodeId));
      }

      const result = await executeCommand(cmd);
      results.push(result);

      if (result.status === "error") {
        throw new BatchError(cmd.id, result.error);
      }

      // Track created nodes for rollback
      if (cmd.type === "CREATE_NODE" && result.result?.nodeId) {
        createdNodes.push(figma.getNodeById(result.result.nodeId));
      }
    }

    return results;

  } catch (error) {
    // Rollback all created nodes
    for (const node of createdNodes.reverse()) {
      try { node.remove(); } catch {}
    }

    // Restore original states for updated nodes
    for (const [nodeId, state] of originalStates) {
      try { restoreState(nodeId, state); } catch {}
    }

    // Mark all results as rolled back
    return results.map(r => ({
      ...r,
      status: "error",
      error: {
        category: "BATCH_ROLLBACK",
        message: `Batch rolled back due to failure in command ${error.commandId}`,
        retryable: false,
      },
    }));
  }
}
```

### 7.3 State Capture for Rollback

For update operations that need rollback, capture the node's state before modification:

```typescript
interface NodeState {
  fills?: readonly Paint[];
  strokes?: readonly Paint[];
  effects?: readonly Effect[];
  opacity?: number;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  cornerRadius?: number | typeof figma.mixed;
  layoutMode?: string;
  // ... other properties
}

function captureState(nodeId: string): NodeState {
  const node = figma.getNodeById(nodeId) as SceneNode;
  return {
    fills: "fills" in node ? [...node.fills] : undefined,
    strokes: "strokes" in node ? [...node.strokes] : undefined,
    effects: "effects" in node ? [...node.effects] : undefined,
    opacity: node.opacity,
    position: { x: node.x, y: node.y },
    size: { width: node.width, height: node.height },
    // ... capture all modifiable properties
  };
}
```

---

## 8. Connection Handshake

### 8.1 Initial Connection (HTTP)

When the plugin starts, it performs a handshake:

```
Plugin                          Relay Server
  │                                  │
  │  GET /health                     │
  │ ────────────────────────────────▶│
  │                                  │
  │  200 { version, authChallenge }  │
  │ ◀────────────────────────────────│
  │                                  │
  │  POST /connect                   │
  │  { pluginId, fileKey, fileName,  │
  │    authResponse, capabilities }  │
  │ ────────────────────────────────▶│
  │                                  │
  │  200 { sessionId, config }       │
  │ ◀────────────────────────────────│
  │                                  │
  │  GET /commands (polling starts)  │
  │ ────────────────────────────────▶│
  │          ...                     │
```

**Connect payload:**
```json
{
  "pluginId": "heph_a1b2c3d4",
  "fileKey": "wRT2n5V1GUhkOBX0x0JMDq",
  "fileName": "My Design File",
  "authResponse": "hmac-sha256-of-challenge",
  "capabilities": {
    "maxConcurrent": 1,
    "supportedTypes": ["CREATE_NODE", "UPDATE_NODE", "..."],
    "figmaVersion": "126.5.1",
    "pluginVersion": "0.1.0"
  }
}
```

**Connect response:**
```json
{
  "sessionId": "sess_x1y2z3",
  "config": {
    "pollingInterval": 300,
    "burstInterval": 100,
    "idleInterval": 500,
    "idleThreshold": 10000,
    "preloadFonts": ["Inter", "Plus Jakarta Sans"]
  }
}
```

### 8.2 WebSocket Upgrade

After HTTP connection is established, the plugin may upgrade:

```
Plugin                          Relay Server
  │                                  │
  │  GET /ws                         │
  │  Upgrade: websocket              │
  │  X-Session-Id: sess_x1y2z3      │
  │ ────────────────────────────────▶│
  │                                  │
  │  101 Switching Protocols         │
  │ ◀────────────────────────────────│
  │                                  │
  │  ◀──── ping (every 5s) ────     │
  │  ──── pong ────▶                 │
  │                                  │
  │  ◀──── command ────             │
  │  ──── ack ────▶                  │
  │  ──── result ────▶              │
```

### 8.3 Disconnection

When the plugin closes (user closes it or switches files):

```
Plugin                          Relay Server
  │                                  │
  │  POST /disconnect                │
  │  { sessionId, reason }           │
  │ ────────────────────────────────▶│
  │                                  │
  │  200 OK                          │
  │ ◀────────────────────────────────│
```

If the plugin crashes (no disconnect message), the relay detects it via:
- 3 consecutive missed polls (HTTP mode)
- 2 missed heartbeat pongs (WebSocket mode)

---

## 9. Health & Diagnostics

### 9.1 Health Endpoint

```
GET /health

Response:
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600,
  "connection": {
    "state": "CONNECTED",
    "transport": "websocket",
    "pluginId": "heph_a1b2c3d4",
    "fileKey": "wRT2n5V1GUhkOBX0x0JMDq",
    "lastHeartbeat": "2026-03-09T12:00:00Z"
  },
  "queue": {
    "pending": 0,
    "inFlight": 1,
    "completedTotal": 142,
    "failedTotal": 1,
    "averageLatency": 45
  }
}
```

### 9.2 Metrics Tracked

| Metric | Description |
|--------|-------------|
| `commands.total` | Total commands processed |
| `commands.success` | Successful commands |
| `commands.failed` | Failed commands |
| `commands.timeout` | Timed-out commands |
| `commands.retried` | Retried commands |
| `commands.latency.avg` | Average execution time (ms) |
| `commands.latency.p95` | 95th percentile execution time |
| `connection.uptime` | Time since last connection |
| `connection.reconnects` | Number of reconnections |
| `connection.state` | Current connection state |
| `transport.http.polls` | Total HTTP polls |
| `transport.ws.messages` | Total WS messages |

---

## 10. Plugin Implementation Guide

### 10.1 File Structure

```
plugin/
├── manifest.json        # Figma plugin manifest
├── code.ts              # Entry point (plugin main thread)
├── ui.html              # Minimal UI
├── poller.ts            # HTTP polling engine
├── ws-client.ts         # WebSocket client
├── executor.ts          # Command executor registry
├── executors/
│   ├── nodes.ts         # Node CRUD executors
│   ├── text.ts          # Text executors
│   ├── visual.ts        # Fill/stroke/effect executors
│   ├── layout.ts        # Auto-layout/grid/constraint executors
│   ├── components.ts    # Component executors
│   ├── variables.ts     # Variable/token executors
│   ├── pages.ts         # Page executors
│   └── utility.ts       # Execute, ping
├── serializer.ts        # Node → JSON serialization
├── fonts.ts             # Font loading and resolution
├── transaction.ts       # Atomic transaction support
├── idempotency.ts       # Idempotency cache
└── tsconfig.json
```

### 10.2 Plugin Manifest

```json
{
  "name": "Hephaestus Bridge",
  "id": "hephaestus-bridge-dev",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "permissions": ["currentuser"],
  "networkAccess": {
    "allowedDomains": ["localhost", "127.0.0.1"],
    "reasoning": "Local MCP relay server communication"
  }
}
```

### 10.3 Main Loop

```typescript
// code.ts — Plugin entry point

import { Poller } from "./poller";
import { WSClient } from "./ws-client";
import { Executor } from "./executor";
import { preloadFonts } from "./fonts";

const RELAY_URL = "http://127.0.0.1:7780";

async function main() {
  // Show minimal UI
  figma.showUI(__html__, { visible: true, width: 200, height: 60 });

  // Pre-load common fonts
  await preloadFonts();

  // Initialize executor
  const executor = new Executor();

  // Start HTTP polling (always-on baseline)
  const poller = new Poller(RELAY_URL, executor);
  await poller.connect();
  await poller.startPolling();

  // Attempt WebSocket upgrade (optional fast path)
  const ws = new WSClient(RELAY_URL, executor);
  ws.connect(); // non-blocking, auto-reconnect

  // Report status to UI
  figma.ui.postMessage({
    type: "status",
    connected: true,
    transport: ws.isConnected ? "websocket" : "http",
  });

  // Handle plugin close
  figma.on("close", () => {
    poller.disconnect();
    ws.disconnect();
  });
}

main().catch(console.error);
```

### 10.4 UI (Minimal)

```html
<!-- ui.html -->
<div id="status" style="
  font-family: Inter, sans-serif;
  font-size: 12px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
">
  <span id="dot" style="
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #999;
  "></span>
  <span id="label">Connecting...</span>
</div>

<script>
  const dot = document.getElementById("dot");
  const label = document.getElementById("label");

  const colors = {
    connected: "#22C55E",
    polling: "#F59E0B",
    disconnected: "#EF4444",
  };

  window.onmessage = (event) => {
    const msg = event.data.pluginMessage;
    if (msg.type === "status") {
      if (msg.connected) {
        dot.style.background = msg.transport === "websocket"
          ? colors.connected
          : colors.polling;
        label.textContent = msg.transport === "websocket"
          ? "Connected (WS)"
          : "Connected (HTTP)";
      } else {
        dot.style.background = colors.disconnected;
        label.textContent = "Disconnected";
      }
    }
  };
</script>
```

---

*See [SPEC.md](./SPEC.md) for architecture overview and [API.md](./API.md) for tool definitions.*
