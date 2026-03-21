# Rex Feature Spec: Enhanced SOM Extraction for v2

## Problem

When Claude extracts a SOM from a refined Figma frame for saving back to Osiris, it currently uses the `execute` tool with custom JavaScript. This works but has limitations:

1. **No role tagging** — extracted SOMs are v1 (no semantic roles). The upcoming `osiris_merge_som` requires v2 SOMs with roles.
2. **Shallow property reading** — the custom `execute` scripts read basic properties (name, type, width, height, text, font) but miss nuances the serializer already captures (effects, strokes, opacity, constraints, layout sizing, min/max dimensions).
3. **Inconsistent format** — each extraction script is hand-written, producing slightly different SOM shapes. There's no standardized extraction.
4. **No content/style separation** — v2 SOMs need content and style as distinct layers on each node.

### What Rex Already Has

The **plugin serializer** (`plugin/serializer.ts`) already extracts:
- ✅ Fills (solid, gradient, image)
- ✅ Strokes (color, weight, align, dash pattern)
- ✅ Effects (drop-shadow, inner-shadow, blur)
- ✅ Opacity
- ✅ Corner radius (uniform and per-corner)
- ✅ Auto-layout (direction, spacing, padding, alignment, sizing)
- ✅ Layout sizing (FILL, HUG, FIXED)
- ✅ Min/max dimensions
- ✅ Constraints
- ✅ Blend mode
- ✅ Clip content
- ✅ Text properties (font, size, weight, color, alignment, decoration)
- ✅ Component key and properties
- ✅ Rotation, visibility, locked state

**The gap is not in reading Figma properties — it's in transforming the serialized output into the SOM v2 format with roles and content/style separation.**

## Solution

### New Tool: `extract_som`

A dedicated Rex MCP tool that extracts a complete SOM v2 from a Figma frame, ready for Osiris storage.

**This is different from `get_node`** — `get_node` returns Rex's internal serialization format. `extract_som` returns the Osiris SOM format with roles.

---

## 1. Tool Definition

### `extract_som` `[plugin]`

Extract a Screen Object Model (SOM v2) from a Figma frame. The SOM includes semantic role tags, content/style separation, and is ready for `osiris_save_screen_som`.

| Param | Type | Required | Description |
|---|---|---|---|
| `nodeId` | `string` | Yes | Root frame to extract from |
| `screenType` | `string` | No | Screen type hint (e.g., "home", "payment", "onboarding") |
| `platform` | `string` | No | Platform hint (default: "mobile") |
| `depth` | `number` | No | Max traversal depth (default: 10) |
| `assignRoles` | `boolean` | No | Auto-assign semantic roles (default: true) |

**Returns:**
```json
{
  "som": {
    "version": 2,
    "platform": "mobile",
    "screenType": "home",
    "referenceFrame": { "width": 390, "height": 844 },
    "root": { /* SOM v2 node tree */ }
  },
  "roleMap": [
    { "nodeId": "23:2563", "nodeName": "revolut-home-dark", "role": "screen", "category": "structure", "confidence": 1.0 },
    { "nodeId": "23:2564", "nodeName": "gradient-header", "role": "hero", "category": "hero", "confidence": 0.95 },
    ...
  ],
  "unknownNodes": ["spacer"],
  "stats": {
    "totalNodes": 42,
    "rolesAssigned": 40,
    "unknownCount": 2,
    "overallConfidence": 0.94
  }
}
```

---

## 2. SOM v2 Node Format

Each node in the extracted SOM has this shape:

```json
{
  "type": "FRAME",
  "name": "verify-card",
  "role": "banner",
  "roleCategory": "feedback",
  "roleConfidence": 0.88,

  "content": {
    "texts": [
      { "role": "label", "value": "Verify your identity" },
      { "role": "prompt", "value": "Keep your account safe and unlock the full Revolut experience" },
      { "role": "label", "value": "Submit documents" }
    ]
  },

  "style": {
    "w": 350,
    "h": 168,
    "fill": "#2A1F4D",
    "cornerRadius": 16,
    "layout": "VERTICAL",
    "padding": 20,
    "gap": 12,
    "effects": [],
    "opacity": 1,
    "clipsContent": true
  },

  "children": [ /* child SOM v2 nodes */ ]
}
```

### Content Layer
Extracted from text nodes and meaningful data:
- `texts[]` — all text content within this node and its descendants, each with a role
- `images[]` — image fill references (imageHash, scaleMode)
- `componentRef` — if this is a component instance, the component key

### Style Layer
All visual properties:
- `w`, `h` — dimensions
- `fill` — primary fill (hex string or gradient object)
- `fills` — full fill array if multiple fills
- `strokes` — stroke array
- `strokeWeight` — stroke weight
- `effects` — effects array (shadows, blurs)
- `opacity` — node opacity
- `cornerRadius` — uniform or per-corner
- `layout` — auto-layout direction
- `padding` — auto-layout padding
- `gap` — auto-layout spacing (including negative)
- `primaryAxisAlign`, `counterAxisAlign` — alignment
- `primaryAxisSizing`, `counterAxisSizing` — sizing mode
- `clipsContent` — clip overflow
- `blendMode` — if not NORMAL

---

## 3. Role Auto-Assignment Algorithm

Implemented in the plugin executor (runs in Figma context with access to the node tree).

```typescript
function assignRole(node: SceneNode): { role: string; category: string; confidence: number } {

  // 1. NAME-BASED MATCHING (highest confidence)
  const namePatterns: Record<string, { role: string; category: string }> = {
    // Structure
    "nav|nav-bar|header|top-bar|navigation": { role: "nav", category: "structure" },
    "bottom-nav|tab-bar|footer-nav": { role: "bottom-nav", category: "structure" },
    "status-bar|system-bar": { role: "status-bar", category: "structure" },
    "tabs|segment|switcher": { role: "tab-bar", category: "structure" },

    // Hero
    "hero|hero-section|gradient-header|banner-hero": { role: "hero", category: "hero" },
    "header-image|cover|splash": { role: "header-image", category: "hero" },
    "carousel|slider|stories": { role: "carousel", category: "hero" },

    // Content
    "card-": { role: "card", category: "content" },
    "section|-section|content-|details-": { role: "section", category: "content" },
    "row-|-row": { role: "row", category: "content" },
    "list|quick-actions|features-": { role: "list", category: "content" },
    "list-item|action-|feature-": { role: "list-item", category: "content" },
    "accordion|expandable": { role: "accordion", category: "content" },

    // Interactive
    "cta|cta-button|-btn|send-btn|confirm-": { role: "cta", category: "interactive" },
    "cta-secondary|outline-btn": { role: "cta-secondary", category: "interactive" },
    "input|search-bar|text-field|amount-": { role: "input", category: "interactive" },
    "toggle|switch": { role: "toggle", category: "interactive" },
    "swipe-|slide-": { role: "swipe-cta", category: "interactive" },

    // Decorative
    "divider|div|separator": { role: "divider", category: "decorative" },
    "pill|chip|badge|tag": { role: "pill", category: "decorative" },
    "icon-|icon": { role: "icon", category: "decorative" },
    "avatar|profile-pic": { role: "avatar", category: "decorative" },

    // Feedback
    "banner|verify-|alert|notification": { role: "banner", category: "feedback" },
    "modal|dialog|popup": { role: "modal", category: "feedback" },
    "bottom-sheet|sheet": { role: "bottom-sheet", category: "feedback" },
    "empty-state|no-data": { role: "empty-state", category: "feedback" },
    "progress|stepper|step-": { role: "progress", category: "feedback" },
    "skeleton|shimmer|loading": { role: "skeleton", category: "feedback" },

    // Data
    "label|-label|metric-label": { role: "label", category: "data" },
    "value|-value|amount-|balance-": { role: "value", category: "data" },
    "prompt|safety-|warning-body|-body": { role: "prompt", category: "data" },
  };

  const nameLower = node.name.toLowerCase();

  for (const [patterns, result] of Object.entries(namePatterns)) {
    for (const pattern of patterns.split("|")) {
      if (nameLower.includes(pattern.trim())) {
        return { ...result, confidence: 0.9 };
      }
    }
  }

  // 2. TYPE-BASED INFERENCE (medium confidence)
  if (node.type === "ELLIPSE") {
    return { role: "avatar", category: "decorative", confidence: 0.6 };
  }
  if (node.type === "TEXT") {
    // Determine if label or value based on font weight and content
    const textNode = node as TextNode;
    const weight = textNode.fontWeight;
    if (typeof weight === "number" && weight >= 600) {
      return { role: "value", category: "data", confidence: 0.5 };
    }
    return { role: "label", category: "data", confidence: 0.5 };
  }
  if (node.type === "LINE") {
    return { role: "divider", category: "decorative", confidence: 0.8 };
  }

  // 3. POSITION-BASED INFERENCE (lower confidence)
  if (node.type === "FRAME") {
    const parent = node.parent;
    if (parent && "height" in parent) {
      const parentHeight = (parent as FrameNode).height;
      // Bottom 100px → likely bottom-nav
      if (node.y > parentHeight - 100 && node.height < 100) {
        return { role: "bottom-nav", category: "structure", confidence: 0.4 };
      }
      // Top 80px → likely nav
      if (node.y < 80 && node.height < 80) {
        return { role: "nav", category: "structure", confidence: 0.4 };
      }
    }

    // Has gradient fill → likely hero
    const fills = "fills" in node ? (node as FrameNode).fills : [];
    if (fills !== figma.mixed) {
      for (const fill of fills as Paint[]) {
        if (fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL") {
          return { role: "hero", category: "hero", confidence: 0.5 };
        }
      }
    }
  }

  // 4. FALLBACK
  if (node.type === "FRAME" && "children" in node) {
    // Frame with children but no match → generic section
    return { role: "section", category: "content", confidence: 0.3 };
  }

  return { role: "unknown", category: "unknown", confidence: 0 };
}
```

### Confidence Levels
- **0.9** — Name-based match (highest reliability)
- **0.5-0.8** — Type/property-based inference
- **0.3-0.4** — Position-based guess
- **0** — Unknown (flagged for AI review)

---

## 4. Content Extraction

For each node, extract text content recursively:

```typescript
function extractContent(node: SceneNode): ContentLayer {
  const content: ContentLayer = { texts: [] };

  function walkTexts(n: SceneNode) {
    if (n.type === "TEXT") {
      const textNode = n as TextNode;
      const roleResult = assignRole(n);
      content.texts.push({
        role: roleResult.role, // "label", "value", or "prompt"
        value: textNode.characters,
        nodeId: n.id,
      });
    }
    if ("children" in n) {
      for (const child of (n as ChildrenMixin).children) {
        walkTexts(child as SceneNode);
      }
    }
  }

  walkTexts(node);

  // Extract image references
  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed) {
      for (const fill of fills as Paint[]) {
        if (fill.type === "IMAGE") {
          if (!content.images) content.images = [];
          content.images.push({
            imageHash: (fill as ImagePaint).imageHash,
            scaleMode: (fill as ImagePaint).scaleMode,
          });
        }
      }
    }
  }

  // Extract component reference
  if (node.type === "INSTANCE") {
    const instance = node as InstanceNode;
    if (instance.mainComponent) {
      content.componentRef = instance.mainComponent.key;
    }
  }

  return content;
}
```

---

## 5. Style Extraction

Extract all visual properties into the style layer:

```typescript
function extractStyle(node: SceneNode): StyleLayer {
  const style: StyleLayer = {
    w: Math.round(node.width),
    h: Math.round(node.height),
  };

  // Fills
  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed) {
      const serialized = serializePaints(fills as Paint[]);
      if (serialized.length === 1 && serialized[0].type === "solid") {
        style.fill = serialized[0].color;
      } else if (serialized.length > 0) {
        style.fills = serialized;
      }
    }
  }

  // Strokes
  if ("strokes" in node) {
    const strokes = (node as GeometryMixin).strokes;
    const serialized = serializePaints(strokes);
    if (serialized.length > 0) {
      style.strokes = serialized;
      if ("strokeWeight" in node) {
        const sw = (node as GeometryMixin).strokeWeight;
        if (sw !== figma.mixed) style.strokeWeight = sw;
      }
    }
  }

  // Effects
  if ("effects" in node) {
    const effects = (node as BlendMixin).effects;
    if (effects.length > 0) style.effects = serializeEffects(effects);
  }

  // Opacity
  if (node.opacity !== 1) style.opacity = Math.round(node.opacity * 100) / 100;

  // Corner radius
  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr !== figma.mixed && cr !== 0) {
      style.cornerRadius = cr;
    } else if (cr === figma.mixed) {
      const rn = node as RectangleNode;
      style.cornerRadius = {
        topLeft: rn.topLeftRadius,
        topRight: rn.topRightRadius,
        bottomRight: rn.bottomRightRadius,
        bottomLeft: rn.bottomLeftRadius,
      };
    }
  }

  // Auto-layout
  if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
    const frame = node as FrameNode;
    style.layout = frame.layoutMode === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL";
    style.gap = frame.itemSpacing; // supports negative values
    style.primaryAxisAlign = frame.primaryAxisAlignItems;
    style.counterAxisAlign = frame.counterAxisAlignItems;
    style.primaryAxisSizing = frame.primaryAxisSizingMode;
    style.counterAxisSizing = frame.counterAxisSizingMode;

    // Padding
    const p = {
      top: frame.paddingTop,
      right: frame.paddingRight,
      bottom: frame.paddingBottom,
      left: frame.paddingLeft,
    };
    if (p.top === p.right && p.right === p.bottom && p.bottom === p.left) {
      style.padding = p.top;
    } else {
      style.padding = p;
    }
  }

  // Clips content
  if ("clipsContent" in node) {
    style.clipsContent = (node as FrameNode).clipsContent;
  }

  // Blend mode
  if ("blendMode" in node) {
    const bm = (node as BlendMixin).blendMode;
    if (bm !== "NORMAL" && bm !== "PASS_THROUGH") style.blendMode = bm;
  }

  return style;
}
```

---

## 6. Implementation Architecture

### Where the code lives

```
plugin/
  executors/
    som-extractor.ts   ← NEW: SOM v2 extraction logic
                          (role assignment, content/style split)
  serializer.ts        ← EXISTING: reuse serializePaints, serializeEffects,
                          serializeTextStyle (no changes needed)

src/
  tools/
    read/
      extract-som.ts   ← NEW: MCP tool handler for extract_som
    schemas.ts         ← ADD: ExtractSomSchema
```

### Execution Flow

```
1. Claude calls extract_som(nodeId: "23:2563")
2. Rex MCP server receives the request
3. Rex sends command to plugin via relay
4. Plugin executor runs som-extractor.ts:
   a. Walks the node tree starting from nodeId
   b. For each node:
      - Calls assignRole() → role, category, confidence
      - Calls extractContent() → texts, images, componentRef
      - Calls extractStyle() → fills, strokes, effects, layout...
      - Assembles SOM v2 node
   c. Builds roleMap summary
   d. Identifies unknownNodes
   e. Calculates stats
5. Returns complete SOM v2 + metadata to Rex server
6. Rex server returns to Claude
7. Claude reviews roleMap (AI validation)
8. Claude sends to osiris_save_screen_som if approved
```

---

## 7. Relationship to Existing Serializer

**Do NOT modify the existing serializer.** It serves a different purpose:
- `serializer.ts` → used by `get_node` for general-purpose Figma node inspection
- `som-extractor.ts` → used by `extract_som` for SOM-specific output with roles

The SOM extractor **reuses** serializer utility functions:
- `serializePaints()` — for fills and strokes
- `serializeEffects()` — for shadows and blurs
- `serializeTextStyle()` — for typography
- `colorToHex()` — for color conversion

But it produces a **different output shape** (SOM v2 format, not Rex serialization format).

---

## 8. Testing

```typescript
describe("extract_som", () => {
  test("extracts v2 SOM with roles from a frame", async () => {
    const result = await extractSom({ nodeId: "test:root" });
    expect(result.som.version).toBe(2);
    expect(result.som.root.role).toBe("screen");
    expect(result.som.root.roleCategory).toBe("structure");
    expect(result.roleMap.length).toBeGreaterThan(0);
  });

  test("assigns roles based on node names", async () => {
    const result = await extractSom({ nodeId: "test:root" });
    const heroNode = result.roleMap.find(r => r.nodeName === "gradient-header");
    expect(heroNode?.role).toBe("hero");
    expect(heroNode?.category).toBe("hero");
    expect(heroNode?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("separates content and style layers", async () => {
    const result = await extractSom({ nodeId: "test:root" });
    const card = findNode(result.som.root, "verify-card");
    expect(card.content.texts.length).toBeGreaterThan(0);
    expect(card.style.fill).toBeDefined();
    expect(card.style.cornerRadius).toBeDefined();
  });

  test("flags unknown nodes", async () => {
    const result = await extractSom({ nodeId: "test:root" });
    expect(result.unknownNodes).toContain("spacer");
    expect(result.stats.unknownCount).toBeGreaterThan(0);
  });

  test("handles negative spacing", async () => {
    const result = await extractSom({ nodeId: "test:overlap" });
    const overlayNode = findNode(result.som.root, "overlay-content");
    expect(overlayNode.style.gap).toBeLessThan(0);
  });

  test("extracts effects and opacity", async () => {
    const result = await extractSom({ nodeId: "test:shadow-card" });
    const card = findNode(result.som.root, "shadow-card");
    expect(card.style.effects).toBeDefined();
    expect(card.style.effects.length).toBeGreaterThan(0);
  });
});
```

---

## 9. Implementation Priority

| Phase | What | Effort |
|---|---|---|
| P0 | `ExtractSomSchema` in schemas.ts | 15 min |
| P0 | `som-extractor.ts` — role assignment function | 1-2 hours |
| P1 | `som-extractor.ts` — content/style extraction | 1-2 hours |
| P1 | `extract-som.ts` — MCP tool handler + wiring | 30 min |
| P2 | Tests | 1 hour |
| P2 | API.md documentation | 30 min |

**Total estimated effort: 4-6 hours**

---

## 10. Dependencies

| Dependency | Status | Impact |
|---|---|---|
| `REX-NEGATIVE-SPACING` | Spec complete, not implemented | SOM extraction reads negative spacing fine (Figma API returns it). But building FROM the extracted SOM requires the spacing fix. |
| `SOM-MERGE.md` (Osiris) | Spec complete, being built | `extract_som` produces v2 SOMs that Osiris needs for merge. |
| Role taxonomy | Defined in `SOM-MERGE.md` | `extract_som` implements the auto-assignment algorithm from the taxonomy. |
