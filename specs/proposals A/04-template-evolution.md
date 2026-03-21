# Proposal 04: Template Evolution (Golden SOM Library)

## Problem

Rex builds UI screens in Figma from Osiris reference screens. Designers refine the output. Those refinements are lost — the next time Rex builds a similar screen, it starts from scratch and makes the same mistakes. Tree-diffing SOMs to extract "what changed" has failed: SOMs are structurally noisy, node counts shift, wrappers appear and disappear, and the diffs produce brittle rules that don't generalize.

We need a system that learns from designer refinements without diffing.

## Core Insight

**Don't diff. Don't match. Just save the refined version as the new gold standard.**

This is how design systems actually work. When a designer updates a button component, nobody diffs the old button against the new one and extracts "the radius decreased by 4px." They just use the new button. The old one is gone.

The same principle applies at the screen level. When a designer refines Rex's payment screen output — adding `cornerRadius: 24` to the root, switching to `SPACE_BETWEEN`, bumping padding from 16 to 24 — the refined screen IS the lesson. Store it. Next time Rex needs a payment screen, start from the refined version instead of generating from scratch.

Learning happens by accumulating better templates, not by extracting rules.

## Why This Works for the Observed Refinements

The 10 refinement patterns observed across 5 screens map cleanly to this approach:

| Refinement | How Template Evolution Handles It |
|---|---|
| `cornerRadius: 24` on root frame | Baked into every refined template's root node |
| Top padding 16 to 24-32 | Stored in the template's layout properties |
| `SPACE_BETWEEN` for main vertical axis | Part of the template's auto-layout config |
| Horizontal padding 20 to 24-32 | In the template's padding values |
| Reduced card/pill corner radii (28 to 12, 18 to 8) | Each card in the template carries the correct radius |
| Darkened body text, bumped font sizes | Typography style baked into each text node |
| CTAs separated into own sections | Structural pattern preserved in the template tree |
| Removed unnecessary wrapper frames | Clean structure IS the template — no wrappers to remove |
| Numpad keys tinted with brand color | Stored as fill values in the template |
| Gray bg with white cards | Background and card fills stored directly |

No rule extraction needed. No "if payment screen, add 24px radius." The template just has 24px radius because that's what the designer set.

---

## 1. Template Storage Format

A **Golden Template** is a refined SOM v2 with metadata that describes when and how to use it.

```typescript
interface GoldenTemplate {
  // Identity
  id: string;                        // UUID
  brandId: string;                   // Osiris brand slug (e.g., "revolut", "nubank")
  version: number;                   // Increments on re-refinement

  // Classification — WHEN to use this template
  screenType: string;                // "payment", "home", "onboarding", "settings"
  screenSubtype?: string;            // "payment-numpad", "payment-confirmation"
  tags: string[];                    // ["dark-mode", "card-list", "hero-gradient"]
  mood?: string;                     // "premium", "minimal", "energetic"
  density: "compact" | "normal" | "spacious";
  platform: "mobile" | "tablet" | "desktop";

  // The actual template — WHAT to build from
  som: SOMv2;                        // Full SOM v2 tree (same format as Osiris)
  referenceFrame: {
    width: number;
    height: number;
  };

  // Content slots — WHERE new content goes
  slots: ContentSlot[];              // Parameterized regions (see section 3)

  // Structural metadata — HOW to adapt
  structure: {
    sectionCount: number;            // Number of top-level content sections
    hasCTA: boolean;
    hasHero: boolean;
    hasBottomNav: boolean;
    hasTabBar: boolean;
    listItemCount?: number;          // If it contains a repeating list
    cardCount?: number;              // If it contains cards
  };

  // Provenance
  sourceScreenId: string;            // Osiris screen ID this was refined from
  refinedFromNodeId: string;         // Figma node ID of the refined frame
  refinedBy: {                       // Figma user who refined it
    id: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;                // How many times this template was used
  lastUsedAt?: Date;

  // Lineage
  supersedes?: string;               // ID of the older template this replaces
  generation: number;                // 1 = first refinement, 2 = re-refined, ...
}
```

### Content Slots

Content slots mark the variable parts of a template — text, images, list items — that change between uses. Everything NOT in a slot is structural/stylistic and stays fixed.

```typescript
interface ContentSlot {
  slotId: string;                    // "hero-title", "cta-label", "list-items"
  nodeId: string;                    // SOM node ID where this slot lives
  role: string;                      // SOM role: "label", "value", "cta", "list"
  type: "text" | "image" | "repeating-group";
  defaultValue?: string;             // Current text/image in the template
  constraints?: {
    maxLength?: number;              // Character limit before truncation
    minItems?: number;               // For repeating groups
    maxItems?: number;
  };
}
```

### Storage Location

Templates live in Osiris alongside screens. They are a new collection, not a modification to existing screen data.

```
Osiris Collections:
  screens          — existing screen data, SOMs, scores
  golden_templates — NEW: refined SOMs with metadata and slots
```

Indexed on: `{ brandId, screenType, tags, mood, density }` for fast retrieval.

---

## 2. Template Matching and Retrieval

When Rex needs to build a screen, it queries the Golden Template library before falling back to raw Osiris references.

### Matching Algorithm

```
Input:  "Build a payment confirmation screen for Revolut, dark mode"
Output: Ranked list of matching Golden Templates
```

**Step 1: Hard filters** — eliminate templates that cannot work.

```
brand     = "revolut" OR brand = "*"     // Brand-specific first, universal fallback
platform  = "mobile"                      // Must match target platform
```

**Step 2: Soft scoring** — rank remaining candidates.

| Signal | Weight | How It Works |
|---|---|---|
| Screen type match | 0.35 | Exact match on `screenType` ("payment" = "payment") scores 1.0. Partial match ("payment-numpad" vs "payment-confirmation") scores 0.6. |
| Tag overlap | 0.20 | Jaccard similarity between request tags and template tags. |
| Mood match | 0.15 | Exact match = 1.0. Compatible moods (e.g., "premium" and "minimal") = 0.5. |
| Recency | 0.15 | More recently refined templates score higher. Normalized by age. |
| Usage count | 0.10 | Templates that have been reused successfully score higher. |
| Generation | 0.05 | Higher generation (more times re-refined) = more polished. |

**Step 3: Return top-N** (default 3) with scores.

### MCP Tool: `find_template`

This would be exposed through Osiris as a new tool.

```
osiris_find_template(
  brand: "revolut",
  screenType: "payment",
  tags: ["dark-mode", "numpad"],
  mood: "premium",
  platform: "mobile",
  limit: 3
) -> GoldenTemplate[]
```

### Fallback Chain

```
1. Exact brand + exact screen type  → Best case: designer-refined template
2. Exact brand + related screen type → Adapt a close template
3. Any brand + exact screen type     → Cross-brand template (style will differ)
4. No template match                 → Fall back to Osiris reference screens
                                       (current behavior, raw SOM from screenshot)
```

---

## 3. Adapting Templates to New Content

A template is not a screenshot to copy pixel-for-pixel. It is a structural and stylistic scaffold that accepts new content. Adaptation happens in three phases.

### Phase 1: Slot Population

Claude receives the template SOM with its content slots and fills them with the requested content.

```
Template slot:  { slotId: "hero-title", role: "label", defaultValue: "Send Money" }
New content:    "Confirm Payment"
Action:         Replace text node content. No structural change.

Template slot:  { slotId: "list-items", role: "list", type: "repeating-group",
                  constraints: { minItems: 1, maxItems: 6 } }
Template has:   3 list items
Request needs:  5 list items
Action:         Clone the list-item SOM node 2 more times. Populate each with new data.
```

### Phase 2: Structural Adjustment

When the new screen needs more or fewer sections than the template provides, Claude adds or removes sections while preserving the template's style conventions.

The key constraint: **new sections copy style from existing template sections.** If the template uses `padding: 24`, `gap: 16`, `cornerRadius: 12` on its sections, new sections use those same values. Claude does not invent new style values.

```
Template has:  [hero] [balance-card] [recent-transactions] [cta]
Request needs: [hero] [balance-card] [recent-transactions] [scheduled-payments] [cta]

Action:
  1. Clone the style envelope of "recent-transactions" (padding, bg, radius, gap)
  2. Create "scheduled-payments" section with that style envelope
  3. Populate with new content
  4. Insert before [cta] (CTAs stay at the bottom — structural convention from template)
```

### Phase 3: Rex Build Execution

The adapted SOM is sent to Rex for Figma construction using existing tools (`create_node`, `set_auto_layout`, `set_fills`, `set_text`, etc.). This is the same build pipeline Rex already uses — the only difference is the input SOM is higher quality because it came from a refined template instead of a raw reference.

### Worked Example

```
Request: "Build a payment screen where the user confirms sending $250 to Alice"

1. find_template(brand: "revolut", screenType: "payment", tags: ["confirmation"])
   → Returns template "payment-confirmation-v3" (generation 3, used 12 times)

2. Template structure:
   [status-bar]
   [nav: "Send Money" + back arrow]
   [recipient-card: avatar + name + amount]
   [details-section: fee, exchange rate, arrival time]
   [cta: "Confirm"]

3. Slot population:
   - nav title: "Send Money" → "Send Money" (same)
   - recipient name: "John Smith" → "Alice"
   - amount: "$100.00" → "$250.00"
   - fee: "$0.00" → "$0.00"
   - cta label: "Confirm" → "Confirm"

4. No structural adjustment needed — same sections.

5. Build in Figma using Rex tools. The root frame gets cornerRadius: 24,
   padding: 24, SPACE_BETWEEN — because that's what the template says.
   Not because a rule told Rex to. Because the template IS the rule.
```

---

## 4. Full Walkthrough: "I Need a New Payment Screen"

### Scenario
A designer asks Claude: *"Build me a payment screen for the Revolut app where users enter an amount using a numpad."*

### Step 1: Template Search (200ms)

Claude calls `osiris_find_template`:
```
brand: "revolut"
screenType: "payment"
tags: ["numpad", "amount-entry"]
platform: "mobile"
```

Result: **payment-numpad-v2** (score: 0.94)
- Generation 2 (refined twice)
- Used 8 times before
- Last refined 3 weeks ago
- Structure: status-bar, nav, amount-display, numpad-grid, cta

### Step 2: Template Inspection (Claude reads the SOM)

Claude examines the template SOM. Key style properties already baked in:
- Root: `cornerRadius: 24`, `padding: { top: 24, left: 24, right: 24, bottom: 32 }`
- Main axis: `SPACE_BETWEEN`
- Numpad keys: `fill: "#1A56DB"` (brand-tinted), `cornerRadius: 8`
- Amount text: `fontSize: 48`, `fontWeight: 700`, `fill: "#070809"`
- Body text: `fontSize: 18`, `fill: "#070809"`
- Background: `fill: "#F5F5F5"` with white card sections

These are all the refinement patterns from the real data — already present, no rules needed.

### Step 3: Content Slot Population

```
Slots:
  amount-display  → "$0" (default, user will type)
  cta-label       → "Continue"
  nav-title       → "Send Money"
  currency-label  → "USD"
```

Claude fills the slots. No structural changes needed — the template already has the right sections.

### Step 4: Build in Figma (~3 seconds)

Claude sends the adapted SOM to Rex. Rex executes:
```
create_node (root frame, 390x844)
  → set_auto_layout (VERTICAL, SPACE_BETWEEN, padding 24)
  → set_corner_radius (24)
  → set_fills (#F5F5F5)

create_node (nav section)
  → set_text ("Send Money")
  ...

create_node (amount display)
  → set_text ("$0", fontSize: 48, fontWeight: 700)
  ...

create_node (numpad grid, 3x4)
  → for each key: create_node + set_fills (#1A56DB) + set_corner_radius (8)
  ...

create_node (CTA)
  → set_text ("Continue")
  ...
```

### Step 5: Designer Review

The designer sees the output. Because the template was already refined, the output is much closer to what they want. Maybe they tweak the CTA color. Maybe nothing.

### Step 6: If Refined — Save Back

If the designer makes changes, Claude extracts the refined SOM using `extract_som` and saves it as a new template version:

```
extract_som(nodeId: "refined-frame-id")
  → SOM v2 with all the designer's tweaks

osiris_save_golden_template(
  brandId: "revolut",
  screenType: "payment",
  screenSubtype: "payment-numpad",
  som: <extracted SOM>,
  supersedes: "payment-numpad-v2",
  generation: 3
)
```

The old template is not deleted — it is marked `supersededBy` and kept for lineage tracking.

---

## 5. Novel Screen Types (No Template Exists)

This is the cold-start problem at the screen-type level. Three strategies, applied in order.

### Strategy A: Structural Analogy

Find a template with similar structure even if the screen type differs.

```
Request: "Build a cryptocurrency staking screen"
No template for screenType: "staking"

But find_template with relaxed matching finds:
  - "investment-detail" (has: hero metric, info rows, CTA) → score 0.6
  - "savings-account" (has: balance display, action buttons, history list) → score 0.55
  - "payment-confirmation" (has: amount display, details, CTA) → score 0.45
```

Claude picks the structurally closest template and adapts it. The style (padding, radii, colors, typography) transfers perfectly. Only the content and section labels change.

### Strategy B: Composite Assembly

No single template matches, but pieces of multiple templates do.

```
Request: "Build a screen showing a user's NFT collection as a grid"
No template matches overall.

But:
  - "home-v3" has a card-grid section with the right card styling
  - "profile-v2" has the right header with avatar and stats
  - "settings-v1" has the right bottom-nav

Claude assembles a new screen using sections from these templates,
inheriting their style properties.
```

This works because templates are SOM trees — subtrees are extractable and composable.

### Strategy C: Raw Reference Fallback

No usable templates at all. Fall back to the current behavior:

```
1. osiris_search_screens(screen_type: "staking", limit: 5)
2. osiris_get_screen_som(screen_id: best_match)
3. Build from raw SOM (un-refined)
4. Designer refines
5. Save as first Golden Template for "staking" → generation 1
```

The system bootstraps. Next time someone needs a staking screen, the template exists.

---

## 6. Evolving Designer Preferences

> *What if the designer's preferences change? Today they like 24px corner radius. Next month they prefer 16px. How do old templates get updated?*

### Passive Evolution: Supersession

Every time a designer refines a Rex output, the refined version supersedes the template it was built from. Templates naturally evolve because each refinement produces a new generation.

```
Template: payment-numpad-v1 (cornerRadius: 28)
  ↓ designer refines
Template: payment-numpad-v2 (cornerRadius: 24)
  ↓ designer refines again
Template: payment-numpad-v3 (cornerRadius: 16)
```

The retrieval algorithm prefers the latest generation. Old preferences fade naturally.

### Active Evolution: Style Propagation

When a designer refines multiple screens in the same session and the same style changes appear across them, the system can propagate those changes to untouched templates of the same brand.

```
Session: designer refines 3 screens, all changing cornerRadius from 24 → 16

System detects: consistent style delta across 3 templates for brand "revolut"

Proposed action: "Apply cornerRadius: 16 to 7 other Revolut templates?"
  → Designer confirms → batch update
  → Designer declines → only the 3 refined templates update
```

This is the ONE place where diffing is useful — not to extract abstract rules, but to detect "the designer just changed the same property the same way on 3 screens, should we apply it to the others?" It is a narrow, concrete, human-confirmed operation. Not an inference engine.

### Staleness Detection

Templates that have not been used or re-refined in a configurable period (default: 90 days) are flagged as potentially stale. They are not deleted — just deprioritized in retrieval scoring.

```typescript
// In the retrieval scoring function
const recencyScore = Math.max(0, 1 - (daysSinceLastRefinement / 180));
```

---

## 7. Memorization vs. Learning

> *Doesn't this just memorize screens instead of learning generalizable principles?*

Yes. And that is the point.

### Why Memorization is the Right Move

**Generalized rules are fragile.** The rule "use 24px corner radius on root frames" is already wrong — the data shows the designer uses 24 on roots but 12 on cards and 8 on pills. A rule engine needs to capture "24 for roots, 12 for cards, 8 for pills" — which is three rules. And if the designer uses 16 on modals, that is four rules. This does not scale, and it does not capture the designer's actual intent — it captures a lossy abstraction of their intent.

**Templates capture the full decision.** A refined template does not say "use 24px radius." It says "this specific frame, with this specific layout, these specific children, uses 24px radius." The radius is not a rule — it is a fact about this artifact. When you reuse the template, you reuse the fact.

**Generalization happens at query time, not storage time.** When Claude selects a template and adapts it, THAT is the generalization step. Claude decides "this payment template's style is appropriate for a transfer screen." The intelligence is in the matching and adaptation, not in the storage format.

### Where Rules Still Add Value

Template Evolution does not replace Rex Memory. It complements it. Memory stores things templates cannot:

| Concern | Template Evolution | Rex Memory |
|---|---|---|
| "Use 24px padding on all screens" | Implicit in every template | Explicit rule via `remember` |
| "We rejected tabbed navigation" | Not captured | `rejection` memory |
| "This file is iOS-only" | Not captured | `context` memory |
| "Never use red for success states" | Implicit (no template has red success) | Explicit `convention` memory |
| "The brand font is Plus Jakarta Sans" | In every template's text nodes | `convention` memory |

Templates handle the **positive case** (what TO build). Memory handles **negative cases** (what NOT to do) and **context** (why decisions were made).

---

## 8. Cold Start vs. Mature System

### Cold Start (0 templates)

The system behaves exactly as Rex does today:

```
1. Search Osiris for reference screens
2. Get SOM from best match
3. Build in Figma from raw SOM
4. Designer refines heavily (expect significant corrections)
5. extract_som → save as Golden Template (generation 1)
```

Every build session is a chance to capture a template. After 5-10 sessions covering the common screen types (home, payment, settings, onboarding, profile), the library has enough coverage that most new requests hit a template.

### Growth Phase (5-20 templates)

Common screen types are covered. Novel requests still fall back to raw Osiris references, but the system is bootstrapping new templates with each session. Designer refinements are smaller because the structural patterns are already established.

### Mature System (20+ templates per brand)

Most requests match a template directly. Designer refinements are minor — a color tweak, a text size adjustment. The templates have been through multiple generations and are highly polished.

```
Metric                    Cold Start    Growth    Mature
─────────────────────────────────────────────────────────
Template hit rate         0%            40-60%    80-95%
Avg refinement size       Major         Medium    Minor
Build quality (1-10)      4-5           6-7       8-9
Time to acceptable output 10-15 min     5-8 min   2-3 min
```

### Accelerating the Cold Start

Two strategies to bootstrap faster:

**1. Batch Import.** If the designer has existing Figma screens they are happy with, import them as generation-1 templates in bulk:

```
For each approved screen in the Figma file:
  1. extract_som(nodeId)
  2. Claude classifies: screenType, tags, mood, density
  3. Claude identifies content slots
  4. Save as Golden Template
```

A designer could seed 10-20 templates in a single session.

**2. Cross-Brand Seeding.** If brand A has no templates but brand B does, use brand B's templates with style overrides (colors, fonts). The structural patterns transfer; only the skin changes.

---

## 9. Implementation Plan

### New Osiris Endpoints

| Endpoint | Description |
|---|---|
| `osiris_save_golden_template` | Store a new Golden Template or new version |
| `osiris_find_template` | Search templates by brand, type, tags, mood |
| `osiris_get_template` | Retrieve a specific template by ID |
| `osiris_list_templates` | List all templates for a brand |
| `osiris_deprecate_template` | Mark a template as deprecated (not deleted) |

### Rex Changes

Minimal. Rex does not need to know about templates. From Rex's perspective, it receives a SOM and builds it — whether that SOM came from a raw Osiris reference or a Golden Template is irrelevant. The intelligence is in Claude's orchestration layer.

### Claude Orchestration (Prompt-Level)

The template workflow lives in Claude's system prompt, not in Rex or Osiris code:

```
When asked to build a screen:
1. Call osiris_find_template with the request parameters
2. If a template matches (score > 0.5):
   a. Use the template SOM as the build plan
   b. Populate content slots with requested content
   c. Add/remove sections as needed, copying style from existing sections
   d. Build using Rex tools
3. If no template matches:
   a. Fall back to osiris_search_screens + osiris_get_screen_som
   b. Build from raw reference
4. After designer refinement:
   a. Call extract_som on the refined frame
   b. Call osiris_save_golden_template with the refined SOM
```

### Data Model (MongoDB)

```javascript
// Collection: golden_templates
{
  _id: ObjectId,
  brandId: "revolut",
  version: 3,
  screenType: "payment",
  screenSubtype: "payment-numpad",
  tags: ["dark-mode", "numpad", "amount-entry"],
  mood: "premium",
  density: "normal",
  platform: "mobile",

  som: { /* full SOM v2 */ },
  referenceFrame: { width: 390, height: 844 },
  slots: [ /* ContentSlot[] */ ],
  structure: { sectionCount: 4, hasCTA: true, hasHero: false, ... },

  sourceScreenId: "scr_abc123",
  refinedFromNodeId: "123:456",
  refinedBy: { id: "user_1", name: "JP" },

  supersedes: ObjectId("..."),   // previous version
  generation: 3,
  usageCount: 12,
  lastUsedAt: ISODate("2026-03-15"),

  createdAt: ISODate("2026-02-01"),
  updatedAt: ISODate("2026-03-15")
}

// Indexes
{ brandId: 1, screenType: 1, generation: -1 }
{ brandId: 1, tags: 1 }
{ supersedes: 1 }
{ usageCount: -1 }
```

### Implementation Phases

| Phase | Work | Effort |
|---|---|---|
| P0 | `golden_templates` collection + `save_golden_template` endpoint | 1 day |
| P0 | `find_template` endpoint with scoring algorithm | 1 day |
| P0 | `get_template` and `list_templates` endpoints | 0.5 day |
| P1 | Content slot detection in `extract_som` (or Claude-side) | 1 day |
| P1 | Claude orchestration prompt for template-first workflow | 0.5 day |
| P2 | Style propagation detection (multi-screen refinement) | 2 days |
| P2 | Batch import flow for existing Figma screens | 1 day |
| P2 | `deprecate_template` + staleness scoring | 0.5 day |

**Total: ~7.5 days**

---

## 10. What This Does NOT Do

To keep scope honest:

- **Does not auto-detect refinements.** The designer (via Claude) explicitly saves refined screens as templates. There is no background diffing or passive observation.
- **Does not extract abstract rules.** No "increase padding by 20% on all screens." The template has the padding it has.
- **Does not handle responsive layout.** A mobile template produces a mobile screen. Tablet/desktop need their own templates.
- **Does not replace Osiris references.** Raw Osiris screens are still the fallback for novel screen types and cross-brand inspiration.
- **Does not version-control SOMs.** Supersession is a linked list, not git. You can see lineage but not diff between versions (intentionally — diffing is what we're avoiding).

---

## Summary

Template Evolution turns the refinement problem from an AI inference challenge into a data accumulation problem. Instead of building a rule engine that extracts "the designer prefers X" from noisy diffs, it stores refined screens as reusable templates and lets Claude's reasoning handle adaptation at query time.

The system gets better with every refinement, requires no rule maintenance, handles preference evolution through natural supersession, and degrades gracefully to the current Osiris-based workflow when no templates exist.

The designer's refined output is not training data for a rule engine. It is the artifact itself, ready to be reused.

---

## Round 2: Addressing Evaluator Challenges

### Challenge 1: Cross-Brand Template Reuse (The Revolut Problem)

> The Kraken template has brand-specific colors baked in. When building for Revolut, how does Claude know which values to keep (structural/taste) and which to replace (brand)?

This is a real weakness. The proposal as written treats the template as an opaque blob and trusts Claude to figure out what is brand-specific at adaptation time. That is not reliable enough.

**The fix: Brand-Semantic Tagging on Template Properties.**

When saving a Golden Template, the system should tag property values with their semantic origin. This does not require diffing -- it requires classification at save time.

```typescript
interface PropertyAnnotation {
  source: "brand" | "taste" | "structural";
}
```

The classification is straightforward for most cases:

- **Brand properties:** Fills that match the brand's color palette (available from Osiris brand data), font family, logo/icon references. These are detectable by cross-referencing against the brand's variable collection or design tokens.
- **Taste properties:** Corner radii, padding, gap, font sizes, font weights, layout modes. These are the designer's stylistic preferences and should transfer across brands.
- **Structural properties:** Auto-layout direction, child ordering, section presence/absence. These are the skeleton and always transfer.

When adapting a Kraken template for Revolut, Claude gets clear guidance: replace `source: "brand"` values with Revolut's brand tokens, keep `source: "taste"` values as-is, preserve `source: "structural"` decisions.

This is not a perfect classifier -- edge cases exist (is a dark background brand-specific or a taste choice?). But it reduces Claude's guesswork from "figure out everything" to "resolve the ambiguous 10%." And the ambiguous cases can be flagged for Claude to reason about explicitly: "This template uses a dark background (#1A1A2E). The source brand is Kraken (dark-mode). Revolut's brand supports both light and dark. The request says 'dark mode.' Keep the dark background."

The evaluator is right that I traded the diffing problem for a style-separation problem. But style-separation is a much easier problem than tree-diffing. Brand colors are enumerable. Font families are enumerable. The designer's taste preferences (padding, radii, spacing) are the values that are NOT in the brand's token set -- they are the residual, and the residual is what transfers.

### Challenge 2: Content Slot Ambiguity (fontSize as Slot vs. Style)

> How does the slot detector know that "$10.00" fontSize 56 is a style decision (keep it) vs. the text "$10.00" is content (replace it)?

The evaluator correctly identifies a conflation in my proposal. I was overloading "content slot" to mean "anything variable," but slots should be narrowly defined.

**Clarification: Slots are content-only. Style is never slotted.**

A content slot marks WHAT text/image appears, not HOW it is styled. The slot for an amount display is:

```typescript
{
  slotId: "amount-display",
  type: "text",
  defaultValue: "$10.00",    // This gets replaced
  // fontSize, fontWeight, fill are NOT part of the slot.
  // They belong to the node's style properties and are preserved.
}
```

When Claude populates a slot, it replaces the text content and nothing else. The font size of 56, the font weight of 700, the fill color -- those are baked into the template node and survive slot population. This is exactly how Figma's component text overrides work: you can change the string but the style stays.

The risk the evaluator raises -- marking fontSize as slottable -- only exists if the slot definition is too broad. By constraining slots to `{ text content, image source, list item data }` and never including style properties, the problem disappears.

For repeating groups (list items), the slot controls how many items and what data they contain. The style of each item (padding, radius, fill, typography) comes from the template's prototype item and is cloned, not slotted.

### Challenge 3: Template Sprawl and Retrieval Degradation

> After a year, you have 15 versions of "payment-numpad" that are nearly indistinguishable. Does retrieval reliably pick the best one?

This is a valid concern, but the proposal already contains the answer -- it just does not emphasize it enough.

**Template versioning is a linked list, not a flat collection.** The `supersedes` field creates an explicit chain: v1 -> v2 -> v3. Retrieval does not search across all 15 versions equally. It follows the supersession chain and picks the latest non-deprecated version.

The retrieval query is effectively:

```
WHERE brandId = "revolut"
  AND screenType = "payment"
  AND screenSubtype = "payment-numpad"
  AND supersededBy IS NULL           -- only the head of the chain
ORDER BY generation DESC, updatedAt DESC
LIMIT 3
```

Old versions are never returned unless the head is deprecated or the query explicitly requests lineage. This is not a search/ranking problem across 15 candidates -- it is a "find the latest" problem, which is O(1) with the right index.

**For near-duplicate detection:** if a designer refines a template and the resulting SOM is nearly identical to the current version (say, only one padding value changed by 2px), the system should still save it. These micro-refinements are the designer converging on their preference. The cost of storing a near-duplicate is negligible (one more document in MongoDB). The cost of NOT storing it is losing the designer's latest preference.

The real sprawl risk is not versions of the same template -- it is proliferation of SIMILAR templates with slightly different classifications. "payment-numpad" vs. "payment-numpad-dark" vs. "payment-amount-entry." This is a taxonomy problem, and the mitigation is to keep the classification vocabulary controlled: `screenType` values come from a fixed enum, `screenSubtype` is free-form but Claude is instructed to reuse existing subtypes when possible, and `tags` are additive metadata, not primary keys.

### Cross-Cutting Challenge: The Kraken Restructure

> Proposal 04 just saves the whole refined SOM. It captures everything. But it learns nothing transferable -- next time a different screen needs CTA isolation, the template for THIS screen does not help.

The evaluator frames this as a weakness. I want to push back -- partially.

**What transfers and what does not:**

The evaluator is right that "CTA isolation" as an abstract principle does not transfer from the Kraken payment template to, say, an onboarding template. If I save the Kraken payment screen with CTA in its own wrapper, and then build an onboarding screen from a different template, that onboarding template still has the CTA inline.

But there are two responses:

**1. Cross-template pattern transfer is a real gap, and Style Propagation (Section 6) is the mechanism that addresses it.** When the designer refines 3 screens in one session and isolates the CTA on all 3, the system detects the consistent structural change and proposes propagating it to other templates. This is not automatic rule extraction -- it is a human-confirmed batch update. The evaluator's challenge assumes each template is an island. With Style Propagation, they are not.

**2. "Learns nothing transferable" overstates the problem.** When Claude adapts a template for a new screen (Strategy A: Structural Analogy), it sees the CTA isolation in the template and carries it forward. The template does not encode the principle "isolate CTAs" explicitly, but Claude can observe the pattern and apply it when building from the template. The intelligence is in Claude's reasoning, not in the storage format. This is by design: templates provide the example, Claude provides the generalization.

**3. Honest acknowledgment:** For truly cross-screen-type structural patterns (like "always isolate CTAs regardless of screen type"), templates alone are insufficient. This is where the complementary Rex Memory system (Section 7) is load-bearing. The designer or Claude can `remember("Always put CTAs in their own section wrapper, not nested inside content sections")`. Templates handle the positive example; Memory handles the explicit principle. Neither alone covers everything.

### Cross-Cutting Challenge: The Contradiction Test

> Screen 1 (Kraken): cornerRadius 8 for pills. Screen 47 (fitness app): cornerRadius 20. How does the system know these are not contradictions?

**Templates do not have this problem.** This is the evaluator's own observation -- "Proposal 04 stores two different templates. No contradiction, but no learning transfer either."

I want to defend this more aggressively: the absence of contradiction IS the advantage.

Other proposals that extract rules face an impossible disambiguation: is `pill.cornerRadius = 8` a universal rule or a brand-scoped rule? They need brand-awareness machinery to resolve it.

Templates sidestep this entirely. The Kraken template has `cornerRadius: 8`. The fitness template has `cornerRadius: 20`. When building for Kraken, retrieve the Kraken template. When building for the fitness app, retrieve the fitness template. The brand-awareness is embedded in the retrieval query (`brandId = "kraken"` vs `brandId = "fitness"`), not in a rule resolution engine.

The evaluator says "no learning transfer." True for the cornerRadius value itself. But the structural and layout patterns DO transfer via cross-brand template matching (fallback level 3 in the retrieval chain). If the fitness app has no "payment" template but Kraken does, Claude uses Kraken's payment template and replaces brand-specific values (including the pill radius) with the fitness app's brand values. The structure transfers; the brand-specific values do not. That is correct behavior.

**The evaluator's deeper question -- "how does the system know that contradictions across brands are not real contradictions?" -- is answered by the data model itself.** Templates are scoped to a brand. Two different brands having different values is not a contradiction; it is two separate data points in two separate namespaces. No resolution logic needed.

### Summary of Changes Needed

| Challenge | Verdict | Action |
|---|---|---|
| Cross-brand reuse (brand vs. taste) | Real weakness | Add property-level `source` annotations (brand/taste/structural) at save time |
| Slot ambiguity (content vs. style) | Misunderstanding, but proposal was unclear | Clarify: slots are content-only, never style. Style is always preserved from the template node |
| Template sprawl | Minor concern | Emphasize supersession chain retrieval (only head is returned), controlled taxonomy |
| Kraken restructure (no transfer) | Partially valid | Style Propagation + Rex Memory cover the gap. Templates provide examples, Claude generalizes, Memory stores explicit principles |
| Contradiction test | Not a problem for this proposal | Brand-scoped storage eliminates contradictions by design |
