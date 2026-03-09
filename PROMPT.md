# Hephaestus — Implementation Prompt

> Execute this prompt to build the Hephaestus MCP server from the specifications in `specs/`.

---

## Context

You are building **Hephaestus**, a Model Context Protocol (MCP) server that gives AI clients full programmatic read/write access to Figma's canvas. The system has three tiers:

1. **MCP Server** — Node.js/TypeScript process that exposes tools via stdio
2. **Relay Server** — Embedded HTTP + WebSocket server on port 7780 (localhost only)
3. **Figma Plugin** — Thin relay that polls for commands and executes `figma.*` API calls

Read the full specifications before writing any code:
- `specs/SPEC.md` — Architecture, design principles, transport, error handling, security
- `specs/API.md` — All MCP tool definitions, parameters, and return types
- `specs/PROTOCOL.md` — Wire format, command types, plugin execution model, serialization

---

## Build Order & Parallel Workstreams

Execute these workstreams in parallel where possible. Dependencies are marked.

### Phase 1 — Foundation (parallel, no dependencies)

**Workstream 1A: Project Scaffolding & Shared Infrastructure**
```
1. Initialize the project:
   - package.json with dependencies: @modelcontextprotocol/sdk, fastify, ws, zod, uuid
   - Dev deps: typescript, tsup, esbuild, vitest, @types/node, @types/ws, eslint, prettier
   - tsconfig.json with strict mode, ES2022 target, NodeNext module resolution
   - .eslintrc.json and .prettierrc

2. Create shared modules (src/shared/):
   - types.ts — All TypeScript interfaces from the specs:
     * Command, CommandResult, CommandType enum, ErrorCategory enum
     * SerializedNode, SerializedPaint, SerializedEffect, SerializedAutoLayout
     * AutoLayoutParams, LayoutChildParams, CornerRadius, Padding
     * Fill (solid, linear-gradient, radial-gradient, image), Stroke, Effect
     * TextStyle, TextStyleRange, NodeType enum, BlendMode enum
     * ConnectionState enum (WAITING, POLLING, CONNECTED, DEGRADED)
     * CommandStatus enum (QUEUED, SENT, ACKNOWLEDGED, COMPLETED, TIMEOUT, RETRY, FAILED, EXPIRED)
   - errors.ts — HephaestusError class with category, message, retryable, suggestion fields
     * Factory functions: connectionError(), figmaApiError(), validationError(), internalError()
     * Error response serialization matching SPEC.md §5.2
   - logger.ts — Structured logger (JSON output for MCP compatibility, level filtering)
   - config.ts — Configuration loader:
     * Reads hephaestus.config.json with defaults
     * Environment variable overrides (FIGMA_PAT, RELAY_PORT, etc.)
     * Zod schema validation of config shape
     * Export typed Config interface
```

**Workstream 1B: Zod Schemas for All Tools**
```
Create src/tools/schemas.ts with Zod schemas for every tool input defined in API.md:
- Read tools: getNodeSchema, getSelectionSchema, getPageSchema, searchNodesSchema,
  screenshotSchema, getStylesSchema, getVariablesSchema, getComponentsSchema
- Write/Node: createNodeSchema (recursive for children), updateNodeSchema,
  batchUpdateNodesSchema, deleteNodesSchema, cloneNodeSchema, reparentNodeSchema,
  reorderChildrenSchema
- Write/Text: setTextSchema (with TextStyle and TextStyleRange)
- Write/Visual: setFillsSchema, setStrokesSchema, setEffectsSchema, setCornerRadiusSchema
- Write/Layout: setAutoLayoutSchema, setLayoutChildSchema, batchSetLayoutChildrenSchema,
  setLayoutGridSchema, setConstraintsSchema
- Write/Components: instantiateComponentSchema, setInstancePropertiesSchema,
  createComponentSchema, createComponentSetSchema, addComponentPropertySchema,
  editComponentPropertySchema, deleteComponentPropertySchema, setDescriptionSchema
- Write/Variables: createVariableCollectionSchema, deleteVariableCollectionSchema,
  createVariablesSchema, updateVariablesSchema, deleteVariableSchema,
  renameVariableSchema, addModeSchema, renameModeSchema, setupDesignTokensSchema
- Write/Pages: createPageSchema, renamePageSchema, deletePageSchema, setCurrentPageSchema
- Write/Comments: postCommentSchema, deleteCommentSchema
- Utility: executeSchema, batchExecuteSchema

Each schema must exactly match the parameter tables in API.md.
Use shared Zod types for reusable shapes (Fill, Stroke, Effect, AutoLayoutParams, etc.)
```

### Phase 2 — Core Infrastructure (parallel after Phase 1)

**Workstream 2A: Relay Server**
```
Build src/relay/ — the HTTP + WebSocket server that bridges MCP server and plugin.

1. src/relay/command-queue.ts — Command lifecycle management:
   - In-memory queue with Map<string, QueuedCommand>
   - States: QUEUED → SENT → ACKNOWLEDGED → COMPLETED (with TIMEOUT → RETRY → FAILED paths)
   - Methods: enqueue(command), markSent(id), markAcknowledged(id), complete(id, result),
     timeout(id), retry(id), getPending(), getInFlight()
   - TTL enforcement: commands expire after their ttl (default 30s)
   - Retry logic: max 1 retry per command, with backoff per SPEC.md §5.3
   - Rate limiting: max 100 commands/sec, max 10 concurrent pending
   - Idempotency: LRU cache (500 entries, 5-min TTL) for completed command results
   - Events: emit on state transitions for monitoring

2. src/relay/connection.ts — Connection state machine:
   - States: WAITING, POLLING, CONNECTED, DEGRADED (per SPEC.md §4.1)
   - Transitions: plugin connects → POLLING, WS upgrade → CONNECTED,
     WS drops → DEGRADED, WS reconnects → CONNECTED, plugin stops → WAITING
   - Track: sessionId, pluginId, fileKey, fileName, lastHeartbeat, transport type
   - Plugin authentication: validate X-Auth-Token header (32-byte hex secret)
   - Session management: generate sessionId on connect, invalidate on disconnect

3. src/relay/heartbeat.ts — Health monitoring:
   - Track missed polls (3 consecutive = disconnected)
   - Track missed WebSocket pongs (2 = connection dead)
   - Metrics: commands.total/success/failed/timeout, latency.avg/p95, connection uptime

4. src/relay/server.ts — HTTP + WebSocket relay:
   - Fastify HTTP server bound to 127.0.0.1:7780
   - Routes:
     * GET /health — return status, version, uptime, connection state, queue stats
     * POST /connect — plugin handshake (validate auth, store session, return config)
     * GET /commands — plugin polls for pending commands (X-Plugin-Id header)
       - Return pending commands as JSON array
       - 204 if no commands pending
       - Mark returned commands as SENT
       - Adaptive polling: 100ms burst / 300ms default / 500ms idle
     * POST /results — plugin posts command results (match to queued command, complete it)
     * POST /disconnect — clean plugin disconnect
     * GET /ws — WebSocket upgrade endpoint
   - WebSocket handling:
     * On upgrade: validate X-Session-Id, transition to CONNECTED state
     * Message types: command (server→plugin), result (plugin→server), ack, ping, pong
     * Heartbeat: server sends ping every 5s, expect pong within 3s
     * On command: push directly via WS instead of waiting for poll
     * Reconnection: exponential backoff 500ms → 15s max
   - Auth middleware: validate X-Auth-Token on all plugin endpoints
   - Generate per-session 32-byte hex secret on server start
```

**Workstream 2B: Figma REST API Client**
```
Build src/rest-api/ — client for read operations that bypass the plugin.

1. src/rest-api/client.ts — Base HTTP client:
   - Configurable base URL (https://api.figma.com/v1)
   - Auth via Personal Access Token (from config)
   - Rate limiting (respect Figma API limits)
   - Error handling with typed errors
   - Response caching (optional, short TTL)

2. src/rest-api/files.ts — File data endpoints:
   - getFile(fileKey, params) — GET /files/:key
   - getFileNodes(fileKey, nodeIds, params) — GET /files/:key/nodes
   - getFileVersions(fileKey) — GET /files/:key/versions

3. src/rest-api/components.ts — Component endpoints:
   - getFileComponents(fileKey) — GET /files/:key/components
   - getFileComponentSets(fileKey) — GET /files/:key/component_sets

4. src/rest-api/variables.ts — Variable endpoints:
   - getLocalVariables(fileKey) — GET /files/:key/variables/local
   - getPublishedVariables(fileKey) — GET /files/:key/variables/published

5. src/rest-api/images.ts — Image export:
   - getImage(fileKey, nodeIds, params) — GET /images/:key

6. src/rest-api/comments.ts — Comments:
   - getComments(fileKey) — GET /files/:key/comments
   - postComment(fileKey, params) — POST /files/:key/comments
   - deleteComment(fileKey, commentId) — DELETE /files/:key/comments/:id
```

### Phase 3 — MCP Server & Tool Handlers (after Phase 1 + 2A)

**Workstream 3A: MCP Server Core**
```
Build src/server/ — MCP server setup and tool routing.

1. src/server/mcp-server.ts — MCP server initialization:
   - Use @modelcontextprotocol/sdk Server class
   - stdio transport
   - Register all tools with name, description, and Zod input schema
   - Start relay server as embedded process
   - Handle graceful shutdown

2. src/server/tool-router.ts — Routes tool calls to handlers:
   - Map tool names to handler functions
   - For plugin-required tools: enqueue command, await result from queue
   - For REST API tools: call Figma REST API directly
   - Validate inputs against Zod schemas
   - Serialize responses to MCP content format
   - Handle errors: catch HephaestusError, format per SPEC.md §5.2

3. src/index.ts — Entry point:
   - Parse CLI args
   - Load config
   - Create MCP server + relay server
   - Start listening on stdio
   - Graceful shutdown on SIGINT/SIGTERM
```

**Workstream 3B: Tool Handlers — Read Tools**
```
Build src/tools/read/ — handlers for read operations.

Each handler receives validated params and returns structured JSON.
Use REST API client where possible, plugin commands where marked [plugin].

1. get-node.ts — getNode handler (REST API)
2. get-selection.ts — getSelection handler [plugin command]
3. get-page.ts — getPage handler (REST API with verbosity filtering)
4. search.ts — searchNodes handler [plugin command]
5. screenshot.ts — screenshot handler [plugin command, returns base64]
6. get-styles.ts — getStyles handler (REST API)
7. get-variables.ts — getVariables handler (REST API, with alias resolution)
8. get-components.ts — getComponents handler (REST API)
```

**Workstream 3C: Tool Handlers — Write Tools**
```
Build src/tools/write/ — handlers for write operations.
All write tools send commands to the plugin via the relay command queue.

1. create-node.ts — createNode handler:
   - Translate createNode params to CREATE_NODE command payload
   - Handle recursive children array (each child becomes part of the atomic tree)
   - Set atomic: true for composite creation
   - Return nodeId tree on success

2. update-node.ts — updateNode + batchUpdateNodes handlers:
   - Single update: UPDATE_NODE command
   - Batch: send all updates with same batchId, atomic: true

3. delete-node.ts — deleteNodes handler → DELETE_NODES command

4. clone-node.ts — cloneNode handler → CLONE_NODE command

5. set-text.ts — setText handler → SET_TEXT command
   - Include font info in payload for pre-loading

6. execute.ts — execute + batchExecute handlers:
   - execute: EXECUTE command with code and timeout
   - batchExecute: multiple operations with batchId, atomic flag
```

**Workstream 3D: Tool Handlers — Layout Tools**
```
Build src/tools/layout/ — handlers for layout operations.

1. auto-layout.ts — setAutoLayout handler → SET_AUTO_LAYOUT command
2. layout-child.ts — setLayoutChild + batchSetLayoutChildren handlers
3. grid.ts — setLayoutGrid handler → SET_LAYOUT_GRID command
4. constraints.ts — setConstraints handler → SET_CONSTRAINTS command
```

**Workstream 3E: Tool Handlers — Component & Variable Tools**
```
Build src/tools/components/ and src/tools/variables/:

Components:
1. instantiate.ts — instantiateComponent → INSTANTIATE_COMPONENT
2. properties.ts — setInstanceProperties, addComponentProperty,
   editComponentProperty, deleteComponentProperty, setDescription
3. variants.ts — createComponent, createComponentSet

Variables:
1. collections.ts — createVariableCollection, deleteVariableCollection
2. variables.ts — createVariables, updateVariables, deleteVariable, renameVariable,
   addMode, renameMode
3. tokens.ts — setupDesignTokens → SETUP_DESIGN_TOKENS (atomic)
```

### Phase 4 — Figma Plugin (parallel with Phase 3, depends on Phase 1)

**Workstream 4: Figma Plugin**
```
Build plugin/ — the Figma development plugin that acts as a thin relay.

1. plugin/manifest.json — per PROTOCOL.md §10.2:
   - name: "Hephaestus Bridge", id: "hephaestus-bridge-dev"
   - networkAccess: localhost/127.0.0.1 only

2. plugin/fonts.ts — Font loading:
   - preloadFonts(): load Inter + Plus Jakarta Sans (Regular/Medium/Semi Bold/Bold)
   - ensureFont(node, fontName): load on demand before text ops
   - resolveFontName(family, weight): weight number → style string mapping

3. plugin/serializer.ts — Node serialization:
   - serializeNode(node, depth, seen): recursive serializer with circular ref prevention
   - colorToHex() and hexToColor(): Figma RGB ↔ hex conversion
   - serializeAutoLayout(): Figma layout → Hephaestus format
   - Serialize fills, strokes, effects, text styles

4. plugin/idempotency.ts — LRU cache:
   - Max 500 entries, 5-minute TTL
   - get(key), set(key, result), has(key)

5. plugin/transaction.ts — Atomic transaction support:
   - captureState(nodeId): snapshot node properties for rollback
   - restoreState(nodeId, state): restore from snapshot
   - executeAtomic(fn): try/catch wrapper that rolls back created nodes

6. plugin/executor.ts — Command executor registry:
   - Map<CommandType, Executor> registry
   - executeCommand(command): TTL check → idempotency check → lookup → pre-process → execute → serialize → cache
   - Sequential execution (FIFO), read interleaving for priority:"read"
   - Timeout enforcement via Promise.race

7. plugin/executors/ — Individual executor implementations:
   Per PROTOCOL.md §3, implement an executor for every CommandType:

   a. nodes.ts:
      - executeCreateNode: create node tree atomically (recursive children, rollback on failure)
      - executeUpdateNode: apply property updates to existing node
      - executeDeleteNodes: delete nodes, return {deleted, notFound}
      - executeCloneNode: duplicate node to target parent
      - executeReparentNode: move node to new parent at index
      - executeReorderChildren: reorder children for z-index

   b. text.ts:
      - executeSetText: load fonts, set characters, apply style/styleRanges

   c. visual.ts:
      - executeSetFills: apply fill paints (solid, gradient, image)
      - executeSetStrokes: apply strokes with weight/align/dash/cap/join
      - executeSetEffects: apply shadows and blur effects
      - executeSetCornerRadius: uniform or per-corner radius

   d. layout.ts:
      - executeSetAutoLayout: apply auto-layout using applyAutoLayout() from PROTOCOL.md §5.3
      - executeSetLayoutChild: set alignSelf, grow, positioning on child
      - executeBatchSetLayoutChildren: update multiple children
      - executeSetLayoutGrid: apply column/row/uniform grids
      - executeSetConstraints: set horizontal/vertical constraints

   e. components.ts:
      - executeInstantiateComponent: figma.importComponentByKeyAsync or local lookup, apply variant + overrides
      - executeSetInstanceProperties: set TEXT/BOOLEAN/INSTANCE_SWAP/VARIANT props
      - executeCreateComponent: figma.createComponentFromNode() or manual conversion
      - executeCreateComponentSet: figma.combineAsVariants()
      - executeAddComponentProperty, executeEditComponentProperty, executeDeleteComponentProperty
      - executeSetDescription: set node.description

   f. variables.ts:
      - executeCreateVariableCollection: figma.variables.createVariableCollection()
      - executeDeleteVariableCollection
      - executeCreateVariables: batch create with figma.variables.createVariable()
      - executeUpdateVariables: batch set values by mode
      - executeDeleteVariable, executeRenameVariable
      - executeAddMode, executeRenameMode
      - executeSetupDesignTokens: atomic collection + modes + variables

   g. pages.ts:
      - executeCreatePage: figma.createPage()
      - executeRenamePage, executeDeletePage
      - executeSetCurrentPage: figma.setCurrentPageAsync()

   h. utility.ts:
      - executeExecute: eval code in async IIFE with timeout, no fetch/__html__
      - executePing: return { ok: true }

8. plugin/poller.ts — HTTP polling engine:
   - connect(): GET /health → POST /connect with auth
   - startPolling(): loop GET /commands at adaptive interval
   - On commands received: execute sequentially, POST /results
   - Adaptive interval: 100ms burst (commands pending), 300ms default, 500ms idle (>10s)
   - Track consecutive missed polls for disconnection detection

9. plugin/ws-client.ts — WebSocket client:
   - connect(): GET /ws with Upgrade header and X-Session-Id
   - Handle messages: command (execute + send result), ping (respond pong)
   - Send: result, ack, pong
   - Auto-reconnect with exponential backoff (500ms → 15s)
   - isConnected getter for status reporting

10. plugin/code.ts — Entry point (per PROTOCOL.md §10.3):
    - Show UI, preload fonts, init executor, start poller, attempt WS upgrade
    - Report status to UI, handle close event

11. plugin/ui.html — Minimal status UI (per PROTOCOL.md §10.4):
    - Green dot = WebSocket connected, amber = HTTP polling, red = disconnected

12. plugin/tsconfig.json — TypeScript config for Figma plugin environment
```

### Phase 5 — Build Configuration

**Workstream 5: Build & Entry Point**
```
1. Configure tsup for server build:
   - Entry: src/index.ts
   - Output: dist/
   - Format: ESM
   - Bundle dependencies
   - Add shebang for CLI execution

2. Configure esbuild for plugin build:
   - Entry: plugin/code.ts
   - Output: plugin/code.js (single bundle)
   - Target: ES2020 (Figma plugin sandbox)
   - Bundle all plugin modules into single file

3. Add package.json scripts:
   - build: build server + plugin
   - build:server: tsup
   - build:plugin: esbuild
   - dev: watch mode for both
   - test: vitest run
   - test:watch: vitest
   - lint: eslint + prettier check
   - start: node dist/index.js

4. Create hephaestus.config.json with defaults from SPEC.md §8.2
```

---

## Test Strategy

### Unit Tests (src/tests/unit/)

Run tests with `vitest`. Every module should have corresponding unit tests.

**Test Priority Order:**

```
1. command-queue.test.ts — Command lifecycle (CRITICAL):
   - Enqueue returns command with QUEUED status
   - markSent transitions to SENT
   - complete transitions to COMPLETED with result
   - TTL expiration: command expires after ttl ms
   - Retry: TIMEOUT → RETRY → re-queued (max 1 retry)
   - Failed after max retries
   - Rate limiting: reject when over 100 cmd/sec
   - Concurrency limiting: reject when over 10 concurrent
   - Idempotency: duplicate key returns cached result
   - LRU eviction at 500 entries

2. connection.test.ts — Connection state machine:
   - Initial state is WAITING
   - Plugin connect → POLLING
   - WS upgrade → CONNECTED
   - WS drop → DEGRADED
   - WS reconnect → CONNECTED
   - Plugin disconnect → WAITING
   - Auth validation: reject invalid X-Auth-Token
   - Session tracking: pluginId, fileKey stored on connect

3. schemas.test.ts — Zod schema validation:
   - Valid inputs pass for every tool schema
   - Missing required fields fail with descriptive error
   - Invalid types fail (string where number expected, etc.)
   - Optional fields are truly optional
   - Nested schemas (children in createNode) validate recursively
   - Edge cases: empty arrays, boundary numbers, hex color format

4. tool-handlers.test.ts — Tool handler logic:
   - Each handler correctly translates params to command payload
   - REST API handlers call the correct endpoint
   - Plugin handlers enqueue the correct CommandType
   - Error handling: HephaestusError is caught and formatted
   - Batch handlers set batchId and atomic flag

5. errors.test.ts — Error types and factories:
   - Each factory produces correct category and retryable flag
   - Error serialization matches SPEC.md §5.2 format
   - Suggestion field is populated for common errors

6. config.test.ts — Configuration loading:
   - Defaults are applied when no config file
   - Config file values override defaults
   - Environment variables override config file
   - Invalid config shapes are rejected with clear errors
```

### Integration Tests (src/tests/integration/)

```
1. relay.test.ts — Full relay server integration:
   - Start relay server on random port
   - Simulate plugin connection handshake (GET /health → POST /connect)
   - Enqueue command via queue, poll via GET /commands, verify command received
   - POST /results, verify command completed in queue
   - WebSocket upgrade: connect, receive command via WS, send result
   - Heartbeat: verify ping/pong cycle
   - Disconnection: stop polling, verify WAITING state after timeout
   - Auth: reject requests with wrong token
   - Adaptive polling: verify interval changes with queue depth

2. plugin-mock.test.ts — End-to-end with mock Figma API:
   - Mock figma.* namespace (createFrame, loadFontAsync, etc.)
   - Send CREATE_NODE command, verify figma.createFrame called with correct args
   - Verify serialized result matches expected SerializedNode shape
   - Test atomic rollback: fail mid-tree, verify all created nodes removed
   - Test font loading: SET_TEXT triggers loadFontAsync before setting text
   - Test idempotency: same idempotencyKey returns cached result
   - Test timeout: slow executor gets killed after TTL
```

### Test Fixtures (src/tests/fixtures/)

```
sample-commands.json — Example commands for every CommandType:
- Valid CREATE_NODE with children (atomic composite)
- Valid UPDATE_NODE with multiple properties
- Valid SET_TEXT with styleRanges
- Valid batch operation with 3 updates
- Various error scenarios (expired TTL, unknown type, invalid payload)
```

### Test Best Practices

```
- Use vitest with TypeScript directly (no compile step for tests)
- Mock external dependencies (Figma API, filesystem) at module boundaries
- Use test factories for creating valid Command/CommandResult objects
- Test error paths as thoroughly as happy paths
- Integration tests use real HTTP (start server on port 0 for random port)
- No flaky timing tests: use fake timers for TTL/heartbeat/polling tests
- Snapshot tests for serialized node shapes (catch accidental format changes)
- Coverage target: 90%+ on shared/, relay/, tools/; 80%+ on plugin/
```

---

## Implementation Best Practices

### Code Quality
- TypeScript strict mode everywhere (no `any` unless absolutely necessary)
- All public APIs documented with JSDoc
- Use discriminated unions for Fill, Effect types
- Use branded types for nodeId, commandId where it adds safety
- Keep modules focused: one file = one concern
- Export only what's needed (internal helpers stay private)

### Architecture
- Relay server is embedded in MCP server process (not separate)
- Command queue is the single source of truth for command state
- Connection state machine enforces valid transitions only
- Plugin is a pure executor — zero business logic, zero state beyond cache
- REST API client is stateless (auth token from config)

### Error Handling
- Every error has a category from ErrorCategory enum
- retryable flag drives auto-retry behavior
- suggestion field helps the AI client self-correct
- Never swallow errors — log at minimum
- Validation errors fail fast (before enqueuing)

### Security
- Relay binds to 127.0.0.1 ONLY (never 0.0.0.0)
- Per-session auth token validated on every request
- execute tool: no fetch, no __html__, timeout enforced
- Rate limiting prevents runaway loops
- No secrets in logs

### Performance
- Batch operations reduce round trips
- Adaptive polling prevents unnecessary traffic
- WebSocket is an optimization, not a requirement
- Idempotency cache prevents duplicate work
- Font pre-loading prevents per-operation latency

---

## Execution Instructions

When executing this prompt, use parallel agents for independent workstreams:

```
Phase 1: Run 1A and 1B in parallel
Phase 2: Run 2A and 2B in parallel (after Phase 1)
Phase 3: Run 3A, 3B, 3C, 3D, 3E in parallel (after Phase 2A completes)
Phase 4: Run alongside Phase 3 (only depends on Phase 1)
Phase 5: Run after all phases complete
Tests:  Write tests alongside their corresponding workstream
```

After all phases complete:
1. Run `npm run build` to verify compilation
2. Run `npm test` to verify all tests pass
3. Run `npm run lint` to verify code quality
4. Verify the plugin builds to a single `code.js` file
5. Smoke test: start the MCP server, verify `/health` endpoint responds
