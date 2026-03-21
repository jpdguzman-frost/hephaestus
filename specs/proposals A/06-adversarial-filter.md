# Proposal 06: Adversarial Filter for Refinement Learning

## The Problem No One Else Is Solving

Every other proposal in this series tackles capture — how to detect what changed and store it. None of them ask the harder question: **should the system learn this at all?**

A system that naively promotes every observed change into a reusable principle will poison itself. After 50 screens, the principle store becomes a contradictory pile of one-off fixes, bug workarounds, and screen-specific tweaks that actively degrade output quality. The designer spends more time undoing "learned" behaviors than they saved.

This proposal defines the adversarial filter: the gate that sits between whatever capture system is chosen and the principle store. Its job is to **reject most changes** and only let through the ones that represent genuine, transferable design preferences.

## Core Insight

Not every change is a principle. Most changes fall into one of these categories:

| Category | Example | Should learn? |
|----------|---------|---------------|
| **Bug fix** | AI loaded wrong font, element misaligned | No |
| **Screen-specific** | This dashboard uses dark header | No |
| **Artifact cleanup** | Renamed "Frame 427" to "hero-section" | No |
| **Reverted experiment** | Tried rounded cards, went back to sharp | No |
| **Content-driven** | Longer headline forced smaller font size | No |
| **Platform convention** | Added iOS safe area inset | No |
| **Genuine preference** | Always uses 24px corner radius on root | **Yes** |
| **Systematic pattern** | Consistently uses SPACE_BETWEEN for vertical | **Yes** |
| **Brand enforcement** | Always darkens body text to near-black | **Yes** |

The filter's goal: confidently separate the bottom three rows from everything above them.

## Change Taxonomy

### Category 1: AI Error Corrections (NEVER learn)

Changes that fix mistakes the AI made during the build step. These should feed back into the builder, not the principle store.

**Detection heuristics:**
- The "before" value doesn't match what the reference screenshot shows. The AI built it wrong; the designer is correcting to match intent, not expressing preference.
- Change targets a single node and brings its properties closer to the reference SOM. Example: text was `fontSize: 14` but reference clearly shows `~16px` — designer changes to 16. That's a correction, not a preference for 16px text everywhere.
- Layer renaming from auto-generated names ("Frame 1", "Rectangle 5") to semantic names. This is build-quality cleanup.
- Fixing broken constraints or missing auto-layout that should have been set during build.

**Signal:** One-off, targets specific nodes, brings output closer to reference rather than diverging from it.

### Category 2: Screen-Specific Adjustments (NEVER learn)

Changes that make sense for this particular screen but should not generalize.

**Detection heuristics:**
- Change applies to a unique structural element (e.g., a numpad that only exists on a PIN entry screen).
- The property combination doesn't appear in the screen's archetype. Gray background with white cards is a specific layout strategy, not a universal preference — unless it shows up repeatedly.
- Content-driven sizing: a 3-line paragraph needs different spacing than a 1-line label. The change responds to content, not taste.

**Signal:** Change only makes sense given the specific content/structure of this screen.

### Category 3: Figma Artifact Cleanup (NEVER learn)

Organizational changes with no visual impact.

**Detection heuristics:**
- Layer renames where the visual output is identical.
- Reordering layers without z-index visual effect.
- Removing empty/invisible frames.
- Adding or removing layout constraints that don't change rendered output (e.g., setting constraints on a node already positioned correctly by auto-layout).

**Signal:** No pixel-level difference in a before/after screenshot.

### Category 4: Experimental and Reverted (NEVER learn)

Changes the designer makes and then undoes.

**Detection heuristics:**
- Property X changes from A → B, then later B → A (or close to A) within the same session.
- Designer creates a node, then deletes it.
- Multiple conflicting changes to the same property in rapid succession (< 2 minutes apart), indicating experimentation.

**Signal:** Non-monotonic change trajectory within a session.

### Category 5: Content and Platform Constraints (NEVER learn)

Changes forced by external factors, not preference.

**Detection heuristics:**
- Font size decrease paired with text content increase (longer string needs smaller font to fit).
- Spacing adjustments that exactly compensate for different content lengths.
- Platform-standard values: iOS status bar height (44pt/47pt), Android nav bar (48dp), safe area insets. These are constraints, not choices.
- Accessibility overrides mandated by guidelines (minimum tap target 44x44, contrast ratios).

**Signal:** Change can be explained by a constraint rather than a preference.

### Category 6: Genuine Principles (LEARN)

Changes that represent transferable design taste.

**Detection heuristics (all must pass):**
- **Recurrence**: The same directional change appears across 3+ screens. Not the exact same value — the same *direction*. "Increased padding" is a direction. "Set padding to 24" on one screen is a data point.
- **Consistency**: The change applies to the same semantic role (root frames, cards, body text) across screens, not random nodes.
- **Independence**: The change cannot be explained by content differences, reference matching, or platform constraints.
- **Stability**: The change persists — the designer doesn't revert it.

**Signal:** Repeated, role-consistent, content-independent, stable.

## Confidence Thresholds

A change graduates from "observed" to "principle candidate" to "active principle" through accumulation:

| Stage | Occurrences | Confidence | System behavior |
|-------|-------------|------------|-----------------|
| **Observed** | 1 | 0.0-0.2 | Stored but never applied. No influence on builds. |
| **Recurring** | 2 | 0.3-0.4 | Stored, flagged for review. Still no influence. |
| **Candidate** | 3+ | 0.5-0.7 | Queued for designer confirmation. Not yet applied. |
| **Confirmed** | 3+ with designer approval | 0.8-1.0 | Applied to future builds. |
| **Rejected** | Any count, designer rejects | 0.0 (frozen) | Never re-proposed. Tombstoned. |

The threshold of 3 is deliberate. Two occurrences could be coincidence. Three across different screen types is a pattern.

**Confidence scoring formula:**

```
base_confidence = min(occurrence_count / 5, 0.7)
role_consistency_bonus = +0.1 if same semantic role across all occurrences
direction_consistency_bonus = +0.1 if change direction is consistent (always increase, always decrease)
recency_bonus = +0.1 if most recent occurrence is within last 5 screens
max_unconfirmed = 0.7  (cannot exceed without designer approval)
```

## Walking Through the 10 Real Changes

### 1. Always added cornerRadius: 24 to root frame
**Verdict: PRINCIPLE (high confidence)**
- Recurrence: applied to root frame across multiple screens
- Role-consistent: always the root frame, not random elements
- Content-independent: corner radius has nothing to do with content
- Direction: always 0 → 24, never varies
- Filter passes this. After 3 occurrences, it becomes a candidate.

### 2. Increased top padding from 16 → 24-32
**Verdict: PRINCIPLE (medium confidence)**
- Recurrence: consistent direction (always increase)
- Role-consistent: root or top-level container
- Value varies (24 vs 32) — the principle is "increase top padding", not "set to exactly 24"
- Filter passes this but notes the value range. The principle would be encoded as "top padding >= 24" rather than an exact value.

### 3. Switched to SPACE_BETWEEN for main vertical axis
**Verdict: PRINCIPLE (high confidence)**
- Recurrence: structural pattern across screens
- Content-independent: layout strategy, not content-driven
- Role-consistent: main vertical container
- This is exactly the kind of systematic preference that should be learned.

### 4. Increased horizontal padding from 20-24 → 24-32
**Verdict: PRINCIPLE (medium confidence)**
- Same analysis as #2. Directional preference for more generous horizontal padding.
- The filter notes this pairs with #2 — the designer generally wants more breathing room than the AI provides. These could merge into a single principle: "increase all padding by ~30-50% from AI defaults."

### 5. Reduced corner radii on cards/pills (28→12, 18→8, 16→8)
**Verdict: PRINCIPLE (high confidence)**
- Recurrence: consistent direction (always decrease) across multiple element types
- Role-consistent: secondary elements (cards, pills, chips)
- Interesting contrast with #1 (root frame radius increases). The principle is nuanced: "large radius on root, smaller radii on inner elements." The filter should capture both and note the role distinction.

### 6. Darkened body text (#666666 → #070809), bumped font sizes (16→18)
**Verdict: PRINCIPLE (high confidence) + possible AI error correction**
- The color change (#666666 → near-black) is almost certainly a brand/readability preference. Consistent, content-independent, role-specific.
- The font size bump *could* be error correction (AI rendered at wrong size) or genuine preference. Need to check against the reference.
- **Filter action:** Split into two observations. Color change passes immediately. Font size change gets cross-checked against reference — if reference shows ~16px and designer changed to 18, it's a genuine preference for larger body text. If reference shows ~18px and AI built at 16, it's an error correction.

### 7. Separated CTAs from content into own sections
**Verdict: AMBIGUOUS — needs more data**
- This is a structural/compositional change, not a property change.
- Could be screen-specific (this screen's CTA needed visual separation) or a general principle (CTAs should always be in their own container).
- **Filter action:** Store as "observed" at confidence 0.2. If it recurs across 2 more screens, promote to candidate. The filter is skeptical of structural changes because they're more likely to be content-driven.

### 8. Removed unnecessary wrapper frames
**Verdict: AI ERROR CORRECTION (do not learn as principle)**
- This is the AI over-nesting its output. The fix is "build cleaner output," not "always remove wrappers."
- **Filter action:** Route this back to the builder as a quality signal, not to the principle store. Tag it as `category: ai_error_correction`.
- However: if the designer *consistently* flattens hierarchy even when the AI's nesting was defensible, that could become a principle ("prefer flat hierarchy"). The filter watches for this.

### 9. Tinted numpad keys with brand color
**Verdict: SCREEN-SPECIFIC (do not learn)**
- Numpad is unique to PIN/dialer screens. This change cannot generalize.
- **Filter action:** Discard from principle tracking. However, if the broader pattern is "tint interactive elements with brand color," the filter watches for that generalization. The numpad is one data point; if buttons and toggles also get tinted across other screens, the principle is "brand-color interactive elements," not "brand-color numpad keys."

### 10. Used gray bg with white cards instead of flat white
**Verdict: AMBIGUOUS — screen-specific or principle?**
- Could be a universal preference (the designer always wants depth via bg/card contrast) or specific to card-heavy layouts.
- **Filter action:** Store at confidence 0.2. Watch for recurrence. If 3+ screens all get gray bg + white cards, it's a layout principle. If it only happens on dense list screens, it's a screen-type principle (scoped to that archetype, not universal).

### Summary scorecard

| # | Change | Category | Filter decision |
|---|--------|----------|-----------------|
| 1 | Root corner radius 24 | Principle | Pass (after 3 occurrences) |
| 2 | Increase top padding | Principle | Pass (directional) |
| 3 | SPACE_BETWEEN vertical | Principle | Pass |
| 4 | Increase horizontal padding | Principle | Pass (directional, merge with #2) |
| 5 | Reduce inner corner radii | Principle | Pass (note role distinction from #1) |
| 6 | Darken body text, bump font | Principle + check | Pass color; check font against ref |
| 7 | Separate CTAs | Ambiguous | Hold — need 2 more occurrences |
| 8 | Remove wrapper frames | AI error correction | Route to builder, not principle store |
| 9 | Tint numpad keys | Screen-specific | Discard; watch for generalization |
| 10 | Gray bg + white cards | Ambiguous | Hold — need 2 more occurrences |

**Result: 5 pass, 2 held, 1 routed elsewhere, 2 discarded.** The filter rejects or defers 50% of changes. This is expected and healthy.

## False Negative Recovery: What If We Filter Out a Real Principle?

This is the most dangerous failure mode. The system ignores a genuine preference, and the designer has to keep making the same correction forever.

### Detection

The system tracks *all* changes, even filtered ones. A background job runs periodically:

1. **Recurrence scan:** For every change marked `category: screen_specific` or `category: ai_error_correction`, check if the same directional change has now appeared 3+ times. If so, reclassify as `candidate` regardless of original categorization.

2. **Frustration signal:** If the designer makes the same correction on 3 consecutive screens, escalate immediately to `candidate` even if the filter thinks it's noise. Repetitive manual correction is the strongest signal of a missed principle.

3. **Explicit override:** The designer can always say "Rex, remember this" or use the memory system to explicitly store a preference. Explicit instructions bypass the filter entirely — they enter the principle store at confidence 0.8.

### Design principle: conservative but recoverable

The filter is deliberately conservative. It will miss some real principles early on. But every filtered change is still tracked, so the system self-corrects over time. The cost of a false negative is "the designer makes the same change 3 times before the system catches on." The cost of a false positive is "the system applies a wrong principle to every future screen until someone notices." False positives are far more expensive.

## Filter Integration with Capture Systems

The filter is **capture-agnostic**. It works the same regardless of which capture mechanism is chosen:

```
[Screen Built] → [Designer Refines] → [Capture System] → [Adversarial Filter] → [Principle Store]
                                            │                      │
                                       (any approach)         (this proposal)
                                       - tree diff
                                       - screenshot diff
                                       - property snapshot
                                       - content fingerprint
```

### Interface contract

The filter expects a **normalized change record** from the capture system:

```typescript
interface CapturedChange {
  // What changed
  nodeRole: string;          // Semantic role: "root-frame", "card", "body-text", "cta-button"
  property: string;          // "cornerRadius", "paddingTop", "fills[0].color", etc.
  valueBefore: any;
  valueAfter: any;

  // Context
  screenId: string;
  screenArchetype?: string;  // "dashboard", "settings", "onboarding", etc.
  referenceScreenId?: string;
  sessionId: string;
  timestamp: number;

  // Optional enrichment from capture system
  pixelDifference?: number;  // 0 = no visual change
  referenceMatch?: number;   // How close the "before" was to reference (0-1)
}
```

The filter returns:

```typescript
interface FilterResult {
  change: CapturedChange;
  category: "principle" | "ai_error" | "screen_specific" | "artifact" | "reverted" | "content_driven" | "platform_convention";
  confidence: number;         // 0.0-1.0
  reasoning: string;          // Human-readable explanation
  action: "promote" | "hold" | "discard" | "route_to_builder";
  existingPrincipleId?: string; // If this matches/reinforces an existing principle
}
```

### Where the filter runs

The filter runs on the MCP server, not the plugin. It has access to:
- The Osiris screen store (for reference comparison)
- The principle store (to check for existing matches)
- Session history (to detect reverts and experimentation)
- The memory system (for explicit designer preferences that override filtering)

## Principle Candidate Review Flow

When a change reaches `candidate` status (3+ occurrences, confidence >= 0.5), the system presents it for designer review.

### Passive review (default)

Next time Rex builds a screen and the candidate principle is relevant, Rex mentions it:

> "I noticed you've increased horizontal padding on the last 3 screens. Want me to start using 24-32px horizontal padding by default?"

The designer can:
- **Confirm**: "Yes, always use at least 24px horizontal padding." → Principle promoted to confidence 0.9.
- **Reject**: "No, that was just for those screens." → Principle tombstoned, never re-proposed.
- **Scope**: "Yes, but only for mobile screens." → Principle promoted with scope constraint.
- **Ignore**: Designer doesn't respond. Principle stays at `candidate`. Re-proposed after 2 more occurrences.

### Active review (on request)

Designer asks: "Rex, what patterns have you noticed?" Rex presents all candidates:

```
I've observed these recurring patterns in your refinements:

1. Root frame corner radius → 24px (seen 5 times, confidence: 0.7)
2. Increase padding 30-50% from defaults (seen 4 times, confidence: 0.6)
3. Body text near-black, not gray (seen 3 times, confidence: 0.5)
4. SPACE_BETWEEN for main vertical layout (seen 3 times, confidence: 0.5)

Confirm, reject, or scope each one?
```

### Review through existing memory system

Confirmed principles are stored as memories via the existing Rex Memory system (see MEMORY.md):

```typescript
{
  scope: "team",            // or "user" for personal preferences
  category: "convention",
  content: "Root frames should have cornerRadius: 24",
  tags: ["spacing", "corner-radius", "root-frame"],
  source: "inferred",       // upgraded from inferred to explicit on confirmation
  confidence: 0.9
}
```

This reuses the existing infrastructure. No new storage system needed.

## Cold Start vs. Mature Behavior

### Cold start (screens 1-5)

Everything looks like noise because there's no baseline for comparison.

**Strategy: observe everything, apply nothing.**

- Every change is recorded as `observed` at confidence 0.1-0.2.
- No changes are promoted or applied.
- The filter is in "data collection" mode — it categorizes but does not act.
- The system tells the designer: "I'm watching your refinements. After a few more screens, I'll start noticing patterns."

### Early pattern detection (screens 5-15)

Some changes start recurring. The filter can begin categorizing with moderate confidence.

**Strategy: propose sparingly, require confirmation.**

- Changes that have recurred 3+ times are promoted to `candidate`.
- The system proposes 1-2 candidates max per screen build (avoid overwhelming the designer).
- Confirmed principles start influencing builds.
- The filter is still conservative — it would rather miss a principle than promote a false one.

### Mature operation (screens 15+)

The principle store has 5-15 confirmed principles. The filter has enough data to categorize accurately.

**Strategy: filter confidently, surface outliers.**

- Most changes are quickly categorized as reinforcing existing principles or clearly noise.
- New candidates are rare — the designer's core preferences are already captured.
- The filter focuses on **drift detection**: is the designer's taste evolving? Are they starting to deviate from previously confirmed principles?
- If a confirmed principle stops being reinforced (designer no longer makes that change because Rex already does it), that's success, not decay.

### Drift detection

A confirmed principle should be re-evaluated if:
- The designer actively reverses it on 2+ screens (changes padding *back down* after Rex applied the "increase padding" principle).
- 10+ screens pass without the principle being relevant (it may be obsolete).
- The designer explicitly contradicts it in conversation.

On drift detection, the principle's confidence decays and eventually re-enters `candidate` status for re-confirmation.

## Implementation Sketch

### Phase 1: Classification engine (no learning, just labeling)

Build the categorization logic. For every captured change, output the category and reasoning. Log everything, apply nothing. This can ship immediately as a diagnostic tool.

```typescript
class AdversarialFilter {
  categorize(change: CapturedChange, context: FilterContext): FilterResult {
    // Run heuristics in priority order (first match wins)
    if (this.isRevert(change, context)) return discard("reverted");
    if (this.isArtifactCleanup(change))  return discard("artifact");
    if (this.isAIErrorCorrection(change, context)) return routeToBuilder("ai_error");
    if (this.isPlatformConvention(change)) return discard("platform_convention");
    if (this.isContentDriven(change, context)) return discard("content_driven");

    // Not obviously noise — check for principle patterns
    const existing = this.findMatchingPrinciple(change);
    if (existing) return reinforce(existing);

    // New observation
    return hold("potential_principle", this.calculateConfidence(change, context));
  }
}
```

### Phase 2: Accumulation and candidate promotion

Add the occurrence counter and confidence scoring. When candidates hit the threshold, queue them for review.

### Phase 3: Review flow integration

Wire up the passive review (mention during builds) and active review ("what patterns have you noticed?") flows via Rex's chat interface.

### Phase 4: Principle application

Confirmed principles modify Rex's build behavior. This is the scary part — apply conservatively, always allow override, and monitor for regressions.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Filter is too aggressive, blocks real principles | Designer keeps making same correction | Frustration signal auto-escalates after 3 consecutive corrections |
| Filter is too permissive, promotes noise | Bad principles degrade builds | Require explicit designer confirmation before any principle influences builds |
| Principle store contradictions | Conflicting principles cancel out | Detect contradictions at promotion time; present both to designer for resolution |
| Designer doesn't engage with review flow | Candidates pile up, never confirmed | Cap at 20 unreviewed candidates; oldest auto-expire after 30 days |
| Drift goes undetected | Stale principles persist | Confidence decay on unused principles; re-confirmation after 30 screens |

## Key Takeaway

The hardest part of refinement learning is not capturing changes — it's knowing which ones matter. A system without a filter will learn enthusiastically and wrong. This proposal gives the system the ability to say "I see what you did, but I'm not going to generalize from it" — which is the single most important capability for a learning system that touches real design work.

Build the filter first. Choose a capture system second. The filter is the harder problem and the higher-leverage investment.

## Round 2: Addressing Evaluator Challenges

### Challenge 1: The Confirmation vs. Zero-Friction Contradiction

> "Your filter requires designer confirmation before any principle is applied (confidence caps at 0.7 without approval). But Proposal 05's entire philosophy is 'the designer should never notice the system is learning.' These two proposals are directly contradictory."

This is a real tension, and the evaluator is right to surface it. But the framing of "which one wins" is a false binary.

The resolution is temporal separation. The filter and the workflow operate at different timescales:

- **During a session** (Proposal 05's domain): zero friction. The system observes silently. No popups, no confirmations, no questions. The designer works uninterrupted.
- **Between sessions** (the filter's domain): the filter processes accumulated observations in the background. When a candidate reaches threshold, it surfaces during the *next build*, not during the current refinement session.

The "passive review" flow described in this proposal already handles this correctly. The system says "I noticed you've increased horizontal padding on the last 3 screens. Want me to start using 24-32px by default?" at the *start* of a new build, before the designer is in flow. This is not a confirmation dialog interrupting work. It is a brief question at a natural handoff point — analogous to a design tool asking "use your recent settings?" when you open a new document.

That said, the evaluator exposes a legitimate design question about the confidence cap. The 0.7 cap without approval may be too conservative for patterns with very high recurrence (say, 8+ occurrences all in the same direction). A revised approach: after 8+ consistent occurrences without contradiction, auto-promote to 0.8 and apply silently, but flag it in the next "what patterns have you noticed?" review. This gives the system a path to learning without explicit confirmation while still requiring overwhelming evidence.

The zero-friction principle governs the *interaction model*. The filter governs the *epistemic rigor*. They are complementary, not contradictory.

### Challenge 2: Wrapper Removal — AI Error or Genuine Principle?

> "Your taxonomy classifies 'removed unnecessary wrapper frames' as AI Error Correction (do not learn). But the designer did this consistently across multiple screens — it is a RECURRING, ROLE-CONSISTENT, CONTENT-INDEPENDENT, STABLE change. By your own Category 6 criteria, it should be a Genuine Principle."

The evaluator is correct, and this exposes a real flaw in the original classification. I was too hasty in assigning Category 1 (AI Error Correction) to wrapper removal.

The right answer depends on WHY the wrappers exist:

**Case A: The reference SOMs from Osiris contain the wrappers.** The AI faithfully reproduced what Osiris provided, but the designer flattens them. This is NOT an AI error — the AI built what it was told to build. The designer is expressing a preference for flatter hierarchy than Osiris captures. This IS a principle: "prefer flat hierarchy." The filter should learn it.

**Case B: The AI is adding wrappers that aren't in the reference.** The AI is over-nesting on its own. This IS an AI error, and the fix belongs in the builder, not the principle store.

The original proposal assumed Case B without checking. The corrected filter logic should be:

1. Compare the wrapper structure against the reference SOM.
2. If the reference has the wrapper and the designer removes it → **genuine principle** ("flatten hierarchy"). Route to principle store.
3. If the reference does not have the wrapper and the AI added it → **AI error**. Route to builder.

The evaluator's deeper point is also valid: "who ensures the builder actually gets better?" If the builder cannot stop over-nesting because Osiris references are inherently over-nested, then the designer's flattening preference must be captured as a principle regardless of origin. The filter should track how many times wrapper-removal gets routed to the builder. If the builder doesn't improve after N occurrences, the filter should reclassify the pattern as a principle — the system is acknowledging that the structural depth in references does not match the designer's taste, and it should adapt.

This is exactly the kind of false-negative recovery the "frustration signal" mechanism was designed for, but the original proposal failed to wire it up for this specific case. Consider it wired.

### Challenge 3: Cross-Role Generalization — "Tint Interactive Elements"

> "Your recurrence scan groups by `(role, property, direction)` — but 'numpad-key fills' and 'toggle fills' are different role-property pairs. What mechanism actually detects the cross-role generalization 'tint interactive elements with brand color'? Show me the code path, not the aspiration."

The evaluator is right: the original proposal describes the aspiration without the mechanism. The recurrence scan as specified cannot detect cross-role generalizations because it groups by exact `(role, property)` pairs. Let me define the actual mechanism.

Cross-role generalization requires a second pass over the observation store that groups by *property + value pattern* rather than *role + property*:

```typescript
interface ValuePatternGroup {
  property: string;
  valuePattern: string;       // e.g., "set to brand color", "increased by 20-50%"
  roles: Set<string>;         // all roles where this pattern appeared
  occurrences: number;
  roleCategory?: string;      // inferred common trait: "interactive", "container", etc.
}

function detectCrossRolePatterns(observations: CapturedChange[]): ValuePatternGroup[] {
  // Step 1: Group by (property, valueAfter) where valueAfter matches a known token
  // e.g., if valueAfter === brand color for fills across multiple roles
  const byPropertyValue = groupBy(observations, o => `${o.property}:${classifyValue(o)}`);

  // Step 2: For each group with 3+ distinct roles, check if those roles share a trait
  return Object.entries(byPropertyValue)
    .filter(([_, group]) => distinctRoles(group) >= 3)
    .map(([key, group]) => ({
      property: group[0].property,
      valuePattern: classifyValue(group[0]),
      roles: new Set(group.map(g => g.nodeRole)),
      occurrences: group.length,
      roleCategory: inferRoleCategory(group.map(g => g.nodeRole))
      // inferRoleCategory maps ["numpad-key", "toggle", "button"] → "interactive"
      // using a lightweight role taxonomy: interactive, container, content, decorative
    }));
}
```

The key insight the original proposal missed: `classifyValue` must map concrete values to semantic patterns. The raw value `#7B61FF` means nothing. But if the system knows the brand's primary color is `#7B61FF` (from the Osiris brand data or variable collections), it can classify the value as "brand-primary." Now the grouping becomes `fills:brand-primary` across roles `[numpad-key, toggle, button]`, and `inferRoleCategory` recognizes these are all interactive elements.

This requires two pieces of context the filter does not currently have:
1. **A role taxonomy** that maps specific roles to categories (interactive, container, content, decorative). This is a small, manually-maintained lookup — maybe 30-40 role-to-category mappings.
2. **Brand token awareness** so the filter can recognize when a raw color/value corresponds to a brand token rather than an arbitrary value.

Without these, the evaluator is correct that cross-role generalization is an aspiration with no code path. With them, the mechanism is concrete and implementable. The cost is maintaining the role taxonomy and wiring in brand token resolution, both of which are tractable.

### Cross-Cutting Challenge: The Kraken Restructure

> "Proposal 06 evaluates each change individually and might classify some as 'principle' and others as 'screen-specific' — splitting what was one unified design intention into multiple categories."

This is a legitimate weakness. The filter processes `CapturedChange` records independently. Five changes that constitute one coherent design decision ("isolate the CTA with generous spacing") arrive as five separate records and get evaluated in isolation.

The fix is a **session clustering** step that runs before individual classification:

Changes made within the same session, on related nodes (parent-child or siblings), within a short time window (< 2 minutes), should be grouped into a **change cluster** before the filter evaluates them. The cluster gets a unified evaluation:

```typescript
interface ChangeCluster {
  changes: CapturedChange[];
  timeSpan: number;           // seconds between first and last change
  structuralRelationship: "parent-child" | "siblings" | "ancestor-descendant" | "unrelated";
  possibleIntent?: string;    // inferred from the combination of changes
}
```

For the Kraken case, the five changes (CTA reparented, spacing zeroed, frame renamed, wrapper removed, layout mode changed) cluster together because they happen within 90 seconds on structurally related nodes. The filter evaluates the cluster as a whole:

- Does this *combination* recur? If another screen also gets "CTA separated + wrapper flattened + SPACE_BETWEEN," the cluster is a principle about CTA isolation strategy, not five independent property preferences.
- If only parts of the cluster recur (SPACE_BETWEEN shows up everywhere but CTA separation only on payment screens), the filter can split the cluster post-hoc — but the initial evaluation preserves the designer's unified intent.

This is a meaningful addition to the proposal. The original design's per-change evaluation model is insufficient for how designers actually work, and the evaluator correctly identified this gap.

### Cross-Cutting Challenge: The Contradiction Test

> "How does the system know that two contradictory values from different brands are NOT contradictions, while two contradictory values from the SAME brand ARE contradictions?"

The evaluator is correct that brand-awareness is load-bearing. The original proposal does not address this, and it must.

The filter already receives `screenId` and `sessionId` in the `CapturedChange` record. The missing piece is `brandId` (or `projectId` as a proxy). The fix:

1. **Extend `CapturedChange`** with `brandId: string` (derived from the Figma file or project, or from an explicit brand tag in Osiris).

2. **Scope the recurrence scan by brand.** When counting occurrences for confidence scoring, group by `(brandId, role, property, direction)` first. `cornerRadius: 8` on Kraken screens and `cornerRadius: 20` on fitness app screens are two separate recurrence tracks, not contradictions.

3. **Cross-brand principles exist but require higher evidence.** If the *direction* is the same across brands (e.g., "always reduce inner corner radii from AI defaults" — Kraken reduces to 8, fitness reduces to 12, both reducing from higher AI-generated values), the filter can extract a directional principle scoped as universal: "reduce inner element corner radii." The exact values remain brand-scoped.

4. **Same-brand contradictions are real contradictions.** If the designer uses `cornerRadius: 8` on Kraken screen 1 and `cornerRadius: 16` on Kraken screen 5, the filter flags this as ambiguous within the same brand and holds at low confidence until more data resolves the pattern (maybe it is role-dependent: pills get 8, cards get 16).

The confidence formula should be amended:

```
brand_consistency_bonus = +0.15 if all occurrences are within the same brand
cross_brand_penalty = -0.2 if contradictory values appear across brands (the direction must be consistent for cross-brand principles)
```

Brand-awareness is not optional. It was missing from the original proposal and must be added. The data model change is small (one field), but the recurrence logic change is significant — every grouping operation must become brand-aware by default, with cross-brand generalization as an explicit second-pass analysis rather than the default.
