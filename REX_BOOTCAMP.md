# Rex Bootcamp

Rex is an MCP server for programmatic Figma canvas read/write. Plugin must be running in Figma Desktop.

## Workflow: Read → Plan → Build → Verify

1. `get_page` or `get_selection` to understand current state
2. Plan node tree structure before creating
3. `create_node` with full children tree in one call (atomic)
4. `screenshot` to verify result

## Tool Cheatsheet

### Read (no plugin needed unless marked [P])

| Tool | Use | Key Params |
|------|-----|------------|
| `get_node` | Inspect nodes | `nodeIds`, `depth` (max 5), `properties` filter |
| `get_selection` [P] | What user selected | `includeChildren`, `depth` |
| `get_page` | Page structure | `pageId`, `depth`, `verbosity`: summary/standard/full |
| `search_nodes` [P] | Find by name/type | `query`, `type`, `withinId`, `limit` (default 20) |
| `screenshot` [P] | Visual check | `nodeId`, `format`, `scale` (0.5-4) |
| `get_styles` | File styles | `types` filter |
| `get_variables` | Variables/tokens | `collection`, `namePattern`, `resolvedType` |
| `get_components` | Components | `query`, `includeVariants`, `limit` |

### Write — Nodes

| Tool | Use | Key Params |
|------|-----|------------|
| `create_node` | Create node tree | `type`, `parentId`, `children[]` (recursive), all style props inline |
| `update_node` | Modify any props | `nodeId` + any combo of props |
| `delete_nodes` | Remove nodes | `nodeIds[]` (1-50) |
| `clone_node` | Duplicate | `nodeId`, `parentId`, `position` |
| `reparent_node` | Move to parent | `nodeId`, `parentId`, `index` |
| `reorder_children` | Z-order | `parentId`, `childIds[]` (first=bottom) |

### Write — Text

`set_text`: `nodeId`, `text`, `style` (TextStyle), `styleRanges[]` for mixed styling.

**TextStyle**: `fontFamily`, `fontWeight` (100-900), `fontSize`, `lineHeight`, `color` (hex), `textAlignHorizontal`, `textAutoResize`.

### Write — Visual

| Tool | Params |
|------|--------|
| `set_fills` | `nodeId`, `fills[]` |
| `set_strokes` | `nodeId`, `strokes[]`, `strokeWeight`, `strokeAlign`, `dashPattern` |
| `set_effects` | `nodeId`, `effects[]` |
| `set_corner_radius` | `nodeId`, `radius` (number or per-corner object) |

**Fill types**: `{ type: "solid", color: "#HEX" }`, `{ type: "linear-gradient", stops, angle }`, `{ type: "radial-gradient", stops }`, `{ type: "image", imageHash, scaleMode }`

**Effect types**: `drop-shadow` / `inner-shadow` (`color`, `offset`, `blur`, `spread`), `layer-blur` / `background-blur` (`blur`)

### Write — Layout

| Tool | Use |
|------|-----|
| `set_auto_layout` | `nodeId`, `direction`, `spacing`, `padding`, `primaryAxisAlign`, `counterAxisAlign`, `primaryAxisSizing`, `counterAxisSizing` |
| `set_layout_child` | `nodeId`, `alignSelf`, `grow` (0=fixed, 1=fill), `positioning` |
| `set_layout_grid` | `nodeId`, `grids[]` (columns/rows/grid) |
| `set_constraints` | `nodeId`, `horizontal`, `vertical` (min/center/max/stretch/scale) |

**Auto-layout values**: direction=`horizontal`/`vertical`, spacing=number/`"auto"`, padding=number/{top,right,bottom,left}, sizing=`fixed`/`hug`, align=`min`/`center`/`max`/`space-between`/`baseline`

### Write — Components

| Tool | Use |
|------|-----|
| `instantiate_component` | `componentKey` or `nodeId`, `parentId`, `variant`, `overrides` |
| `set_instance_properties` | `nodeId`, `properties`, `resetOverrides` |
| `create_component` | Convert frame: `nodeId` |
| `create_component_set` | Group variants: `componentIds[]` |

### Write — Variables

| Tool | Use |
|------|-----|
| `create_variable_collection` | `name`, `initialModeName`, `additionalModes` |
| `create_variables` | `collectionId`, `variables[]` (name, resolvedType, valuesByMode) |
| `update_variables` | `updates[]` (variableId, modeId, value) |
| `setup_design_tokens` | Atomic: `collectionName`, `modes[]`, `tokens[]` |

### Write — Pages

`create_page`, `rename_page`, `delete_page`, `set_current_page`

### Utility

| Tool | Use |
|------|-----|
| `execute` | Raw JS in Figma context (escape hatch). No fetch, no __html__. Max 30s. |
| `get_status` | Connection health, queue stats |
| `batch_execute` | Multiple ops atomic. `operations[]` [{tool, params}] |

## Patterns

### Composite creation (prefer this over individual calls)

```json
{
  "type": "FRAME",
  "name": "Card",
  "size": { "width": 320 },
  "fills": [{ "type": "solid", "color": "#FFFFFF" }],
  "cornerRadius": 12,
  "effects": [{ "type": "drop-shadow", "color": "#00000014", "offset": { "x": 0, "y": 4 }, "blur": 16 }],
  "autoLayout": {
    "direction": "vertical",
    "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 },
    "spacing": 16,
    "primaryAxisSizing": "auto",
    "counterAxisSizing": "fixed"
  },
  "children": [
    {
      "type": "TEXT", "name": "Title", "text": "Hello",
      "textStyle": { "fontSize": 24, "fontWeight": 700, "fontFamily": "Inter" },
      "layoutChild": { "alignSelf": "stretch" }
    }
  ]
}
```

### Fill-width children in auto-layout
`"layoutChild": { "alignSelf": "stretch" }` — stretches cross-axis.
`"layoutChild": { "grow": 1 }` — fills main-axis.

### Button pattern
Frame + auto-layout horizontal + padding + text child. No need for separate shape.

### Batch updates (modify multiple nodes at once)
Use `batch_update_nodes` with `updates[]` array (1-50 nodes).

### Design tokens in one shot
Use `setup_design_tokens` — creates collection + modes + all variables atomically.

## Key Rules

- **Colors**: Always hex strings. `"#RRGGBB"` or `"#RRGGBBAA"` for alpha.
- **Fonts**: Inter and Plus Jakarta Sans are pre-loaded. Others load on demand.
- **Node types**: FRAME, RECTANGLE, ELLIPSE, TEXT, LINE, POLYGON, STAR, VECTOR, SECTION, COMPONENT, COMPONENT_SET
- **IDs**: Node IDs look like `"123:456"`. Always get fresh IDs from read tools.
- **Atomic**: Composite creates roll back entirely on failure.
- **One call > many calls**: Prefer `create_node` with children over creating individually. Prefer `update_node` with multiple props over separate set_fills + set_effects.
- **Screenshot after writes**: Always verify visually.
- **`primaryAxisSizing: "auto"`** = hug contents. `"fixed"` = explicit size.
- **`counterAxisSizing: "fixed"`** on parent + `alignSelf: "stretch"` on child = child fills width.
