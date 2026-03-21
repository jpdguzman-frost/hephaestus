# Refinement Learning — Activity Tracker

**Created:** 2026-03-21
**Context:** After testing the SOM extraction → refinement → delta workflow across 5 screens, the tree-diff approach failed. 6 proposals were evaluated, and a merged architecture was selected: Template-First with Passive Pattern Learning.

**Specs produced:** `specs/proposals/01-06` (proposals), `07` (cleanup), `08` (architecture), `09` (final integrated spec)

---

## Completed

- [x] **Extract SOM tool** — `extract_som` implemented in Rex plugin with role assignment. Code reviewed and simplified.
- [x] **Architecture decision** — Template-First + Passive Observation + Adversarial Filter selected from 6 proposals.
- [x] **Integrated spec** — Rex + Osiris responsibilities mapped. MongoDB schemas defined.
- [x] **Osiris cleanup** — Removed 2,629 LOC dead code + distillations feature. Deployed.
- [x] **Osiris MongoDB cleanup** — `deltas`, `refinement_principles`, `distillations` collections dropped.
- [x] **Phase 1: Reference Templates (Osiris)** — `reference_templates` collection, 5 API endpoints, 5 MCP tools, scoring algorithm. All verified on live instance.

---

## Phase 0: Remaining Prep

### 0.1 Fix Rex Memory Retrieval
**Status:** User working on this independently
**Problem:** Rex cloud notes contain stored conventions but search queries fail to surface them.

---

## Up Next

### Phase 1.5: Save Refined Screens as Templates
**Status:** Complete
**Completed:** 2026-03-21
**Templates saved to live Osiris:**
- kraken_05 → `69be2ed1` (trading/buy-crypto, dark-mode, premium)
- zing_51 → `69be2ed3` (payments/send-money, light-mode, clean)
- acorns_54 → `69be2f00` (investing/success-confirmation, light-mode, friendly)
- coinbase_03 → `69be2f19` (onboarding/onboarding-carousel, light-mode, clean)
- betterment_01 → `69be2f48` (dashboard/dashboard-setup, light-mode, professional)
**Also fixed:** Osiris SOM validator now accepts INSTANCE, VECTOR, GROUP, COMPONENT node types + normalizes roleCategories (navigation→structure, unknown→decorative)

### Phase 2: Passive Observer (Rex plugin)
**Status:** Not started
- 2.1 **BuildManifest** — map Figma node IDs to SOM roles during build (`plugin/build-manifest.ts`)
- 2.2 **DocumentChange Observer** — listen to property changes on Rex-built frames (`plugin/refinement-observer.ts`)
- 2.3 **Rex Server Relay** — forward observations to Osiris
- 2.4 **Osiris: Refinement Record Storage** — `refinement_records` collection

### Phase 3: Adversarial Filter + Patterns (Osiris)
**Status:** Not started
- 3.1 **Change Classifier** — 6-category adversarial filter (`src/refinement-filter.js`)
- 3.2 **Pattern Extraction** — group by (brand, role, property), track direction
- 3.3 **Property Pattern Storage** — `property_patterns` collection + 2 MCP tools

### Phase 4: Integration + Feedback
**Status:** Not started
- 4.1 Pattern application at build time
- 4.2 Override detection via BuildManifest
- 4.3 Pattern promotion rules (observed → candidate → confirmed → tombstoned)
- 4.4 Recall interface

### Phase 5: Maturation (Ongoing)
- [ ] Style Propagation
- [ ] Structural pattern support
- [ ] Screenshot cold-start acceleration
- [ ] Content fingerprinting fallback
- [ ] Learning dashboard
- [ ] Cross-brand directional patterns

---

## Open Issues

1. **Rex memory retrieval** — user working on fix independently
2. **Template content slots** — Claude's responsibility, needs prompt engineering
3. **Brand scoping** — templates use brand boost (0.20 weight), not hard filter
4. **5 refined screens** — need Rex+Figma connection to extract and save as templates
