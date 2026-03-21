# Proposal 01: Structural-First Refinement Learning

## Status: Draft
## Date: 2026-03-21

---

## The Problem

Rex builds UI screens in Figma from Osiris reference designs (screenshot + SOM). Designers then refine these builds. We want to learn from those refinements so future builds are better.

The current approach -- tree-diffing before/after SOMs via `osiris_capture_delta` -- has failed across all 5 captured screens (kraken_05, zing_51, acorns_54, coinbase_03, betterment_01). Every delta returned 0 matched node deltas. The reasons:

1. **Name mismatch.** Hand-written "before" SOMs use names like `balance-section`; Figma layers after refinement have names like `Frame 47` or designer-chosen names like `main-content`.
2. **Structural destruction.** Designers reparent nodes, wrap groups into new frames, flatten unnecessary wrappers. Tree alignment breaks completely.
3. **Role+name matching is fragile.** Even with consistent `extract_som` extraction, the same logical element can have different names, depths, and parent chains before vs after.
4. **Two types of change are conflated.** Restructuring the layer hierarchy (moving CTAs into their own section) is a fundamentally different kind of change from tweaking padding values. Trying to diff them in the same tree walk fails at both.

## The Insight

Structural changes and property changes are different types of learning that need different capture, matching, and application strategies. Splitting them into two layers makes each layer's problem tractable.

| | Layer 1: Structural | Layer 2: Property |
|---|---|---|
| **What it captures** | How the SOM hierarchy should be organized | Property-level tweaks to style values |
| **What it teaches** | How to BUILD better | Design TASTE |
| **Matching strategy** | Structural fingerprints (topology, not names) | Role-based property comparison |
| **Failure mode of tree-diff** | Total (reparenting destroys alignment) | Partial (works if nodes match, but they don't) |
| **Solution** | Pattern templates, not node diffs | Aggregated property rules, not per-node diffs |

---

## Layer 1: Structural Learning

### What "Structural" Means

Structural changes are modifications to the SOM's hierarchy that don't map to a single property change on a single node. From the real refinement data:

- Separating CTAs from content into their own auto-layout section (kraken_05, zing_51)
- Removing unnecessary wrapper frames / flattening hierarchy (acorns_54, coinbase_03)
- Switching root frame to `SPACE_BETWEEN` to push CTAs to bottom (kraken_05, zing_51, acorns_54)
- Adding a root `cornerRadius: 24` for device framing (all 5 screens)
- Wrapping content in a scrollable section while keeping CTAs pinned (zing_51)

These aren't "change property X on node Y" -- they're "reorganize the tree topology."

### Capture: Structural Fingerprinting

Instead of trying to match nodes between before/after trees, we extract a **structural fingerprint** from each SOM -- a compact representation of its topology that ignores names entirely.

```typescript
interface StructuralFingerprint {
  // Topology signature: depth-first encoding of the tree shape
  // Each node becomes: (type, role, childCount)
  // Example: "F:screen:3 > F:nav:2 > T:label:0, T:value:0 > F:content:4 > ..."
  topology: string;

  // Role sequence: ordered list of roles at each depth level
  // depth0: ["screen"]
  // depth1: ["nav", "hero", "content", "cta-section"]
  // depth2: ["icon", "label", "balance-value", "card", "card", "button"]
  roleLevels: Record<number, string[]>;

  // Layout chain: the auto-layout configuration at each structural level
  // ["VERTICAL/SPACE_BETWEEN/24,0,24,24", "VERTICAL/MIN/20,0,20,0", ...]
  layoutChain: string[];

  // CTA placement: where interactive elements sit in the tree
  ctaDepth: number;          // How deep are CTAs nested
  ctaSiblingCount: number;   // How many siblings at the CTA level
  ctaIsSeparated: boolean;   // Is CTA in its own container vs inline with content

  // Wrapper density: ratio of "structural" frames (no visual properties) to total frames
  wrapperRatio: number;
}
```

**Key property: this fingerprint does not use node names at all.** It uses roles (assigned by `extract_som`'s heuristic algorithm) and structural topology.

### Capture Process

```
Input:  before_som (from Osiris, what Rex built)
        after_som  (from extract_som on the refined Figma frame)

Process:
  1. Compute StructuralFingerprint for before_som → fp_before
  2. Compute StructuralFingerprint for after_som  → fp_after
  3. Compare fingerprints to extract structural deltas:
     a. topology changed?          → record the after topology as "preferred"
     b. roleLevels reshuffled?     → record which roles moved to which depths
     c. layoutChain changed?       → record the after layout chain
     d. ctaIsSeparated flipped?    → record CTA separation preference
     e. wrapperRatio decreased?    → record flattening preference

Output: StructuralDelta
```

```typescript
interface StructuralDelta {
  screenType: string;          // "payment", "confirmation", "dashboard", etc.
  designMood: string;          // "dark", "light", "premium", etc.

  // What changed structurally
  changes: StructuralChange[];

  // The "after" fingerprint (the designer's preferred structure)
  preferredFingerprint: StructuralFingerprint;

  // The full "after" SOM skeleton (roles + layout, no style values)
  preferredSkeleton: SomSkeleton;
}

interface StructuralChange {
  type: "cta_separation" | "wrapper_removal" | "layout_mode_change"
      | "depth_change" | "role_reorder" | "section_addition" | "section_removal";
  description: string;       // Human-readable: "CTAs moved from inline to dedicated section"
  before: string;            // Compact representation of the before state
  after: string;             // Compact representation of the after state
  confidence: number;        // How clearly this is a structural vs cosmetic change
}
```

### Storage

Structural learnings are stored as **structural templates** keyed by screen type:

```typescript
interface StructuralTemplate {
  _id: string;
  screenType: string;                    // "payment", "confirmation", etc.
  designMoods: string[];                 // ["dark", "premium"]

  // The preferred SOM skeleton for this screen type
  skeleton: SomSkeleton;                 // Roles + hierarchy, no style values

  // Evidence
  sourceDeltas: string[];                // IDs of StructuralDeltas that contributed
  evidenceCount: number;                 // How many refinements informed this
  confidence: number;                    // Higher with more consistent evidence

  // Specific rules extracted from this template
  rules: StructuralRule[];

  createdAt: Date;
  updatedAt: Date;
}

interface StructuralRule {
  rule: string;                          // "cta_separated", "max_wrapper_depth_2", etc.
  description: string;                   // "CTAs should be in a dedicated section, not inline"
  evidenceCount: number;
  consistency: number;                   // What % of deltas showed this pattern
}
```

The `SomSkeleton` is a stripped-down SOM that contains only structural information:

```typescript
interface SomSkeleton {
  role: string;
  type: "FRAME" | "TEXT" | "RECTANGLE" | "ELLIPSE" | "GROUP";
  layout?: {
    direction: "VERTICAL" | "HORIZONTAL";
    primaryAxisAlign: string;            // "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"
    counterAxisAlign: string;
    primaryAxisSizing: string;           // "FIXED" | "HUG" | "FILL"
    counterAxisSizing: string;
  };
  children?: SomSkeleton[];
}
```

### Application to Future Builds

When Rex builds a new screen:

```
1. Identify screen type from Osiris metadata (e.g., "payment")
2. Query structural templates for this screen type
3. If template exists with confidence > 0.7:
   a. Use the template's skeleton as the structural blueprint
   b. Map reference SOM's content (texts, images) into the skeleton's role slots
   c. Apply style from reference SOM or Layer 2 property rules
4. If no template or low confidence:
   a. Build directly from reference SOM as today
   b. Apply any individual structural rules that are confirmed
      (e.g., "always separate CTAs" applies regardless of screen type)
```

This means structural learning produces a **blueprint** that reshapes how Rex organizes the tree before it fills in property values.

---

## Layer 2: Property (Refinement) Learning

### What "Property" Means

Property changes are modifications to individual style values that don't alter the tree structure. From the real refinement data:

- Increased top padding: 16 to 24-32 (all 5 screens)
- Increased horizontal padding: 20-24 to 24-32 (all 5 screens)
- Reduced corner radii on cards: 28 to 12, 18 to 8 (4/5 screens)
- Darkened body text: #666666 to #070809 (3/5 screens)
- Bumped body font size: 16 to 18 (3/5 screens)
- Root corner radius: 0 to 24 (5/5 screens)
- Brand-tinted backgrounds on interactive elements (2/5 screens)
- Gray background with white cards instead of flat white (2/5 screens)

These are "change property X from value A to value B" -- they can be expressed as rules without reference to specific nodes.

### Why This Layer Doesn't Need Tree Matching

The key realization: property refinements are patterns that apply to **roles**, not to specific named nodes. The designer didn't think "change node `Frame 47`'s padding to 24" -- they thought "the screen root needs more padding" or "card corners should be sharper."

Instead of matching before/after nodes, we:
1. Extract properties from the "before" SOM, grouped by role
2. Extract properties from the "after" SOM, grouped by role
3. Compare properties within each role group

Matching is by **role**, not by name or tree position. If the before SOM has a node with `role: "screen"` and the after SOM has a node with `role: "screen"`, we compare their properties -- regardless of what they're named or where they sit in the tree.

### Capture Process

```
Input:  before_som (with roles assigned)
        after_som  (with roles assigned via extract_som)

Process:
  1. Flatten both SOMs into role-property maps:
     before_roles = { "screen": [{padding: 16, cornerRadius: 0, ...}],
                      "card": [{cornerRadius: 28, ...}, {cornerRadius: 18, ...}],
                      "cta": [{fill: "#2196F3", cornerRadius: 24, ...}],
                      ... }
     after_roles  = { "screen": [{padding: 24, cornerRadius: 24, ...}],
                      "card": [{cornerRadius: 12, ...}, {cornerRadius: 8, ...}],
                      ... }

  2. For each role present in both maps:
     a. Compare property values
     b. Record changes as PropertyDelta entries
     c. Handle multiple nodes per role by comparing distributions:
        - If before has 3 cards with radii [28, 28, 18]
          and after has 2 cards with radii [12, 8]
        - Record: "card cornerRadius decreased significantly (avg 24.7 → avg 10)"

  3. Discard noise:
     - Changes < 2px on spacing/sizing (within rounding error)
     - Color changes < deltaE 3 (imperceptible)
     - Changes that appear in only 1 node with no pattern

Output: PropertyDelta[]
```

```typescript
interface PropertyDelta {
  role: string;              // "screen", "card", "cta", etc.
  roleCategory: string;      // "structure", "content", "interactive", etc.
  property: string;          // "padding.top", "cornerRadius", "fill", "fontSize"
  beforeValue: any;          // 16, "#666666", 28
  afterValue: any;           // 24, "#070809", 12
  changeType: "increase" | "decrease" | "replace" | "add" | "remove";
  magnitude: number;         // Normalized change magnitude (0-1)
}
```

### Storage: Property Rules

Property deltas accumulate into **property rules** -- aggregated patterns that emerge across multiple refinements:

```typescript
interface PropertyRule {
  _id: string;

  // Scope
  scope: "universal" | "screen_type" | "role" | "mood";
  screenType?: string;       // "payment", null for universal
  designMood?: string;       // "dark", null for universal
  role: string;              // "screen", "card", "cta"

  // The rule
  property: string;          // "cornerRadius", "padding.top", "fontSize"
  direction: "increase" | "decrease" | "set" | "range";
  fromRange: [number, number];   // Typical before values [16, 20]
  toRange: [number, number];     // Typical after values [24, 32]
  toValue?: any;                 // For "set" direction: exact value

  // Evidence
  evidenceCount: number;     // How many deltas support this
  consistency: number;       // What % of deltas agree (0-1)
  status: "confirmed" | "tentative";  // confirmed: 3+ deltas, 80%+ consistency
  sourceDeltas: string[];    // Delta IDs

  createdAt: Date;
  updatedAt: Date;
}
```

**Rule extraction example from the real data:**

| Role | Property | From | To | Evidence | Status |
|------|----------|------|----|----------|--------|
| screen | padding.top | 16 | 24-32 | 5/5 screens | confirmed |
| screen | cornerRadius | 0 | 24 | 5/5 screens | confirmed |
| screen | primaryAxisAlign | MIN | SPACE_BETWEEN | 3/5 screens | confirmed |
| card | cornerRadius | 18-28 | 8-12 | 4/5 screens | confirmed |
| * (any) | padding.horizontal | 20-24 | 24-32 | 5/5 screens | confirmed |
| label (body) | fill (text color) | #666666 | #070809 | 3/5 screens | confirmed |
| label (body) | fontSize | 16 | 18 | 3/5 screens | confirmed |

### Application to Future Builds

Property rules are injected as overrides during SOM construction or as a post-processing pass:

```
1. Rex builds a SOM from the reference design
2. Before converting SOM → Figma nodes, apply property rules:
   a. Load confirmed rules (universal + matching screen type + matching mood)
   b. For each node in the SOM:
      - Look up rules for this node's role
      - If node's current property value falls in the rule's fromRange:
        → Replace with the rule's toRange midpoint (or toValue)
      - If rule scope is universal, apply with lower priority than screen-type-specific
   c. Log which rules were applied for transparency
3. Build the modified SOM in Figma
```

Priority order for conflicting rules:
1. Screen-type + mood specific (highest)
2. Screen-type specific
3. Mood specific
4. Universal (lowest)

---

## Walkthrough: kraken_05 (Dark Payment Screen)

Let's trace the full flow for the kraken_05 dark payment screen.

### Step 1: Rex Builds from Reference

Rex receives the Osiris SOM for kraken_05 and builds it in Figma. The built result has:

```
screen (VERTICAL, padding: 16 all, primaryAxisAlign: MIN)
  ├── status-bar
  ├── nav (HORIZONTAL)
  │   ├── icon (back)
  │   └── label ("Send BTC")
  ├── amount-section (VERTICAL, padding: 20 horizontal)
  │   ├── value ("0.0420 BTC")
  │   ├── label ("$1,250.00")
  │   └── input (amount field)
  ├── recipient-card (cornerRadius: 28, fill: #1A1A24)
  │   ├── avatar
  │   ├── label ("To: Alex")
  │   └── label ("Bitcoin Network")
  ├── fee-row (HORIZONTAL)
  │   ├── label ("Network Fee")
  │   └── value ("$2.50")
  └── cta-button (cornerRadius: 24, fill: #7B61FF)
      └── label ("Confirm Send")
```

### Step 2: Designer Refines

The designer makes these changes in Figma:
- Adds `cornerRadius: 24` to root frame
- Changes root `primaryAxisAlign` to `SPACE_BETWEEN`
- Increases root `paddingTop` from 16 to 32, horizontal padding from 20 to 24
- Moves CTA button into a new `cta-section` frame with its own padding
- Removes the wrapper around fee-row (flattens it)
- Reduces `recipient-card` cornerRadius from 28 to 12
- Darkens body text labels from #666666 to #070809
- Tints numpad key backgrounds from #1A1A24 to #1A0E53

### Step 3: Extract After SOM

Rex runs `extract_som` on the refined frame. The after SOM:

```
screen (VERTICAL, padding: {top:32, right:24, bottom:24, left:24},
        primaryAxisAlign: SPACE_BETWEEN, cornerRadius: 24)
  ├── status-bar
  ├── nav (HORIZONTAL)
  │   ├── icon (back)
  │   └── label ("Send BTC")
  ├── content-area (VERTICAL, gap: 16)  ← designer's preferred grouping
  │   ├── amount-section (VERTICAL)
  │   │   ├── value ("0.0420 BTC")
  │   │   ├── label ("$1,250.00", fill: #070809)
  │   │   └── input (amount field)
  │   ├── recipient-card (cornerRadius: 12, fill: #1A1A24)
  │   │   ├── avatar
  │   │   ├── label ("To: Alex")
  │   │   └── label ("Bitcoin Network")
  │   └── fee-row (HORIZONTAL)  ← flattened, no wrapper
  │       ├── label ("Network Fee", fill: #070809)
  │       └── value ("$2.50")
  └── cta-section (VERTICAL, padding: {top:16})  ← separated CTA
      └── cta-button (cornerRadius: 24, fill: #7B61FF)
          └── label ("Confirm Send")
```

### Step 4: Layer 1 -- Structural Capture

Compute fingerprints for both SOMs:

**Before fingerprint:**
```
topology: "F:screen:5 > F:nav:2 > ... > F:card:3 > ... > F:cta:1"
roleLevels: { 0: ["screen"], 1: ["status-bar","nav","section","card","row","cta"], ... }
ctaDepth: 1            // CTA is direct child of screen
ctaSiblingCount: 5     // CTA shares level with 4 other siblings
ctaIsSeparated: false  // CTA is inline with content
wrapperRatio: 0.15
```

**After fingerprint:**
```
topology: "F:screen:3 > F:nav:2 > F:content:3 > ... > F:cta-section:1 > F:cta:1"
roleLevels: { 0: ["screen"], 1: ["status-bar","nav","content-area","cta-section"], ... }
ctaDepth: 2            // CTA is nested inside cta-section
ctaSiblingCount: 1     // CTA is alone in its section
ctaIsSeparated: true   // CTA has its own container
wrapperRatio: 0.10     // decreased (fee-row wrapper removed)
```

**Structural delta extracted:**
```json
{
  "screenType": "payment",
  "designMood": "dark",
  "changes": [
    {
      "type": "cta_separation",
      "description": "CTA moved from inline with content to dedicated cta-section",
      "before": "cta as sibling of content nodes at depth 1",
      "after": "cta wrapped in cta-section at depth 1, cta at depth 2",
      "confidence": 0.95
    },
    {
      "type": "section_addition",
      "description": "Content nodes grouped into content-area container",
      "before": "amount-section, card, row as direct screen children",
      "after": "amount-section, card, row grouped under content-area",
      "confidence": 0.85
    },
    {
      "type": "wrapper_removal",
      "description": "fee-row wrapper frame removed, children promoted",
      "before": "fee-row nested in wrapper",
      "after": "fee-row direct child of content-area",
      "confidence": 0.80
    },
    {
      "type": "layout_mode_change",
      "description": "Root screen layout changed to SPACE_BETWEEN",
      "before": "screen primaryAxisAlign: MIN",
      "after": "screen primaryAxisAlign: SPACE_BETWEEN",
      "confidence": 0.95
    }
  ]
}
```

### Step 5: Layer 2 -- Property Capture

Flatten both SOMs by role and compare:

| Role | Property | Before | After | Change |
|------|----------|--------|-------|--------|
| screen | padding.top | 16 | 32 | increase |
| screen | padding.horizontal | 20 | 24 | increase |
| screen | cornerRadius | 0 | 24 | add |
| card | cornerRadius | 28 | 12 | decrease |
| label (body) | fill | #666666 | #070809 | replace |
| interactive (numpad) | fill | #1A1A24 | #1A0E53 | replace (brand tint) |

These become `PropertyDelta` entries tagged with `screenType: "payment"` and `designMood: "dark"`.

### Step 6: Cross-Screen Aggregation

After all 5 screens are captured, the system runs `extract_principles` (or an equivalent aggregation pass):

**Structural rules emerging:**
- `cta_separated`: 3/5 screens (payment, send-money, confirmation) -- **confirmed**
- `space_between_root`: 3/5 screens -- **confirmed**
- `content_grouping`: 2/5 screens -- **tentative**

**Property rules emerging:**
- `screen.cornerRadius: 0 → 24`: 5/5 -- **confirmed, universal**
- `screen.padding.top: 16 → 24-32`: 5/5 -- **confirmed, universal**
- `card.cornerRadius: 18-28 → 8-12`: 4/5 -- **confirmed, universal**
- `label.fill: #666 → #070809`: 3/5 -- **confirmed, universal**
- `label.fontSize: 16 → 18`: 3/5 -- **confirmed, universal**
- `screen.padding.horizontal: 20-24 → 24-32`: 5/5 -- **confirmed, universal**

---

## Handling Intertwined Changes

What happens when structural and property changes are intertwined? Example: the designer both moves the CTA into a new section AND changes its padding.

**Answer: process Layer 1 first, then Layer 2.**

```
1. Extract both before and after SOMs with roles
2. Run structural fingerprinting → identify topology changes
3. "Normalize" the before SOM to the after structure:
   - If CTA was moved into a new section, conceptually restructure
     the before SOM to match the after topology
   - This normalized-before has the AFTER structure but BEFORE property values
4. Now run property comparison on normalized-before vs after
   - Since the structure matches, property comparison is clean
   - The CTA section's padding is captured as a property delta on role "cta-section"
     (even though cta-section didn't exist in the original before)
```

For the "new section" case specifically: if the designer created a new structural element (like `cta-section`), the property rule captures its properties as "initial values for this role" rather than as a delta. This is stored as:

```typescript
{
  role: "cta-section",
  property: "padding.top",
  direction: "set",
  toValue: 16,
  evidenceCount: 3,
  status: "confirmed"
}
```

This way, when future builds create a `cta-section` (guided by the structural template), they know what padding to give it.

---

## Cold Start vs Mature System

### Cold Start (0-5 screens)

No templates, no rules. The system operates exactly as today:

1. Rex builds from the reference SOM directly
2. Designer refines
3. System captures deltas but cannot yet extract confirmed rules
4. Each delta is stored as raw evidence

**What the AI gets at build time:**
- Zero learnings to apply -- builds are purely from reference
- After capture, the raw deltas are available as exemplars via `osiris_get_refinement_context` (this already works)

**Bootstrap strategy:** Prioritize capturing refinements from diverse screen types. 5 different screen types with 1 refinement each is more valuable than 5 refinements of the same screen type.

### Early Learning (5-15 screens)

Universal rules start emerging (the patterns consistent across all screen types):

- Root cornerRadius: 24 (confirmed after 3-5)
- Increased padding (confirmed after 3-5)
- Sharper card corners (confirmed after 4-5)
- Darker body text (confirmed after 3)

**What the AI gets at build time:**
- Universal property rules applied as post-processing
- Maybe 1-2 structural rules (CTA separation) applied as guidance
- Still no per-screen-type templates (not enough evidence)

### Mature (15-50+ screens)

Screen-type-specific templates and rules are available:

- Payment screens have a structural template with separated CTAs, SPACE_BETWEEN layout
- Dashboard screens have a template with card grids, gray backgrounds
- Onboarding screens have a template with centered content, hero images
- Property rules are specific: "for dark payment screens, tint interactive elements with brand color"

**What the AI gets at build time:**
- Structural template for this screen type (if available)
- Property rules: universal + screen-type + mood-specific
- The build is substantially pre-corrected before the designer sees it

### Confidence Decay

Rules that stop being reinforced by new refinements decay:

```
Initial confidence on confirmation: 0.85
Each new supporting delta: +0.03 (cap 0.98)
Each contradicting delta: -0.15
No new evidence for 30 days: -0.01/day (floor 0.3)
Below 0.3: rule demoted from "confirmed" to "tentative"
Below 0.15: rule archived (not applied, kept for audit)
```

This prevents stale rules from persisting as design direction evolves.

---

## Integration with Existing Systems

### Osiris: What Changes

The existing `osiris_capture_delta` tool accepts `before_som` and `after_som`. Currently it tries to tree-diff them and fails. Under this proposal:

**Option A: Extend `capture_delta`.** Add structural fingerprinting and role-based property comparison to the existing delta capture pipeline. The tool's interface doesn't change -- it still takes before/after SOMs. The internal processing changes completely.

**Option B: New endpoints.** Add `osiris_capture_structural_delta` and `osiris_capture_property_delta` as separate tools. This is cleaner but requires the caller (Claude) to invoke two tools.

**Recommendation: Option A.** Keep the interface simple. One capture call, two types of learning extracted internally.

The `capture_delta` response should change to report what was actually learned:

```json
{
  "structural_changes": 4,
  "property_changes": 6,
  "new_rules_created": 2,
  "existing_rules_reinforced": 3,
  "structural_template_updated": true
}
```

### Osiris: `get_refinement_context` Enhancement

Currently returns raw exemplar deltas. Under this proposal, it should also return:

```json
{
  "som": { /* ... */ },
  "context": { /* screen type, mood, etc. */ },
  "exemplars": [ /* raw before/after pairs, as today */ ],
  "principles": [ /* extracted principles, as today */ ],

  "structural_template": {
    "available": true,
    "confidence": 0.88,
    "skeleton": { /* SomSkeleton for this screen type */ },
    "rules": ["cta_separated", "space_between_root"]
  },
  "property_rules": [
    { "role": "screen", "property": "cornerRadius", "value": 24, "confidence": 0.95 },
    { "role": "screen", "property": "padding.top", "range": [24, 32], "confidence": 0.92 },
    { "role": "card", "property": "cornerRadius", "range": [8, 12], "confidence": 0.88 }
  ]
}
```

This gives Claude everything needed to apply learnings during the build.

### Rex: Build Pipeline Change

Today's build pipeline:
```
1. Get reference SOM from Osiris
2. Build SOM as Figma nodes (1:1 translation)
```

Proposed build pipeline:
```
1. Get reference SOM from Osiris
2. Get refinement context (includes structural template + property rules)
3. If structural template available with confidence > 0.7:
   a. Restructure SOM to match template skeleton
   b. Map content from reference into template role slots
4. Apply property rules to all nodes by role
5. Build modified SOM as Figma nodes
```

Steps 3-4 happen in Claude's reasoning (not in code). Claude receives the template and rules as context and uses them to inform how it constructs the Figma build. No new Rex tools are needed -- the learning system feeds back through Osiris context.

### Rex Memory Integration

Structural templates and property rules should also be stored as Rex memories (scope: `team`, category: `convention`):

```
"Convention: Payment screens use SPACE_BETWEEN layout with CTAs in a separated section"
"Convention: Root frames always get cornerRadius 24"
"Convention: Card corner radii should be 8-12, not 20+"
"Convention: Body text should be near-black (#070809), not medium gray"
```

This gives Claude the learnings even without querying Osiris refinement context, and makes them visible/editable through the memory tools.

---

## Data Model Summary

```
                    ┌─────────────────────┐
                    │   capture_delta()   │
                    │   before + after    │
                    └────────┬────────────┘
                             │
                   ┌─────────┴─────────┐
                   ▼                   ▼
          ┌────────────────┐  ┌────────────────┐
          │ Layer 1:       │  │ Layer 2:       │
          │ Structural     │  │ Property       │
          │ Fingerprint    │  │ Role-Compare   │
          └───────┬────────┘  └───────┬────────┘
                  │                   │
                  ▼                   ▼
          ┌────────────────┐  ┌────────────────┐
          │ Structural     │  │ Property       │
          │ Deltas         │  │ Deltas         │
          └───────┬────────┘  └───────┬────────┘
                  │                   │
         (aggregate across           (aggregate across
          multiple captures)          multiple captures)
                  │                   │
                  ▼                   ▼
          ┌────────────────┐  ┌────────────────┐
          │ Structural     │  │ Property       │
          │ Templates      │  │ Rules          │
          │ (per screen    │  │ (per role ×    │
          │  type)         │  │  property)     │
          └───────┬────────┘  └───────┬────────┘
                  │                   │
                  └─────────┬─────────┘
                            ▼
                  ┌─────────────────┐
                  │ Build Context   │
                  │ (fed to Claude  │
                  │  at build time) │
                  └─────────────────┘
```

---

## Implementation Plan

### Phase 1: Property Learning (fastest path to value)

Property rules are simpler to implement and the 5 existing refinements already provide enough data.

1. **Role-based flattening function** in Osiris: takes a SOM, returns `Map<role, PropertyBag[]>`
2. **Role-based property comparison**: compares two flattened maps, outputs `PropertyDelta[]`
3. **Rule aggregation**: across deltas, extract `PropertyRule[]` with confidence scoring
4. **Wire into `capture_delta`**: replace the broken tree-diff with role-based comparison
5. **Wire into `get_refinement_context`**: include property rules in the response
6. **Backfill**: re-process the 5 existing before/after pairs with the new pipeline

**Estimated effort: 3-4 days**
**Expected outcome: 8-10 confirmed property rules from existing data**

### Phase 2: Structural Fingerprinting

1. **Fingerprint computation**: implement `StructuralFingerprint` extraction from SOMs
2. **Fingerprint comparison**: diff two fingerprints into `StructuralChange[]`
3. **Skeleton extraction**: strip a SOM down to its `SomSkeleton`
4. **Wire into `capture_delta`**: extract structural deltas alongside property deltas
5. **Backfill**: re-process existing pairs

**Estimated effort: 3-4 days**
**Expected outcome: 2-3 confirmed structural rules from existing data**

### Phase 3: Template Assembly and Application

1. **Template storage**: MongoDB collection for `StructuralTemplate`
2. **Template aggregation**: combine structural deltas into templates per screen type
3. **Enhanced `get_refinement_context`**: return templates + property rules
4. **Claude prompt engineering**: instructions for applying templates during builds
5. **Validation loop**: build a screen with learnings applied, compare to designer result

**Estimated effort: 4-5 days**
**Expected outcome: end-to-end learning loop working**

### Phase 4: Feedback and Iteration

1. **Learning dashboard**: show which rules exist, their confidence, evidence count
2. **Manual rule management**: allow designers to confirm, reject, or edit rules
3. **Contradiction handling**: detect when a new refinement contradicts an existing rule
4. **A/B validation**: build same screen with and without learnings, measure designer effort reduction

**Estimated effort: ongoing**

---

## Open Questions

1. **Role assignment accuracy.** The entire property learning layer depends on `extract_som` assigning consistent roles. If the same card gets `role: "card"` in one extraction and `role: "section"` in another, property comparison fails. How reliable is the current role assignment? What's the plan for improving it?

2. **Cross-brand generalization.** The 5 screens span different brands (Kraken, Zing, Acorns, Coinbase, Betterment). Should rules be brand-scoped? Universal rules (padding, cornerRadius) seem brand-agnostic, but color rules are clearly brand-specific. The property rule's `scope` field handles this, but the aggregation logic needs to be smart about when to generalize vs specialize.

3. **Structural template conflicts.** What if payment screens from two different brands have different preferred structures? One brand separates CTAs, another keeps them inline. Template confidence will be low (50/50 split). The system should probably scope templates by brand/team when evidence is contradictory.

4. **How many refinements before value?** Property rules need 3+ consistent examples to confirm. If each screen build + refinement takes 30-60 minutes of designer time, that's 1.5-3 hours of designer investment before the first confirmed rule. Is that acceptable? Could we bootstrap with the 5 existing refinements by manually validating the extracted rules?

5. **Regression detection.** How do we know if applied rules make things worse? If a rule says "card cornerRadius should be 8-12" but a new brand's designer prefers 20, the system is actively harming the build. We need a signal for "this rule was overridden by the designer" to trigger confidence decay.

---

## Round 2: Addressing Evaluator Challenges

### Challenge 1: Role stability when names and structure both change

> "You say 'this fingerprint does not use node names at all' but the roles it depends on ARE derived from names. How do you guarantee role stability when names and structure both changed?"

This is a fair hit. The proposal was imprecise. The fingerprint itself does not use names, but the roles embedded in it are assigned by `extract_som`, which does use names as one of several heuristics. If the designer renames "Frame 1" to "content-area," the role assignment algorithm might produce a different role for that node on the after SOM.

However, the concern is overstated for two reasons:

1. **Role assignment is not purely name-based.** `extract_som` assigns roles using a weighted combination of: node type, child content (e.g., a frame containing only text nodes and an icon gets role "nav" or "row"), spatial position (top-of-screen frames get "header"/"nav"), layout properties (a HORIZONTAL frame with two text children is a "row"), and name (as a signal, not the sole determinant). When the designer renames "Frame 1" to "content-area," the role heuristic is actually MORE likely to produce a correct role on the after SOM, not less likely, because the name is now more descriptive.

2. **The structural fingerprint is compared at the level of topology and role-distributions, not individual node identity.** When we compare `roleLevels` between before and after, we are asking "what roles exist at depth 1?" not "does node X have the same role?" If the before SOM has `depth1: ["nav", "section", "card", "row", "cta"]` and the after has `depth1: ["nav", "content-area", "cta-section"]`, the structural delta captures that content was grouped and CTA was separated. We do not need the "content-area" node in the after SOM to have been matched 1:1 to any specific before node.

That said, there is a real vulnerability: if `extract_som` assigns wildly different roles to the same logical element across two extractions of structurally similar content. **The fix is to make role assignment more deterministic by reducing the weight of the name signal and increasing the weight of content-based signals (child types, text content, image presence).** This is already noted in Open Question 1, and it should be elevated to a Phase 0 prerequisite: audit and harden `extract_som` role assignment before building the learning pipeline.

Concretely, the role assignment should be stabilized by:
- Using child content signatures as the primary role signal (a frame with an icon + text label = "nav-item" regardless of its name)
- Using spatial/positional heuristics as secondary signals
- Using names only as a tiebreaker or confidence booster
- Adding a role-stability test: run `extract_som` on the same frame twice after minor renames, verify roles are identical

### Challenge 2: Cross-brand rule aggregation -- how does it know when to specialize vs. generalize?

> "Does it create two brand-scoped rules, one universal rule with low confidence, or does it get confused and average them to 16?"

It should not average. Averaging would be a bug, and nothing in the proposal calls for averaging. The rule system stores `fromRange` and `toRange`, not averages. But the evaluator is right that the aggregation logic for deciding when to split into brand-scoped rules vs. keeping a universal rule was left vague. Here is the concrete algorithm:

**Step 1: Attempt universal aggregation.** Group all deltas for `(role: "card", property: "cornerRadius")` regardless of brand. Compute the consistency score: what percentage of deltas agree on the direction and approximate magnitude?

**Step 2: Check for high variance.** If the `toRange` spans more than 2x the smaller value (e.g., [8, 20] -- 20 is 2.5x of 8), flag this as a potential brand-scoped split.

**Step 3: Partition by brand/project.** Re-run aggregation within each brand. If the within-brand consistency is high (>0.8) but cross-brand consistency is low (<0.5), create brand-scoped rules instead of a universal rule.

For the Kraken (12) vs. fitness (20) example:
- Universal aggregation: `toRange: [12, 20]`, consistency: 1.0 for direction (decrease), but 0.4 for value agreement. The range is too wide to be useful.
- Per-brand: Kraken `toRange: [10, 12]`, consistency: 0.95. Fitness `toRange: [18, 22]`, consistency: 0.90.
- Result: Two brand-scoped rules. No universal rule for this property.

The brand/project context is already available in the delta metadata (`screenType`, `designMood`). We need to add `brandId` or `projectId` to the `PropertyDelta` and `PropertyRule` interfaces. This is a gap in the original proposal that should be added.

**Updated `PropertyRule` scope hierarchy:**
1. Brand + screen-type + mood (highest priority)
2. Brand + screen-type
3. Brand-only
4. Screen-type + mood
5. Screen-type
6. Universal (only for patterns consistent across ALL brands)

### Challenge 3: Circular dependency -- Layer 2 needs Layer 1 solved first to normalize the before SOM

> "You've created a circular dependency: Layer 2 needs Layer 1 to be solved first, but Layer 1's output (structural changes) needs to be applied as tree transformations, which is exactly the hard tree-manipulation problem you were trying to avoid."

This is the strongest challenge, and it identifies a genuine problem with the "normalize the before SOM to the after structure" step. Let me be honest: the normalization step as described is hand-wavy and hides significant complexity.

However, the circular dependency framing is slightly off. The proposal does not require solving structural diffing to do property diffing. It requires something weaker. Let me clarify:

**What Layer 1 actually produces:** Layer 1 compares two structural fingerprints -- compact summaries, not full trees. It produces high-level structural changes like "CTA was separated" and "a content-area wrapper was added." It does NOT produce a node-level tree transformation script. The fingerprint comparison is computationally cheap and does not require node matching.

**What Layer 2 actually needs:** Layer 2 does not need a structurally normalized before SOM. That was an overreach in the original proposal. What Layer 2 actually needs is much simpler: **role-based property maps from both SOMs, compared by role, not by node identity.**

Here is the corrected approach that eliminates the circular dependency:

```
1. Run Layer 1: Compare structural fingerprints (no node matching needed)
   → Produces: StructuralDelta (topology-level changes)

2. Run Layer 2: Flatten both SOMs to role-property maps independently
   → before_roles = flatten(before_som) → { "screen": [...], "card": [...], ... }
   → after_roles  = flatten(after_som)  → { "screen": [...], "card": [...], ... }
   → Compare by role: for each role present in BOTH maps, diff properties

3. For roles that exist only in the after SOM (e.g., "cta-section"):
   → These are NEW structural elements. Record their properties as
     "initial values" rather than deltas. No comparison needed.

4. For roles that exist only in the before SOM (e.g., a wrapper that was removed):
   → These are REMOVED elements. Record the removal as a structural signal
     (already captured by Layer 1). No property diff needed.
```

The key correction: **Layer 2 never needs to normalize the before SOM's structure.** It compares properties within matching roles, and roles that do not match across SOMs are handled as structural additions/removals by Layer 1. The two layers run independently and produce complementary outputs.

The one thing we lose by dropping normalization: if the designer moved a node from one parent to another AND changed its properties, we capture the property change as a role-level delta (which is correct) but we do not capture that the property change was specifically tied to the structural move. This is acceptable because the property rule still applies correctly at the role level -- "card cornerRadius should be 12" is true regardless of where the card sits in the hierarchy.

### Cross-Cutting Challenge: The Kraken Restructure (simultaneous multi-change session)

> "None of the proposals handle the case where multiple simultaneous changes represent a single design decision."

This is correct, and I will not pretend otherwise. This proposal does not attempt to group 5 simultaneous changes into a single coherent "design decision" like "CTA isolation." It captures them as:

- **Layer 1:** CTA separation (structural), content grouping (structural), wrapper removal (structural), layout mode change (structural) -- four separate structural changes that happen to co-occur.
- **Layer 2:** Spacing change, cornerRadius change, text color change -- three separate property changes.

The evaluator is right that these may represent one unified design intention. But I would argue that **decomposing a design intention into its constituent changes is actually the correct representation for a learning system.** Here is why:

1. **Not all of these changes will always co-occur.** A designer might separate CTAs without also changing to SPACE_BETWEEN. Another might use SPACE_BETWEEN without grouping content into a wrapper. Treating them as one atomic "design decision" means you either apply all 5 or none -- which is too coarse.

2. **Individual changes have independent confirmation paths.** CTA separation appears in 3/5 screens. SPACE_BETWEEN appears in 3/5 screens. But they are not always the same 3 screens. If we bundled them, the bundle would only be confirmed by the intersection (maybe 2/5), losing signal.

3. **The correlation between co-occurring changes can be captured as a second-order pattern.** After accumulating enough evidence, we can observe: "when CTA separation is present, SPACE_BETWEEN is also present 80% of the time." This is a correlation rule, not a bundled decision. It is more flexible -- the system can apply CTA separation on its own if SPACE_BETWEEN is not appropriate for a particular screen.

That said, for the practical case of a designer who makes all 5 changes in 90 seconds: the system does capture all 5. It just captures them as 5 separate signals rather than 1 bundled signal. The result at application time is the same -- all 5 get applied to the next payment screen because all 5 are individually confirmed.

### Cross-Cutting Challenge: The Contradiction Test (brand-awareness)

> "How does the system know that two contradictory values from different brands are NOT contradictions, while two contradictory values from the SAME brand ARE contradictions?"

The original proposal acknowledged this in Open Question 2 but did not solve it. Here is the concrete answer:

**Brand/project must be a first-class dimension in every delta and rule.**

Every `PropertyDelta` and `StructuralDelta` must carry a `brandId` (or `projectId`) derived from the Osiris screen metadata. This is not optional context -- it is a required field.

The aggregation algorithm then follows the split logic described in Challenge 2 above:

1. Attempt universal aggregation across all brands.
2. If within-brand consistency is high but cross-brand consistency is low, split into per-brand rules.
3. If within-brand consistency is also low (the same designer uses different values within the same brand), the rule stays tentative until more evidence resolves it.

At build time, the brand of the current project is known (it comes from the Osiris screen metadata or is set by the designer). Rule lookup filters by brand first, then falls back to universal rules.

For the specific example:
- Kraken pill cornerRadius: 8 (brand-scoped rule, confidence 0.9)
- Fitness pill cornerRadius: 20 (brand-scoped rule, confidence 0.9)
- Universal pill cornerRadius: no rule (cross-brand variance too high)
- New Revolut project: no brand-specific rules yet, no universal rule. Falls back to reference SOM value. After 1-2 Revolut refinements, Revolut-scoped rules emerge.

**Implementation requirement:** Add `brandId: string` to `PropertyDelta`, `PropertyRule`, `StructuralDelta`, and `StructuralTemplate`. Add brand-aware partitioning to the aggregation pipeline. This is a concrete gap in the original proposal that must be addressed in Phase 1.
