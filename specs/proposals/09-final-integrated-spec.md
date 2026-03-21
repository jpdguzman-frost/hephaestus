# 09: Final Integrated Spec — Refinement Learning System

**Status:** Implementation-ready
**Date:** 2026-03-21
**Based on:** Proposals 01-06, Final Evaluation, REX-SOM-EXTRACTION spec

---

## Executive Summary

Rex learns from designer refinements through two complementary tracks:

- **Track A (Templates):** Store refined screens as Golden Templates. Reuse them for future builds of the same screen type. Captures 100% of decisions with zero inference risk.
- **Track B (Patterns):** Passively observe property changes via `documentchange`, extract recurring patterns, apply them when no template exists. Fills the cross-screen-type gap.
- **Adversarial Filter:** Sits between Track B's observer and the pattern store. Rejects noise. Prevents self-poisoning.

Templates ship first (Phase 1). Patterns layer on top (Phases 2-3). The filter gates pattern promotion (Phase 3).

---

## 1. System Boundary: Rex vs. Osiris

### Osiris owns:

- **Screen reference library** (existing) -- screenshots, SOMs, scoring
- **Golden Template storage** (new) -- `golden_templates` MongoDB collection
- **Template CRUD endpoints** (new) -- save, find, get, list, deprecate
- **Brand metadata** (existing) -- brand slugs, color palettes, font families

### Rex owns:

- **SOM extraction** (`extract_som` tool) -- already spec'd in REX-SOM-EXTRACTION.md
- **Passive observer** (new) -- `documentchange` listener in the plugin
- **BuildManifest** (new) -- maps Figma node IDs to SOM roles during build
- **Pattern extraction & application** (new) -- server-side refinement pipeline
- **Adversarial filter** (new) -- change classification engine

### Claude (orchestration layer) owns:

- **Template-first build workflow** -- check for templates before raw references
- **Content slot population** -- replace template content with new content
- **Template save trigger** -- prompt designer or auto-save after refinement
- **Property annotation at save time** -- tag values as brand/taste/structural

### What gets deleted from Osiris:

Nothing is deleted in Phase 1. The existing screen library, SOM storage, and scoring remain untouched. Golden Templates are additive -- a new collection alongside `screens`. If Osiris has experimental refinement-diff code from earlier prototypes, it can be removed, but the core screen pipeline is unchanged.

---

## 2. MongoDB Collection Changes

### New collection: `golden_templates`

```javascript
// Collection: golden_templates
{
  _id: ObjectId,
  brandId: "revolut",              // Osiris brand slug
  version: 3,                      // Increments on re-refinement
  screenType: "payment",           // Controlled enum: home, payment, onboarding, settings, profile, etc.
  screenSubtype: "payment-numpad", // Free-form, reuse existing subtypes
  tags: ["dark-mode", "numpad", "amount-entry"],
  mood: "premium",                 // premium, minimal, energetic, playful, corporate
  density: "normal",               // compact, normal, spacious
  platform: "mobile",              // mobile, tablet, desktop

  // The template itself
  som: { /* Full SOM v2 tree */ },
  referenceFrame: { width: 390, height: 844 },

  // Content slots (content-only, never style)
  slots: [
    {
      slotId: "hero-title",
      nodeId: "som-node-23",       // SOM node ID
      role: "label",
      type: "text",                // text | image | repeating-group
      defaultValue: "Send Money"
    }
  ],

  // Structural metadata
  structure: {
    sectionCount: 4,
    hasCTA: true,
    hasHero: false,
    hasBottomNav: false,
    hasTabBar: false,
    listItemCount: null,
    cardCount: 2
  },

  // Property annotations (brand vs. taste)
  propertyAnnotations: [
    { somNodeId: "som-node-5", property: "fills", source: "brand" },
    { somNodeId: "som-node-1", property: "cornerRadius", source: "taste" },
    { somNodeId: "som-node-1", property: "padding", source: "taste" }
  ],

  // Provenance
  sourceScreenId: "scr_abc123",    // Osiris screen this was refined from
  refinedFromNodeId: "123:456",    // Figma node ID of the refined frame
  refinedBy: { id: "user_1", name: "JP" },

  // Lineage
  supersedes: ObjectId("..."),     // Previous version (null for generation 1)
  supersededBy: null,              // Set when a newer version replaces this one
  generation: 3,                   // 1 = first, increments

  // Usage tracking
  usageCount: 12,
  lastUsedAt: ISODate("2026-03-15"),

  createdAt: ISODate("2026-02-01"),
  updatedAt: ISODate("2026-03-15")
}

// Indexes
db.golden_templates.createIndex({ brandId: 1, screenType: 1, supersededBy: 1, generation: -1 });
db.golden_templates.createIndex({ brandId: 1, tags: 1 });
db.golden_templates.createIndex({ supersedes: 1 });
db.golden_templates.createIndex({ usageCount: -1 });
```

### New collection: `refinement_records` (Phase 2)

```javascript
{
  _id: ObjectId,
  sessionId: "sess_xyz",
  brandId: "kraken",
  screenType: "payment",
  frameId: "23:2563",             // Figma frame that was refined

  propertyChanges: [
    {
      nodeId: "123:456",
      somRole: "screen",
      somName: "payment-root",
      property: "cornerRadius",
      before: 0,
      after: 24,
      propertyCategory: "layout"  // layout | color | typography | structural
    }
  ],

  structuralClusters: [
    {
      timestamp: 1711000000000,
      events: [
        { type: "CREATE", nodeId: "789:012" },
        { type: "PROPERTY_CHANGE", nodeId: "345:678", properties: ["parent"] }
      ],
      affectedSubtree: "23:2563",
      duration: 2000                // ms
    }
  ],

  duration: 240000,                 // Total refinement time in ms
  changeCount: 15,
  createdAt: ISODate("2026-03-21")
}

// Indexes
db.refinement_records.createIndex({ brandId: 1, screenType: 1 });
db.refinement_records.createIndex({ sessionId: 1 });
db.refinement_records.createIndex({ createdAt: -1 });
```

### New collection: `property_patterns` (Phase 3)

```javascript
{
  _id: ObjectId,
  brandId: "kraken",               // Brand-scoped by default
  scope: "brand",                  // brand | universal

  targetRole: "screen",            // SOM role this applies to
  targetProperty: "cornerRadius",

  pattern: {
    type: "override",              // override | increase | decrease | clamp | replace
    value: 24                      // For override. For increase/decrease: delta. For clamp: {min, max}.
  },

  confidence: 0.85,
  status: "confirmed",             // observed | recurring | candidate | confirmed | tombstoned
  observedCount: 5,
  lastSeen: ISODate("2026-03-20"),
  firstSeen: ISODate("2026-03-01"),

  // Evidence trail
  evidenceSessions: ["sess_1", "sess_2", "sess_3"],

  // For override detection
  rejectionCount: 0,
  lastRejectedAt: null,

  createdAt: ISODate("2026-03-01"),
  updatedAt: ISODate("2026-03-20")
}

// Indexes
db.property_patterns.createIndex({ brandId: 1, targetRole: 1, targetProperty: 1 });
db.property_patterns.createIndex({ brandId: 1, status: 1, confidence: -1 });
```

---

## 3. New MCP Tools (Osiris)

### `osiris_save_golden_template`

Save a refined SOM as a Golden Template, or update an existing one.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `brandId` | `string` | Yes | Osiris brand slug |
| `screenType` | `string` | Yes | Screen type from controlled vocab |
| `screenSubtype` | `string` | No | Free-form subtype |
| `tags` | `string[]` | No | Descriptive tags |
| `mood` | `string` | No | Visual mood |
| `density` | `string` | No | Layout density: compact, normal, spacious |
| `platform` | `string` | No | Target platform (default: mobile) |
| `som` | `object` | Yes | Full SOM v2 tree (from `extract_som`) |
| `referenceFrame` | `object` | Yes | `{ width, height }` |
| `slots` | `object[]` | No | Content slot definitions |
| `structure` | `object` | No | Structural metadata |
| `propertyAnnotations` | `object[]` | No | Brand/taste/structural tags per property |
| `sourceScreenId` | `string` | No | Osiris screen ID this derived from |
| `refinedFromNodeId` | `string` | No | Figma node ID |
| `supersedes` | `string` | No | Template ID this replaces |

**Returns:** `{ templateId: string, version: number, generation: number }`

**Behavior:**
- If `supersedes` is provided, sets `supersededBy` on the old template and increments generation.
- If no `supersedes`, creates generation 1.
- Auto-detects content slots if `slots` is omitted (Claude identifies them).

---

### `osiris_find_template`

Search for matching templates by brand, screen type, and attributes.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `brandId` | `string` | Yes | Brand to search |
| `screenType` | `string` | Yes | Screen type to match |
| `tags` | `string[]` | No | Tags to match (Jaccard similarity) |
| `mood` | `string` | No | Mood to match |
| `platform` | `string` | No | Platform (default: mobile) |
| `limit` | `number` | No | Max results (default: 3) |
| `includeOtherBrands` | `boolean` | No | Fall back to other brands if no match (default: false) |

**Returns:** Array of `{ template: GoldenTemplate, score: number, matchBreakdown: object }`

**Scoring algorithm:**

| Signal | Weight | Logic |
|--------|--------|-------|
| Screen type exact | 0.35 | Exact = 1.0, partial (shared prefix) = 0.6 |
| Tag overlap | 0.20 | Jaccard similarity |
| Mood match | 0.15 | Exact = 1.0, compatible = 0.5 |
| Recency | 0.15 | `1 - (daysSinceRefinement / 180)`, clamped to [0, 1] |
| Usage count | 0.10 | `min(usageCount / 20, 1.0)` |
| Generation | 0.05 | `min(generation / 5, 1.0)` |

**Retrieval rules:**
- Only returns templates where `supersededBy IS NULL` (head of chain).
- Brand-specific first. If `includeOtherBrands` and no brand match, search all brands.
- Minimum score threshold: 0.3 (below this, no results returned).

---

### `osiris_get_template`

Retrieve a specific template by ID.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `templateId` | `string` | Yes | Template ID |
| `includeLineage` | `boolean` | No | Include supersession chain (default: false) |

**Returns:** Full `GoldenTemplate` object. If `includeLineage`, includes `lineage: GoldenTemplate[]` (oldest first).

---

### `osiris_list_templates`

List all templates for a brand.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `brandId` | `string` | Yes | Brand slug |
| `screenType` | `string` | No | Filter by screen type |
| `headsOnly` | `boolean` | No | Only latest versions (default: true) |

**Returns:** Array of template summaries (no SOM body, just metadata).

---

### `osiris_deprecate_template`

Mark a template as deprecated (not deleted).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `templateId` | `string` | Yes | Template to deprecate |
| `reason` | `string` | No | Why it was deprecated |

**Returns:** `{ success: true }`

---

## 4. Rex Changes

### 4.1 BuildManifest (Phase 1)

During every build, Rex maintains a mapping from Figma node IDs to SOM roles.

**File:** `src/build/manifest.ts` (new)

```typescript
interface BuildManifest {
  frameId: string;
  brandId: string;
  screenType: string;
  timestamp: number;
  templateId?: string;               // If built from a template
  nodes: Map<string, ManifestEntry>;  // key = Figma node ID
}

interface ManifestEntry {
  somRole: string;                    // Role from SOM or template
  somName: string;
  parentRole: string;
  appliedValues: Record<string, unknown>;     // What Rex set
  patternApplied: Record<string, string>;     // property -> patternId (if pattern was used)
}
```

**Integration point:** Every `create_node` call in the write tool handlers adds an entry to the active manifest. The manifest is stored in memory and persists until the observation window closes.

**Implementation:** One `Map.set()` per node created. No persistence beyond the session.

### 4.2 Passive Observer (Phase 2)

**File:** `plugin/observer.ts` (new, ~150 lines)

```typescript
// Listens to figma.on("documentchange")
// Filters to changes within the observed frame's subtree
// Buffers changes and flushes to relay every 2 seconds via existing polling

interface ObservationWindow {
  frameId: string;
  startedAt: number;
  changes: PropertyChangeEvent[];
  structuralChanges: StructuralChangeEvent[];
  status: "observing" | "flushing" | "closed";
}

// Observation starts: when Rex completes a build (automatic)
// Observation ends: any of:
//   1. Designer says "done" (explicit)
//   2. New Rex build starts (implicit)
//   3. No changes for 60 seconds (idle timeout)
//   4. Designer switches page
```

**Structural clustering:** Changes within a 2-second window on nodes sharing a parent are grouped into `StructuralCluster` objects, preserving temporal context for future interpretation.

**File:** `plugin/code.ts` (modified)
- Wire observer start on build completion
- Wire observer stop on idle/page-change/new-build
- Add `changes` field to poll response payload

### 4.3 Refinement Recorder (Phase 2)

**File:** `src/refinement/recorder.ts` (new)

Receives change buffers from the relay. Looks up each changed node in the BuildManifest to get SOM roles. Assembles `RefinementRecord` objects and stores them in MongoDB.

### 4.4 Pattern Extraction (Phase 3)

**File:** `src/refinement/patterns.ts` (new)

Groups property changes by `(brandId, somRole, property)`. Detects recurrence. Computes confidence:

```
base_confidence = min(occurrence_count / 5, 0.7)
role_consistency_bonus = +0.1 if same role across all occurrences
direction_consistency_bonus = +0.1 if direction is consistent
recency_bonus = +0.1 if most recent occurrence < 5 screens ago
max_without_confirmation = 0.7
auto_promote_threshold = 8 occurrences (bypasses confirmation, goes to 0.8)
```

Pattern types: `override`, `increase`, `decrease`, `clamp`, `replace`.

### 4.5 Adversarial Filter (Phase 3)

**File:** `src/refinement/filter.ts` (new)

Classifies each `CapturedChange` before it enters the pattern store:

1. **Revert detection:** Property changed A -> B -> A within same session. Discard.
2. **Artifact cleanup:** Name-only changes, invisible frame reordering. Discard.
3. **AI error correction:** Change brings value closer to reference SOM. Route to builder diagnostics.
4. **Platform convention:** Value matches known platform constants (44pt tap target, safe area). Discard.
5. **Content-driven:** Font size decrease paired with text length increase. Discard.
6. **Genuine preference:** Passes all four tests (recurring, role-consistent, content-independent, stable). Promote.

**Cross-role generalization (second pass):** Groups by `(property, classifiedValue)` instead of `(role, property)`. Requires 3+ distinct roles. Uses a lightweight role taxonomy (~40 entries) and brand token awareness from Osiris.

**Override detection:** When Rex applies a pattern and the designer changes that value:
- Change from pattern value to reference value: strong rejection (confidence -= 0.2)
- Change from pattern value to novel third value: weak rejection + new data point
- Two rejections across sessions: pattern demoted below application threshold

### 4.6 Pattern Applicator (Phase 3)

**File:** `src/refinement/applicator.ts` (new)

Called during build when no template is available. Queries confirmed patterns (confidence >= 0.7) for the active brand. Adjusts node values before creation. Records applied patterns in the BuildManifest for override detection.

---

## 5. Answering the Missing Pieces

### 5.1 How does the designer trigger template save?

**Primary: Claude prompts after refinement.** When the observation window closes (designer idle 60s, says "done," or starts a new build), Claude asks:

> "Want me to save this as a template for [screen type]?"

This is a single yes/no at a natural handoff point -- not a dialog during editing. If the designer says yes, Claude runs `extract_som` on the refined frame and calls `osiris_save_golden_template`.

**Secondary: Auto-save opt-in.** The designer can tell Claude "always save my refinements as templates." This is stored as a Rex Memory entry (`category: "convention"`, `content: "Auto-save refined screens as templates"`). When active, Claude saves without asking.

**Tertiary: Explicit command.** The designer can say "save this as a template" at any time during chat.

### 5.2 How does content slot detection work?

**Content slot detection is Claude's job, not algorithmic.**

When saving a template, Claude examines the SOM v2 and identifies slots based on semantic understanding:

1. **Text nodes with dynamic content** -- amounts ("$10.00"), names ("John Smith"), titles ("Send Money"). Claude knows these are content because they are screen-instance-specific, not structural.
2. **Image fills** -- profile pictures, product images, illustrations. Always slotted.
3. **Repeating groups** -- list items, card grids. The group itself is structural; the item count and content are slots.

**What is NOT a slot:**
- Style properties (fontSize, cornerRadius, fills that are brand colors) -- these are baked into the template.
- Structural elements (sections, wrappers, layout containers) -- these define the skeleton.
- Labels that are structural ("Settings," "Account," "Notifications") -- these transfer between uses.

**Slot definition:**

```typescript
interface ContentSlot {
  slotId: string;         // "hero-title", "amount-display", "list-items"
  nodeId: string;         // SOM v2 node ID
  role: string;           // SOM role
  type: "text" | "image" | "repeating-group";
  defaultValue?: string;  // Current content (for reference)
  constraints?: {
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
  };
}
```

Claude populates slots by replacing text content only. Style properties on the node (font size, weight, color, padding) are preserved from the template. This mirrors how Figma component text overrides work.

### 5.3 What happens during the first build with zero templates?

**Identical to current behavior.** The template system is additive.

```
1. Claude calls osiris_find_template(brand, screenType, ...)
2. No results (score < 0.3 or empty)
3. Claude falls back to:
   a. osiris_search_screens(screen_type, limit: 5)
   b. osiris_get_screen_som(best_match)
   c. Build from raw SOM using Rex tools
4. Designer refines (the usual heavy refinement -- expect 10-20 changes)
5. Observation window captures all changes (if Phase 2 is active)
6. Claude prompts: "Save this as a template?"
7. If yes: extract_som -> osiris_save_golden_template (generation 1)
8. Next time this screen type is requested, the template exists
```

**The system bootstraps from the first session.** After 5-10 sessions covering common screen types, most requests hit a template. No special cold-start infrastructure needed.

**Optional accelerator: Batch import.** A designer with existing Figma screens can seed 10-20 templates in one session:

```
For each approved screen:
  1. extract_som(nodeId)
  2. Claude classifies screenType, tags, mood, density
  3. Claude identifies content slots
  4. osiris_save_golden_template(...)
```

### 5.4 How are templates versioned vs. screen SOMs?

**Templates and screen SOMs are independent artifacts in separate collections.**

| Concern | Screen SOMs (`screens` collection) | Golden Templates (`golden_templates` collection) |
|---------|-------------------------------------|--------------------------------------------------|
| Source | Extracted from reference screenshots by Osiris | Extracted from designer-refined Figma frames by Rex |
| Purpose | Raw reference material for building | Refined, designer-approved build plans |
| Versioning | Overwritten on re-extraction | Supersession chain (v1 -> v2 -> v3) |
| Roles | May or may not have roles (v1 vs v2) | Always SOM v2 with roles |
| Content slots | None | Defined per template |
| Brand-specific | Yes (each screen belongs to a brand) | Yes (each template scoped to brand) |
| Used by | Fallback when no template exists | Primary build source |

**Key distinction:** A screen SOM is what Osiris captured from a screenshot. A Golden Template is what a designer approved after refinement. The template may have started from a screen SOM, but it diverged during refinement -- different padding, corner radii, structure, etc. The template IS the lesson learned from that divergence.

**Templates reference their source screen** via `sourceScreenId` but do not depend on the screen SOM remaining unchanged. If Osiris re-extracts the screen SOM, the template is unaffected.

---

## 6. Conflict Analysis

### Template save vs. Pattern observation

No conflict. Both can run simultaneously after a refinement:
- The observer captures property-level changes for the pattern pipeline (Track B)
- Claude saves the full refined SOM as a template (Track A)
- These are independent operations on different data

### Adversarial filter vs. zero-friction workflow

Resolved by **temporal separation:**
- **During refinement:** Zero friction. Observer is silent. No popups, no questions.
- **Between sessions:** Filter processes accumulated observations in background.
- **At next build time:** Brief optional question (max one per build) when a pattern reaches candidate status. Natural handoff point.
- **At 8+ consistent occurrences:** Auto-promote silently. Evidence threshold high enough.

### Pattern application vs. template usage

No conflict. They are mutually exclusive paths:
- If a template exists (score > 0.3): use the template. Patterns are NOT applied on top.
- If no template: build from raw reference. Apply confirmed patterns as adjustments.
- Templates already embody the designer's preferences. Applying patterns on top would double-correct.

### BuildManifest lifetime

The manifest lives for one observation window. It is created during build, used during observation, and discarded when observation closes. No persistence conflict with templates or patterns.

---

## 7. Files to Create/Modify

### Rex (this repo)

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `src/build/manifest.ts` | CREATE | 1 | BuildManifest type + factory |
| `src/tools/write/create-node.ts` | MODIFY | 1 | Add manifest entry on node creation |
| `src/tools/write/update-node.ts` | MODIFY | 1 | Update manifest on property changes |
| `src/tools/schemas.ts` | MODIFY | 1 | Add ExtractSomSchema (if not done) |
| `plugin/observer.ts` | CREATE | 2 | Passive `documentchange` listener |
| `plugin/code.ts` | MODIFY | 2 | Wire observer start/stop, add changes to poll |
| `src/refinement/types.ts` | CREATE | 2 | RefinementRecord, PropertyChange, StructuralCluster types |
| `src/refinement/recorder.ts` | CREATE | 2 | Assembles RefinementRecords from change buffers |
| `src/refinement/filter.ts` | CREATE | 3 | Adversarial filter (change taxonomy classifier) |
| `src/refinement/patterns.ts` | CREATE | 3 | Pattern extraction + confidence scoring |
| `src/refinement/applicator.ts` | CREATE | 3 | Applies patterns during no-template builds |
| `plugin/executors/som-extractor.ts` | MODIFY | 1 | Ensure v2 format with content/style split |

### Osiris (separate repo)

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `src/models/golden-template.ts` | CREATE | 1 | Mongoose schema for `golden_templates` |
| `src/routes/templates.ts` | CREATE | 1 | REST routes for template CRUD |
| `src/mcp/tools/save-golden-template.ts` | CREATE | 1 | MCP tool handler |
| `src/mcp/tools/find-template.ts` | CREATE | 1 | MCP tool handler with scoring |
| `src/mcp/tools/get-template.ts` | CREATE | 1 | MCP tool handler |
| `src/mcp/tools/list-templates.ts` | CREATE | 1 | MCP tool handler |
| `src/mcp/tools/deprecate-template.ts` | CREATE | 1 | MCP tool handler |
| `src/mcp/index.ts` | MODIFY | 1 | Register new tools |
| `src/models/refinement-record.ts` | CREATE | 2 | Mongoose schema (if stored in Osiris) |
| `src/models/property-pattern.ts` | CREATE | 3 | Mongoose schema (if stored in Osiris) |

### Claude Orchestration (prompt-level)

Add to Claude's system prompt:

```
When asked to build a screen:
1. Call osiris_find_template(brandId, screenType, tags, mood, platform)
2. If a template matches (score > 0.3):
   a. Use the template SOM as the build plan
   b. Identify content slots and populate with requested content
   c. For cross-brand templates, replace propertyAnnotation source="brand" values
   d. Add/remove sections as needed, copying style from existing sections
   e. Build using Rex tools
3. If no template matches:
   a. Fall back to osiris_search_screens + osiris_get_screen_som
   b. Query property_patterns for confirmed patterns (confidence >= 0.7)
   c. Apply patterns as adjustments during build
   d. Build using Rex tools
4. After designer refinement:
   a. Ask "Want me to save this as a template for [screen type]?"
   b. If yes: call extract_som on the refined frame
   c. Identify content slots (text with dynamic content, images, repeating groups)
   d. Tag property annotations (brand = matches brand palette; taste = everything else)
   e. Call osiris_save_golden_template with the refined SOM
```

---

## 8. Phased Implementation Plan

### Phase 1: Golden Templates (Days 1-3)

**Goal:** Save refined screens as templates. Reuse them for future builds.

Day 1:
- [ ] Osiris: `golden_templates` Mongoose schema + collection indexes
- [ ] Osiris: `osiris_save_golden_template` MCP tool
- [ ] Rex: `BuildManifest` type + factory in `src/build/manifest.ts`

Day 2:
- [ ] Osiris: `osiris_find_template` with scoring algorithm
- [ ] Osiris: `osiris_get_template` and `osiris_list_templates`
- [ ] Rex: Wire manifest population into `create_node` handler

Day 3:
- [ ] Osiris: `osiris_deprecate_template`
- [ ] Claude: Template-first orchestration prompt
- [ ] Claude: Content slot identification logic (prompt-level)
- [ ] Test: End-to-end save + retrieve + build-from-template

**Phase 1 outcome:** The very first refined screen becomes a reusable template. Immediate value.

### Phase 2: Passive Observer (Days 4-6)

**Goal:** Silently capture all property changes during designer refinement.

Day 4:
- [ ] Rex plugin: `observer.ts` -- `documentchange` listener, change buffer
- [ ] Rex plugin: Observation window lifecycle (start/stop triggers)
- [ ] Rex plugin: Wire into `code.ts`, add changes to poll response

Day 5:
- [ ] Rex server: `refinement/types.ts` -- RefinementRecord, PropertyChange types
- [ ] Rex server: `refinement/recorder.ts` -- assemble records from buffers
- [ ] Rex server: Structural clustering (2-second window, shared-parent grouping)

Day 6:
- [ ] Store refinement records in MongoDB
- [ ] Test: Verify change capture across build + refinement + idle
- [ ] Test: Verify structural clusters preserve temporal context

**Phase 2 outcome:** Data accumulates silently. Nothing is applied yet.

### Phase 3: Filter + Patterns (Days 7-11)

**Goal:** Classify changes, reject noise, extract and apply recurring patterns.

Day 7-8:
- [ ] Rex server: `refinement/filter.ts` -- change taxonomy classifier (6 categories)
- [ ] Ship as diagnostic-only first (classify and log, do not gate)
- [ ] Validate on existing refinement data (5 screens, 10 changes)

Day 9:
- [ ] Rex server: `refinement/patterns.ts` -- recurrence grouping, confidence scoring
- [ ] Brand-scoped storage with cross-brand directional detection
- [ ] Pattern types: override, increase, decrease, clamp, replace

Day 10:
- [ ] Rex server: `refinement/applicator.ts` -- apply patterns during no-template builds
- [ ] Override detection via BuildManifest (track pattern-applied values)
- [ ] Pattern confidence decay on rejection

Day 11:
- [ ] Cross-role generalization (second-pass grouping by property + value pattern)
- [ ] Role taxonomy (~40 role-to-category mappings)
- [ ] Integration test: end-to-end learning loop

**Phase 3 outcome:** Patterns form from accumulated observations. High-confidence patterns auto-apply on no-template builds. Noise is filtered.

### Phase 4: Polish + Feedback (Days 12-14)

Day 12:
- [ ] "What have you learned?" recall via existing memory tools
- [ ] Pattern surfacing during builds (max 1 question per build)

Day 13:
- [ ] Backfill: process existing 5 before/after pairs through pipeline
- [ ] Batch template import flow for existing Figma screens

Day 14:
- [ ] Style Propagation: detect consistent changes across templates in one session
- [ ] End-to-end testing across 3 brands

### Phase 5: Maturation (Ongoing)

- [ ] Structural pattern support (interpret structural clusters into transferable patterns)
- [ ] Screenshot-as-index for cold-start acceleration (first 5 screens of new brand)
- [ ] Content fingerprinting fallback for screens Rex did not build
- [ ] Learning dashboard: templates, patterns, filter decisions, confidence trajectories
- [ ] Template deduplication (detect near-duplicate templates, suggest merge)

---

## 9. Data Flow Diagrams

### Build with Template

```
Claude                          Osiris                     Rex                        Figma Plugin
  │                               │                         │                              │
  ├──find_template(brand,type)───>│                         │                              │
  │<──template + score────────────│                         │                              │
  │                               │                         │                              │
  │  [populate content slots]     │                         │                              │
  │  [replace brand properties]   │                         │                              │
  │                               │                         │                              │
  ├──create_node(adapted SOM)────────────────────────────>│                              │
  │                               │                         ├──create + manifest.set()────>│
  │                               │                         │<──nodeId─────────────────────│
  │                               │                         │                              │
  │  [build complete]             │                         ├──start observation──────────>│
  │                               │                         │                    [documentchange]
  │  [designer refines in Figma]  │                         │                              │
  │                               │                         │<──change buffer (poll)───────│
  │                               │                         │                              │
  │  [idle 60s or "done"]         │                         ├──stop observation───────────>│
  │                               │                         │                              │
  │  "Save as template?"          │                         │                              │
  │                               │                         │                              │
  ├──extract_som(frameId)────────────────────────────────>│                              │
  │<──SOM v2──────────────────────────────────────────────│                              │
  │                               │                         │                              │
  ├──save_golden_template(som)──>│                         │                              │
  │<──templateId─────────────────│                         │                              │
```

### Build without Template (Pattern Path)

```
Claude                          Osiris                     Rex
  │                               │                         │
  ├──find_template(brand,type)───>│                         │
  │<──no results (score < 0.3)───│                         │
  │                               │                         │
  ├──search_screens(type)────────>│                         │
  │<──screen matches──────────────│                         │
  ├──get_screen_som(best)────────>│                         │
  │<──raw SOM─────────────────────│                         │
  │                               │                         │
  │  [query patterns]             │                         │
  │  patterns = confirmed patterns for this brand           │
  │                               │                         │
  ├──create_node(SOM + patterns)─────────────────────────>│
  │                               │         [apply patterns during build]
  │                               │         [record pattern-applied values in manifest]
  │                               │                         │
```

---

## 10. Success Metrics

| Metric | Cold Start (0 templates) | After 2 weeks | After 3 months |
|--------|--------------------------|---------------|----------------|
| Template hit rate | 0% | 40-60% | 80-95% |
| Avg refinement changes | 15-20 | 5-8 | 2-3 |
| Refinement time | 4 min | 2 min | 45 sec |
| Pattern false positive rate | N/A | < 15% | < 5% |
| Filter rejection rate | N/A | ~50% | ~50% |
| Templates per brand | 0 | 8-15 | 20+ |
| Confirmed patterns per brand | 0 | 3-5 | 10-15 |

The ultimate metric: **the designer forgets the system is learning.** Builds just get better.

---

## 11. Open Questions for Implementation

1. **Where do refinement records and patterns live?** Options: (a) in Osiris alongside templates, (b) in Rex's own MongoDB, (c) in Rex Memory. Recommendation: Osiris, since patterns are brand-scoped and Osiris already owns brand data.

2. **Pattern confidence decay rate.** Current proposal: -0.01/day without reinforcement, -0.2 per rejection-to-reference, -0.1 per rejection-to-novel. Needs tuning with real data.

3. **Cross-brand template threshold.** When `includeOtherBrands=true`, how much should cross-brand scores be penalized? Recommendation: multiply score by 0.6 for different-brand matches.

4. **Template SOM size limits.** A complex screen SOM can be 50-100KB. At 200+ templates, this is 10-20MB in MongoDB. Not a concern for MongoDB, but the MCP response payload for `find_template` should return metadata-only by default, with SOM fetched separately via `get_template`.

5. **Observation window for chat-directed refinements.** When the designer says "change the padding to 24" and Rex makes the change, this is a Rex-directed change, not a designer edit. The observer should distinguish Rex-applied changes from designer manual edits. Solution: the observer ignores changes that occur within 500ms of a Rex command execution.
