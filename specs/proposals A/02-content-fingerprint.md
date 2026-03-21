# Proposal 02: Content-Fingerprint Matching for Refinement Learning

## Status
Proposal

## Problem

Rex builds UI screens in Figma from reference designs stored in Osiris. Designers then refine these screens. We need to diff the before/after SOMs to extract learnings that improve future builds.

Tree-diffing by name+role failed completely. Across 5 delta captures, 0 nodes matched. The reasons are structural:

- Designers rename layers ("amount-value" becomes "$10" or "Frame 7")
- Designers reparent nodes (move a text node into a new wrapper frame)
- Designers delete wrappers, flatten hierarchies, add grouping frames
- Role assignment depends on names, so renamed nodes lose their roles too

Name and structural position are both unstable across refinement. We need a matching signal that is stable.

## Key Insight

**Match nodes by what they contain, not what they're called.**

A node containing the text "$10" at fontSize 56 is the same node regardless of whether it is named "amount-value", "$10", or "Frame 7". Content is the one thing designers generally leave untouched during refinement -- they change how things look, not what they say.

This insight splits the node universe into two populations:
1. **Content-bearing nodes** (text, images, component instances): matchable by fingerprint
2. **Pure structural nodes** (empty frames used for layout): matchable by their content-bearing descendants

## Algorithm

### 1. Fingerprint Computation

A fingerprint is a short hash derived from a node's content signals. The algorithm differs by node type.

#### Text Nodes

```
fingerprint = hash(
  type: "TEXT",
  text: normalize(node.characters),   // lowercase, collapse whitespace
  fontSize: dominantFontSize(node),    // handles mixed styles
)
```

`normalize()` lowercases, collapses whitespace, and strips leading/trailing whitespace. This makes the fingerprint resilient to minor copy edits like adding a period or fixing capitalization, which we do not want to treat as a content change.

`dominantFontSize()` returns the most common font size in the text run. This disambiguates nodes with identical text but different visual roles (e.g., a "Settings" header at 24px vs a "Settings" list item at 16px).

#### Image Nodes

```
fingerprint = hash(
  type: "IMAGE",
  imageHash: node.fills[0].imageHash,  // Figma's content-addressed hash
)
```

Figma already content-addresses images. If the designer replaces the image, it is a different node semantically, and we do not want to match it.

#### Component Instances

```
fingerprint = hash(
  type: "INSTANCE",
  componentKey: node.mainComponent.key,
  overrides: sortedPropertyOverrides(node),  // text and boolean overrides
)
```

Two instances of the same component with the same overrides are the same node. If the designer changes an override, the fingerprint changes -- but the componentKey still provides a partial match (see Tiered Matching below).

#### Container Frames (with content descendants)

```
fingerprint = hash(
  type: "FRAME",
  childFingerprints: sortedChildFingerprints(node),  // sorted, not ordered
)
```

A container's identity is defined by its content-bearing descendants. The child fingerprints are **sorted** (not ordered) because the designer may reorder children. A frame containing ["$10", "Current balance"] is the same frame whether those children appear in that order or reversed.

Only direct children's fingerprints are included. This keeps the fingerprint shallow and avoids the combinatorial explosion of deep tree hashing.

#### Empty Structural Frames (no content descendants)

These nodes have no content to fingerprint. They get `fingerprint = null` and are handled separately (see Section 5).

### 2. Hash Function

Use a fast, non-cryptographic hash. The fingerprint string is the hex-encoded first 8 bytes of a SHA-256 of the JSON-serialized input. Collisions at this length are acceptable because we validate matches with a secondary similarity check.

```typescript
function computeFingerprint(input: FingerprintInput): string {
  const json = JSON.stringify(input);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}
```

### 3. Building the Fingerprint Index

Given a SOM tree, walk it bottom-up (post-order) so that child fingerprints are available before computing parent fingerprints.

```typescript
interface FingerprintedNode {
  nodeId: string;
  fingerprint: string | null;
  type: string;
  content: ContentSignals;  // text, imageHash, componentKey
  style: StyleProperties;   // all visual properties
  children: FingerprintedNode[];
}

function indexSom(som: SomNode): Map<string, FingerprintedNode> {
  const index = new Map<string, FingerprintedNode>();

  function walk(node: SomNode): FingerprintedNode {
    const children = (node.children || []).map(walk);
    const fp = computeNodeFingerprint(node, children);
    const entry = { nodeId: node.id, fingerprint: fp, type: node.type, ... };
    if (fp !== null) {
      index.set(fp, entry);
    }
    return entry;
  }

  walk(som.root);
  return index;
}
```

## Matching Process

### 4. Tiered Matching

Given a `before` SOM (what Rex built) and an `after` SOM (what the designer refined), matching proceeds in tiers from most to least confident.

**Tier 1: Exact fingerprint match (confidence 1.0)**

Build fingerprint indexes for both SOMs. For each fingerprint in the `before` index, look it up in the `after` index. Exact match means the content is identical; any differences in the `style` properties on these matched nodes are refinements.

```
for each (fp, beforeNode) in beforeIndex:
  if afterIndex.has(fp):
    afterNode = afterIndex.get(fp)
    emit Match(beforeNode, afterNode, confidence=1.0)
```

**Tier 2: Partial content match (confidence 0.7-0.9)**

For unmatched content-bearing nodes, fall back to fuzzy matching:
- Text nodes: Levenshtein similarity on normalized text > 0.8
- Component instances: same componentKey but different overrides
- Containers: Jaccard similarity of child fingerprint sets > 0.6

```
for each unmatched beforeNode with fingerprint != null:
  candidates = unmatched afterNodes of same type
  bestMatch = max(candidates, by=similarity(beforeNode, candidate))
  if bestMatch.similarity > threshold:
    emit Match(beforeNode, bestMatch, confidence=bestMatch.similarity)
```

**Tier 3: Structural position (confidence 0.3-0.5)**

For unmatched nodes where content matching failed (rare for content-bearing nodes, common for empty frames), use position within the matched parent:

```
if parent was matched:
  match unmatched children by ordinal position within the parent
  emit Match(beforeChild, afterChild, confidence=0.4)
```

This tier handles empty structural frames like spacers, dividers, and layout wrappers.

### 5. Handling Empty Structural Frames

Empty frames (no text, no images, no component instances, no content-bearing descendants) cannot be fingerprinted. This is the primary weakness of content-fingerprint matching.

Three strategies, applied in order:

**Strategy A: Anchor by neighbors.** If the siblings on both sides of the empty frame were matched via fingerprint, the empty frame in between is implicitly matched. Example: a spacer between a "Balance" label and a "$10" value -- both neighbors match, so the spacer matches.

**Strategy B: Match by role within matched parent.** If the parent frame was matched (via its content-bearing descendants), match empty children by their relative position and approximate size. A 1px-tall frame spanning full width at position 3 is probably the same divider in both SOMs.

**Strategy C: Ignore.** If an empty frame exists in `after` but not `before`, it was added by the designer. If it exists in `before` but not `after`, it was removed. Both are structural refinements captured at the parent level (the parent's layout properties changed to accommodate the addition/removal).

In practice, Strategy C is often correct. When a designer removes a wrapper frame, the important learning is not "wrapper was removed" but rather the resulting changes to padding, spacing, and alignment on the parent -- which are captured via the parent's matched style diff.

### 6. Handling Changed Text Content

When the designer changes text content, the fingerprint changes and Tier 1 matching fails. This falls through to Tier 2 fuzzy matching.

Cases:

| Scenario | Fuzzy Match? | Example |
|----------|-------------|---------|
| Minor edit (typo fix, punctuation) | Yes (similarity > 0.8) | "Send money" -> "Send Money" |
| Copy rewrite | Depends on length overlap | "Get started now" -> "Begin your journey" |
| Completely different text | No | "$10.00" -> "Transfer complete" |

When fuzzy matching fails, the node is marked as **unmatched**. This is not a problem -- it means the designer replaced the content, which is a different kind of refinement (content change vs. style change). Content changes are not style learnings; they are captured as separate content observations.

The system is designed to learn from **style refinements**, not content swaps. A designer who changes "$10" to "$25" has not taught us anything about visual design. A designer who changes the font size from 48 to 56 has.

## Delta Extraction

### 7. Computing Style Deltas

For each matched pair (beforeNode, afterNode), diff their style properties:

```typescript
interface StyleDelta {
  property: string;        // e.g., "cornerRadius", "padding.top", "fill"
  before: any;
  after: any;
  nodeType: string;        // FRAME, TEXT, etc.
  nodeRole: string;        // from SOM role assignment
  nodeContent: string;     // brief content summary for context
  confidence: number;      // from the match tier
}

function diffStyles(before: FingerprintedNode, after: FingerprintedNode): StyleDelta[] {
  const deltas: StyleDelta[] = [];
  const allKeys = union(Object.keys(before.style), Object.keys(after.style));

  for (const key of allKeys) {
    if (!deepEqual(before.style[key], after.style[key])) {
      deltas.push({
        property: key,
        before: before.style[key],
        after: after.style[key],
        nodeType: before.type,
        nodeRole: before.role || after.role || "unknown",
        nodeContent: summarizeContent(before),
        confidence: matchConfidence,
      });
    }
  }

  return deltas;
}
```

### 8. Walkthrough: kraken_05 Matching

Here is a concrete walkthrough using a hypothetical kraken_05 screen (a payment/transfer screen).

**Before SOM (Rex-built):**
```
root-frame "kraken_05"
  status-bar "status-bar"
  header-frame "header"
    back-icon [IMAGE hash=abc123]
    title-text [TEXT "Send Money"]
  amount-section "amount-wrapper"
    currency-label [TEXT "USD"]
    amount-value [TEXT "$10.00" fontSize=48]
    amount-subtext [TEXT "Available: $1,234.56"]
  recipient-card "recipient"
    avatar [IMAGE hash=def456]
    recipient-name [TEXT "John Doe"]
    recipient-detail [TEXT "john@email.com"]
  numpad "numpad-wrapper"
    key-1 [TEXT "1"]
    key-2 [TEXT "2"]
    ... (9 keys)
  cta-button "send-btn"
    cta-text [TEXT "Send"]
```

**After SOM (designer-refined):**
```
Frame 1 "kraken_05-refined"
  status-bar "StatusBar"
  nav "navigation"
    Frame 7 [IMAGE hash=abc123]
    heading [TEXT "Send Money"]
  content-area "main"
    amount [TEXT "USD"]
    big-number [TEXT "$10.00" fontSize=56]
    subtitle [TEXT "Available: $1,234.56"]
  card "person-card"
    profile-pic [IMAGE hash=def456]
    name [TEXT "John Doe"]
    email [TEXT "john@email.com"]
  keypad "keys"
    k1 [TEXT "1"]
    k2 [TEXT "2"]
    ... (9 keys)
  bottom-section "cta-area"
    action [TEXT "Send"]
```

**Step 1: Build fingerprint indexes.**

| Fingerprint | Before Node | After Node |
|---|---|---|
| `fp(TEXT,"send money",24)` | title-text | heading |
| `fp(IMAGE,abc123)` | back-icon | Frame 7 |
| `fp(TEXT,"usd",14)` | currency-label | amount |
| `fp(TEXT,"$10.00",48)` | amount-value | -- (fontSize changed to 56) |
| `fp(TEXT,"$10.00",56)` | -- | big-number |
| `fp(TEXT,"available: $1,234.56",14)` | amount-subtext | subtitle |
| `fp(IMAGE,def456)` | avatar | profile-pic |
| `fp(TEXT,"john doe",16)` | recipient-name | name |
| `fp(TEXT,"john@email.com",14)` | recipient-detail | email |
| `fp(TEXT,"1",24)` | key-1 | k1 |
| ... | ... | ... |
| `fp(TEXT,"send",16)` | cta-text | action |

**Step 2: Tier 1 exact matches.**

12 out of 14 content-bearing nodes match exactly (all text nodes where fontSize did not change, both images). These are marked confidence=1.0.

**Step 3: Tier 2 fuzzy match for amount-value.**

`amount-value` (TEXT "$10.00" fontSize=48) does not exact-match because the after node has fontSize=56. Fuzzy match: same text "$10.00", same type TEXT. Similarity=0.95 (text identical, fontSize differs). Match with confidence=0.9.

This is the critical match. The style delta extracted: `{ property: "fontSize", before: 48, after: 56, role: "value", content: "$10.00" }`.

**Step 4: Container matching via child fingerprints.**

- `header-frame` children fingerprints: {fp(IMAGE,abc123), fp(TEXT,"send money",24)}
- `nav` children fingerprints: {fp(IMAGE,abc123), fp(TEXT,"send money",24)}
- Exact match. Now we can diff header-frame vs nav styles.

- `amount-section` children: {fp(TEXT,"usd"), fp(TEXT,"$10.00",48), fp(TEXT,"available...")}
- `content-area` children: {fp(TEXT,"usd"), fp(TEXT,"$10.00",56), fp(TEXT,"available...")}
- Two of three children match exactly, one fuzzy matches. Jaccard = 2/3 exact + 1/3 fuzzy. Match confidence=0.85.

- `recipient-card` and `card`: children fingerprints identical. Exact match.

- `numpad` and `keypad`: children fingerprints identical (9 key texts + child texts). Exact match.

**Step 5: Root frame matching.**

Root children fingerprints (via container fingerprints) are identical sets. Root frames match. We can now diff root styles.

**Step 6: Extract deltas.**

| Matched Pair | Property | Before | After | Learning |
|---|---|---|---|---|
| root / root | cornerRadius | 0 | 24 | Add cornerRadius to root frame |
| root / root | padding.top | 16 | 28 | Increase top padding |
| root / root | primaryAxisAlign | MIN | SPACE_BETWEEN | Use SPACE_BETWEEN for main axis |
| amount-section / content-area | padding.left | 20 | 28 | Increase horizontal padding |
| amount-section / content-area | padding.right | 20 | 28 | Increase horizontal padding |
| amount-value / big-number | fontSize | 48 | 56 | Bump primary value font size |
| recipient-card / card | cornerRadius | 28 | 12 | Reduce card corner radius |
| numpad keys / keypad keys | fill | null | "#1A1A2E" | Tint numpad keys with brand color |
| cta wrapper (structural) | -- | nested inside amount section | own section | CTA separated (structural) |

The structural change (CTA separation) surfaces as the CTA text node matching but having a different parent. The system notes the parent change but focuses on the measurable style deltas.

**Result: 14/14 content-bearing nodes matched (12 exact, 2 fuzzy). All 10 refinement patterns from the real data are captured.**

## Learning Storage and Application

### 9. Refinement Rules

Extracted deltas are aggregated into **refinement rules** stored in Osiris.

```typescript
interface RefinementRule {
  id: string;
  brandId: string;
  bucketId?: string;            // null = applies to all screen types
  screenType?: string;          // "payment", "home", "onboarding", etc.

  // The rule
  target: {
    nodeRole: string;           // "screen", "card", "value", "cta", etc.
    nodeType?: string;          // "FRAME", "TEXT", etc.
    contentPattern?: string;    // regex for text content, if role is ambiguous
  };
  property: string;             // "cornerRadius", "padding.top", "fontSize", etc.
  adjustment: {
    type: "set" | "delta" | "range";
    value?: any;                // for "set": the absolute value
    delta?: number;             // for "delta": +8 means "add 8 to whatever Rex builds"
    min?: number;               // for "range": minimum acceptable value
    max?: number;               // for "range": maximum acceptable value
  };

  // Provenance
  observedCount: number;        // how many times this pattern was seen
  screenIds: string[];          // which screen refinements contributed
  confidence: number;           // increases with observedCount
  firstSeen: Date;
  lastSeen: Date;
}
```

**Example rules from kraken_05:**

```json
[
  {
    "target": { "nodeRole": "screen", "nodeType": "FRAME" },
    "property": "cornerRadius",
    "adjustment": { "type": "set", "value": 24 },
    "observedCount": 5,
    "confidence": 0.92
  },
  {
    "target": { "nodeRole": "card", "nodeType": "FRAME" },
    "property": "cornerRadius",
    "adjustment": { "type": "range", "min": 8, "max": 16 },
    "observedCount": 4,
    "confidence": 0.85
  },
  {
    "target": { "nodeRole": "screen", "nodeType": "FRAME" },
    "property": "padding.top",
    "adjustment": { "type": "range", "min": 24, "max": 32 },
    "observedCount": 5,
    "confidence": 0.92
  },
  {
    "target": { "nodeRole": "value" },
    "property": "fontSize",
    "adjustment": { "type": "delta", "delta": 2 },
    "observedCount": 3,
    "confidence": 0.72
  },
  {
    "target": { "nodeRole": "prompt" },
    "property": "fill",
    "adjustment": { "type": "set", "value": "#070809" },
    "observedCount": 4,
    "confidence": 0.85
  }
]
```

### 10. Applying Rules to Future Builds

When Rex builds a new screen, after constructing the initial layout from the reference SOM, it queries applicable refinement rules:

```
1. Rex builds screen from reference SOM
2. Query refinement rules: filter by brandId + (bucketId OR screenType)
3. Sort by confidence descending
4. For each rule with confidence >= threshold (0.7):
   a. Find nodes in the built screen matching rule.target (by role, type, contentPattern)
   b. Apply rule.adjustment to the matched property
   c. Log the applied rule for transparency
5. Return the refined screen
```

The threshold starts high (0.8) and can be lowered as the system matures and rules accumulate more observations.

**Application modes:**

| Adjustment Type | Behavior |
|---|---|
| `set` | Override the value from the reference SOM with this value |
| `delta` | Add/subtract from whatever value the reference SOM specified |
| `range` | Clamp the reference value to within [min, max] |

`delta` is the safest mode -- it preserves the reference SOM's intent while applying a consistent correction. `set` is used for values that should be uniform across all screens (e.g., root cornerRadius is always 24). `range` is used when there is variance across screen types but clear bounds.

### 11. Confidence Calculation

```
confidence = min(1.0, baseConfidence + (observedCount - 1) * 0.08)

where baseConfidence:
  - Tier 1 match: 0.6 (first observation from exact fingerprint match)
  - Tier 2 match: 0.4 (first observation from fuzzy match)
  - Tier 3 match: 0.2 (first observation from positional match)
```

A rule observed 5 times from exact fingerprint matches: `min(1.0, 0.6 + 4*0.08) = 0.92`.

Confidence decays at -0.02 per month without new observations, flooring at 0.1. A rule that stops being reinforced by new refinements fades out rather than being hard-deleted.

### 12. Rule Conflicts

When two rules target the same (role, property) with different adjustments:
- Higher confidence wins
- If confidence is within 0.1, the more recent rule wins
- If a rule from a specific bucketId conflicts with a brand-wide rule, the bucket-specific rule wins (specificity)

## Cold Start vs. Mature System

### 13. Cold Start (0-5 refinements)

With zero refinement data, no rules exist. Rex builds screens purely from reference SOMs. This is the current behavior -- no regression.

After the first refinement capture:
- Rules are created but at low confidence (0.6 from exact matches)
- Below the application threshold (0.7-0.8), so they are stored but not yet applied
- The system is silently learning

After 2-3 refinements reinforcing the same pattern:
- Confidence crosses the threshold
- Rules begin being applied to new builds
- The designer should notice fewer of the same corrections needed

### 14. Mature System (20+ refinements)

At maturity:
- Core brand rules are at confidence 0.9+ (cornerRadius, padding ranges, typography scale)
- Screen-type-specific rules capture patterns like "payment screens use SPACE_BETWEEN", "dashboard screens use gray backgrounds with white cards"
- New screen types still start cold for their bucket-specific rules but inherit brand-wide rules immediately
- Rule conflicts have been resolved through repeated observation

### 15. Feedback Loop

The system self-corrects:

```
Build v1 → Designer refines → Learn rules
Build v2 (rules applied) → Designer refines less → Fewer new rules
Build v3 → Designer approves with minimal changes → Rules stabilize
```

If a rule is wrong (Rex applies cornerRadius 24 but the designer keeps reverting to 16), the new delta observation contradicts the existing rule. After 2-3 contradictions, the rule's adjustment updates and confidence resets. The system converges on the designer's actual preference.

## Implementation Plan

### Phase 1: Fingerprinting (in Rex plugin)

Extend `extract_som` to compute fingerprints during SOM extraction. Each node in the returned SOM includes a `fingerprint` field.

```
plugin/
  executors/
    fingerprint.ts      # fingerprint computation per node type
  executors/
    som-extractor.ts    # MODIFY: add fingerprint to each extracted node
```

Estimated effort: 3-4 hours.

### Phase 2: Matching (in Osiris)

Implement the tiered matching algorithm in Osiris's `capture_delta` flow. Instead of name+role tree diff, use fingerprint matching.

```
osiris/
  services/
    fingerprint-matcher.ts    # Tiered matching: exact, fuzzy, positional
    delta-extractor.ts        # Style diffing on matched pairs
```

Estimated effort: 6-8 hours.

### Phase 3: Rule Aggregation (in Osiris)

Aggregate deltas into refinement rules. Store rules per brand and bucket.

```
osiris/
  services/
    rule-aggregator.ts        # Delta patterns -> refinement rules
    rule-store.ts             # CRUD for refinement rules (MongoDB)
  api/
    get-refinement-rules.ts   # Query rules for a brand+bucket
```

Estimated effort: 4-6 hours.

### Phase 4: Rule Application (in Rex/Claude workflow)

Expose refinement rules as context during screen builds. Claude queries rules after building the initial screen and applies them.

This is a workflow change, not a code change. Osiris exposes `get_refinement_context` (which already exists in the MCP tool list), and Claude uses it during the build process.

Estimated effort: 2-3 hours (prompt engineering + testing).

### Total: 15-21 hours across 4 phases.

## Comparison to Alternatives

| Approach | Matching Rate | Handles Renames | Handles Reparenting | Handles Restructuring | Implementation Complexity |
|---|---|---|---|---|---|
| Name+role tree diff | 0% (observed) | No | No | No | Low |
| **Content fingerprint** | **~95% of content-bearing nodes** | **Yes** | **Yes** | **Partial** | **Medium** |
| Visual screenshot diff | ~80% (estimated) | Yes | Yes | Yes | High (ML pipeline) |
| Manual annotation | 100% | Yes | Yes | Yes | Impractical at scale |

Content fingerprinting is the sweet spot: dramatically better than name+role, implementable without ML infrastructure, and sufficient for extracting the style learnings that matter.

## Open Questions

1. **Should fingerprints include nodeId as a tiebreaker?** Figma nodeIds are stable within a file but change across files. Including them would improve matching within a single file's before/after but would not help cross-file learning. Current recommendation: no.

2. **Should the system learn structural patterns (not just style)?** For example, "always separate CTA into its own section" or "remove wrapper frames". These are harder to express as rules because they require tree transformations rather than property adjustments. Current recommendation: defer to a future proposal.

3. **What is the right confidence threshold for auto-application?** Too low and Rex applies bad rules. Too high and rules never activate. Starting at 0.8 and adjusting based on designer feedback seems right. This could also be a per-team configuration.

## Round 2: Addressing Evaluator Challenges

### Challenge 1: Empty structural frames are where the hardest decisions live

> "Your system either matches them at confidence 0.4 via ordinal position (unreliable when the designer also reordered children) or ignores them via Strategy C. You're capturing all the easy property changes and missing the hard structural ones."

This is a real weakness, and I was too dismissive of it in the original proposal. Strategy C ("ignore") is not acceptable when the structural change IS the learning. Let me be more honest about what the system can and cannot do, and then extend it.

**What the system genuinely captures today:** When the designer creates `cta-section` and moves the CTA into it, the CTA text node ("Send") still matches via fingerprint. The system sees that the CTA's parent changed -- the matched CTA node has a different ancestor chain in the before vs. after SOM. This is not "missing" the structural change; it is detecting it from the content-bearing node's perspective rather than from the empty frame's perspective. The system can emit a structural observation: `{ type: "reparent", node: "Send button", fromParent: "root", toParent: "new wrapper" }`.

**What the system misses:** The *properties* of the new `cta-section` wrapper (its padding, layout mode, fill) are invisible because the wrapper itself was never matched. It has no "before" to diff against. Similarly, a deleted wrapper's properties are lost.

**Proposed fix -- Structural Change Records:** Instead of trying to match empty frames (which is unreliable), explicitly detect structural events as first-class observations:

```typescript
interface StructuralObservation {
  type: "wrapper_added" | "wrapper_removed" | "node_reparented";
  affectedNodes: string[];          // fingerprints of content-bearing descendants
  wrapperProperties?: StyleProperties; // for added wrappers: capture their full style
  parentBefore?: string;            // fingerprint of old parent
  parentAfter?: string;             // fingerprint of new parent
}
```

When a content-bearing node's matched parent differs between before and after, walk up both ancestor chains to the nearest common matched ancestor. Any unmatched frames in between are structural additions or removals. For additions, capture their full style properties as the "learned" wrapper template. For removals, record the flattening.

This does not solve the general structural learning problem, but it captures enough to record observations like "designer wraps CTAs in a dedicated section with padding 24, gap 16, SPACE_BETWEEN layout." That observation can become a structural rule (see the response to Challenge 3 below).

### Challenge 2: fontSize in the fingerprint causes false matches at scale

> "Every body text node that got a font size change drops out of Tier 1... many body text strings are short ('Network Fee', 'Available balance'). How many false matches does Tier 2 produce at scale?"

The evaluator is right that short, common labels are a collision risk in Tier 2. But the concern is somewhat overstated -- let me walk through the actual mechanics.

**Why the risk is bounded:** Tier 2 fuzzy matching operates on *unmatched* nodes only. If a screen has one "Amount" label at fontSize 14 and one "Amount" header at fontSize 24, and the designer changes the header to fontSize 28:

- The label (fontSize 14, unchanged) matches exactly in Tier 1.
- The header (fontSize 24 -> 28) drops to Tier 2.
- Tier 2 sees one unmatched "Amount" in before (the header) and one unmatched "Amount" in after (the header). There is only one candidate. No ambiguity.

The false match scenario requires *multiple* unmatched nodes with the same text. This happens when the designer changes fontSize on multiple nodes with identical text in the same screen. In practice, this is rare -- screens do not typically have two "Amount" labels that both get different font size changes.

**However, at 200-screen scale, rare becomes frequent.** The evaluator is right that this matters. Here is a concrete fix:

**Tier 2 enhancement -- use spatial proximity as a tiebreaker.** When multiple Tier 2 candidates have similar Levenshtein scores, prefer the candidate whose bounding box (x, y, width, height) is closest to the before node's position. Text nodes rarely move far during refinement. A "Network Fee" label that was at (20, 340) in the before SOM is almost certainly the "Network Fee" at (24, 356) in the after SOM, not the one at (20, 720).

```
Tier 2 score = 0.6 * textSimilarity + 0.3 * fontSizeProximity + 0.1 * spatialProximity
```

This makes Tier 2 robust to short-label collisions without adding significant complexity. I should have included spatial signals from the start.

**Impact of a single false match on rules:** A false match produces a spurious delta (e.g., "fontSize changed from 14 to 28" when the real change was 24 to 28). This bad delta enters the rule aggregator. But because it is a one-off observation, it starts at confidence 0.4 (Tier 2 base). It would need 4+ reinforcing observations of the same spurious pattern to cross the 0.7 application threshold. A single false match does not poison the system; it creates noise that decays via the confidence floor. The system is self-healing here, though I should have made this resilience argument explicit in the original proposal.

### Challenge 3: 70% coverage -- is ignoring structural learning fatal?

> "You're building a system that can only learn 7 out of 10 things the designer actually cares about. Is 70% coverage enough?"

Let me reframe this honestly. The evaluator counts 3 structural patterns out of 10: CTA separation, wrapper removal, and SPACE_BETWEEN switch. I would argue that SPACE_BETWEEN is a *property* change on the root frame (primaryAxisAlignItems changed from MIN to SPACE_BETWEEN), which content-fingerprint matching captures perfectly because the root frame matches via its content-bearing descendants. So it is 2 structural out of 10, giving 80% coverage, not 70%.

But the deeper question stands: is 80% enough? I believe yes, for three reasons:

1. **The 80% that we capture accounts for the most repetitive work.** Property corrections (padding, cornerRadius, fontSize, fills) are the changes designers make on *every single screen*. Structural changes like CTA separation happen once per screen type and are much less predictable across different screen layouts. Eliminating the repetitive property corrections is where the time savings compound.

2. **Structural learning can be layered on without replacing the matcher.** The Structural Change Records described in Challenge 1 provide the raw observations. A future structural rule engine could consume these observations and produce rules like "when building a payment screen, separate the CTA into its own wrapper with these properties." This does not require re-architecting the fingerprint matcher -- it is an additive layer.

3. **Perfect is the enemy of shipped.** The current system matches 0 out of 10 patterns. Going to 8 out of 10 is transformative. The remaining 2 are harder, but the designer gets immediate value from the 8. Waiting to solve all 10 before shipping means the designer gets 0 value for longer.

That said, I accept the evaluator's implicit point: the proposal should not *defer* structural learning as an "open question." It should include a concrete sketch of how structural observations become rules, even if the full implementation is Phase 5. Here is that sketch:

**Structural Rule Format:**

```typescript
interface StructuralRule {
  id: string;
  brandId: string;
  screenType?: string;

  pattern: {
    type: "isolate_to_wrapper" | "flatten_wrapper" | "reorder_children";
    targetRole: string;          // role of the node being moved/wrapped
    wrapperTemplate?: {          // for "isolate_to_wrapper": what the wrapper looks like
      layoutMode: string;
      padding: number[];
      gap: number;
      fills: any[];
    };
  };

  observedCount: number;
  confidence: number;
}
```

These rules would be applied during the build phase: after constructing the initial layout, check if any structural rules apply (e.g., "for payment screens, isolate CTA into its own wrapper"). This is harder to auto-apply than property rules because it requires tree manipulation, but it is expressible and implementable.

### Cross-Cutting Challenge: The Kraken Restructure (simultaneous changes as a single design decision)

> "None of the proposals handle the case where multiple simultaneous changes represent a single design decision."

Guilty as charged. Content-fingerprint matching treats each matched pair independently and extracts per-property deltas. It does not know that "move CTA + change spacing + rename frame + flatten fee-row + switch to SPACE_BETWEEN" is one coherent decision.

But I want to push back on whether this *needs* to be solved at the matcher level. The matcher's job is to produce accurate deltas. The *interpreter's* job is to group related deltas into coherent design decisions. These are separate concerns.

**Proposed: Delta Clustering as a post-processing step.**

After matching produces N deltas from a single refinement session, cluster them by:

1. **Temporal proximity:** All deltas from one capture are from one session.
2. **Spatial proximity:** Deltas on nodes that are siblings or parent-child in the after SOM are likely related.
3. **Semantic coherence:** A CTA reparenting + a parent layout mode change + a spacing change all involve the same region of the tree.

The cluster becomes a "design decision" record:

```typescript
interface DesignDecision {
  name: string;               // generated: "CTA isolation with spacing reform"
  deltas: StyleDelta[];
  structuralChanges: StructuralObservation[];
  screenType: string;
  confidence: number;          // min confidence across constituent deltas
}
```

This does not require the matcher to understand intent. It requires a post-processing step (likely Claude-assisted, since naming and grouping design decisions is a judgment call) that runs after delta extraction. The matcher stays clean and mechanical; the interpretation layer adds semantic understanding.

### Cross-Cutting Challenge: The Contradiction Test (brand-scoped rules)

> "How does the system know that two contradictory values from different brands are NOT contradictions?"

The original proposal already includes `brandId` on every `RefinementRule`. Rules are scoped to a brand by construction -- when extracting deltas from a Kraken refinement, the resulting rules have `brandId: "kraken"`. When extracting from a fitness app, `brandId: "fitness-app"`.

The evaluator's concern is valid if rule *querying* is not brand-scoped. Let me make the query logic explicit:

```
When building for brand B, screen type S:
  1. Query rules WHERE brandId = B AND (screenType = S OR screenType IS NULL)
  2. Never query rules from brand B2 when building for brand B
```

There is no cross-brand aggregation. Kraken's `cornerRadius: 8` and the fitness app's `cornerRadius: 20` are two separate rules in two separate brand namespaces. They never conflict because they never co-exist in the same query result.

The harder version of this question is: what about a *new* brand with no refinement history? The system has no rules for it. This is correct behavior -- cold start for a new brand means building purely from the reference SOM, which is what happens today. The designer refines, rules accumulate, and after 2-3 screens the system starts learning.

Could we offer cross-brand "universal" rules? Yes, but cautiously. If 4 out of 5 brands all use `padding.top: 28` on root frames, there is arguably a universal rule. But the evaluator is right that brand-awareness is load-bearing -- I would rather be conservative and keep rules brand-scoped than risk applying Kraken's dark-mode fills to a light-mode fitness app. Cross-brand generalization is a Phase 5+ optimization that requires explicit opt-in ("use industry defaults for new brands").
