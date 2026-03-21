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
**Status:** Complete (2026-03-21)
- [x] **BuildManifest** — `plugin/build-manifest.ts` tracks node IDs to SOM roles
- [x] **DocumentChange Observer** — filters, batches, net-zero detection, 10s idle / 30s interval flush
- [x] **Rex Server Relay** — POST `/observations` endpoint forwards to Osiris
- [x] **Osiris: Refinement Record Storage** — `refinement_records` collection + GET/POST endpoints
- [x] **TRACK_FRAME command** — explicit frame tracking via MCP tool
- **Verified:** 20+ records captured from wise_77, paypal_146 live refinements

### Phase 3: Adversarial Filter + Patterns (Osiris)
**Status:** Complete (2026-03-21)
- [x] **Change Classifier** — 6-category adversarial filter (`src/refinement-filter.js`)
- [x] **Pattern Extraction** — groups by (role, property, brandId), computes mode/consistency/direction
- [x] **Property Pattern Storage** — `property_patterns` collection + 2 MCP tools (`osiris_extract_patterns`, `osiris_get_patterns`)
- [x] **Lifecycle promotion** — observed → candidate (3+ occ, 60%) → confirmed (5+ occ, 80%) → tombstoned
- **Results:** 120 patterns across 5 brands, 16 at candidate status

### Phase 4: Pattern Application at Build Time
**Status:** Complete (2026-03-21) — property-level patterns working
- [x] **Pattern enrichment** — `enrichWithPatterns()` in tool-router.ts queries Osiris patterns by (brandId, somRole)
- [x] **Default-only application** — patterns fill in values Claude didn't explicitly set
- [x] **Recursive children** — brandId propagated, children enriched
- [x] **Schema extended** — `somRole` and `brandId` optional fields on `create_node`
- **Limitation:** Patterns fix property-level preferences but don't fix structural build quality. Template-based builds needed for consistent screen construction.

### Phase 4.5: Template-Based Builds (Not started)
**Problem:** Pattern enrichment works but cold-building from screenshots produces inconsistent structural quality. Need to build screens directly from reference template SOMs — using the refined node tree as scaffolding with content swapping.

### Phase 5: Maturation (Ongoing)
- [ ] Template-based screen construction (Phase 4.5)
- [ ] Override detection via BuildManifest
- [ ] Pattern tombstoning (designer overrides confirmed pattern)
- [ ] Cross-brand directional patterns
- [ ] Learning dashboard
- [ ] Screenshot cold-start acceleration

---

## Open Issues

1. **Rex memory retrieval** — user working on fix independently
2. **Template content slots** — Claude's responsibility, needs prompt engineering
3. **Brand scoping** — templates use brand boost (0.20 weight), not hard filter
4. **5 refined screens** — need Rex+Figma connection to extract and save as templates
