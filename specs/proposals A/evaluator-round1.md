# Evaluator Round 1: Hard Questions for Each Proposal

**Evaluator context:** 15 years designing and shipping design tools. Grounding all challenges in the real refinement data (5 screens, 10 observed changes, 0/0 tree-diff match rate).

---

## Proposal 01: Structural-First Refinement Learning

**Strength:** Correctly identifies that structural changes and property changes are fundamentally different problems that need different solutions.

1. Walk me through the Kraken screen scenario exactly. The designer moved the CTA out of the dark section into its own wrapper, changed numpad spacing from 4 to 0, and renamed "Frame 1" to "content-area" -- all in the same editing session. Your structural fingerprint uses roles, but `extract_som` assigns roles based on heuristics that use names, child content, and tree position. When the designer renames frames and reparents nodes, the role assignment on the "after" SOM is going to produce different roles than the "before" SOM for the same logical elements. You say "this fingerprint does not use node names at all" but the roles it depends on ARE derived from names. How do you guarantee role stability when names and structure both changed?

2. You say property rules are scoped by screen type and resolved by priority (screen-type + mood > screen-type > mood > universal). Now the designer has refined 200 screens across 3 projects: Kraken (crypto, dark, premium), a neobank (light, minimal), and a fitness app (energetic, colorful). On Kraken screens, card cornerRadius is 12. On the fitness app, card cornerRadius is 20 because the brand is rounded and playful. Your rule aggregation sees "card cornerRadius" with values 12 and 20 across different brands -- does it create two brand-scoped rules, one universal rule with low confidence, or does it get confused and average them to 16? The spec says rules have a `scope` field but the aggregation logic for deciding WHEN to specialize vs. generalize is described as needing to be "smart" without defining what smart means.

3. The "normalize the before SOM to the after structure" step in Section "Handling Intertwined Changes" sounds clean in theory. In practice, how does the system know which structural changes to normalize? If the designer simultaneously (a) separated the CTA, (b) grouped content under a new wrapper, and (c) flattened the fee-row wrapper, you need to apply three structural transformations to the before SOM before you can do a clean property diff. That means you already need to have solved the structural diffing problem BEFORE you can run the property diff. You've created a circular dependency: Layer 2 needs Layer 1 to be solved first, but Layer 1's output (structural changes) needs to be applied as tree transformations, which is exactly the hard tree-manipulation problem you were trying to avoid.

---

## Proposal 02: Content-Fingerprint Matching

**Strength:** Matching by content rather than names is a genuinely clever insight that sidesteps the rename problem entirely.

1. Your walkthrough shows 14/14 content-bearing nodes matched. But you quietly admit that empty structural frames -- the spacers, dividers, layout wrappers -- get `fingerprint = null` and fall through to positional matching or are ignored entirely. In the real Kraken refinement, the designer CREATED a new `cta-section` wrapper (empty frame with just layout properties) and DELETED an existing wrapper around fee-row. These are two of the most important structural changes. Your system either matches them at confidence 0.4 via ordinal position (unreliable when the designer also reordered children) or ignores them via Strategy C. You're capturing all the easy property changes and missing the hard structural ones -- which is where the designer's most intentional decisions live.

2. The fontSize is part of your text node fingerprint: `hash(type, text, fontSize)`. The designer bumped body text from 16 to 18. That means every body text node that got a font size change drops out of Tier 1 exact matching and falls to Tier 2 fuzzy. But Tier 2 fuzzy matching uses Levenshtein on normalized text -- and many body text strings are short ("Network Fee", "Available balance"). If two different short text nodes happen to have similar Levenshtein scores, you'll match them wrong. Now scale this: 200 screens, many with repeated short labels like "Amount", "Total", "Done". How many false matches does Tier 2 produce at scale, and what does a single false match do to your extracted rules?

3. You explicitly defer structural learning to "a future proposal" (Open Question 2). But 3 of the 10 real refinement patterns (CTA separation, wrapper removal, SPACE_BETWEEN switch) are structural. You're building a system that can only learn 7 out of 10 things the designer actually cares about. Is 70% coverage enough to meaningfully reduce refinement time, or will the designer keep hitting the same 3 structural problems on every screen and wonder why the system never learns?

---

## Proposal 03: Visual-Perceptual Refinement Learning

**Strength:** Using screenshots as an index and SOMs as data is the most natural mapping to how a human reviewer actually works.

1. Pass 1 depends on Claude's visual comparison of two screenshots. Claude identifies "cards have sharper corners" and localizes it to a bounding box. But the Kraken dark payment screen has the numpad keys, the recipient card, the amount display, and the fee row all within the same vertical band. When Claude says "region: y 200-600, corner treatment changed," Pass 2 has to figure out which of the 15+ nodes in that band actually had corner radius changes vs. which ones were already sharp. The spatial lookup is doing a lot of heavy lifting here. What happens when the screen is dense (dashboard with 30+ cards) and multiple overlapping observations map to the same region? Does Pass 2 devolve into "just diff everything in this region," which is basically tree-diffing with extra steps?

2. You say "the screenshot is the magnifying glass, the SOM is the ruler, you need both." But the screenshot comparison is an LLM call. It costs tokens, takes 5-10 seconds, and its accuracy depends on image resolution and Claude's visual perception capabilities. For the 200-screen scale test, that is 200 LLM vision calls just for Pass 1. Now the designer changes their mind about corner radii (from 12 to 16 on a new project). You need to re-run Pass 1 on new refinements to detect the shift. At what point does the per-screen LLM cost exceed the value of the learning, and have you compared this cost to just having Claude read the two SOMs directly (which is what Proposal 01 does without any vision calls)?

3. Your fallback chain degrades to tree-diffing when no screenshots exist. But that is the exact approach that already failed with 0 matched nodes. You say it works in fallback "because we are comparing two SOMs of the same screen rather than unrelated trees" and "Node IDs are stable." But in the real data, node IDs are NOT stable across extract_som calls -- extract_som produces new SOM node IDs on every extraction. The Figma node IDs are stable, but the SOM representation assigns its own IDs. Have you verified that your fallback actually works, or is it inheriting the same failure mode you are trying to replace?

---

## Proposal 04: Template Evolution (Golden SOM Library)

**Strength:** "Don't diff, just save the refined version" is the most pragmatically honest framing in the entire set. It correctly identifies that the refined artifact IS the knowledge.

1. The designer refined 5 screens across 5 different brands (Kraken, Zing, Acorns, Coinbase, Betterment). Each screen has brand-specific colors, typography, and layout density. Your template library now has 5 templates, one per brand. A new request comes in: "Build a payment screen for Revolut." None of your 5 templates are for Revolut. Your fallback chain goes to "any brand + exact screen type" and finds the Kraken payment template. But the Kraken template has Kraken's purple brand color (#7B61FF) baked into the numpad keys, Kraken's dark mode fills, Kraken's specific card styling. Claude now has to strip out all brand-specific styling and apply Revolut's brand -- but the template does not distinguish "this fill is brand-specific" from "this fill is a structural/taste decision." How does Claude know which values to keep and which to replace? You've traded the diffing problem for a style-separation problem.

2. Content slots assume Claude can identify which parts of a template are variable (content) and which are fixed (structure/style). But in the real data, the designer changed both content-adjacent properties (font size on amount text) and structural properties (CTA separation) and pure style properties (corner radii). When saving a template, how does the slot detector know that the "$10.00" text node's font size of 56 is a style decision (keep it) vs. the text "$10.00" is content (replace it)? If it gets this wrong and marks fontSize as slottable, future templates lose the learned font size. If it marks the text as fixed, the template can only be used for screens showing "$10.00."

3. At 200 screens across 3 projects, your template library has ~60-100 templates (accounting for screen type variants). Template retrieval now becomes a search/ranking problem with soft scoring across 5 weighted dimensions. How do you prevent template sprawl? If every minor refinement creates a new version, the designer who refined "payment-numpad-v2" by only changing one card's padding creates "payment-numpad-v3" that is 99% identical to v2. After a year, you have 15 versions of "payment-numpad" that are nearly indistinguishable. Does the retrieval algorithm reliably pick the best one, or does it become a crapshoot?

---

## Proposal 05: Designer-Workflow-First Refinement Learning

**Strength:** The only proposal that starts from the designer's actual behavior rather than from an engineering abstraction. The zero-friction philosophy is correct.

1. Your entire capture mechanism relies on `figma.on("documentchange")` tracking property changes on nodes that Rex created, identified by their Figma node IDs. But when the designer deletes a wrapper frame and reparents its children, the children's node IDs are preserved but their parent relationship changes. When the designer creates a NEW frame (the `cta-section` wrapper) and moves the CTA button into it, `documentchange` fires a CREATE for the new frame and a PROPERTY_CHANGE for the CTA's parent property. Does your system understand that "CTA.parent changed from root to cta-section" is a STRUCTURAL decision about CTA isolation, or does it just log it as a property change on `parent`? Your Section 10 says "structural changes are recorded but not auto-applied" -- but if you cannot even INTERPRET them correctly during capture, how do you know what you are deferring?

2. You claim "Maximum One Question Per Session" and "No Confirmation Dialogs." But Proposal 06 (Adversarial Filter) argues that changes MUST be confirmed by the designer before being applied, because false positives are far more expensive than false negatives. Your proposal auto-applies patterns at confidence 0.6 with zero designer confirmation. What happens when the system learns the wrong thing? The designer uses cornerRadius 8 for pills on the Kraken project. Two months later, they start a fitness app project where pills should be cornerRadius 20. Your system auto-applies cornerRadius 8 because it has confidence 0.9 from the Kraken data. The designer has to undo it. Your "graceful regression" says confidence decreases after 2 consecutive undos -- but can you even detect an undo? Figma's undo is Cmd+Z, which fires as a `documentchange` that reverses the property. Your observer sees "cornerRadius changed from 8 to 20" and interprets it as a NEW preference, not as "the designer undid your auto-applied pattern." How do you distinguish "designer intentionally set 20" from "designer undid your 8 to restore the reference value of 20"?

3. The pattern extraction groups changes by `(role, property)`. But roles are assigned by `extract_som`, which runs on the SOM AFTER the build. Your observer tracks changes by Figma node ID, not by SOM role. To map a node ID to a role, you need to know what role Rex assigned to that node during the build. But Rex creates nodes via `create_node` which returns a Figma node ID -- does Rex store a mapping of "Figma node ID -> SOM role" for every node it creates? If not, how does the observer know that node `123:456` has role "card" vs. role "section"? And if the designer renames the node, does the role mapping become stale?

---

## Proposal 06: Adversarial Filter

**Strength:** This is the only proposal that asks "should we learn this at all?" -- a question that every other proposal ignores and that will determine whether any of them succeed at scale.

1. Your filter requires designer confirmation before any principle is applied (confidence caps at 0.7 without approval). But Proposal 05's entire philosophy is "the designer should never notice the system is learning." These two proposals are directly contradictory. The filter says "always ask before applying." The workflow says "never ask, just apply." Which one wins? If the filter wins, you add friction and the designer stops using the system. If the workflow wins, you apply unconfirmed patterns and risk false positives. You cannot have both zero friction AND explicit confirmation. Which trade-off are you actually recommending?

2. Your taxonomy classifies "removed unnecessary wrapper frames" as AI Error Correction (do not learn). But the designer did this consistently across multiple screens -- it is a RECURRING, ROLE-CONSISTENT, CONTENT-INDEPENDENT, STABLE change. By your own Category 6 criteria, it should be a Genuine Principle. The fact that it originated as an AI error does not make the designer's correction any less of a preference signal. If the AI keeps over-nesting and the designer keeps flattening, your filter routes this "back to the builder" rather than into the principle store -- but who ensures the builder actually gets better? What if the builder CANNOT get better because the reference SOMs from Osiris are inherently over-nested? Then the designer's flattening IS a design principle ("prefer flat hierarchy") that your filter is systematically suppressing.

3. You classify "tinted numpad keys with brand color" as Screen-Specific and discard it. Then you say "if the broader pattern is 'tint interactive elements with brand color,' the filter watches for that generalization." But HOW does it watch? Your filter processes one `CapturedChange` at a time. A single change record says `nodeRole: "numpad-key", property: "fills", valueBefore: "#F5F5F5", valueAfter: "#7B61FF"`. A later change record from a different screen says `nodeRole: "toggle", property: "fills", valueBefore: "#CCCCCC", valueAfter: "#7B61FF"`. These have different roles, different before values, and different node types. The only thing they share is the after value being the brand color. Your recurrence scan groups by `(role, property, direction)` -- but "numpad-key fills" and "toggle fills" are different role-property pairs. What mechanism actually detects the cross-role generalization "tint interactive elements with brand color"? Show me the code path, not the aspiration.

---

## Cross-Cutting Challenge: The Kraken Restructure

Every proposal must answer this concretely: The designer restructured the Kraken payment screen in a single session. They moved the CTA out of the dark content section into its own wrapper frame, changed numpad key spacing from 4 to 0, renamed "Frame 1" to "content-area," flattened the fee-row wrapper, AND changed the root to SPACE_BETWEEN -- all simultaneously, in under 90 seconds.

- **Proposal 01** needs to compute structural fingerprints on two SOMs where the "after" has different topology, different names, and different roles. The normalization step requires solving the structural diff before running the property diff.
- **Proposal 02** matches content-bearing nodes fine but misses the structural changes (new wrapper, removed wrapper, layout mode) because they are on empty frames.
- **Proposal 03** sees "layout feels different" in the screenshot but must map that fuzzy observation to 5 simultaneous property and structural changes via spatial lookup on a dense screen.
- **Proposal 04** just saves the whole refined SOM. It captures everything. But it learns nothing transferable -- next time a different screen needs CTA isolation, the template for THIS screen does not help.
- **Proposal 05** sees individual `documentchange` events for each property but must infer that 5 separate changes constitute one coherent design decision (CTA isolation). It records them as 5 independent property changes.
- **Proposal 06** evaluates each change individually and might classify some as "principle" and others as "screen-specific" -- splitting what was one unified design intention into multiple categories.

None of the proposals handle the case where multiple simultaneous changes represent a single design decision. This is not an edge case -- it is how designers actually work.

## Cross-Cutting Challenge: The Contradiction Test

Screen 1 (Kraken): designer uses cornerRadius 8 for pills.
Screen 47 (fitness app): designer uses cornerRadius 20 for pills because the brand is rounded.

- **Proposals 01, 02, 03, 05** all aggregate by role. They see "pill cornerRadius" with values 8 and 20. Do they create a range rule [8, 20]? That is useless -- it permits any value. Do they create two brand-scoped rules? Then you need brand detection at build time, which none of them specify.
- **Proposal 04** stores two different templates. No contradiction, but no learning transfer either.
- **Proposal 06** might hold both as "ambiguous" indefinitely, never promoting either to a principle.

The question every proposal must answer: how does the system know that two contradictory values from different brands are NOT contradictions, while two contradictory values from the SAME brand ARE contradictions? Brand-awareness is not optional -- it is load-bearing for any system that operates across projects.
