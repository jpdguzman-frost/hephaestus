# Proposal 05: Designer-Workflow-First Refinement Learning

**Date:** 2026-03-21
**Status:** Proposal
**Author:** Claude (Opus 4.6)

---

## The Problem Everyone Else Is Solving vs. The Actual Problem

Other approaches to refinement learning start with: "How do we diff two SOMs?" or "How do we match nodes across before/after snapshots?" These are engineering questions. They produce engineering answers --- tree-diff algorithms, heuristic matchers, confidence thresholds.

But the real problem is not technical. The real problem is:

**A designer refines screens directly in Figma, works fast, doesn't want to explain changes, and expects the system to get smarter without adding friction to their workflow.**

The designer's natural loop is: reference -> Rex builds -> designer refines in Figma -> says "done" -> expects the system to learn. Every piece of friction you add to that loop (explicit capture commands, confirmation dialogs, "what did you change?" questions) breaks it. The designer will stop using it.

So the question is not "how do we diff" but "how do we learn without the designer noticing we're learning?"

---

## 1. The Designer's Actual Workflow (Not Idealized)

Observed across 5 refinement sessions (kraken_01 through kraken_05):

```
1. Designer gives Rex a reference screen and says "build this"
2. Rex builds the screen from the SOM
3. Designer looks at the result for 2-5 seconds
4. Designer starts editing directly in Figma:
   - Adjusts spacing (padding, gaps)
   - Changes corner radii
   - Tweaks colors
   - Restructures frames (removes wrappers, regroups content)
   - Adjusts typography (size, weight, color)
5. Designer may ask Rex for help with tedious structural work:
   "clean up frames, spacing, and sizes"
6. Designer continues refining
7. Designer says "done" or moves to the next screen
8. Designer expects the NEXT screen to not have the same problems
```

Key behavioral observations:

- **Refinement is fast.** The designer makes 10-30 changes in 2-5 minutes. They do not pause between changes.
- **Refinement is nonlinear.** They might fix spacing, then go back and change a color, then restructure, then fix the spacing again.
- **"Done" is implicit.** The designer moves on. They don't announce completion. Sometimes they say "done," sometimes they just start talking about the next screen.
- **Patterns repeat.** Across 5 screens, the same categories of changes appeared: padding increases, corner radius reductions, text darkening, layout mode changes. These are not one-off corrections --- they are preferences.
- **The designer does NOT want to be asked** "What did you change?" or "Should I save this pattern?" They expect the system to figure it out.

---

## 2. Where the System Inserts Itself

The system has exactly three natural insertion points where it can act without creating friction:

### Insertion Point A: The Build (before refinement)

When Rex builds a screen from a SOM, it applies whatever it has learned so far. The designer sees a better first draft. This is where learning **pays off** --- the designer never sees the system learning, they just see better results.

### Insertion Point B: The Quiet Snapshot (after refinement)

When the designer stops editing and moves on, the system silently captures the final state. No dialog, no confirmation, no "should I save this?" The designer said "done" (or just moved on), and the system takes a snapshot.

### Insertion Point C: The One Smart Question (optional, rare)

When the system detects a refinement that contradicts a previously learned pattern, it asks ONE question. Not "what did you change?" but something specific and actionable: "You usually round cards to 12px, but this one is 24px --- is this screen special, or should I update the default?" This happens at most once per session, and only when genuine ambiguity exists.

---

## 3. Architecture: The Passive Observer

### 3.1 Change Stream from the Plugin

The Figma plugin already has the infrastructure for this. `figma.on("documentchange")` fires on every edit. The plugin does not need to diff anything --- it just records a lightweight change event.

```typescript
// New addition to plugin/code.ts
figma.on("documentchange", (event: DocumentChangeEvent) => {
  if (!observing) return;

  for (const change of event.documentChanges) {
    if (change.type === "PROPERTY_CHANGE") {
      changeBuffer.push({
        nodeId: change.id,
        properties: change.properties, // ["paddingTop", "cornerRadius", etc.]
        timestamp: Date.now(),
      });
    }
    if (change.type === "CREATE" || change.type === "DELETE") {
      structuralChanges.push({
        type: change.type,
        nodeId: change.id,
        timestamp: Date.now(),
      });
    }
  }
});
```

This is cheap. No serialization, no tree walking, no diffing. Just recording which properties changed on which nodes. The buffer is flushed to the relay server every 2 seconds (piggybacks on existing polling, not a new connection).

### 3.2 Observation Window

The system does not try to observe everything forever. It observes a specific frame that Rex built, during a bounded time window.

```
observation = {
  frameId: "23:2563",           // The frame Rex built
  startedAt: <timestamp>,       // When Rex finished building
  changes: [],                  // Property changes within this frame
  structuralChanges: [],        // Create/delete within this frame
  status: "observing"           // → "capturing" → "captured"
}
```

**Start observing:** When Rex completes a build, the plugin starts recording changes to that frame's subtree.

**Stop observing:** Any of these triggers:
1. The designer says "done" (explicit)
2. The designer starts a new Rex build (implicit --- they moved on)
3. No changes to the observed frame for 60 seconds (idle timeout)
4. The designer switches to a different page

When observation stops, the system transitions to capture.

### 3.3 The Capture: Property-Level, Not Tree-Level

This is where this proposal fundamentally diverges from tree-diffing approaches.

**We do not diff trees. We diff properties on matched nodes.**

The plugin already knows every node Rex created --- it created them. Each node has an ID. When the designer edits a node Rex created, we know exactly which node changed and which properties changed because `documentchange` told us.

The capture produces a **refinement record**, not a SOM diff:

```typescript
interface RefinementRecord {
  sessionId: string;
  screenType: string;              // "home", "payment", "onboarding"
  brand: string;                   // "kraken", "revolut", etc.
  frameId: string;
  timestamp: number;

  propertyChanges: PropertyChange[];
  structuralChanges: StructuralChange[];
  duration: number;                // How long the designer spent refining
}

interface PropertyChange {
  nodeId: string;
  nodeName: string;
  nodeRole: string;                // From SOM role assignment
  property: string;                // "paddingTop", "cornerRadius", "fills", etc.
  before: unknown;                 // Value Rex set
  after: unknown;                  // Value designer changed to
  isLayoutProperty: boolean;
  isColorProperty: boolean;
  isTypographyProperty: boolean;
}

interface StructuralChange {
  type: "reparent" | "delete" | "create" | "reorder";
  nodeId: string;
  nodeName: string;
  context: string;                 // e.g., "removed wrapper frame around CTA section"
}
```

**Why this is better than tree-diffing:**
- No node-matching problem. We already know the IDs.
- No "what changed?" ambiguity. The change events tell us exactly which properties.
- No false positives from Figma-internal changes (selection, viewport, undo/redo).
- Property-level changes are directly actionable ("increase padding by 8px") vs. tree-level diffs ("subtree structure changed somehow").

### 3.4 Pattern Extraction

Refinement records accumulate. After 3+ screens, the system runs pattern extraction --- not after every refinement, but periodically (end of session, or when the designer starts a new build).

Pattern extraction groups property changes by role and property:

```typescript
interface LearnedPattern {
  id: string;
  scope: "universal" | "brand" | "screenType";
  confidence: number;              // 0.0-1.0, increases with repetition
  observedCount: number;           // How many times this pattern appeared

  // What it applies to
  targetRole: string;              // "screen", "card", "hero", "cta", etc.
  targetProperty: string;          // "cornerRadius", "paddingTop", etc.

  // The pattern itself
  pattern: AdjustmentPattern;

  // Provenance
  firstSeen: string;               // Session ID
  lastSeen: string;
  examples: string[];              // Up to 3 session IDs as evidence
}

type AdjustmentPattern =
  | { type: "override"; value: unknown }           // Always set to this value
  | { type: "increase"; delta: number }            // Always increase by ~N
  | { type: "decrease"; delta: number }            // Always decrease by ~N
  | { type: "clamp"; min: number; max: number }    // Keep within range
  | { type: "replace"; from: unknown; to: unknown } // When you see X, use Y
```

From the 5 kraken sessions, pattern extraction would produce:

| # | Target Role | Property | Pattern | Confidence |
|---|-------------|----------|---------|------------|
| 1 | `screen` | `cornerRadius` | override: 24 | 1.0 (5/5) |
| 2 | `screen` | `paddingTop` | clamp: {min: 24, max: 32} | 1.0 (5/5) |
| 3 | `screen` | `primaryAxisAlignItems` | override: "SPACE_BETWEEN" | 0.8 (4/5) |
| 4 | `screen` | `paddingLeft` / `paddingRight` | clamp: {min: 24, max: 32} | 1.0 (5/5) |
| 5 | `card`, `pill` | `cornerRadius` | decrease: varies | 0.8 (4/5) |
| 6 | `label` (body text) | `fills` | replace: {from: "#666666", to: "#070809"} | 0.8 (4/5) |
| 7 | `label` (body text) | `fontSize` | increase: 2 | 0.6 (3/5) |
| 8 | `cta` | structural | reparent: separate from content | 0.6 (3/5) |
| 9 | screen bg | `fills` | replace: {from: "#FFFFFF", to: "#F5F5F5"} | 0.6 (3/5) |

Confidence increases with repetition. A pattern seen in 1 session has confidence 0.3 (not applied automatically). Seen in 3+ sessions: 0.7+ (applied automatically). Seen in 5+ sessions: 0.9+ (strong default, only overridden explicitly).

### 3.5 Applying Patterns at Build Time

When Rex builds a new screen, it checks for applicable patterns:

```
1. Get the screen's brand and screenType
2. Query patterns: universal > brand-specific > screenType-specific
3. Filter by confidence >= 0.6
4. For each node Rex is about to create:
   a. Get the node's assigned role
   b. Look up patterns matching (role, property)
   c. Apply the pattern to adjust the value
5. Build the node with adjusted values
```

The designer sees a better first draft. They don't know why. They just refine less.

---

## 4. The Designer's Experience

### Session 1 (Cold Start)

```
Designer: "Build the kraken home screen from this reference"
Rex: [builds screen from SOM]
Designer: [spends 4 minutes refining in Figma]
  - Adds cornerRadius 24 to root
  - Bumps top padding to 28
  - Changes body text to #070809
  - Removes a wrapper frame
  - etc.
Designer: "Done. Next screen."
Rex: [silently captures refinement record]
         [nothing visible to the designer]
```

**What the designer noticed:** Nothing different. Rex built, they refined, they moved on.

### Session 3 (Warming Up)

```
Designer: "Build the kraken payment screen from this reference"
Rex: [builds screen, but this time:]
  - Root frame already has cornerRadius: 24
  - Top padding is 26 (learned range: 24-32)
  - Body text is #070809
  - Layout uses SPACE_BETWEEN
Designer: [spends 2 minutes refining — fewer changes needed]
  - Adjusts a card radius
  - Moves a CTA
Designer: "That was better. Next."
```

**What the designer noticed:** "Hmm, I didn't have to fix as much." They may not even consciously notice. They just spent less time refining.

### Session 5 (Mature)

```
Designer: "Build the kraken settings screen"
Rex: [builds screen with all learned patterns applied]
Designer: [spends 45 seconds making 2-3 minor tweaks]
Designer: "Good. Let's move on."
```

**What the designer noticed:** It just works better now. The system got smarter. They never had to teach it --- it taught itself.

### The ONE Smart Question (Rare)

```
Designer: [sets cornerRadius to 0 on the root frame of a new screen]
Rex: (after the designer pauses for 10+ seconds)
     "You usually set root frame radius to 24. Is this screen different,
      or should I stop doing that?"
Designer: "This one's different, it's a full-bleed screen."
Rex: [stores exception: screenType="full-bleed" → cornerRadius: 0]
     [does not change the universal pattern]
```

This question is asked because:
- The change contradicts a high-confidence pattern (0.9+)
- The designer has paused (not mid-flow)
- The system has not asked a question in this session yet

If the designer says "stop doing that," the universal pattern is removed. If they say "this one's different," a scoped exception is created. Either way, one question, one answer, done.

---

## 5. Walkthrough: kraken_05 With This System

Here is how the kraken_05 session would have played out with the passive observer in place, assuming sessions 01-04 already happened.

### Before Rex Builds

The system loads patterns for brand="kraken":

```
Applicable patterns (confidence >= 0.6):
- screen.cornerRadius → 24 (conf: 1.0, seen 4x)
- screen.paddingTop → clamp(24, 32) (conf: 1.0, seen 4x)
- screen.paddingLeft/Right → clamp(24, 32) (conf: 1.0, seen 4x)
- screen.primaryAxisAlignItems → SPACE_BETWEEN (conf: 0.8, seen 3x)
- label.fills (body) → #070809 (conf: 0.8, seen 3x)
- label.fontSize (body) → +2 (conf: 0.6, seen 3x)
- card.cornerRadius → decrease(~50%) (conf: 0.7, seen 3x)
- screen.fills → #F5F5F5 bg with white cards (conf: 0.6, seen 3x)
```

### Rex Builds the Screen

Rex takes the SOM from Osiris, creates nodes, and applies patterns:

```
Root frame:
  Before patterns: cornerRadius=0, paddingTop=16, paddingH=20, bg=#FFFFFF
  After patterns:  cornerRadius=24, paddingTop=28, paddingH=28, bg=#F5F5F5

Body text:
  Before patterns: fills=#666666, fontSize=16
  After patterns:  fills=#070809, fontSize=18

Cards:
  Before patterns: cornerRadius=28
  After patterns:  cornerRadius=14

Layout:
  Before patterns: primaryAxisAlignItems=MIN
  After patterns:  primaryAxisAlignItems=SPACE_BETWEEN
```

### Designer Refines

The designer looks at the result. Most of the usual fixes are already done. They make a few remaining adjustments:

```
Change 1: Tints numpad keys with brand color (#7B61FF)
  → New pattern candidate: numpad.fills → brand color
  → Confidence: 0.3 (first occurrence)

Change 2: Adjusts card padding from 16 to 20
  → Matches emerging pattern from sessions 02, 04
  → Pattern confidence bumps to 0.6

Change 3: Tweaks one specific label's font weight
  → Isolated change, no pattern formed
```

### After "Done"

The observation window closes. The system:

1. Records the refinement record (3 property changes, 0 structural changes, 90 seconds duration --- down from 4 minutes in session 01)
2. Updates pattern confidences
3. Promotes card.padding increase to confidence 0.6 (now applicable next time)
4. Stores the numpad tint as a low-confidence candidate (will become a pattern if it repeats)

**Duration trend: 4 min → 3 min → 2 min → 90 sec → 90 sec.** The system is converging.

---

## 6. Avoiding Being Annoying/Intrusive

This is the most important design constraint. The system follows strict rules:

### Rule 1: Never Interrupt Mid-Flow

The system never shows UI, sends messages, or asks questions while the designer is actively editing. "Actively editing" = any change to the observed frame in the last 10 seconds.

### Rule 2: Maximum One Question Per Session

The system may ask at most ONE question per session, and only when:
- A high-confidence pattern (>= 0.8) is contradicted
- The designer has been idle for 10+ seconds
- No question has been asked yet in this session

If the conditions aren't met, the system just records the change and adjusts confidence silently.

### Rule 3: No Confirmation Dialogs

The system never asks "Should I save this pattern?" or "I noticed you changed X, want me to remember that?" Learning is passive. The designer opts out of a pattern by contradicting it repeatedly (which reduces confidence below the application threshold), not by clicking "No" on a dialog.

### Rule 4: No Visible Capture Step

There is no "capturing refinements..." spinner, no "learning from your changes" toast. The system captures silently. If the designer opens Rex's memory panel (which already exists), they can see learned patterns there --- but they never have to.

### Rule 5: Graceful Regression

If the system applies a pattern and the designer undoes it, the pattern's confidence decreases. After 2 consecutive undos across sessions, the pattern is demoted below the application threshold. The designer never has to explicitly tell the system to stop --- they just undo, and the system learns.

---

## 7. What If the Designer's Workflow Changes?

### Scenario: Designer Stops Refining in Figma, Starts Using Chat

If the designer starts giving Rex verbal instructions instead of editing directly ("make the padding 24"), the system still learns --- but from the explicit commands rather than from observed changes. The refinement record captures Rex's own changes as "designer-directed" and patterns still form.

### Scenario: New Designer Joins

Patterns are scoped to the team level (via Rex Memory). A new designer inherits the team's patterns. If they consistently override a pattern, their user-scoped preferences take priority over team defaults. The team pattern stays for other designers.

### Scenario: Brand/Project Changes

Patterns are brand-scoped. Starting a new brand starts fresh. The universal patterns (e.g., "always use generous padding") carry over; brand-specific patterns (e.g., "kraken uses #7B61FF for accents") don't.

### Scenario: The Designer Wants to See What Was Learned

The existing `recall` and `memories` tools (from the Memory spec) surface learned patterns:

```
Designer: "What have you learned about how I build kraken screens?"
Rex: recalls patterns → shows them in chat

Designer: "Forget the thing about SPACE_BETWEEN, that was just for home screens"
Rex: either scopes the pattern to screenType="home" or deletes it
```

This is pull-based (designer asks) rather than push-based (system tells). No friction unless the designer wants to inspect.

---

## 8. Cold Start vs. Mature

### Cold Start (Sessions 1-2)

- System observes but does not apply anything.
- All patterns have confidence < 0.6 (application threshold).
- The designer's experience is identical to today: Rex builds, they refine.
- No questions asked. No visible difference.

### Warming Up (Sessions 3-5)

- First patterns cross the 0.6 confidence threshold.
- The designer notices fewer corrections needed.
- Still no questions unless a high-confidence contradiction occurs.
- Duration per refinement decreases measurably.

### Mature (Sessions 6+)

- Most common refinements are pre-applied.
- The designer makes 2-3 minor tweaks instead of 15-20.
- New patterns still form as the designer evolves their style.
- Old patterns decay if unused (confidence -= 0.01/day without reinforcement, per Memory spec).

### Cold Start Accelerator

For a brand-new team, the system can bootstrap from Osiris. If Osiris has 50 screens for a brand with SOMs, the system can pre-analyze common style patterns across those screens to seed initial patterns at confidence 0.4 (not auto-applied, but one confirmation away from becoming active).

---

## 9. Integration with Existing Rex Architecture

### What Changes in the Plugin

```
plugin/
  observer.ts          ← NEW: documentchange listener, change buffer,
                          observation window management
  code.ts              ← MODIFIED: wire up observer start/stop on build
                          completion and idle detection
```

The observer is ~150 lines. It listens to `documentchange`, filters to the observed frame's subtree, buffers changes, and flushes them to the relay via the existing HTTP polling mechanism (new field in the poll response: `changes`).

### What Changes in the Server

```
src/
  refinement/
    recorder.ts        ← NEW: receives change buffers, builds RefinementRecords
    patterns.ts        ← NEW: pattern extraction from accumulated records
    applicator.ts      ← NEW: applies patterns during build (called by
                          write tool handlers)
    types.ts           ← NEW: RefinementRecord, PropertyChange, LearnedPattern
```

### What Changes in the Relay

Minimal. The relay gains one new field in the poll response body (`changes: PropertyChange[]`) and one new endpoint for the observation lifecycle (`POST /observe/start`, `POST /observe/stop`).

### Integration with Memory

Learned patterns are stored as Memory entries with category `"convention"` and source `"inferred"`. They follow the existing Memory lifecycle: confidence decay, superseding, cleanup. The Memory system is the persistence layer; the refinement system is the intelligence layer.

```typescript
// A learned pattern stored as a Memory entry
{
  scope: "team",
  category: "convention",
  source: "inferred",
  confidence: 0.85,
  content: "For kraken screens: set root frame cornerRadius to 24",
  tags: ["pattern", "kraken", "screen", "cornerRadius"],
  // The structured pattern data is in a separate patterns collection,
  // linked by memory ID. The memory entry is for human-readable recall;
  // the pattern record is for machine application.
}
```

---

## 10. What This Proposal Does NOT Do

- **It does not diff SOMs.** Property-level change tracking from `documentchange` makes tree-diffing unnecessary.
- **It does not require role matching across builds.** The system knows node IDs because Rex created them.
- **It does not add any UI to the Figma plugin.** All observation is invisible.
- **It does not require the designer to change their workflow.** Zero new steps, zero new commands.
- **It does not try to learn structural patterns in v1.** Structural changes (frame reparenting, wrapper removal) are recorded but not auto-applied. They are too context-dependent. v2 may tackle this with more data.

---

## 11. Implementation Phases

### Phase 1: Observer (1-2 days)

- `plugin/observer.ts`: `documentchange` listener, change buffer, observation window
- Wire up observation start on build completion
- Wire up observation stop on idle/page-change/new-build
- Flush changes to relay via polling

### Phase 2: Recorder (1 day)

- `src/refinement/recorder.ts`: Assemble `RefinementRecord` from change buffers
- Before/after value capture (before = what Rex set, after = what the designer changed to)
- Store records (MongoDB or in-memory for now)

### Phase 3: Pattern Extraction (2 days)

- `src/refinement/patterns.ts`: Group changes by (role, property), detect repetition
- Confidence scoring based on repetition count and consistency
- Pattern types: override, increase, decrease, clamp, replace

### Phase 4: Pattern Application (1 day)

- `src/refinement/applicator.ts`: Query applicable patterns at build time
- Integrate into write tool handlers (adjust values before creating nodes)
- Undo detection: if designer immediately undoes a pattern-applied value, decrease confidence

### Phase 5: The One Smart Question (0.5 days)

- Contradiction detection: high-confidence pattern overridden by designer
- Idle detection: designer paused for 10+ seconds
- One-question-per-session gate
- Response handling: scope exception vs. pattern removal

**Total estimated effort: 5-7 days**

---

## 12. Success Metrics

| Metric | Cold Start | Target (Session 6+) |
|--------|-----------|---------------------|
| Refinement duration | 4 minutes | < 90 seconds |
| Property changes per screen | 15-20 | 2-5 |
| Designer questions asked | 0 | <= 1 per session |
| Pattern application accuracy | N/A | >= 85% (not undone) |
| Designer satisfaction | Baseline | "It just gets better" |

The ultimate success metric: **the designer forgets the system is learning.** They just notice that Rex's builds keep getting closer to what they want.

---

## Round 2: Addressing Evaluator Challenges

### Challenge 1: Can the observer interpret structural changes, or does it just log property mutations?

> "When the designer deletes a wrapper frame and reparents its children... Does your system understand that 'CTA.parent changed from root to cta-section' is a STRUCTURAL decision about CTA isolation, or does it just log it as a property change on parent?"

This is a real weakness, and I will not pretend otherwise.

The v1 observer records structural events (CREATE, DELETE) and property changes (including `parent` mutations) as raw facts. It does NOT interpret them. It sees "node X was created," "node Y's parent changed," "node Z was deleted" --- three separate events. It does not infer that these three events constitute the single design intention "isolate the CTA into its own section."

The proposal already says "structural changes are recorded but not auto-applied" (Section 10). The evaluator's question is sharper: can we even RECORD them in a useful way if we cannot interpret them?

**The fix:** The observer should record structural changes as a timestamped cluster, not as isolated events. Changes that occur within a 2-second window on nodes that share a parent (or where one becomes the other's parent) are grouped into a `StructuralCluster`:

```typescript
interface StructuralCluster {
  timestamp: number;
  events: StructuralChange[];    // The raw CREATE/DELETE/reparent events
  affectedSubtree: string;       // Common ancestor node ID
  duration: number;              // Time span of the cluster
}
```

This does not solve interpretation --- the system still does not know it means "CTA isolation." But it preserves the temporal and spatial proximity that a future interpreter (or an LLM call at pattern-extraction time) can use to reconstruct the intention. The key insight: we do not need to interpret structural changes at capture time. We need to capture them with enough context that they CAN be interpreted later. Raw isolated events lose that context; clustered events preserve it.

For v1, structural clusters are stored but not turned into auto-applied patterns. They are surfaced when the designer asks "what have you learned?" and they feed into the v2 structural pattern system. This is an honest deferral, not a hand-wave --- the data is preserved in a usable form.

### Challenge 2: Undo detection and the auto-apply false positive problem

> "Your observer sees 'cornerRadius changed from 8 to 20' and interprets it as a NEW preference, not as 'the designer undid your 8 to restore the reference value of 20.' How do you distinguish 'designer intentionally set 20' from 'designer undid your 8 to restore the reference value of 20'?"

This is the best challenge in the entire document. It exposes a genuine flaw.

The original proposal hand-waves undo detection with "confidence decreases after 2 consecutive undos." The evaluator correctly identifies that a Cmd+Z fires as a normal `documentchange` and is indistinguishable from an intentional edit at the event level.

**The fix requires two mechanisms:**

**Mechanism 1: Track the "Rex-applied value."** When Rex builds a screen and applies a pattern (e.g., sets cornerRadius to 8 because it learned that from Kraken), it records a manifest of pattern-applied values:

```typescript
patternApplications = [
  { nodeId: "123:456", property: "cornerRadius", appliedValue: 8, patternId: "p-001" },
  ...
]
```

If the observer later sees `cornerRadius` on node `123:456` change FROM 8 to something else, it knows a pattern-applied value was overridden. This is a "pattern rejection" signal, not just a normal edit. A single rejection in one session decreases confidence by 0.1. Two rejections of the same pattern across different sessions drops confidence by 0.3 --- enough to push most patterns below the 0.6 application threshold.

**Mechanism 2: Distinguish undo-to-reference from intentional override.** The system also knows the reference value (from the SOM) --- the value Rex WOULD have used without any pattern. If the designer changes cornerRadius from 8 (pattern-applied) to the exact reference value, that is likely an undo/rejection. If they change it to a third value (neither the pattern value nor the reference value), that is an intentional new preference. The system should weight these differently:

- Change from pattern value -> reference value: strong rejection signal (confidence -= 0.2)
- Change from pattern value -> novel third value: weak rejection of old pattern + new data point for a replacement pattern

This does not perfectly detect Cmd+Z (nothing can, short of hooking into Figma's undo stack, which is not exposed). But it correctly handles the functional consequence: "the designer does not want the value the system applied."

**Regarding the Proposal 06 contradiction** (zero friction vs. explicit confirmation): The evaluator frames this as binary --- either you ask or you don't. But the actual trade-off has a middle ground. The system auto-applies at confidence >= 0.6 AND treats any override as a learning signal. This means false positives are self-correcting: the designer undoes the bad application, the system notices, confidence drops, the pattern stops being applied. The cost of a false positive is one undo action per screen for at most 2 sessions before the pattern is demoted. That cost is lower than the friction cost of a confirmation dialog on every pattern application. The evaluator is right that false positives matter. But the correction mechanism (override detection + confidence decay) is cheaper than the prevention mechanism (confirmation dialogs) as long as the decay is fast enough. The fix above makes it fast enough: two rejections across sessions kills the pattern.

### Challenge 3: Mapping Figma node IDs to SOM roles

> "To map a node ID to a role, you need to know what role Rex assigned to that node during the build. Does Rex store a mapping of 'Figma node ID -> SOM role' for every node it creates?"

Today, Rex does not maintain this mapping. The evaluator correctly identified a gap.

**The fix:** Rex's `create_node` and `instantiate_component` tool handlers already receive the SOM node data (including the role) and return the Figma node ID. The fix is straightforward: maintain a `BuildManifest` per build that maps each created Figma node ID to its SOM role, name, and parent role.

```typescript
interface BuildManifest {
  frameId: string;
  brand: string;
  screenType: string;
  timestamp: number;
  nodes: Map<string, {           // key = Figma node ID
    somRole: string;
    somName: string;
    parentRole: string;
    properties: Record<string, unknown>;  // Values Rex set
  }>;
}
```

This manifest is created during the build (one Map.set per node created) and persists for the duration of the observation window. When the observer records a property change on node `123:456`, the recorder looks up `123:456` in the manifest to get the role.

If the designer renames the node, the role mapping does NOT become stale, because the role was assigned at build time from the SOM, not from the Figma node name. The node's Figma name can change freely --- the manifest still records what role Rex assigned based on the SOM data.

The implementation cost is minimal: one `Map.set()` call per node during build, stored in memory for the duration of the observation window (typically under 5 minutes).

### Cross-Cutting Challenge: The Kraken Restructure

> "Proposal 05 sees individual documentchange events for each property but must infer that 5 separate changes constitute one coherent design decision (CTA isolation). It records them as 5 independent property changes."

The evaluator is right. The v1 system records 5 independent changes. It does not infer the unified intention "CTA isolation."

But the evaluator's framing implies this is fatal. I disagree. Here is why:

Of the 5 simultaneous changes in the Kraken restructure:
1. CTA reparented into new wrapper --- structural, deferred to v2
2. Numpad spacing 4 -> 0 --- property change on a known node, captured correctly
3. "Frame 1" renamed to "content-area" --- name change, captured but not pattern-relevant (names are brand/screen-specific)
4. Fee-row wrapper flattened --- structural, deferred to v2
5. Root set to SPACE_BETWEEN --- property change on a known node, captured correctly

The system captures 2 out of 5 changes as actionable patterns (spacing, layout mode) and records the other 3 as structural clusters for future interpretation. That is not 100% coverage, but 2 of the 3 missed changes are structural (which no proposal handles well, as the evaluator acknowledges), and the third is a rename (which is not a transferable pattern).

The deeper question --- "can the system understand that these 5 changes are one decision?" --- is a genuine open problem. The temporal clustering fix from Challenge 1 preserves the evidence that they happened together. A future version could use an LLM call at pattern-extraction time to interpret clustered changes: "These 5 changes in a 90-second window, all affecting the CTA area, appear to represent CTA isolation as a design pattern." But that is v2. For v1, the system captures the property changes it can act on and preserves the structural changes it cannot yet interpret.

**No proposal in this set solves the unified-intention problem.** The evaluator's own cross-cutting analysis confirms this. This proposal's advantage is that it at least captures the raw events with temporal context, rather than trying to infer intentions from a static before/after comparison and getting it wrong.

### Cross-Cutting Challenge: The Contradiction Test

> "How does the system know that two contradictory values from different brands are NOT contradictions, while two contradictory values from the SAME brand ARE contradictions?"

The proposal already specifies that patterns are brand-scoped (Section 7: "Patterns are brand-scoped. Starting a new brand starts fresh."). The `RefinementRecord` includes a `brand` field. Pattern extraction groups by brand before aggregating.

But the evaluator's question is more precise: what about universal patterns that appear to conflict across brands?

**The rule:** A pattern starts as brand-scoped. It is promoted to universal ONLY if the same pattern (same role, same property, same direction of change) appears across 2+ brands with consistent values. If `pill.cornerRadius` is 8 on Kraken and 20 on the fitness app, the values conflict, so no universal pattern is created. Both remain brand-scoped.

If `screen.paddingTop` is increased by ~8px on Kraken AND increased by ~8px on the fitness app, the pattern "increase root padding" IS promoted to universal because the direction and magnitude are consistent even though the absolute values differ (the `increase` pattern type captures the delta, not the absolute value).

This means:
- `pill.cornerRadius = 8` (brand: kraken, conf: 0.9)
- `pill.cornerRadius = 20` (brand: fitness, conf: 0.9)
- No universal pill.cornerRadius pattern exists
- `screen.paddingTop += 8` (universal, conf: 0.8)

At build time, the system checks brand-scoped patterns first. If building a Revolut screen and no Revolut-scoped pattern for `pill.cornerRadius` exists, no pattern is applied --- the SOM value is used as-is. The system does not guess. It does not average. It does not fall back to a universal pattern that does not exist.

**Brand detection at build time** is not a new requirement. Rex already knows the brand from the session context (the designer says "build the Revolut payment screen" or the Osiris screen metadata includes the brand). The brand is part of the existing workflow, not an additional input.

### Summary of Proposed Changes

| Challenge | Weakness Real? | Fix |
|-----------|---------------|-----|
| Structural change interpretation | Yes | Temporal clustering of structural events; defer interpretation to v2 but preserve context |
| Undo detection | Yes | Track pattern-applied values in a manifest; distinguish rejection-to-reference from intentional override; fast confidence decay (2 rejections kills a pattern) |
| Node ID to role mapping | Yes | BuildManifest created during build, maps Figma node IDs to SOM roles |
| Unified design intentions | Yes (but unsolved by all proposals) | Temporal clustering preserves co-occurrence; LLM interpretation deferred to v2 |
| Brand contradictions | Partially addressed in original | Clarified: patterns are brand-scoped by default, promoted to universal only on cross-brand consistency; no guessing, no averaging |
