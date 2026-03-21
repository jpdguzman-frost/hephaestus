# Proposal 07: Osiris Cleanup — Remove, Simplify, Evolve

**Status:** Draft
**Date:** 2026-03-21

---

## Motivation

Osiris has grown organically from a screen scoring database into a design intelligence platform with refinement learning, SOM extraction, delta capture, and pattern synthesis. Along the way, several subsystems were built speculatively and never validated. Others ran but produced zero useful output. The result is a 1,479 LOC `server.js`, 45+ endpoints, 23 MCP tools, 7 pipeline scripts, and 5 MongoDB collections — when the actual usage pattern touches maybe 60% of that surface area.

This proposal classifies every questionable subsystem and recommends a path forward. The goal is a leaner Osiris that does fewer things well, with a clear boundary between the proven reference library (screens, buckets, SOMs) and the emerging refinement architecture (Golden Templates, passive observation, adversarial filter from the final-evaluation merged solution).

---

## Classification Summary

| Item | Verdict | LOC Impact | Risk |
|------|---------|-----------|------|
| `synthesizer.js` | REMOVE | ~200 LOC | None |
| `brief-generator.js` | REMOVE | ~250 LOC | None |
| `pattern-extractor.js` | REMOVE | ~300 LOC | None |
| `audit.js` | REMOVE | ~200 LOC | None |
| Delta system (`som-refine.js`) | REMOVE | ~588 LOC | Low |
| `refinement_principles` collection | REMOVE | 0 (empty) | None |
| `distillations` collection | REMOVE | ~80 LOC (routes) | None |
| `/api/correlations` endpoint | REMOVE | ~40 LOC | None |
| `/api/benchmark` endpoint | SIMPLIFY | ~20 LOC | None |
| Emotional spectrum scores | SIMPLIFY | ~60 LOC | Low |
| Visual features (phash, spatial color) | KEEP | 0 | N/A |
| Delta MCP tools (5 tools) | EVOLVE | ~150 LOC | Medium |
| `find_similar` presets | SIMPLIFY | ~30 LOC | Low |

**Estimated total LOC removed: ~1,700-1,900**
**Estimated LOC simplified: ~110**
**Net complexity reduction: ~40% of server.js**

---

## 1. REMOVE: Dead Pipeline Scripts

### 1a. `synthesizer.js` — Cross-Industry Pattern Synthesis

**Evidence:** Data directory is empty. Script was never executed. The premise — that cross-industry UI patterns would emerge from automated analysis — is sound in theory but was never tested, and the merged refinement architecture (Proposal 04+05+06) replaces this with brand-scoped Golden Templates and property patterns learned from actual designer behavior, not automated cross-industry inference.

**Action:**
- Delete `synthesizer.js`
- Delete any empty data directories it would have written to
- Remove any references in pipeline documentation or npm scripts

**Risk:** None. Zero output was ever produced.

### 1b. `brief-generator.js` — 3-Direction Design Briefs

**Evidence:** Never executed. The idea was to generate three design direction briefs (conservative, moderate, bold) from screen analysis. This is a prompt engineering task that Claude handles contextually during builds — a static brief generator adds no value over Claude reading the screen analysis and bucket insights at build time.

**Action:**
- Delete `brief-generator.js`

**Risk:** None. If brief generation is needed later, it belongs in the Claude orchestration prompt, not a standalone script.

### 1c. `pattern-extractor.js` — UI Component Cropping/Clustering

**Evidence:** Never executed. The intent was to crop individual UI components from screenshots and cluster them by visual similarity. This is superseded by the SOM system, which gives structured component-level data without needing image cropping. The SOM's role taxonomy (`assign_roles`) provides semantic clustering that image clustering cannot match.

**Action:**
- Delete `pattern-extractor.js`

**Risk:** None. SOM + role assignment is strictly superior to image-based component extraction.

### 1d. `audit.js` — Comprehensive Design Quality Audit

**Evidence:** Never executed. The scoring rubric and per-screen analysis already capture design quality at ingest time via Claude Vision. A separate "audit" pass over already-scored screens is redundant.

**Action:**
- Delete `audit.js`

**Risk:** None. The existing scoring pipeline (`analyze` step) covers this.

---

## 2. REMOVE: Failed Delta/Refinement System

### 2a. `som-refine.js` (588 LOC) + Delta Matching Algorithm

**Evidence:** This is the most important removal. The delta system was the original approach to refinement learning: capture before/after SOM pairs, compute node-level diffs, extract principles. It was tested on 5 real screens (kraken_05, zing_51, acorns_54, coinbase_03, betterment_01). Results:

- 11 deltas captured
- ALL had 0 matched node deltas
- Principle extraction returned 0 principles
- The matching algorithm (path+role, fallback name+role) is proven fragile against the reality of designer refinement (renames, reparenting, wrapper insertion/removal)

The final-evaluation merged solution explicitly replaces this with:
- **Track A:** Golden Templates (store the whole refined SOM, no diffing needed)
- **Track B:** Passive observation via `documentchange` (exact before/after values on known nodes via BuildManifest, no matching needed)

The delta system's fundamental flaw — trying to match nodes across two independently-produced SOMs — is architecturally unfixable without the BuildManifest approach.

**Action:**
- Delete `som-refine.js`
- Drop `deltas` collection from MongoDB (after backing up the 11 records for historical reference)
- Drop `refinement_principles` collection (empty, never populated)
- Remove all `/api/deltas/*` and `/api/principles/*` REST endpoints from `server.js`
- Remove the following 5 MCP tools:
  - `osiris_capture_delta`
  - `osiris_list_deltas`
  - `osiris_get_refinement_context` (delta-dependent portions)
  - `osiris_extract_principles`
  - `osiris_get_principles`

**Risk:** Low. The 11 captured deltas contain the before/after SOMs which could theoretically be reprocessed through a better matching algorithm. Mitigation: export the 11 delta documents to a JSON backup file before dropping the collection. If the merged refinement architecture needs seed data, these SOMs can be re-ingested as Golden Templates.

### 2b. `refinement_principles` Collection

**Evidence:** Empty. Never populated because `extract_principles` returned 0 results (because the deltas had 0 matched nodes). This collection is the output of a pipeline that never produced output.

**Action:** Drop collection. No backup needed — it is empty.

### 2c. `distillations` Collection

**Evidence:** This was a "saved queries" concept — pre-computed cross-bucket analyses stored for reuse. It is redundant with:
- Bucket insights (already stored per-bucket via `get_bucket_insights`)
- Claude's ability to query multiple buckets on the fly
- The scoring rubric + benchmark system

**Action:**
- Drop `distillations` collection
- Remove `/api/distillations/*` endpoints from `server.js`
- No MCP tools reference this collection, so no tool changes needed

**Risk:** None if bucket insights cover the same ground. Check whether any distillation documents contain unique analysis not captured in bucket insights before dropping.

---

## 3. REMOVE: Unused REST Endpoints

### 3a. `/api/correlations`

**Evidence:** Not exposed via MCP. Computes score correlations across dimensions (e.g., "screens with high whitespace_ratio tend to have high calm_confident"). This is interesting for data exploration but:
- Never called by any MCP tool
- Never referenced in any workflow or prompt
- Claude can compute correlations on the fly from search results if needed

**Action:** Remove endpoint from `server.js`.

**Risk:** None. If correlation analysis becomes valuable, it can be reimplemented as an MCP tool with a clearer use case.

### 3b. `/api/benchmark` (non-MCP version)

**Evidence:** There is both a REST endpoint and an MCP tool (`osiris_get_bucket_benchmarks`) for benchmarks. The REST endpoint predates the MCP tool and is likely unused now that all access goes through MCP.

**Action:** Verify no external consumers, then remove the REST-only endpoint. Keep the MCP tool.

**Risk:** Low. Check server logs for any direct REST calls before removing.

---

## 4. SIMPLIFY: Scoring Dimensions

### 4a. Emotional Spectrum Scores (5 dimensions, -5 to +5 scale)

**Evidence:** Each screen has 5 emotional spectrum scores alongside the main quality scores. These are:
- Not used in `find_similar` (similarity uses fingerprint, tags, screen_type, scores — but only the main quality scores)
- Not used in `search_screens` filtering
- Not surfaced in `get_bucket_benchmarks`
- Not used in `score_comparison`
- Stored in every screen document, adding ~50 bytes per screen (170KB total across 3,400 screens — negligible storage)

They appear in `get_screen_detail` output but are never acted upon.

**Action:** SIMPLIFY, not remove:
- Stop computing emotional scores during new screen ingestion (remove from the `analyze` pipeline step)
- Keep existing scores in the database (no migration needed)
- Remove emotional score fields from `get_screen_detail` response serialization
- If emotional understanding is needed, Claude Vision can assess it at query time from the screenshot

**Risk:** Low. If a future workflow needs emotional tone matching (e.g., "find screens that feel premium and calm"), it can be reintroduced as a tag or mood filter, which already exists. The `mood` field in `search_screens` covers the primary use case with less complexity.

### 4b. `find_similar` Presets

**Evidence:** The `find_similar` tool supports 4 presets: `default`, `visual`, `semantic`, `score`. In practice, `default` is used almost exclusively. The preset system adds branching logic to the similarity algorithm without clear user value — Claude rarely has reason to switch presets.

**Action:** SIMPLIFY to 2 presets:
- `default` — balanced similarity (keep as-is)
- `visual` — weight visual features higher (keep for when Claude needs visual matches specifically)
- Remove `semantic` and `score` presets

**Risk:** Low. If a specific similarity mode is needed, Claude can filter/re-rank results from the default preset.

---

## 5. KEEP: Core Reference Library

These systems are proven and actively used. No changes recommended.

| System | Reason to Keep |
|--------|---------------|
| `screens` collection + scoring | Core asset. 3,400+ scored screens across 6 industries. |
| `buckets` collection + insights | Curated groupings with AI editorial. Used in every build workflow. |
| SOM storage + retrieval | Foundation for Rex builds. `get_screen_som`, `save_screen_som`. |
| `search_screens` | Primary discovery tool. All filter dimensions are used. |
| `find_similar` | Used for exemplar matching during builds. |
| `get_screen_image` | Visual reference for Claude Vision. |
| `get_screen_detail` | Full analysis for build planning. |
| `list_buckets` / `list_brands` | Navigation and discovery. |
| `get_bucket_benchmarks` + `score_comparison` | Quality gate during builds. |
| `get_scoring_rubric` | Self-evaluation reference. |
| `assign_roles` | SOM v2 role tagging. |
| `merge_som` | Content/style recombination. |
| Visual features (phash, spatial color) | Used as similarity fallback. Low cost to keep. |

**MCP tools to keep: 15** (down from 23)

---

## 6. EVOLVE: Delta Tools into Refinement Architecture

The 5 delta/principle MCP tools are removed (Section 2a), but their *intent* — learning from designer corrections — is preserved and upgraded in the merged refinement architecture from `specs/proposals A/final-evaluation.md`.

### Replacement Mapping

| Old Tool | Replacement | Architecture |
|----------|------------|--------------|
| `osiris_capture_delta` | `osiris_save_golden_template` | Track A: store the refined SOM as a reusable template. No diffing. |
| `osiris_list_deltas` | `osiris_list_templates` | Browse saved templates by brand, screen type. |
| `osiris_get_refinement_context` | `osiris_find_template` + property pattern query | Template-first lookup, then apply confirmed patterns. |
| `osiris_extract_principles` | Passive observer + adversarial filter | Principles emerge from `documentchange` observation, not SOM diffing. |
| `osiris_get_principles` | Property pattern store query | Brand-scoped, role-scoped patterns with confidence scores. |

### New Collections (from merged solution)

| Collection | Replaces | Purpose |
|------------|----------|---------|
| `golden_templates` | `deltas` + `refinement_principles` | Refined SOMs as reusable build plans |
| `property_patterns` | `refinement_principles` | Recurring property adjustments with confidence |
| `refinement_records` | `deltas` | Raw observation data from `documentchange` |

### Implementation Sequence

This cleanup should happen **before** Phase 1 of the merged solution (Golden Templates, Days 1-3):

1. **Day 0a:** Export 11 delta documents to `backups/deltas-backup.json`
2. **Day 0a:** Delete the 4 pipeline scripts + `som-refine.js`
3. **Day 0b:** Remove dead endpoints from `server.js` (~15 endpoints)
4. **Day 0b:** Remove 5 delta/principle MCP tools
5. **Day 0c:** Drop `deltas`, `refinement_principles`, `distillations` collections
6. **Day 0c:** Simplify emotional scores and similarity presets
7. **Day 1:** Begin Golden Templates implementation on a clean foundation

---

## 7. Impact Summary

### Before Cleanup

| Metric | Count |
|--------|-------|
| `server.js` LOC | ~1,479 |
| REST endpoints | 45+ |
| MCP tools | 23 |
| MongoDB collections | 5 |
| Pipeline scripts | 7 (collect, analyze, ingest, fingerprint, synthesize, brief-generate, pattern-extract) |

### After Cleanup

| Metric | Count | Delta |
|--------|-------|-------|
| `server.js` LOC | ~800-900 | -40% |
| REST endpoints | ~28-30 | -35% |
| MCP tools | 15 | -35% |
| MongoDB collections | 2 (screens, buckets) | -60% |
| Pipeline scripts | 3 (collect, analyze, ingest) | -57% |

### After Merged Solution (Phase 1-4)

| Metric | Count | vs. Cleanup |
|--------|-------|-------------|
| MongoDB collections | 5 (screens, buckets, golden_templates, property_patterns, refinement_records) | +3 new, purpose-built |
| MCP tools | 19-20 | +4-5 new template/pattern tools |
| Pipeline scripts | 3 (unchanged) | Learning happens live, not in batch pipelines |

---

## 8. Risk Mitigation

### What if we need the delta data later?

Export to JSON before dropping. The 11 before/after SOM pairs contain valid structural data. They can be:
- Re-ingested as Golden Templates (the "after" SOMs)
- Used as test fixtures for the passive observer pipeline
- Analyzed manually for structural pattern research

### What if emotional scores become useful?

The data stays in existing screen documents (no migration removes it). Reintroducing emotional scoring means adding 5 fields back to the analyze pipeline — a 30-minute change. The `mood` filter on `search_screens` covers 80% of the emotional matching use case already.

### What if cross-industry synthesis is needed?

The `search_screens` tool already supports cross-industry queries. Claude can synthesize patterns across industries at query time by searching multiple industries and comparing results. A batch `synthesizer.js` script adds no value over this interactive approach.

### What if removing `score` and `semantic` similarity presets breaks something?

These presets are parameters on an MCP tool, not stored data. If a workflow needs them back, adding a preset is a 10-line change. Monitor for any Claude prompts that reference these presets before removing.

### What about the `fingerprint` pipeline script?

Keep it. Fingerprinting runs during ingest and populates fields used by `find_similar`. It is part of the working pipeline (collect -> analyze -> ingest -> fingerprint), not speculative code.

---

## 9. Cleanup Checklist

```
Phase 0: Cleanup (1 day)

[ ] Export deltas collection to backups/deltas-backup.json
[ ] Delete pipeline scripts:
    [ ] synthesizer.js
    [ ] brief-generator.js
    [ ] pattern-extractor.js
    [ ] audit.js
    [ ] som-refine.js
[ ] Remove from server.js:
    [ ] /api/deltas/* endpoints
    [ ] /api/principles/* endpoints
    [ ] /api/distillations/* endpoints
    [ ] /api/correlations endpoint
    [ ] /api/benchmark (REST-only, keep MCP tool)
    [ ] Emotional score computation in analyze pipeline
    [ ] Emotional score fields from screen detail serialization
[ ] Remove MCP tools:
    [ ] osiris_capture_delta
    [ ] osiris_list_deltas
    [ ] osiris_get_refinement_context
    [ ] osiris_extract_principles
    [ ] osiris_get_principles
[ ] Simplify find_similar to 2 presets (default, visual)
[ ] Drop MongoDB collections:
    [ ] deltas
    [ ] refinement_principles
    [ ] distillations
[ ] Update any documentation referencing removed features
[ ] Run full test suite to verify no regressions
[ ] Verify remaining 15 MCP tools function correctly
```

---

## 10. What Remains

After cleanup, Osiris is a focused design reference library:

**Core purpose:** Store, score, search, and serve high-quality UI screen references with structured SOMs for Rex to build from.

**MCP tools (15):**
1. `osiris_list_buckets` — Browse curated collections
2. `osiris_get_bucket_screens` — Get screens from a bucket
3. `osiris_get_bucket_insights` — AI editorial for a bucket
4. `osiris_get_bucket_benchmarks` — Quality targets
5. `osiris_search_screens` — Full-text and filtered search
6. `osiris_find_similar` — Similarity matching
7. `osiris_list_brands` — Brand navigation
8. `osiris_get_screen_detail` — Full screen analysis
9. `osiris_get_screen_image` — Screenshot retrieval
10. `osiris_get_screen_som` — SOM retrieval
11. `osiris_save_screen_som` — SOM storage
12. `osiris_assign_roles` — SOM role tagging
13. `osiris_merge_som` — Content/style recombination
14. `osiris_get_scoring_rubric` — Scoring reference
15. `osiris_score_comparison` — Quality gap analysis

**Collections (2):** `screens`, `buckets`

**Pipeline (3):** `collect`, `analyze`, `ingest` (+ `fingerprint` as a post-ingest step)

This is the clean foundation for the Golden Templates + Passive Observer + Adversarial Filter architecture defined in the merged solution. New collections and tools get added incrementally in Phases 1-4, each one justified by a concrete workflow need — not built speculatively.
