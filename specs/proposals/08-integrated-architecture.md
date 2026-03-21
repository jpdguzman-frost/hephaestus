# Proposal 08: Integrated Rex + Osiris Refinement Learning Architecture

**Date:** 2026-03-21
**Status:** Draft
**Systems:** Rex (MCP server + Figma plugin), Osiris (design intelligence API + MongoDB)

---

## 1. Overview

This proposal maps the winning refinement learning strategy onto the actual Rex and Osiris systems. Three tracks work together:

- **Track A: Golden Templates** — Save designer-approved refined screens as reusable templates, superseding the raw `screens` collection for build-time reference.
- **Track B: Property Patterns** — Passively observe designer edits in Figma via `documentchange`, extract recurring property-level patterns without manual before/after capture.
- **Adversarial Filter** — Classify observed changes to reject noise (undo loops, exploratory tweaks, alignment jitter) and promote only genuine design preferences.

---

## 2. What Lives in Rex (Plugin)

All observation happens inside the Figma plugin because it is the only code with access to `figma.on('documentchange', ...)` and live node state.

### 2.1 DocumentChange Observer

**File:** `plugin/refinement-observer.ts` (new)

Registers a `figma.on('documentchange', callback)` listener. For every document change event, it:

1. Checks if the changed node is within a **tracked frame** (a frame Rex built and registered in the BuildManifest).
2. If yes, reads the change's `type` (property change, node added, node removed, node moved) and extracts:
   - `nodeId` — the changed node
   - `property` — the changed property name (e.g., `fills`, `fontSize`, `itemSpacing`, `paddingTop`)
   - `oldValue` — previous value (from Figma's `DocumentChangeEvent`)
   - `newValue` — current value (read from live node)
   - `timestamp` — `Date.now()`
3. Drops the raw change into a **ChangeBuffer**.

The observer is lightweight. It does no classification, no HTTP calls. It only buffers.

```typescript
// plugin/refinement-observer.ts

interface RawChange {
  frameId: string;          // tracked frame root
  nodeId: string;           // changed node
  nodeName: string;
  nodeRole: string | null;  // from BuildManifest roleMap
  property: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: 'PROPERTY_CHANGE' | 'NODE_ADDED' | 'NODE_REMOVED' | 'NODE_MOVED';
  timestamp: number;
}

let changeBuffer: RawChange[] = [];
const MAX_BUFFER = 200;

export function startObserving(): void {
  figma.on('documentchange', (event) => {
    for (const change of event.documentChanges) {
      if (change.type === 'PROPERTY_CHANGE') {
        const node = change.node;
        const manifest = getManifestForNode(node.id);
        if (!manifest) continue; // not a tracked frame

        for (const prop of change.properties) {
          changeBuffer.push({
            frameId: manifest.frameId,
            nodeId: node.id,
            nodeName: node.name,
            nodeRole: manifest.roleMap[node.id] || null,
            property: prop,
            oldValue: null, // documentchange doesn't give old values
            newValue: readProperty(node, prop),
            changeType: 'PROPERTY_CHANGE',
            timestamp: Date.now(),
          });
        }

        if (changeBuffer.length > MAX_BUFFER) {
          changeBuffer = changeBuffer.slice(-MAX_BUFFER);
        }
      }
    }
  });
}
```

**Important limitation:** Figma's `documentchange` event provides property *names* but not old values. The observer reads the current (new) value from the live node. Old values come from the BuildManifest snapshot taken at build time.

### 2.2 BuildManifest

**File:** `plugin/build-manifest.ts` (new)

When Rex builds a screen from a SOM, the plugin records a manifest that maps every created Figma node back to its SOM role and captures a snapshot of the initial property values.

```typescript
// plugin/build-manifest.ts

interface BuildManifest {
  frameId: string;              // root frame node ID
  sourceScreenId: string;       // Osiris screen_id used as reference
  templateId: string | null;    // golden template ID if built from one
  buildTimestamp: number;
  roleMap: Record<string, string>;   // nodeId -> role (e.g., "nav", "hero", "card")
  initialSnapshot: Record<string, Record<string, unknown>>; // nodeId -> { prop: value }
}

// In-memory store, keyed by frameId. Persisted to figma.clientStorage.
const manifests = new Map<string, BuildManifest>();
```

The manifest is populated during `CREATE_NODE` execution in `plugin/executors/nodes.ts`. After a batch of creates completes for a SOM build, the executor calls `registerManifest()` with the full node-to-role mapping.

This requires a new command type `REGISTER_BUILD_MANIFEST` that the Rex server sends after completing a SOM-based build. The plugin executor stores the manifest and starts observing changes on that frame.

### 2.3 Change Flush

**File:** `plugin/refinement-observer.ts` (flush logic)

Changes are flushed to the Rex relay server periodically (every 5 seconds if buffer is non-empty) or when the buffer hits 100 entries. The flush uses the existing HTTP bridge (`httpRequest`).

```
POST /refinement/changes
X-Auth-Token: <token>
Body: { frameId, changes: RawChange[], manifest: { sourceScreenId, templateId, roleMap } }
```

The flush clears the buffer. If the POST fails, changes stay in the buffer for next attempt.

---

## 3. What Lives in Rex (Server)

The Rex MCP server acts as the bridge between plugin observations and the Osiris API. It does NOT store refinement data itself -- it assembles records and forwards them.

### 3.1 Refinement Relay Endpoint

**File:** `src/relay/server.ts` (new route)

```
POST /refinement/changes
```

Receives flushed changes from the plugin. Performs no classification (that is Osiris's job). Immediately forwards to Osiris:

```
POST https://aux.frostdesigngroup.com/osiris/api/refinement/ingest
Body: {
  sourceScreenId: string,
  templateId: string | null,
  changes: RawChange[],
  roleMap: Record<string, string>,
  fileKey: string,
  userId: string
}
```

### 3.2 Build Manifest Registration

When the AI client builds a screen from a SOM (using `create_node`, `set_auto_layout`, etc.), the Rex server has no built-in knowledge that a "SOM build" just happened. The AI client must explicitly call a new MCP tool to register the build:

**New MCP tool: `register_build`**

| Param | Type | Required | Description |
|---|---|---|---|
| `frameId` | `string` | Yes | Root frame node ID of the built screen |
| `sourceScreenId` | `string` | Yes | Osiris screen_id used as reference |
| `templateId` | `string` | No | Golden template ID if built from one |
| `roleMap` | `Record<string, string>` | Yes | Node ID to SOM role mapping |

This sends a `REGISTER_BUILD_MANIFEST` command to the plugin, which stores the manifest and starts change observation on that frame.

### 3.3 Golden Template Build Flow

When the AI client wants to build from a golden template instead of a raw SOM, it calls a new Osiris MCP tool to retrieve the template, then builds normally with Rex. The Rex server itself doesn't need special template-awareness -- the intelligence is in the Osiris retrieval and the AI client's build logic.

### 3.4 Snapshot Capture

**New MCP tool: `capture_snapshot`**

| Param | Type | Required | Description |
|---|---|---|---|
| `frameId` | `string` | Yes | Root frame to snapshot |
| `purpose` | `"pre_refinement" \| "post_refinement" \| "golden"` | Yes | Why this snapshot is being taken |
| `sourceScreenId` | `string` | No | Osiris screen_id for context |

This calls `extract_som` on the frame (reusing existing infrastructure) and forwards the resulting SOM to Osiris with metadata. Used to:
- Take a "before" snapshot right after build
- Take an "after" snapshot when the designer says they are done
- Save a golden template

The Rex server sends the SOM to Osiris via:

```
POST https://aux.frostdesigngroup.com/osiris/api/templates
Body: { som, purpose, sourceScreenId, metadata }
```

or for pre/post snapshots:

```
POST https://aux.frostdesigngroup.com/osiris/api/refinement/snapshot
Body: { som, purpose, sourceScreenId, frameId }
```

---

## 4. What Lives in Osiris (API)

Osiris owns all storage, classification, pattern extraction, and template matching. All of this runs in the Express API at `aux.frostdesigngroup.com/osiris`.

### 4.1 Refinement Ingestion

**Endpoint:** `POST /api/refinement/ingest`

Receives raw changes from Rex relay. For each batch:

1. **Adversarial Filter** — classifies each change:
   - `genuine` — intentional design preference (e.g., changed card padding from 16 to 20)
   - `noise` — undo/redo cycle, exploratory tweak reverted within the batch, jitter (< 1px position change)
   - `structural` — node added/removed (significant but handled differently)

   Classification rules:
   - If property changed and then changed back within the same batch: `noise`
   - If position change < 2px: `noise`
   - If opacity flickers (changes > 2 times in batch): `noise`
   - If a property changed once and the change persists: `genuine`
   - Node add/remove: `structural`

2. **Enrichment** — for `genuine` changes, add context from the roleMap:
   - What role was this node? (e.g., "hero", "card", "nav")
   - What property changed? (e.g., "itemSpacing", "fills", "cornerRadius")
   - What was the delta? (e.g., `16 -> 20`, `#1A1A2E -> #0D0D1A`)

3. **Storage** — write enriched changes to `refinement_observations` collection.

### 4.2 Golden Template CRUD

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/templates` | Save a new golden template |
| `GET` | `/api/templates/:id` | Get a specific template |
| `GET` | `/api/templates` | List/search templates |
| `PUT` | `/api/templates/:id` | Update a template |
| `DELETE` | `/api/templates/:id` | Delete a template |
| `GET` | `/api/templates/match` | Find best matching template for a build request |

A golden template is a SOM that has been refined and approved. It carries:
- The refined SOM (v2 with roles)
- Source screen reference
- Refinement history (what changes were applied)
- Match criteria (screen_type, layout, mood, industry)
- Quality scores
- Usage count

**Template matching** (`GET /api/templates/match`) accepts `screen_type`, `layout`, `mood`, `industry`, and `content_structure` and returns the best matching template using weighted similarity against all stored templates.

### 4.3 Adversarial Filter

**File:** `osiris/src/refinement/adversarial-filter.ts` (new)

The filter runs server-side in the Osiris Express API. It is a rule-based classifier (not ML), operating on batches of changes:

```typescript
interface ClassifiedChange {
  original: RawChange;
  classification: 'genuine' | 'noise' | 'structural';
  reason: string; // human-readable classification reason
}

function classifyBatch(changes: RawChange[]): ClassifiedChange[] {
  // Group by nodeId + property
  const groups = groupBy(changes, c => `${c.nodeId}:${c.property}`);

  const results: ClassifiedChange[] = [];

  for (const [key, group] of Object.entries(groups)) {
    if (group.length >= 3) {
      // Flickering — likely exploratory
      results.push(...group.map(c => ({
        original: c,
        classification: 'noise' as const,
        reason: `Property ${c.property} changed ${group.length} times — exploratory`,
      })));
      continue;
    }

    if (group.length === 2) {
      // Check if reverted
      const first = group[0];
      const last = group[1];
      if (deepEqual(first.oldValue, last.newValue)) {
        results.push(...group.map(c => ({
          original: c,
          classification: 'noise' as const,
          reason: 'Change reverted within batch',
        })));
        continue;
      }
    }

    // Single change that persisted — genuine
    for (const change of group) {
      if (change.changeType === 'NODE_ADDED' || change.changeType === 'NODE_REMOVED') {
        results.push({ original: change, classification: 'structural', reason: 'Structural change' });
      } else if (isJitter(change)) {
        results.push({ original: change, classification: 'noise', reason: 'Sub-pixel jitter' });
      } else {
        results.push({ original: change, classification: 'genuine', reason: 'Persistent property change' });
      }
    }
  }

  return results;
}
```

### 4.4 Pattern Extraction and Promotion

**File:** `osiris/src/refinement/pattern-extractor.ts` (new)

Runs periodically (or on-demand via MCP tool) against the `refinement_observations` collection. Groups genuine changes by `(role, property)` and identifies consistent patterns:

```typescript
interface PropertyPattern {
  role: string;           // e.g., "card", "hero", "nav"
  property: string;       // e.g., "itemSpacing", "cornerRadius", "fills"
  direction: string;      // e.g., "increase", "decrease", "darken", "lighten"
  medianDelta: number;    // e.g., +4 (spacing always increases by ~4px)
  consistency: number;    // 0-1, what fraction of observations agree
  observationCount: number;
  status: 'tentative' | 'confirmed';
  examples: Array<{
    sourceScreenId: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
}
```

**Promotion rules:**
- `tentative`: 3+ observations with consistency >= 0.6
- `confirmed`: 5+ observations with consistency >= 0.8
- Auto-demote if new contradicting observations drop consistency below 0.5

Patterns are stored in the `property_patterns` collection and served to the AI client at build time via `get_refinement_context` (evolved, see section 5).

### 4.5 Template Matching and Retrieval

When the AI client is about to build a screen, it asks Osiris: "Do you have a golden template that matches this screen type, layout, and mood?"

The matching algorithm:
1. Filter templates by `screen_type` (exact match required)
2. Score remaining by weighted similarity:
   - `layout` match: 0.3 weight
   - `mood` match: 0.2 weight
   - `industry` match: 0.2 weight
   - `content_structure` similarity (node count, depth, role distribution): 0.3 weight
3. Return top match if score > 0.5, otherwise return null (build from raw SOM)

---

## 5. What Replaces Existing Osiris Features

### 5.1 Golden Templates vs. `screens` Collection + `save_screen_som`

**Not replaced. Extended.**

The existing `screens` collection (3,400+ scored screens with SOMs) remains the reference library. Golden templates are a NEW collection (`golden_templates`) that sits alongside `screens`. The relationship:

- `screens` = raw reference material. Scored, tagged, searchable. Source of truth for "what good looks like."
- `golden_templates` = refined, build-ready SOMs. Each template references a source screen but carries a *refined* SOM that incorporates designer corrections. Source of truth for "how to build."

`save_screen_som` is unchanged. It still saves raw SOMs to the `screens` collection.

A new endpoint `POST /api/templates` saves refined SOMs to `golden_templates`.

### 5.2 `capture_delta` -- Evolved, Not Replaced

**Current behavior:** `capture_delta` takes explicit before/after SOM pairs, computes a diff, and stores in the `refinement_deltas` collection. This requires manual invocation and the AI to extract a "before" and "after" SOM.

**New behavior:** `capture_delta` remains available for explicit before/after capture (backward compatible). But it becomes the *secondary* learning path. The primary path is now **passive observation** via Track B (documentchange -> refinement/ingest -> pattern extraction).

The `refinement_deltas` collection is retained. New observations from Track B go into a separate `refinement_observations` collection. Both feed into pattern extraction.

Over time, as passive observation accumulates enough data, explicit `capture_delta` becomes optional. But it remains useful for high-signal captures (e.g., the designer explicitly says "I'm done refining, capture this").

### 5.3 `extract_principles` -- Replaced by `extract_patterns`

**Current behavior:** `extract_principles` groups deltas by (screen_type, role, property) and identifies consistent changes. It requires 3+ deltas to find a principle.

**New behavior:** Replaced by `extract_patterns` which operates on the much richer `refinement_observations` collection (hundreds of individual property changes vs. a handful of full-SOM deltas). Same concept, better data source.

The `refinement_principles` collection is replaced by `property_patterns`.

Key differences:
- Principles were SOM-level ("for confirmation screens, hero sections tend to get more padding"). Patterns are property-level ("for cards, cornerRadius tends to increase by 4px").
- Principles needed manual `capture_delta` invocations to accumulate data. Patterns accumulate passively.
- Principles had no adversarial filter. Patterns are pre-filtered for noise.

### 5.4 `get_refinement_context` -- Evolved

**Current behavior:** Returns the raw SOM, matched exemplar deltas, accumulated principles, and the Phosphor icon list.

**New behavior:** Returns:
1. The raw SOM (unchanged)
2. Best matching golden template, if one exists (NEW)
3. Confirmed property patterns relevant to this screen type (REPLACES principles)
4. Tentative patterns for awareness (REPLACES tentative principles)
5. Phosphor icon list (unchanged)
6. Exemplar deltas from the old system (DEPRECATED, included for backward compat until patterns have sufficient coverage)

The response shape evolves:

```json
{
  "som": { ... },
  "goldenTemplate": {
    "templateId": "tpl_abc123",
    "matchScore": 0.82,
    "som": { ... },
    "refinementHistory": [ ... ]
  },
  "patterns": {
    "confirmed": [
      {
        "role": "card",
        "property": "cornerRadius",
        "direction": "increase",
        "medianDelta": 4,
        "consistency": 0.88,
        "observationCount": 12
      }
    ],
    "tentative": [ ... ]
  },
  "exemplarDeltas": [ ... ],
  "icons": [ ... ]
}
```

---

## 6. New MCP Tools

### 6.1 New Rex MCP Tools

| Tool | Description |
|---|---|
| `register_build` | Register a build manifest (frame -> SOM role mapping) to enable change observation |

Implementation: `src/tools/write/register-build.ts` (new)
Schema: `src/tools/schemas.ts` (add `RegisterBuildSchema`)
Command type: `REGISTER_BUILD_MANIFEST` in `src/shared/types.ts`

### 6.2 New Osiris MCP Tools

| Tool | Osiris API Endpoint | Description |
|---|---|---|
| `osiris_save_template` | `POST /api/templates` | Save a refined screen as a golden template |
| `osiris_get_template` | `GET /api/templates/:id` | Retrieve a specific golden template |
| `osiris_find_template` | `GET /api/templates/match` | Find the best matching template for a build request |
| `osiris_list_templates` | `GET /api/templates` | List/search golden templates |
| `osiris_delete_template` | `DELETE /api/templates/:id` | Remove a golden template |
| `osiris_extract_patterns` | `POST /api/refinement/extract-patterns` | Trigger pattern extraction from accumulated observations |
| `osiris_get_patterns` | `GET /api/refinement/patterns` | Get confirmed/tentative property patterns |

### 6.3 Tool Schemas

```typescript
// osiris_save_template
{
  source_screen_id: string,       // original screen this was refined from
  som: SOMv2,                     // the refined SOM
  screen_type: string,            // e.g., "home", "payment", "onboarding"
  layout?: string,                // e.g., "card_grid", "hero_detail"
  mood?: string,                  // e.g., "calm", "premium"
  industry?: string,              // e.g., "fintech", "luxury"
  quality_scores?: Record<string, number>, // self-evaluated scores
  notes?: string                  // designer notes
}

// osiris_find_template
{
  screen_type: string,            // required
  layout?: string,
  mood?: string,
  industry?: string,
  content_hint?: {                // rough content shape for better matching
    section_count?: number,
    has_hero?: boolean,
    has_bottom_nav?: boolean,
    card_count?: number
  }
}

// osiris_extract_patterns
{
  min_observations?: number,      // default 3
  screen_type?: string            // scope extraction to specific screen type
}

// osiris_get_patterns
{
  screen_type?: string,
  role?: string,
  status?: 'confirmed' | 'tentative' | 'all'  // default 'all'
}
```

---

## 7. Data Flow Diagram

### 7.1 Build -> Refine -> Learn -> Reuse Cycle

```
STEP 1: BUILD
══════════════════════════════════════════════════════════════════════════

  AI Client
    │
    ├─ osiris_find_template(screen_type: "home", mood: "premium")
    │   └─► Osiris GET /api/templates/match
    │       └─► Returns golden template SOM (or null)
    │
    ├─ osiris_get_refinement_context(screen_id: "scr_xyz")
    │   └─► Osiris GET /api/refinement/context
    │       └─► Returns: SOM + template + confirmed patterns + icons
    │
    ├─ [AI applies patterns to SOM before building]
    │   e.g., "confirmed pattern: card cornerRadius += 4, applying..."
    │
    ├─ rex create_node / set_auto_layout / set_fills / ... (batch build)
    │   └─► Rex plugin creates nodes in Figma
    │
    └─ rex register_build(frameId: "123:456", sourceScreenId: "scr_xyz",
    │      roleMap: { "123:457": "nav", "123:460": "hero", ... })
    │   └─► Rex server sends REGISTER_BUILD_MANIFEST to plugin
    │       └─► Plugin stores BuildManifest
    │       └─► Plugin starts documentchange observer on frame "123:456"
    │
    └─ rex extract_som(nodeId: "123:456")  [pre-refinement snapshot]
        └─► SOM sent to Osiris POST /api/refinement/snapshot
            (purpose: "pre_refinement")


STEP 2: DESIGNER REFINES
══════════════════════════════════════════════════════════════════════════

  Designer works in Figma (no AI involvement)
    │
    ├─ Changes card padding 16 → 20
    │   └─► documentchange fires
    │       └─► Observer buffers: { nodeId, role: "card", prop: "paddingTop",
    │           newValue: 20 }
    │
    ├─ Tries hero gradient, reverts it
    │   └─► documentchange fires (2 changes)
    │       └─► Observer buffers both changes
    │
    ├─ Increases section spacing 12 → 16
    │   └─► documentchange fires
    │       └─► Observer buffers: { nodeId, role: "section", prop: "itemSpacing",
    │           newValue: 16 }
    │
    └─ [5 seconds pass, buffer flush triggers]
        └─► Plugin POST /refinement/changes to Rex relay
            └─► Rex relay forwards to Osiris POST /api/refinement/ingest
                │
                ├─ Adversarial Filter:
                │   ├─ card padding 16→20: GENUINE (single persistent change)
                │   ├─ hero gradient change+revert: NOISE (reverted in batch)
                │   └─ section spacing 12→16: GENUINE (single persistent change)
                │
                └─ Stores 2 genuine observations in refinement_observations


STEP 3: DESIGNER APPROVES
══════════════════════════════════════════════════════════════════════════

  AI Client (designer signals "I'm happy with this")
    │
    ├─ rex extract_som(nodeId: "123:456")  [post-refinement snapshot]
    │   └─► SOM sent to Osiris POST /api/refinement/snapshot
    │       (purpose: "post_refinement")
    │
    └─ osiris_save_template(
    │      source_screen_id: "scr_xyz",
    │      som: <refined SOM>,
    │      screen_type: "home",
    │      mood: "premium",
    │      industry: "fintech"
    │  )
    │  └─► Osiris POST /api/templates
    │      └─► Saves to golden_templates collection
    │
    └─ [Optional] osiris_capture_delta(
           source_screen_id: "scr_xyz",
           before_som: <pre-refinement SOM>,
           after_som: <refined SOM>
       )
       └─► Legacy delta capture for backward compat


STEP 4: PATTERN EXTRACTION (periodic or on-demand)
══════════════════════════════════════════════════════════════════════════

  AI Client (or scheduled job)
    │
    └─ osiris_extract_patterns(min_observations: 3)
        └─► Osiris POST /api/refinement/extract-patterns
            │
            ├─ Groups observations: (role=card, prop=cornerRadius) → 12 observations
            │   └─ 10/12 increased by 2-6px → medianDelta: +4, consistency: 0.83
            │   └─ Status: CONFIRMED
            │
            ├─ Groups observations: (role=section, prop=itemSpacing) → 4 observations
            │   └─ 3/4 increased by 2-4px → medianDelta: +3, consistency: 0.75
            │   └─ Status: TENTATIVE
            │
            └─ Stores to property_patterns collection


STEP 5: REUSE (next build)
══════════════════════════════════════════════════════════════════════════

  AI Client (new design request for a "home" screen)
    │
    ├─ osiris_find_template(screen_type: "home", mood: "premium")
    │   └─► Returns the golden template saved in Step 3
    │       └─► AI builds from the template SOM (already refined!)
    │
    ├─ osiris_get_patterns(screen_type: "home", status: "confirmed")
    │   └─► Returns: card cornerRadius += 4, section spacing += 3
    │       └─► AI applies patterns to any nodes not covered by template
    │
    └─ [Build proceeds with pre-refined SOM + pattern adjustments]
        └─► Less designer refinement needed → fewer observations → system converges
```

---

## 8. MongoDB Schema Changes

### 8.1 New Collections

#### `golden_templates`

```javascript
{
  _id: ObjectId,
  templateId: "tpl_<nanoid>",
  sourceScreenId: "scr_xyz",           // reference to screens collection
  som: { /* SOM v2 with roles */ },
  screenType: "home",
  layout: "hero_detail",
  mood: "premium",
  industry: "fintech",
  qualityScores: {
    overall_quality: 8.5,
    calm_confident: 9.0,
    // ...
  },
  contentStructure: {                    // auto-computed for matching
    sectionCount: 4,
    hasHero: true,
    hasBottomNav: true,
    cardCount: 3,
    roleDistribution: { nav: 1, hero: 1, card: 3, section: 2, bottom_nav: 1 }
  },
  refinementHistory: [                   // what changed from source to golden
    { role: "card", property: "cornerRadius", from: 12, to: 16 },
    { role: "section", property: "itemSpacing", from: 12, to: 16 },
  ],
  notes: "Designer approved — premium fintech home with refined spacing",
  usageCount: 0,                         // incremented each time template is used
  createdAt: ISODate,
  updatedAt: ISODate
}

// Indexes
{ screenType: 1, mood: 1, industry: 1 }
{ templateId: 1 }  // unique
{ sourceScreenId: 1 }
```

#### `refinement_observations`

```javascript
{
  _id: ObjectId,
  sourceScreenId: "scr_xyz",
  templateId: "tpl_abc123" | null,       // if built from golden template
  frameId: "123:456",                    // Figma frame ID
  fileKey: "abc123",                     // Figma file key
  userId: "user_123",                    // who made the change

  // The observed change
  nodeRole: "card",
  property: "cornerRadius",
  oldValue: 12,                          // from BuildManifest snapshot
  newValue: 16,
  delta: 4,                             // computed: newValue - oldValue (for numerics)
  changeType: "PROPERTY_CHANGE",

  // Classification
  classification: "genuine",             // from adversarial filter
  classificationReason: "Persistent property change",

  // Context
  screenType: "home",
  mood: "premium",
  industry: "fintech",

  timestamp: ISODate,
  batchId: "batch_<nanoid>"              // groups changes from same flush
}

// Indexes
{ nodeRole: 1, property: 1, classification: 1 }   // pattern extraction queries
{ sourceScreenId: 1 }
{ screenType: 1, classification: 1 }
{ batchId: 1 }
{ timestamp: 1 }                                   // TTL index, expire after 180 days
```

#### `property_patterns`

```javascript
{
  _id: ObjectId,
  patternId: "pat_<nanoid>",
  role: "card",
  property: "cornerRadius",
  direction: "increase",
  medianDelta: 4,
  meanDelta: 3.8,
  consistency: 0.88,                     // fraction of observations that agree
  observationCount: 12,
  status: "confirmed",                   // "tentative" | "confirmed"

  // Scope
  screenType: "home" | null,             // null = applies to all screen types
  mood: null,
  industry: null,

  examples: [
    { sourceScreenId: "scr_xyz", oldValue: 12, newValue: 16 },
    { sourceScreenId: "scr_abc", oldValue: 8, newValue: 12 },
  ],

  createdAt: ISODate,
  updatedAt: ISODate,
  lastEvaluatedAt: ISODate               // when pattern was last re-evaluated
}

// Indexes
{ role: 1, property: 1 }                // unique compound for upsert
{ status: 1, screenType: 1 }
{ patternId: 1 }  // unique
```

### 8.2 Modified Collections

#### `screens` -- No changes

The existing `screens` collection is untouched. Golden templates reference screens via `sourceScreenId` but don't modify them.

#### `refinement_deltas` -- Retained, no schema changes

The existing `refinement_deltas` collection is retained for backward compatibility. `capture_delta` still writes here. Over time, as `refinement_observations` + `property_patterns` accumulate enough data, deltas become less important.

#### `refinement_principles` -- Deprecated

No new writes. Existing data retained for reference. `get_principles` still reads from it but the response is marked as deprecated. `property_patterns` is the replacement.

### 8.3 Removed Collections

None. All existing collections are retained for backward compatibility.

---

## 9. Command Type Addition

### Rex Plugin Command Types

Add to `src/shared/types.ts` `CommandType` enum:

```typescript
REGISTER_BUILD_MANIFEST = "REGISTER_BUILD_MANIFEST",
```

Add to plugin `EXECUTOR_MAP` in `plugin/executor.ts`:

```typescript
REGISTER_BUILD_MANIFEST: executeRegisterBuildManifest,
```

The executor stores the manifest and starts the observer.

---

## 10. New Files Summary

### Rex Plugin (new files)

| File | Purpose |
|---|---|
| `plugin/refinement-observer.ts` | documentchange listener, change buffer, flush to relay |
| `plugin/build-manifest.ts` | BuildManifest storage, snapshot management, node-to-role lookup |
| `plugin/executors/build-manifest.ts` | `REGISTER_BUILD_MANIFEST` command executor |

### Rex Server (new files)

| File | Purpose |
|---|---|
| `src/tools/write/register-build.ts` | `register_build` MCP tool handler |

### Rex Server (modified files)

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `REGISTER_BUILD_MANIFEST` to `CommandType` enum |
| `src/tools/schemas.ts` | Add `RegisterBuildSchema` |
| `src/relay/server.ts` | Add `POST /refinement/changes` route |
| `src/server/tool-router.ts` | Register `register_build` tool |

### Osiris API (new files)

| File | Purpose |
|---|---|
| `osiris/src/refinement/adversarial-filter.ts` | Change classification logic |
| `osiris/src/refinement/pattern-extractor.ts` | Pattern extraction from observations |
| `osiris/src/routes/templates.ts` | Golden template CRUD endpoints |
| `osiris/src/routes/refinement-v2.ts` | New refinement endpoints (ingest, extract-patterns, patterns) |
| `osiris/src/models/GoldenTemplate.ts` | Mongoose model for `golden_templates` |
| `osiris/src/models/RefinementObservation.ts` | Mongoose model for `refinement_observations` |
| `osiris/src/models/PropertyPattern.ts` | Mongoose model for `property_patterns` |

### Osiris MCP Server (modified)

The Osiris MCP server is a thin HTTP relay. Each new tool is a new handler that calls the corresponding Express API endpoint:

| MCP Tool | HTTP Call |
|---|---|
| `osiris_save_template` | `POST /api/templates` |
| `osiris_get_template` | `GET /api/templates/:id` |
| `osiris_find_template` | `GET /api/templates/match` |
| `osiris_list_templates` | `GET /api/templates` |
| `osiris_delete_template` | `DELETE /api/templates/:id` |
| `osiris_extract_patterns` | `POST /api/refinement/extract-patterns` |
| `osiris_get_patterns` | `GET /api/refinement/patterns` |

---

## 11. Migration Strategy

### Phase 1: Foundation (Week 1-2)

1. Add `REGISTER_BUILD_MANIFEST` command type to Rex
2. Implement `plugin/build-manifest.ts` and `plugin/refinement-observer.ts`
3. Add `POST /refinement/changes` relay route
4. Add Osiris `refinement_observations` collection + ingest endpoint
5. Add Osiris adversarial filter

**Validation:** Build a screen with Rex, register the manifest, make changes in Figma, verify changes appear in `refinement_observations` with correct classifications.

### Phase 2: Golden Templates (Week 2-3)

1. Add Osiris `golden_templates` collection + CRUD endpoints
2. Add `osiris_save_template`, `osiris_get_template`, `osiris_find_template` MCP tools
3. Add `register_build` and `capture_snapshot` Rex MCP tools
4. Evolve `get_refinement_context` to include template matching

**Validation:** Build screen -> refine -> save as golden template -> build new screen using the template.

### Phase 3: Pattern Extraction (Week 3-4)

1. Add Osiris `property_patterns` collection
2. Implement pattern extraction logic
3. Add `osiris_extract_patterns` and `osiris_get_patterns` MCP tools
4. Wire patterns into `get_refinement_context` response

**Validation:** Accumulate 10+ observations across 3+ builds, run extraction, verify patterns emerge and are served at build time.

### Phase 4: Convergence (Week 4+)

1. Monitor pattern consistency scores
2. Deprecate `refinement_principles` in `get_refinement_context` response
3. Measure: are designer refinements decreasing per build? (the key success metric)

---

## 12. Key Design Decisions

### Why property-level observation instead of SOM-level diffing?

SOM-level diffing (the old `capture_delta` approach) requires:
1. Manual "before" extraction
2. Manual "after" extraction
3. AI to remember to invoke `capture_delta`

This produced very few data points in practice. Property-level observation via `documentchange` is passive -- it captures every meaningful edit automatically.

### Why the adversarial filter is rule-based, not ML?

The filter needs to work from day one with zero training data. The noise patterns (undo/redo, jitter, exploratory tweaks) are well-defined and deterministic. An ML classifier would need hundreds of labeled examples. Rules give us 90%+ accuracy immediately.

### Why golden templates are separate from the screens collection?

Screens are reference material -- they represent "what exists in the wild." Golden templates represent "how we should build." A screen might score 9/10 on visual quality but its SOM might have spacing that the designer always adjusts. The golden template carries the corrected SOM.

### Why Rex doesn't store refinement data?

Rex is a Figma manipulation tool. Adding a database to Rex would violate its single-responsibility design. Rex observes and relays. Osiris stores and reasons. The relay endpoint in Rex is a pass-through, not a data store.

### Why flush changes in batches instead of streaming individual changes?

Figma's `documentchange` can fire hundreds of times per second during drag operations. Batching into 5-second windows:
1. Reduces HTTP overhead
2. Enables batch-level adversarial filtering (detecting undo/redo within a batch)
3. Keeps the relay server's connection health polling unaffected
