# Final Evaluation: Refinement Learning Architecture

**Evaluator:** Senior Design Systems Architect
**Date:** 2026-03-21

---

## Part 1: Scoring Each Proposal

### Proposal 01: Structural-First Refinement Learning

| Rubric | Score | Justification |
|--------|-------|---------------|
| Ease of Use | 7 | Designer workflow is unchanged -- capture happens via the existing `capture_delta` call, but someone (Claude or the designer) still needs to trigger it explicitly. |
| Compound Learning | 8 | The two-layer architecture with confidence-scored rules and structural templates creates genuine compounding, especially after the Round 2 fix eliminating the circular dependency between layers. |
| Simplicity of Implementation | 5 | Three phases spanning 10-13 days, with the structural fingerprinting and template assembly requiring non-trivial algorithmic work and a Phase 0 prerequisite to harden role assignment. |
| Fault Tolerance | 7 | Confidence decay, priority-ordered rule scoping, and the corrected independent-layer design mean a bad rule fades rather than cascading, though the Round 2 response admits structural normalization was hand-wavy. |
| Signal vs Noise | 6 | Role-based property comparison filters out name noise effectively, but the proposal has no explicit mechanism to distinguish genuine preferences from AI error corrections or one-off adjustments. |

**Total: 33/50**

---

### Proposal 02: Content-Fingerprint Matching

| Rubric | Score | Justification |
|--------|-------|---------------|
| Ease of Use | 7 | Same as Proposal 01 -- capture is triggered, not passive -- but the matching itself is fully automated with no designer input required. |
| Compound Learning | 7 | Rule aggregation with confidence scoring and brand scoping produces compounding, though the Round 2 admission that structural learning is additive (not yet built) limits the ceiling. |
| Simplicity of Implementation | 7 | 15-21 hours total is the most concrete and achievable estimate; fingerprint hashing and tiered matching are well-understood algorithms with no research risk. |
| Fault Tolerance | 7 | Tiered confidence levels mean low-quality matches produce low-confidence rules that stay below the application threshold; the Round 2 spatial-proximity fix for Tier 2 false matches is sensible. |
| Signal vs Noise | 5 | Content fingerprinting inherently captures everything that changed on matched nodes without distinguishing preference from error correction; it relies entirely on recurrence to filter signal from noise. |

**Total: 33/50**

---

### Proposal 03: Visual-Perceptual Refinement Learning

| Rubric | Score | Justification |
|--------|-------|---------------|
| Ease of Use | 8 | Auto-screenshot capture at build and refinement completion makes the process nearly invisible; the designer just works in Figma and the system observes. |
| Compound Learning | 6 | Rule accumulation works, but the vision-based Pass 1 does not itself improve over time -- it is a stateless LLM call every time, and the Round 2 concession to skip vision in mature phases undermines the proposal's core differentiator. |
| Simplicity of Implementation | 5 | 5-9 days is optimistic given the prompt engineering required for reliable visual observation extraction, the spatial lookup pipeline, and the need for adaptive Pass 1 logic across cold/growth/mature phases. |
| Fault Tolerance | 6 | The two-pass design means a missed visual observation still allows the SOM data to catch it, but the Round 2 admission that the SOM fallback inherits the 0/0 failure mode is concerning. |
| Signal vs Noise | 7 | The screenshot acts as a natural gestalt filter -- Claude notices visually salient changes and ignores invisible ones (like renames), which is a surprisingly effective noise filter that no other proposal achieves. |

**Total: 32/50**

---

### Proposal 04: Template Evolution (Golden SOM Library)

| Rubric | Score | Justification |
|--------|-------|---------------|
| Ease of Use | 9 | Save the refined screen, use it next time -- this maps directly to how designers already think about reusable components and requires zero mental model shift. |
| Compound Learning | 5 | Templates get better through supersession, but each template is an island; cross-screen-type learning requires explicit Style Propagation (human-confirmed) or Rex Memory (manually created), so compound learning across screen types is weak. |
| Simplicity of Implementation | 8 | 7.5 days with most work being straightforward CRUD endpoints and a scoring algorithm; no novel algorithms, no ML, no complex matching logic. |
| Fault Tolerance | 9 | A bad template is just... not used. Supersession means the latest version wins. Brand scoping eliminates cross-brand contradictions by design. There is almost no way for the system to cascade a bad decision. |
| Signal vs Noise | 8 | By storing the entire refined artifact rather than extracted rules, the system cannot learn the wrong abstraction -- it stores facts, not inferences, which eliminates the signal/noise problem at the storage layer entirely. |

**Total: 39/50**

---

### Proposal 05: Designer-Workflow-First

| Rubric | Score | Justification |
|--------|-------|---------------|
| Ease of Use | 10 | Truly zero friction -- the designer's workflow is completely unchanged, observation is invisible, and the one-question-per-session gate ensures the system never becomes annoying. |
| Compound Learning | 8 | `documentchange` tracking with BuildManifest provides exact before/after values per node, and the pattern extraction pipeline with confidence scoring produces genuine compounding; the Round 2 undo-detection fix makes learning self-correcting. |
| Simplicity of Implementation | 7 | 5-7 days leveraging existing plugin infrastructure (`documentchange`, polling); the BuildManifest is a small addition, and pattern extraction is straightforward grouping logic. |
| Fault Tolerance | 7 | Auto-apply at confidence 0.6 is aggressive, but the Round 2 pattern-rejection manifest (tracking Rex-applied values and detecting overrides) provides a concrete self-correction mechanism that limits the blast radius of false positives. |
| Signal vs Noise | 5 | The observer captures everything indiscriminately -- every property change on every Rex-created node -- and relies on recurrence to separate signal from noise, with no semantic filtering of AI errors, one-offs, or content-driven changes. |

**Total: 37/50**

---

### Proposal 06: Adversarial Filter

| Rubric | Score | Justification |
|--------|-------|---------------|
| Ease of Use | 4 | The confirmation requirement (confidence capped at 0.7 without designer approval) adds friction at exactly the wrong moment; even the Round 2 concession to auto-promote at 8+ occurrences still requires review, and the passive review flow interrupts the build handoff. |
| Compound Learning | 6 | The filter itself does not learn -- it gates learning. Its value is in preventing false positives, but the conservative stance (50% rejection rate on the real data) means the system learns slowly. |
| Simplicity of Implementation | 6 | The classification engine is conceptually simple but the heuristics (detecting AI errors vs. preferences, cross-role generalization, session clustering) require substantial tuning and the role taxonomy + brand token awareness are prerequisites. |
| Fault Tolerance | 9 | This is the proposal's entire purpose and it excels -- tombstoning rejected principles, frustration-signal recovery for false negatives, and explicit contradiction detection make this the most robust gating system. |
| Signal vs Noise | 9 | The change taxonomy with six categories and the explicit "all four criteria must pass" test for genuine principles is the most rigorous signal/noise discrimination in any proposal; the Round 2 cross-role generalization mechanism adds the missing piece. |

**Total: 34/50**

---

## Part 2: Best Ideas Across Proposals

These seven ideas are individually strong and complementary:

### 1. Passive Observation via `documentchange` (Proposal 05)

The insight that Rex already knows every node it created, so `documentchange` gives exact before/after values without any matching algorithm, is the single most important technical insight across all proposals. It eliminates the node-matching problem entirely -- which is the problem that killed the original tree-diff approach.

### 2. Golden Templates as the Primary Learning Artifact (Proposal 04)

Storing the refined SOM as a reusable template is the fastest path to value and the most fault-tolerant approach. It captures 100% of the designer's decisions (structural AND property) without any extraction, inference, or rule formation. Templates are facts, not abstractions.

### 3. The Adversarial Filter's Change Taxonomy (Proposal 06)

The six-category taxonomy (AI error, screen-specific, artifact cleanup, reverted experiment, content-driven, genuine principle) is the missing piece that prevents every other proposal from poisoning itself. Without it, recurrence-based confidence scoring treats AI error corrections the same as genuine preferences.

### 4. Content Fingerprinting for Node Matching (Proposal 02)

For cases where passive observation is not available (e.g., the designer refined a screen Rex did not build, or the observation window was missed), content fingerprinting provides the best fallback matching strategy. It is simple, deterministic, and handles renames and reparenting gracefully.

### 5. BuildManifest for Node-to-Role Mapping (Proposal 05, Round 2)

The explicit mapping of Figma node IDs to SOM roles at build time solves a problem every other proposal hand-waves: how do you know what role a node has after the designer has renamed and reparented it? The manifest is trivial to build (one Map.set per node) and invaluable for pattern extraction.

### 6. Brand-Scoped Storage with Cross-Brand Directional Rules (Proposals 01, 02, 05, 06)

Every proposal that addressed the Contradiction Test converged on the same answer: rules are brand-scoped by default, and cross-brand generalization only happens for directional patterns (e.g., "always reduce inner corner radii") rather than absolute values. This consensus validates the approach.

### 7. Screenshot-as-Index for Cold Start (Proposal 03)

During cold start (0-5 screens), the system has no patterns and no idea what matters. The visual comparison provides gestalt-level pattern recognition ("this feels more spacious," "corners are sharper") that bootstraps learning faster than raw property diffs. Once the system has patterns, vision becomes unnecessary -- but for those first critical screens, it accelerates discovery.

---

## Part 3: The Merged Solution

### Architecture: Template-First with Passive Pattern Learning

The merged system has two complementary learning tracks that operate independently but reinforce each other:

**Track A: Template Library (primary)** -- Store refined screens as reusable Golden Templates. This is the main mechanism for improving builds. It captures everything, requires no inference, and is fault-tolerant by design.

**Track B: Property Patterns (secondary)** -- Passively observe designer refinements via `documentchange`, extract recurring property patterns, and apply them as adjustments when building from raw references (i.e., when no template is available). This fills the gap when a template does not exist for the requested screen type.

**The Adversarial Filter** sits between Track B's observation pipeline and its pattern store, preventing noise from becoming rules.

```
                     Rex Builds Screen
                           │
                  ┌────────┴────────┐
                  │                 │
           Template exists?    No template
                  │                 │
                  ▼                 ▼
           Use Template        Build from reference
           (Track A)           + apply property patterns
                                    (Track B)
                  │                 │
                  └────────┬────────┘
                           │
                    Designer Refines
                           │
                  ┌────────┴────────┐
                  │                 │
           Save as Golden      Passive Observer
           Template v(N+1)     (documentchange)
           (Track A)                │
                              Adversarial Filter
                              (Proposal 06)
                                    │
                              Property Patterns
                              (Track B)
```

### Data Flow

**At build time:**

1. Claude calls `osiris_find_template(brand, screenType, tags)`.
2. If a matching template exists (score > 0.5):
   - Use the template SOM as the build plan.
   - Populate content slots with new content.
   - Build using Rex tools. The template already embodies all learned preferences.
3. If no template match:
   - Fall back to `osiris_search_screens` + `osiris_get_screen_som` (current behavior).
   - Query applicable property patterns for this brand.
   - Apply confirmed patterns (confidence >= 0.7) as post-processing adjustments.
   - Build using Rex tools.

**After refinement:**

1. The plugin's passive observer (via `documentchange`) records all property changes on the Rex-built frame, mapped to SOM roles via the BuildManifest.
2. When the designer stops editing (idle 60s, new build, page switch), the observation window closes.
3. The refinement record is sent to the Adversarial Filter, which classifies each change:
   - AI error corrections are routed to builder diagnostics (not the pattern store).
   - Screen-specific and content-driven changes are recorded but not promoted.
   - Reverted changes are discarded.
   - Genuine preferences enter the pattern store at low confidence.
4. Separately, Claude prompts the designer: "Want me to save this as a template for [screen type]?" (or auto-saves if the designer has opted in). The refined SOM is saved as a Golden Template via `osiris_save_golden_template`.

**Pattern promotion:**

- After 3+ occurrences of the same directional change on the same (role, property), the pattern becomes a candidate.
- At 5+ occurrences with > 80% consistency: auto-promote to confirmed (no designer approval needed -- the evidence is overwhelming).
- At 3-4 occurrences: surface during the next build as a brief question ("I noticed you always increase top padding -- want me to do that by default?").
- Tombstoned patterns are never re-proposed.

### Resolving the Confirmation vs. Zero-Friction Tension

The merged solution threads the needle:

- **During refinement:** Zero friction. The observer is silent. No popups, no questions.
- **At build time:** Brief, optional questions (max one per build) when a pattern reaches candidate status. This is a natural handoff point where the designer is already in conversation with Rex.
- **At 5+ consistent occurrences:** Auto-apply silently. The evidence threshold is high enough that false positives are rare.
- **Override detection:** The BuildManifest tracks which values Rex applied from patterns. If the designer changes a pattern-applied value, that is a rejection signal. Two rejections across sessions demotes the pattern.

This gives the Adversarial Filter its gating function without imposing confirmation dialogs on every learned pattern.

### Handling the Kraken Restructure

The merged solution handles the five simultaneous changes as follows:

1. **CTA reparented into new wrapper** -- Captured by `documentchange` as CREATE + parent-change events. Stored as a structural cluster in the refinement record. Not auto-applied in v1 (structural patterns are too context-dependent). BUT: saved as part of the Golden Template, so any future payment screen built from this template inherits CTA isolation automatically.

2. **Numpad spacing 4 to 0** -- Captured as a property change on a known node. Enters the pattern pipeline. If it recurs, becomes a pattern.

3. **Frame renamed** -- Captured by `documentchange` as a name property change. The Adversarial Filter classifies it as "artifact cleanup" and discards it. Correct behavior.

4. **Fee-row wrapper flattened** -- Captured as DELETE events. Stored as a structural cluster. The filter classifies it: if Osiris references over-nest, it is a preference for flat hierarchy (route to pattern store). If Rex over-nested, it is an AI error (route to builder). Either way, the Golden Template captures the flat structure.

5. **Root set to SPACE_BETWEEN** -- Captured as a property change. Enters the pattern pipeline. High recurrence (3/5 screens) means it quickly becomes a confirmed pattern.

**Key insight:** The Golden Template captures ALL five changes automatically. Property patterns capture changes 2 and 5. The filter correctly discards change 3. Structural changes 1 and 4 are deferred for pattern extraction but preserved in templates. Net coverage: 100% via templates, 40% via patterns (growing as structural pattern support matures).

### Handling the Contradiction Test

- Templates are brand-scoped by construction. Kraken templates have `cornerRadius: 8`. Fitness templates have `cornerRadius: 20`. No conflict.
- Property patterns are brand-scoped by default. If `pill.cornerRadius` values conflict across brands, no universal pattern is created -- only brand-scoped patterns.
- Cross-brand directional patterns (e.g., "reduce inner corner radii from reference") require consistent direction across 2+ brands to be promoted.
- New brands start cold for both templates and patterns. The first few screens fall back to raw Osiris references.

---

## Phased Implementation

### Phase 1: Golden Templates (Days 1-3)

- `golden_templates` MongoDB collection with indexes.
- `osiris_save_golden_template` endpoint.
- `osiris_find_template` endpoint with scoring algorithm.
- `osiris_get_template` and `osiris_list_templates` endpoints.
- Claude orchestration prompt: template-first build workflow.
- Content slot detection (Claude-side, not algorithmic).

**Outcome:** Rex can save and reuse refined screens. Immediate value from the first refinement session. No pattern extraction, no observation, no filter -- just "save the good version and use it next time."

### Phase 2: Passive Observer (Days 4-6)

- `plugin/observer.ts`: `documentchange` listener with change buffer.
- BuildManifest: map Figma node IDs to SOM roles during build.
- Observation window lifecycle (start on build complete, stop on idle/new-build).
- Flush changes to relay via existing polling.
- `src/refinement/recorder.ts`: assemble RefinementRecords.

**Outcome:** The system silently captures every property change the designer makes. Data accumulates. Nothing is applied yet.

### Phase 3: Adversarial Filter + Pattern Extraction (Days 7-10)

- Change taxonomy classifier (six categories).
- Recurrence grouping by (brand, role, property, direction).
- Confidence scoring with the formula from Proposal 06.
- Pattern types: override, increase, decrease, clamp, replace.
- Cross-role generalization (second-pass grouping by property + value pattern).
- Brand-scoped storage with cross-brand directional detection.

**Outcome:** The system classifies changes, rejects noise, and begins forming pattern candidates. High-confidence patterns (5+ occurrences) are auto-applied. Candidates (3-4 occurrences) are surfaced as brief questions during builds.

### Phase 4: Integration and Feedback (Days 11-14)

- Apply confirmed patterns during builds from raw references (no-template path).
- Override detection via BuildManifest (track pattern-applied values, detect rejections).
- Pattern confidence decay on rejection (two rejections kills a pattern).
- "What have you learned?" recall interface via existing memory tools.
- Backfill: process the 5 existing before/after refinement pairs through the new pipeline.

**Outcome:** End-to-end learning loop operational. Templates provide immediate reuse. Patterns fill the gap for novel screen types. The filter prevents noise from becoming rules.

### Phase 5: Maturation (Ongoing)

- Style Propagation: detect consistent changes across multiple templates in one session, offer batch update.
- Structural pattern support: interpret structural clusters from the observer into transferable patterns (CTA isolation, hierarchy flattening).
- Screenshot-as-index for cold-start acceleration (Proposal 03's vision pass, used only for the first 5 screens of a new brand).
- Content fingerprinting as fallback matcher for screens Rex did not build.
- Learning dashboard: show templates, patterns, filter decisions, confidence trajectories.

---

## Part 4: Vote Summary

**Build Template Evolution (Proposal 04) first, then layer Passive Observation (Proposal 05) with Adversarial Filtering (Proposal 06) on top.**

The reasoning:

1. **Templates deliver value on Day 1.** The very first refined screen becomes a reusable template. No pattern extraction, no confidence thresholds, no observation infrastructure needed. The designer refines once; every future screen of that type benefits. This is the fastest path from "the system learns nothing" to "the system reuses what it has seen."

2. **Passive observation fills the generalization gap.** Templates are powerful but island-bound -- a payment template does not teach the system about onboarding screens. Property patterns extracted from `documentchange` events provide cross-screen-type learning ("always use 24px root corner radius") that templates cannot. But this is a secondary priority because the ROI per engineering-day is lower than templates.

3. **The adversarial filter prevents self-poisoning.** Without it, the pattern pipeline will learn AI error corrections, one-off adjustments, and content-driven changes as if they were genuine preferences. The filter is the difference between a system that gets smarter and a system that gets confidently wrong. It is the hardest piece to get right, but it can ship as a diagnostic-only tool (classify and log, do not gate) while being tuned.

4. **Everything else is Phase 5.** Screenshot-based visual detection, content fingerprinting, structural pattern inference, and cross-brand directional rules are all valuable but are refinements on the core loop, not prerequisites for it.

**The system that ships in 2 weeks:**
- Saves refined screens as Golden Templates (100% fidelity, zero inference risk).
- Silently observes designer edits via `documentchange` (zero friction).
- Classifies changes through the adversarial filter (rejects ~50% as noise).
- Promotes recurring, consistent, content-independent patterns to confirmed rules.
- Applies templates when available, property patterns when not.
- Self-corrects when the designer overrides a pattern-applied value.

**The system after 3 months:**
- 20+ templates per brand covering common screen types.
- 10-15 confirmed property patterns per brand (padding, corner radii, typography, colors).
- 80-90% reduction in designer refinement time on templated screen types.
- 40-60% reduction on novel screen types (via property patterns alone).
- The designer has largely forgotten the system is learning. It just builds better screens now.
