# Rex Memory System Specification

## Overview

Rex Memory gives Rex persistent, shared knowledge across sessions and team members. It stores **design decisions, conventions, project context, and corrections** — things that can't be derived by reading the Figma file.

Memory is scoped hierarchically: **user → team → file → page**. It's backed by MongoDB and accessed through MCP tools.

## Principles

1. **Figma is the source of truth for state.** Memory stores *intent*, *decisions*, and *context* — never current property values.
2. **Shared by default.** Team and file memories are visible to all team members. User memories are personal.
3. **Explicit over inferred.** Prefer explicit `remember` commands over auto-inference. When Rex infers, it marks confidence accordingly.
4. **Decay over accumulate.** Unused memories lose relevance. Corrections supersede. Cleanup is a first-class operation.

## Memory Scopes

| Scope | Key | Shared? | Example |
|-------|-----|---------|---------|
| `user` | `userId` | No — personal preferences | "I prefer terse responses" |
| `team` | `teamId` | Yes — all files | "Brand uses Inter + Plus Jakarta Sans" |
| `file` | `fileKey` | Yes — all sessions on this file | "This is the iOS app, Page 1 = production" |
| `page` | `fileKey` + `pageId` | Yes — all sessions on this page | "Building checkout flow, tried modal → rejected" |

## Memory Entry Schema

```typescript
interface MemoryEntry {
  _id: string;                   // MongoDB ObjectId or UUID
  scope: "user" | "team" | "file" | "page";

  // Scope keys
  teamId: string;
  userId?: string;               // Present for user-scoped
  fileKey?: string;              // Present for file/page-scoped
  pageId?: string;               // Present for page-scoped

  // Content
  category: MemoryCategory;
  content: string;               // Natural language, concise
  tags: string[];                // Semantic tags for retrieval

  // Provenance
  source: "explicit" | "inferred" | "corrected";
  createdBy: {                   // Figma user who triggered creation
    id: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;          // Last time loaded into a session

  // Lifecycle
  confidence: number;            // 0.0–1.0
  supersededBy?: string;         // ID of newer memory that replaces this
  relatedTo?: string[];          // IDs of related memories
  accessCount: number;           // How many times loaded into sessions
}

type MemoryCategory =
  | "decision"       // "We chose X because Y"
  | "convention"     // "Always do X"
  | "context"        // "This page is for Z"
  | "rejection"      // "We tried X, didn't work because Y"
  | "relationship"   // "File A's tokens feed into File B"
  | "preference"     // User-scope: "I want terse responses"
  | "correction";    // "Rex got this wrong, the right answer is X"
```

## User Identity

The plugin sends `figma.currentUser` during the connect handshake:

```typescript
// Plugin connect payload (extended)
interface ConnectPayload {
  pluginId: string;
  fileKey: string;
  fileName: string;
  user?: {
    id: string;
    name: string;
    photoUrl: string | null;
  };
  capabilities?: PluginCapabilities;
}
```

The relay stores this in the session and passes it to memory operations as provenance.

## MCP Tools

### `remember`
Store a memory explicitly.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| content | string | yes | What to remember |
| scope | string | no | "user", "team", "file", "page" (default: "file") |
| category | string | no | Memory category (default: "convention") |
| tags | string[] | no | Semantic tags for retrieval |

### `recall`
Query memories relevant to a topic.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | yes | What to recall |
| scope | string | no | Filter by scope |
| category | string | no | Filter by category |
| limit | number | no | Max results (default: 10) |

### `forget`
Delete a specific memory or memories matching a query.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | no | Specific memory ID to delete |
| query | string | no | Delete memories matching this query |
| scope | string | no | Scope filter |

### `memories`
List and browse stored memories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| scope | string | no | Filter by scope |
| category | string | no | Filter by category |
| limit | number | no | Max results (default: 20) |
| includeSuperseded | boolean | no | Include superseded memories (default: false) |

### `memory_cleanup`
Remove stale, low-confidence, and superseded memories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| dryRun | boolean | no | Preview what would be removed (default: true) |
| maxAgeDays | number | no | Remove memories older than N days with 0 access (default: 30) |
| minConfidence | number | no | Remove memories below this confidence (default: 0.2) |
| removeSuperseded | boolean | no | Remove superseded memories (default: true) |

## Memory Retrieval on Session Start

When Rex connects to a Figma file, the relay automatically loads relevant memories:

```
1. Identify scope keys: teamId, userId, fileKey, currentPageId
2. Query MongoDB:
   - user memories for this userId
   - team memories for this teamId
   - file memories for this fileKey
   - page memories for this fileKey + pageId
3. Filter: confidence > 0.3, not superseded
4. Sort: by confidence × recency × accessCount
5. Budget: top N entries fitting within ~2K tokens
6. Inject as system context in the session
```

## Confidence Lifecycle

```
Initial confidence:
  explicit  → 0.9
  inferred  → 0.6
  corrected → 1.0

Decay:
  -0.01 per day without access (floor: 0.1)

Boost:
  +0.05 per session where memory is loaded and not contradicted (cap: 1.0)

Supersede:
  Old memory confidence → 0.0, supersededBy → new memory ID
```

## Conflict Detection

When storing a new memory:
1. Text-search existing memories in the same scope for similar content
2. If overlap detected:
   - Same scope + same category → supersede old with new
   - Different users → store both, tag as `needs-review`
   - Different scopes → keep both (file convention ≠ page exception)

## Storage

**Backend:** MongoDB

**Collections:**
- `memories` — main memory store (indexed on scope keys, category, tags, confidence)
- `memory_audit` — append-only log of all memory operations (create, update, delete)

**Indexes:**
```
{ teamId: 1, scope: 1, confidence: -1 }
{ fileKey: 1, scope: 1, confidence: -1 }
{ userId: 1, scope: 1 }
{ tags: 1 }
{ createdAt: 1 }           // For cleanup TTL
{ supersededBy: 1 }        // For cleanup
```

## Configuration

```typescript
interface MemoryConfig {
  enabled: boolean;              // Feature flag (default: false)
  mongoUri: string;              // MongoDB connection string
  dbName: string;                // Database name (default: "rex_memory")
  teamId: string;                // Team identifier (from env/config)
  maxMemoriesPerSession: number; // Context budget (default: 30)
  cleanupIntervalHours: number;  // Auto-cleanup interval (default: 24)
}
```

Environment variables:
```
REX_MEMORY_ENABLED=true
REX_MEMORY_MONGO_URI=mongodb://localhost:27017
REX_MEMORY_DB_NAME=rex_memory
REX_MEMORY_TEAM_ID=my-team
```

## File Structure

```
src/
  memory/
    config.ts          # MemoryConfig, env parsing
    store.ts           # MongoDB client, CRUD operations
    retrieval.ts       # Query, rank, budget memories for session
    cleanup.ts         # Stale memory removal
    types.ts           # MemoryEntry, MemoryCategory types
  tools/
    memory/
      remember.ts      # remember tool handler
      recall.ts        # recall tool handler
      forget.ts        # forget tool handler
      memories.ts      # memories tool handler
      cleanup.ts       # memory_cleanup tool handler
```
