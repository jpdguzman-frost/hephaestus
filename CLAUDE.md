# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rex is an MCP (Model Context Protocol) server that gives AI clients full programmatic read/write access to Figma's canvas. It has a three-tier architecture:

1. **MCP Server** — Node.js/TypeScript process exposing tools via stdio
2. **Relay Server** — Embedded HTTP + WebSocket server on `127.0.0.1:7780` bridging MCP server and plugin
3. **Figma Plugin** — Thin relay that polls for commands and executes `figma.*` API calls inside the Figma desktop app

The relay server is embedded in the MCP server process (not separate). HTTP polling is the reliable baseline; WebSocket is an optional optimization.

## Specifications

All design decisions are documented in `specs/`:
- `specs/SPEC.md` — Architecture, design principles, transport, error handling, security
- `specs/API.md` — All MCP tool definitions, parameters, and return types
- `specs/PROTOCOL.md` — Wire format, command types, plugin execution model, serialization
- `PROMPT.md` — Build order, phased workstreams, test strategy

Always consult these specs before implementing or modifying features. Tool schemas must exactly match the parameter tables in API.md.

## Build & Development Commands

```bash
npm run build           # Build server + plugin
npm run build:server    # Build server only (tsup)
npm run build:plugin    # Build plugin only (esbuild → plugin/code.js)
npm run dev             # Watch mode for both
npm run start           # node dist/index.js
npm run test            # vitest run
npm run test:watch      # vitest (watch mode)
npm run lint            # eslint + prettier check
```

## Tech Stack

- **Runtime:** Node.js with TypeScript (strict mode, ES2022 target, NodeNext module resolution)
- **MCP SDK:** `@modelcontextprotocol/sdk` with stdio transport
- **HTTP Server:** Fastify (relay server)
- **WebSocket:** `ws` library
- **Validation:** Zod schemas for all tool inputs
- **Build:** tsup (server), esbuild (plugin → single `plugin/code.js` bundle, ES2020 target)
- **Testing:** vitest
- **IDs:** `uuid` for command IDs

## Source Structure

```
src/
  shared/         # Types, errors, logger, config (used by both server and relay)
  relay/          # HTTP + WebSocket relay server (command-queue, connection state machine, heartbeat)
  rest-api/       # Figma REST API client (files, components, variables, images, comments)
  server/         # MCP server core (tool router, stdio setup)
  tools/
    schemas.ts    # Zod schemas for all tool inputs
    read/         # Read tool handlers (some use REST API, some use plugin)
    write/        # Write tool handlers (all go through plugin relay)
    layout/       # Layout tool handlers (auto-layout, grid, constraints)
    components/   # Component & variant tool handlers
    variables/    # Variable & design token tool handlers
  tests/
    unit/         # Unit tests
    integration/  # Integration tests (relay, mock plugin)
    fixtures/     # Sample commands for every CommandType

plugin/
  manifest.json   # Figma plugin manifest (localhost-only network access)
  code.ts         # Entry point
  ui.html         # Status indicator UI
  poller.ts       # HTTP polling engine (adaptive: 100ms burst / 300ms default / 500ms idle)
  ws-client.ts    # WebSocket client with auto-reconnect
  executor.ts     # Command executor registry (sequential FIFO execution)
  executors/      # Individual command executors (nodes, text, visual, layout, components, variables, pages, utility)
  serializer.ts   # Node serialization with circular ref prevention
  fonts.ts        # Font pre-loading (Inter, Plus Jakarta Sans)
  transaction.ts  # Atomic transaction support with rollback
  idempotency.ts  # LRU cache (500 entries, 5-min TTL)
```

## Key Architecture Patterns

- **Command lifecycle:** QUEUED → SENT → ACKNOWLEDGED → COMPLETED (with TIMEOUT → RETRY → FAILED paths). Max 1 retry per command with backoff. Default TTL is 30s.
- **Connection state machine:** WAITING → POLLING → CONNECTED → DEGRADED. Plugin connect triggers POLLING, WS upgrade triggers CONNECTED, WS drop triggers DEGRADED.
- **Read tools** use the Figma REST API directly (no plugin needed) unless marked `[plugin]` in API.md.
- **Write tools** always go through the relay command queue to the plugin.
- **Atomic operations:** Composite node creation and batch updates use `atomic: true` with full rollback on failure.
- **Rate limiting:** Max 100 commands/sec, max 10 concurrent pending commands.
- **Idempotency:** LRU cache (500 entries, 5-min TTL) for completed command results.
- **Auth:** Per-session 32-byte hex token validated via `X-Auth-Token` header on all plugin endpoints.

## Security Constraints

- Relay binds to `127.0.0.1` only — never `0.0.0.0`
- `execute` tool: no `fetch`, no `__html__`, timeout enforced
- No secrets in logs
- Plugin network access is localhost-only (enforced in manifest.json)

## Testing

Coverage targets: 90%+ on `shared/`, `relay/`, `tools/`; 80%+ on `plugin/`. Use fake timers for TTL/heartbeat/polling tests — no flaky timing tests. Integration tests start servers on port 0 for random port assignment.
