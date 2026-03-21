# Proposal 03: Visual-Perceptual Refinement Learning

> Learn from designer refinements by seeing changes first, then measuring them.

**Status:** Proposal
**Date:** 2026-03-21

---

## Problem

Rex builds screens in Figma from reference designs stored in Osiris. Designers then refine these screens — adjusting spacing, corner radii, colors, typography, layout strategy. We need to learn from those refinements so Rex improves over time.

Two prior approaches failed:

1. **Tree-diffing SOMs** — Compare before/after SOM trees node-by-node. Broke down because node name matching is fragile. Renamed, restructured, or flattened nodes produce garbage diffs full of false positives.
2. **Pure screenshot comparison** — Rejected by the designer as "lossy." A screenshot can show that something changed, but it cannot tell you that `cornerRadius` went from 18 to 8, or that padding moved from 20 to 24. The precise values get lost.

Both approaches fail because they each use only half the available information. This proposal uses both halves.

---

## Core Idea

**Use screenshots for pattern recognition. Use the SOM for precise values.**

The screenshot tells you WHAT changed visually — spacing feels bigger, corners feel sharper, text feels darker. The SOM gives you the exact numbers — padding 16 to 24, cornerRadius 18 to 8, fill #666666 to #070809.

This is how a human design reviewer works. You look at two screens side by side and SEE what's different. Then you inspect the specific properties to get exact values. Nobody reads a 200-node JSON tree looking for differences. They look at the picture.

Two-pass system:

- **Pass 1 (Visual Detection):** Claude compares before/after screenshots and produces a list of observed visual changes, each localized to a region of the screen.
- **Pass 2 (Property Extraction):** For each observed change, query the SOM nodes in that region to extract exact before/after property values.

The screenshot is the index. The SOM is the data.

---

## Pass 1: Visual Detection

### Input

Two screenshots of the same screen:
- **Before:** Rex's initial build (captured automatically before handing off to the designer)
- **After:** The designer's refined version (captured when the designer signals "done" or when Rex detects the screen has been modified)

Both screenshots are taken via `rex.screenshot` at the same resolution (2x, matching the frame dimensions).

### What Claude looks for

Claude receives both screenshots and a structured prompt asking it to identify visual differences across specific perceptual categories:

| Category | What to notice | Example observation |
|---|---|---|
| **Spacing** | Gaps between elements feel wider or tighter, content sits higher or lower, margins changed | "The content area has more breathing room at the top" |
| **Corner treatment** | Rounded elements became sharper or vice versa, card shapes changed | "Cards have noticeably sharper corners" |
| **Color & contrast** | Text became darker/lighter, backgrounds changed, new tints appeared | "Body text is darker, easier to read" |
| **Typography** | Text feels bigger/smaller, different weight | "Body text appears slightly larger" |
| **Layout strategy** | Elements redistributed, new visual grouping, content separated into sections | "The CTA button is isolated in its own section at the bottom" |
| **Structural** | Elements added, removed, or reordered; wrapper frames eliminated; nesting changed | "There appear to be fewer nested containers" |
| **Surface treatment** | Background patterns changed (flat to layered, solid to card-based) | "Content sits on white cards over a gray background instead of a flat white surface" |

### Output format

Pass 1 produces a structured list of **visual observations**, each with:

```json
{
  "observations": [
    {
      "id": "obs-1",
      "category": "spacing",
      "region": "top",
      "description": "Top padding of the main content area appears larger",
      "confidence": 0.9,
      "boundingBox": { "yStart": 0, "yEnd": 120 }
    },
    {
      "id": "obs-2",
      "category": "corner_treatment",
      "region": "middle",
      "description": "Card and pill elements have visibly sharper corners",
      "confidence": 0.85,
      "boundingBox": { "yStart": 200, "yEnd": 600 }
    }
  ]
}
```

The `region` and `boundingBox` fields are approximate — they don't need pixel precision. They exist to narrow down which SOM nodes to inspect in Pass 2. A rough vertical band ("top third of the screen," "middle section") is sufficient.

### What the screenshot catches that tree-diffing misses

- **Gestalt changes.** The designer switched from flat white to gray-background-with-white-cards. A tree diff sees dozens of individual fill changes. The screenshot shows one coherent design decision.
- **Proportional changes.** "More breathing room" is immediately visible. In a tree diff, it's `paddingTop: 16 → 24` buried in a wall of unchanged properties.
- **Structural simplification.** Removed wrapper frames are invisible in the screenshot (which is the point — they were unnecessary). A tree diff sees deletions and gets confused about which nodes moved.

### What the screenshot misses

This is the "lossy" concern, and it's real. Screenshots do NOT reliably capture:

- Exact numeric values (cornerRadius 12 vs 16 looks identical at screen scale)
- Precise hex colors (#666666 vs #555555 is ambiguous in a screenshot)
- Layout mode changes (SPACE_BETWEEN vs fixed spacing can produce identical visual output)
- Auto-layout configuration (padding vs margin, sizing modes)
- Non-visible properties (clip content, blend mode, constraints)

This is exactly why Pass 1 is insufficient alone. It identifies the WHAT. Pass 2 provides the HOW MUCH.

---

## Pass 2: Property Extraction

### Process

For each observation from Pass 1, query the relevant SOM nodes from both the before and after SOMs to extract precise property differences.

The mapping from observation to SOM nodes works through **spatial lookup**:

1. Take the observation's `boundingBox` (approximate y-range on the screen).
2. Walk the SOM tree and collect all nodes whose position falls within that range.
3. For each node, compare the before and after property values.
4. Filter to properties relevant to the observation's category.

```
Observation: "Top padding of main content area appears larger"
  → Region: y 0-120
  → Category: spacing
  → SOM nodes in region: root frame, nav-bar, content-wrapper
  → Property filter: padding, gap, y-position, itemSpacing
  → Finding: root.style.padding.top: 16 → 24
```

### Category-to-property mapping

Each observation category maps to specific SOM properties to inspect:

| Observation category | SOM properties to check |
|---|---|
| spacing | `padding` (all sides), `gap`, `itemSpacing`, `y`, `x`, `primaryAxisAlign` |
| corner_treatment | `cornerRadius` (uniform and per-corner) |
| color_contrast | `fill`, `fills`, `strokes`, text `fill` values |
| typography | `fontSize`, `fontWeight`, `fontFamily`, `lineHeight`, `letterSpacing` |
| layout_strategy | `layout`, `primaryAxisAlign`, `counterAxisAlign`, `primaryAxisSizing`, `counterAxisSizing` |
| structural | node count, tree depth, node types, names (presence/absence) |
| surface_treatment | `fill` on container frames, background vs foreground fill patterns |

### Output format

Pass 2 produces **refinement deltas** — concrete, reproducible property changes:

```json
{
  "deltas": [
    {
      "observationId": "obs-1",
      "description": "Increase top padding on root frame",
      "scope": "root",
      "nodeRole": "screen",
      "property": "padding.top",
      "before": 16,
      "after": 24,
      "confidence": 1.0
    },
    {
      "observationId": "obs-2",
      "description": "Reduce corner radius on card elements",
      "scope": "cards",
      "nodeRole": "card",
      "property": "cornerRadius",
      "before": 28,
      "after": 12,
      "confidence": 1.0
    }
  ]
}
```

Confidence here is 1.0 because these are exact values read from the SOM, not estimates. The screenshot observation might have 0.85 confidence ("corners look sharper"), but the extracted delta is precise.

---

## Walkthrough: kraken_05

kraken_05 is a screen where the designer made multiple categories of refinement. Here is the full two-pass process.

### Pass 1: Visual Detection

Claude receives before/after screenshots and identifies:

| # | Category | Region | Observation |
|---|---|---|---|
| 1 | spacing | top | More space above the main content |
| 2 | spacing | full | Content elements are more evenly distributed vertically |
| 3 | corner_treatment | middle | Cards and pill-shaped elements have sharper corners |
| 4 | corner_treatment | root | The overall screen frame has newly rounded corners |
| 5 | color_contrast | middle | Body text is darker and more readable |
| 6 | typography | middle | Body text appears slightly larger |
| 7 | layout_strategy | bottom | The CTA button area is visually separated from the content above it |
| 8 | structural | full | The layout feels cleaner, fewer visible container boundaries |
| 9 | surface_treatment | middle | Some interactive elements have a subtle color tint |
| 10 | spacing | full | Horizontal content margins are wider |

### Pass 2: Property Extraction

For each observation, query the SOMs:

**Observation 1 (top spacing):**
- Region: y 0-100
- Nodes: root frame
- Finding: `root.style.padding.top: 16 → 32`
- Delta: `{ nodeRole: "screen", property: "padding.top", before: 16, after: 32 }`

**Observation 2 (vertical distribution):**
- Region: full screen
- Nodes: main content frame
- Finding: `content.style.primaryAxisAlign: "MIN" → "SPACE_BETWEEN"`
- Delta: `{ nodeRole: "screen", property: "primaryAxisAlign", before: "MIN", after: "SPACE_BETWEEN" }`

**Observation 3 (sharper corners):**
- Region: y 200-600
- Nodes: card frames, pill frames
- Findings:
  - `card.style.cornerRadius: 28 → 12`
  - `pill.style.cornerRadius: 18 → 8`
  - `tag.style.cornerRadius: 16 → 8`
- Delta: `{ nodeRole: "card", property: "cornerRadius", pattern: "reduce by ~60%" }`

**Observation 4 (root corners):**
- Region: root
- Nodes: root frame
- Finding: `root.style.cornerRadius: 0 → 24`
- Delta: `{ nodeRole: "screen", property: "cornerRadius", before: 0, after: 24 }`

**Observation 5 (text color):**
- Region: y 200-600
- Nodes: body text nodes
- Finding: `bodyText.style.fill: "#666666" → "#070809"`
- Delta: `{ nodeRole: "prompt", property: "fill", before: "#666666", after: "#070809" }`

**Observation 6 (font size):**
- Region: y 200-600
- Nodes: body text nodes
- Finding: `bodyText.style.fontSize: 16 → 18`
- Delta: `{ nodeRole: "prompt", property: "fontSize", before: 16, after: 18 }`

**Observation 7 (CTA separation):**
- Region: y 600-844
- Nodes: CTA frame, content frame
- Finding: CTA button reparented into its own section frame, separate from the content section
- Delta: `{ nodeRole: "cta", property: "structure", pattern: "isolate CTA into own section" }`

**Observation 8 (structural simplification):**
- Region: full screen
- Nodes: wrapper frames
- Finding: 3 wrapper frames removed (frame nesting depth reduced from 5 to 3 in places)
- Delta: `{ nodeRole: "section", property: "structure", pattern: "remove unnecessary wrapper frames" }`

**Observation 9 (brand tinting):**
- Region: y 500-700
- Nodes: numpad key frames
- Finding: `numpadKey.style.fill: "#F5F5F5" → "#EDE8F5"` (light purple tint matching brand)
- Delta: `{ nodeRole: "interactive", property: "fill", pattern: "tint with brand color" }`

**Observation 10 (horizontal padding):**
- Region: full screen
- Nodes: content sections
- Finding: `section.style.padding.left: 20 → 24`, `section.style.padding.right: 20 → 24` (some sections 24 → 32)
- Delta: `{ nodeRole: "section", property: "padding.horizontal", pattern: "increase by 4-8px" }`

### Total deltas extracted: 13 concrete property changes from 10 visual observations.

Each delta has an exact before/after value. Nothing is "lost in translation." The screenshot told us where to look. The SOM told us the numbers.

---

## Learning Accumulation

Deltas from individual screens are useful, but the real value comes when patterns emerge across multiple screens.

### From deltas to rules

After processing N screens, the system looks for recurring deltas:

```
Screen 1: root.cornerRadius: 0 → 24
Screen 2: root.cornerRadius: 0 → 24
Screen 3: root.cornerRadius: 0 → 24
Screen 4: root.cornerRadius: 0 → 24
Screen 5: root.cornerRadius: 0 → 24
→ RULE: "Always set cornerRadius: 24 on root frame" (confidence: 5/5 = 1.0)
```

```
Screen 1: padding.top: 16 → 24
Screen 3: padding.top: 16 → 32
Screen 5: padding.top: 16 → 28
→ RULE: "Increase top padding to 24-32 range" (confidence: 3/5 = 0.6, range: 24-32)
```

```
Screen 2: card.cornerRadius: 28 → 12
Screen 4: pill.cornerRadius: 18 → 8
Screen 5: tag.cornerRadius: 16 → 8
→ RULE: "Reduce corner radii on cards/pills (target: 8-12)" (confidence: 3/5 = 0.6)
```

### Rule storage

Rules are stored as Osiris principles via `osiris_extract_principles` or as Rex memories via `remember`:

```json
{
  "scope": "team",
  "category": "convention",
  "content": "Always set cornerRadius: 24 on the root screen frame",
  "confidence": 1.0,
  "source": "inferred",
  "tags": ["refinement", "cornerRadius", "root-frame"]
}
```

### Compounding

Each new screen benefits from all previously learned rules:

| Screen # | Rules available | Refinements needed | Net improvement |
|---|---|---|---|
| 1 (cold) | 0 | 10 | Baseline |
| 2 | 3 rules from screen 1 | 8 (3 already applied) | 20% fewer refinements |
| 5 | 8 rules from screens 1-4 | 4 (6 already applied) | 60% fewer refinements |
| 10 | 12 mature rules | 1-2 edge cases | 80-90% fewer refinements |

The convergence rate depends on how consistent the designer is. A designer with strong, consistent preferences (always cornerRadius 24 on root, always SPACE_BETWEEN) produces high-confidence rules quickly. A designer who experiments produces lower-confidence, more contextual rules.

### Rule application

When Rex builds a new screen, it queries for applicable rules before generating:

```
1. Fetch all refinement rules for this brand/team (confidence > 0.5)
2. Group by property category (spacing, corners, color, layout, structure)
3. Apply deterministic rules (confidence > 0.9) automatically
4. Apply tentative rules (confidence 0.5-0.9) and flag for review
5. Skip low-confidence rules (confidence < 0.5) but log them
```

Rules with exact values (cornerRadius: 24) are applied directly. Range rules (padding: 24-32) use the median. Pattern rules ("isolate CTA into own section") are applied by Claude's judgment during screen construction.

---

## Operating Without a "Before" Screenshot

The designer might modify the screen before anyone captures the original Rex output. Or Rex might not have saved a pre-refinement screenshot. This is a real operational concern.

### Solution: Reconstruct from the SOM

Rex always has the **original SOM** used to build the screen (stored in Osiris as the source reference). It also has the **screen type and structure** that informed the build. This means:

1. **Best case: Both screenshots exist.** Run full two-pass. This is the default when Rex captures a screenshot immediately after building.

2. **Good case: Only the "after" screenshot exists.** Run a modified Pass 1 where Claude compares the after screenshot against the original reference screenshot from Osiris (the design the screen was built from). Visual differences between "what we were trying to match" and "what the designer ended up with" are still informative.

3. **Fallback case: No screenshots at all.** Skip Pass 1 entirely. Run Pass 2 directly by diffing the original build SOM (what Rex generated) against the current SOM (what the designer refined to). This is the tree-diff approach — but it works here because we are comparing **two SOMs of the same screen** rather than trying to match nodes between unrelated trees. The structure hasn't been rebuilt from scratch; it's been refined. Node IDs are stable. Names are mostly stable. This makes tree-diffing viable as a fallback even though it fails as a primary approach across different screens.

4. **Worst case: No original SOM either (first build wasn't tracked).** No refinement learning is possible for this screen. Store the current state as a new baseline for future refinements.

### Automatic screenshot capture

To avoid falling into fallback cases, Rex should automatically capture a screenshot at two points:

- **Post-build:** Immediately after Rex finishes constructing a screen, before handing off to the designer. Store the screenshot in Osiris alongside the build SOM.
- **Post-refinement:** When the designer signals completion (or after a configurable idle period), capture the refined state.

This is a single `rex.screenshot` call per event. Minimal overhead.

---

## Cold Start vs Mature

### Cold start (0 refinements processed)

- No rules exist. Rex builds screens using only the reference SOM and its own judgment.
- Every refinement the designer makes is a learning opportunity.
- Pass 1 is especially valuable here because the system has no prior patterns to guide it — it needs to discover what matters to this designer.
- Expect 8-12 refinement deltas per screen.
- After 3 screens, enough signal exists to form tentative rules (confidence 0.5-0.7).

### Growth phase (3-10 refinements processed)

- 5-8 rules exist, most at medium confidence.
- Rex applies high-confidence rules automatically, reducing refinement count.
- New refinements either reinforce existing rules (boosting confidence) or reveal new patterns.
- Expect 4-6 refinement deltas per screen.
- Contradictions may appear (designer chose 24px padding on one screen, 32px on another). These produce range rules rather than exact rules.

### Mature (10+ refinements processed)

- 10-15 stable rules at high confidence.
- Rex's initial builds are close to what the designer wants.
- Refinements are minor, contextual, or represent genuine design exploration (not systematic corrections).
- Expect 1-3 refinement deltas per screen.
- New deltas at this stage are often screen-type-specific ("onboarding screens use larger padding than home screens") rather than universal.

### Rule confidence trajectory

```
Refinements:    1    2    3    4    5    6    7    8    9   10
                │    │    │    │    │    │    │    │    │    │
cornerRadius 24 ████████████████████████████████████████████ 1.0
top padding     ░░░░░████████████████████████████████████    0.9
SPACE_BETWEEN   ░░░░░░░░░████████████████████████████       0.8
brand tinting   ░░░░░░░░░░░░░░░░████████████████            0.7
CTA isolation   ░░░░░░░░░░░░░░░░░░░░░░██████████            0.6

░ = tentative (applied with flag)   █ = stable (applied automatically)
```

---

## Integration Points

### With Osiris

- `osiris_capture_delta` — Store individual refinement deltas with before/after values
- `osiris_extract_principles` — Aggregate deltas into rules after N screens
- `osiris_get_refinement_context` — Fetch existing rules when building a new screen
- `osiris_score_comparison` — Validate that rule application improved screen quality

### With Rex

- `extract_som` — Get the after-refinement SOM for Pass 2
- `screenshot` — Capture before/after screenshots for Pass 1
- `remember` — Store mature rules as Rex memories for session-level access
- `recall` — Retrieve applicable rules during screen construction

### With Rex Memory

Refinement rules that reach high confidence (0.9+) are promoted to Rex memories at the `team` scope with category `convention`. This means they persist across sessions and are automatically loaded when Rex connects to any file for this team.

---

## Implementation Phases

### Phase 1: Capture pipeline (effort: 1-2 days)

- Auto-screenshot after Rex builds a screen (post-build hook)
- Auto-screenshot on refinement completion signal
- Store both screenshots in Osiris linked to the screen record

### Phase 2: Two-pass analysis (effort: 2-3 days)

- Implement the Pass 1 prompt (visual observation extraction)
- Implement Pass 2 (SOM spatial query + property diff)
- Wire up the observation-to-delta pipeline
- Output: list of refinement deltas for a single screen

### Phase 3: Rule aggregation (effort: 1-2 days)

- Accumulate deltas across screens
- Pattern detection: same property changed the same way N times
- Rule formation with confidence scoring
- Store rules via Osiris principles and Rex memories

### Phase 4: Rule application (effort: 1-2 days)

- Query applicable rules before screen construction
- Inject rules into the build prompt
- Apply deterministic rules automatically
- Flag tentative rules for designer review

### Total estimated effort: 5-9 days

---

## Why This Isn't Lossy

The "lossy" objection to pure screenshot comparison is valid. Screenshots lose:
- Exact numeric values
- Precise colors
- Layout configuration
- Non-visible properties

This proposal uses screenshots only for what they're good at: spatial pattern recognition and change detection. Every observation is then grounded in exact SOM data. The final output is a list of precise property deltas with exact before/after values — the same fidelity as reading the Figma inspector.

The screenshot is the magnifying glass. The SOM is the ruler. You need both.

---

## Round 2: Addressing Evaluator Challenges

### Challenge 1: Dense screens and spatial lookup degenerating into "tree-diffing with extra steps"

The evaluator asks: when Claude says "region y 200-600, corner treatment changed" and there are 15+ nodes in that band, does Pass 2 just diff everything in the region — which is tree-diffing with extra steps?

**This is partly right, but misses the key difference.** Yes, Pass 2 does compare properties across nodes in a region. But it is NOT tree-diffing with extra steps — it is tree-diffing with fewer, better-targeted steps, and that distinction matters.

Unconstrained tree-diffing failed at 0/0 matches because it had to solve two hard problems simultaneously: (1) figure out which nodes correspond to each other across two SOMs, and (2) figure out which property differences are meaningful. Pass 1 eliminates problem (2) by telling Pass 2 what KIND of change to look for. When the observation says "corner treatment changed in region y 200-600," Pass 2 is not diffing all properties on all 15 nodes. It is checking `cornerRadius` on the nodes in that band. That is 15 cornerRadius comparisons, not 15 x 40 property comparisons across an ambiguous node matching. The category filter is doing the work, not the spatial filter alone.

That said, the evaluator is right that on very dense screens (30+ card dashboard), overlapping observations could create a combinatorial blowup. The fix is straightforward: **Pass 1 should produce more granular observations on dense screens.** Instead of "region y 200-600," Claude should say "the top row of cards (3 cards in a horizontal group near y 250)" vs. "the transaction list items below y 400." The prompt should instruct Claude to subdivide large regions when multiple distinct element groups are present. This is a prompt engineering problem, not an architectural one — Claude is good at spatial decomposition when asked to do it.

For the specific Kraken scenario with the numpad keys, recipient card, amount display, and fee row all in the same vertical band: these are visually distinct element types. Claude does not see "15 nodes in a band." It sees "a card, a row of numbers, a text block, a fee line." The observation would naturally be "the numpad keys have a purple tint" or "the card corners are sharper" — not a vague "something changed in this 400px band." The evaluator is modeling Pass 1 as dumber than it is.

### Challenge 2: Cost and speed of 200 LLM vision calls

The evaluator raises a legitimate operational concern. 200 screens x 1 vision call each = real cost and latency. Let me address this honestly.

**The cost concern is valid but overstated for the actual use case.** Refinement learning is not a real-time hot path. It runs after the designer finishes refining, likely asynchronously. A 5-10 second LLM call per screen is irrelevant when the alternative is the designer manually making the same 8 corrections on every future screen. The ROI math works: 200 vision calls at ~$0.01-0.02 each = $2-4 total, to save a designer hours of repetitive refinement work.

But the evaluator's deeper question is sharper: **have I compared this to just having Claude read the two SOMs directly?** This is fair. For mature screens where the changes are mostly property tweaks (cornerRadius, fontSize, padding), a direct SOM comparison with Claude reading both JSONs might work almost as well, and it would be cheaper and faster.

Here is my honest assessment of when the vision pass earns its cost:

- **Worth it during cold start (screens 1-5).** The system does not yet know what matters. The screenshot gives Claude gestalt-level pattern recognition that SOM-reading does not — "this feels more spacious," "the hierarchy is cleaner." These fuzzy observations bootstrap the learning faster than a flat property diff.
- **Diminishing returns in growth phase (screens 5-15).** Once the system has 5-8 rules, it already knows what to look for. A targeted SOM diff checking known rule categories may be sufficient.
- **Skip it in mature phase (screens 15+).** At this point, refinements are minor. A SOM diff filtered by known rule categories catches everything. Vision is overkill.

**Proposed fix: adaptive Pass 1.** Use vision for cold-start and when the SOM diff reveals large unexplained changes. Fall back to SOM-only comparison when the system has high-confidence rules covering most property categories. This makes the vision call a bootstrapping mechanism, not a permanent tax.

### Challenge 3: Fallback SOM-diffing inherits the 0/0 failure mode; SOM IDs are not stable

The evaluator catches a real error in my proposal. I wrote "Node IDs are stable" in the fallback section, implying that the SOM node IDs persist across `extract_som` calls. **The evaluator is correct that `extract_som` generates new SOM-level IDs on each call.** The underlying Figma node IDs (like `123:456`) are stable, but the SOM wrapper assigns its own identifiers.

However, this does not invalidate the fallback as completely as the evaluator suggests. Here is why:

**The fallback case is comparing two SOMs of the same screen built by Rex.** Rex created every node in the "before" state. It knows the Figma node IDs of everything it created (returned by `create_node`). When `extract_som` runs on the refined screen, it produces new SOM IDs but the underlying Figma node IDs are embedded in the SOM data. The fallback can match on Figma node IDs, not SOM IDs. The original proposal was sloppy about this distinction — I should have said "Figma node IDs are stable" and specified that matching uses those, not SOM-assigned IDs.

**The real limitation of the fallback is structural changes, not ID instability.** When the designer deletes a wrapper and reparents children, the children's Figma node IDs survive but the wrapper's ID disappears. When the designer creates a new wrapper, it gets a new Figma node ID that Rex has never seen. The fallback can detect "node X now has a different parent" and "new node Y appeared," but interpreting those as coherent structural decisions (like "CTA was isolated into its own section") requires the kind of gestalt reasoning that Pass 1 provides. This is precisely why the fallback is the FALLBACK and not the primary approach.

**Proposed fix:** Make the fallback explicit about its limitations. It should be documented as "property-change detection only" — capable of catching cornerRadius, fontSize, padding, and fill changes via Figma node ID matching, but NOT capable of interpreting structural reorganization. Structural learning requires Pass 1 (vision) or the designer-workflow capture approach from Proposal 05.

---

### Cross-Cutting Challenge: The Kraken Restructure

The evaluator's summary of Proposal 03's weakness: "sees 'layout feels different' in the screenshot but must map that fuzzy observation to 5 simultaneous property and structural changes via spatial lookup on a dense screen."

**This is the strongest challenge against this proposal, and it is partially right.** Let me walk through what actually happens.

Pass 1 does not produce one fuzzy observation for the whole restructure. It produces multiple observations:

1. "The CTA button is isolated in its own section at the bottom" (layout_strategy, region: bottom)
2. "Content elements are more evenly distributed" (spacing, region: full)
3. "The layout feels cleaner, fewer visible container boundaries" (structural, region: full)

These are three separate observations mapping to three different aspects of the restructure. Pass 2 handles each one independently:

- Observation 1 → Pass 2 finds the CTA node is now inside a new parent frame in the bottom region. Delta: structural reparenting.
- Observation 2 → Pass 2 finds `primaryAxisAlign` changed to `SPACE_BETWEEN`. Delta: layout property change.
- Observation 3 → Pass 2 finds wrapper frames removed. Delta: structural simplification.

The numpad spacing change (4 to 0) and the rename ("Frame 1" to "content-area") are the ones this proposal handles least well. The spacing change might be caught as a "spacing" observation if it is visually perceptible, but 4px to 0px on small numpad keys might be below Claude's visual detection threshold. The rename produces zero visual change and will be missed entirely by Pass 1.

**Honest assessment:** This proposal captures 3-4 of the 5 simultaneous changes in the Kraken restructure scenario. The numpad spacing change is borderline (depends on visual salience). The rename is invisible and uncapturable by this approach. But the rename is also arguably the least important change — it is a code-hygiene decision, not a design decision. No visual outcome depends on whether a frame is called "Frame 1" or "content-area."

**What this proposal does NOT do — and what the evaluator is right to flag — is recognize that these 3-4 changes constitute a single design decision.** Pass 2 produces separate deltas. The system sees "CTA reparented" and "SPACE_BETWEEN applied" and "wrappers removed" as independent patterns. If they always co-occur across multiple screens, the rule aggregation phase could detect the correlation. But it would require deliberate co-occurrence analysis: "these 3 deltas appear together on 4/5 screens → they may be one compound decision." The current proposal does not specify this. It should.

**Proposed addition:** Add a **Pass 3: Delta Clustering** step that groups co-occurring deltas (same screen, same editing session) and tracks whether those clusters recur across screens. If "CTA isolation + SPACE_BETWEEN + wrapper removal" recurs 3+ times, promote the cluster to a compound rule rather than 3 independent rules.

### Cross-Cutting Challenge: The Contradiction Test

The evaluator asks: how does the system know that cornerRadius 8 (Kraken) and cornerRadius 20 (fitness app) are not contradictions, but two brand-scoped values?

**This proposal, as written, does not handle this.** The rule aggregation logic would see "pill cornerRadius" with values 8 and 20 across different screens and either create a useless range rule [8-20] or oscillate between them. The evaluator is correct that brand-awareness is load-bearing.

**The fix is scoping, and it is not complicated — but I failed to specify it.** Every delta is already tagged with the screen it came from. Screens belong to projects. Projects belong to brands. The aggregation step should group deltas by brand before computing rules:

```
Kraken screens:   pill.cornerRadius → 8, 8, 8, 8    → Rule: cornerRadius 8 (brand: Kraken, confidence: 1.0)
Fitness screens:  pill.cornerRadius → 20, 20, 20     → Rule: cornerRadius 20 (brand: FitApp, confidence: 1.0)
```

At build time, Rex already knows which brand/project it is building for (this context comes from Osiris). It queries rules scoped to that brand first, then falls back to cross-brand rules only for properties with no brand-specific rule.

The harder question is: what if there IS a cross-brand pattern? Maybe across all brands, the designer always reduces cornerRadius from whatever the reference has. The pattern is not "use 8" or "use 20" — it is "reduce by ~40% from the reference." Detecting relative/proportional rules rather than absolute value rules requires the aggregation to look at the delta direction and magnitude, not just the target value. The walkthrough in my original proposal actually hints at this — Observation 3 notes "reduce by ~60%" — but I did not formalize it into the rule engine.

**Proposed fix:** Rules should have two forms:
- **Absolute:** `pill.cornerRadius = 8` (scoped to brand)
- **Directional:** `pill.cornerRadius: reduce from reference by 40-60%` (cross-brand)

The directional form captures the designer's taste ("I always want tighter corners than the reference") without conflicting across brands. Brand-scoped absolute rules take priority when they exist. Cross-brand directional rules serve as fallback for new brands.
