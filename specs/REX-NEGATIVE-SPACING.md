# Rex Feature Spec: Negative Auto-Layout Spacing

## Problem

Figma's auto-layout supports **negative `itemSpacing`** values, which causes child frames to overlap. This is a legitimate and powerful design technique used for:
- Overlapping cards on gradient backgrounds (e.g., card overlaying a hero section)
- Stacked avatar groups (slightly overlapping circles)
- Layered card effects (parallax-style depth)
- Negative margin visual patterns common in modern fintech UI

Rex's `create_node` and `set_auto_layout` tools currently **reject negative spacing values** because the Zod schema enforces `z.number().min(0)`. This blocks generation of screens that use negative spacing, forcing a workaround through the `execute` tool.

### Evidence

Encountered 2026-03-17 when generating `revolut_39` (dark Revolut home screen). The refined version used `itemSpacing: -120` on an overlay container to create a card-overlapping-gradient effect. The `create_node` call failed with:

```
"Invalid parameters for create_node: children.1.autoLayout.spacing:
 Number must be greater than or equal to 0"
```

Workaround was to create with `spacing: 0`, then use `execute` to set negative spacing — breaking the atomic create pattern and requiring extra tool calls.

## Solution

### 1. Schema Change

**File:** `src/tools/schemas.ts`

**Current (lines 215 and 574):**
```typescript
spacing: z.union([z.number().min(0), z.literal("auto")]).optional(),
```

**Proposed:**
```typescript
spacing: z.union([z.number(), z.literal("auto")]).optional(),
```

Remove the `.min(0)` constraint on both occurrences. Figma's API accepts negative values for `itemSpacing`, so the schema should too.

### 2. Affected Tools

| Tool | Schema Location | Change |
|---|---|---|
| `create_node` | `autoLayout.spacing` in `AutoLayoutParamsSchema` (line ~215) | Remove `.min(0)` |
| `set_auto_layout` | `spacing` in `SetAutoLayoutSchema` (line ~574) | Remove `.min(0)` |
| `update_node` | `autoLayout.spacing` — uses same `AutoLayoutParamsSchema` | Inherited from schema change |
| `batch_update_nodes` | `autoLayout.spacing` — uses same schema | Inherited from schema change |

### 3. Plugin Executor

**No change needed.** The plugin executor already passes `itemSpacing` directly to the Figma node:

```typescript
node.itemSpacing = params.spacing;
```

Figma's API accepts negative numbers here. The only validation was in the Zod schema.

### 4. API.md Update

**File:** `specs/API.md`

Update the `AutoLayoutParams` shared type:

**Current:**
```typescript
spacing?: number | "auto"
```

**Proposed — add a note:**
```typescript
spacing?: number | "auto"  // Negative values create overlapping children
```

### 5. SOM Compatibility

The SOM format already stores spacing as a plain number. No SOM schema changes needed.

When Osiris returns a SOM with negative spacing (e.g., from a refined extraction), Rex will now be able to build it directly without workarounds.

### 6. Testing

Add test cases in `src/tests/`:

```typescript
// Should accept negative spacing
test("create_node with negative itemSpacing", async () => {
  const result = await createNode({
    type: "FRAME",
    name: "overlap-container",
    autoLayout: {
      direction: "vertical",
      spacing: -120,
      primaryAxisSizing: "hug",
      counterAxisSizing: "fixed",
    },
    children: [
      { type: "FRAME", name: "child-a", size: { width: 350, height: 200 } },
      { type: "FRAME", name: "child-b", size: { width: 350, height: 300 } },
    ],
  });
  expect(result.autoLayout.spacing).toBe(-120);
});

// Should still accept zero and positive spacing
test("create_node with zero spacing", async () => { /* ... */ });
test("create_node with positive spacing", async () => { /* ... */ });

// set_auto_layout should also accept negative
test("set_auto_layout with negative spacing", async () => {
  await setAutoLayout({ nodeId: "test:1", spacing: -50 });
});
```

### 7. Implementation Effort

**Estimated: ~15 minutes**
- 2 lines changed in `schemas.ts`
- 1 line comment in `API.md`
- 3 test cases added

This is a minimal, low-risk change. The validation was overly restrictive — Figma itself supports the feature.

---

## Priority

**P0** — Blocks SOM round-trip generation. Without this, every screen using negative spacing requires a 2-step workaround (create + execute).
