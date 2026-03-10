# Rex — Tool API Reference

> Complete tool definitions for the Rex MCP server.
> All tools use JSON Schema for input validation via Zod.

---

## Table of Contents

1. [Read Tools](#1-read-tools)
2. [Write Tools — Nodes](#2-write-tools--nodes)
3. [Write Tools — Text](#3-write-tools--text)
4. [Write Tools — Visual Properties](#4-write-tools--visual-properties)
5. [Write Tools — Layout](#5-write-tools--layout)
6. [Write Tools — Components](#6-write-tools--components)
7. [Write Tools — Variables & Tokens](#7-write-tools--variables--tokens)
8. [Write Tools — Page & Document](#8-write-tools--page--document)
9. [Write Tools — Comments](#9-write-tools--comments)
10. [Utility Tools](#10-utility-tools)
11. [Shared Types](#11-shared-types)

---

## Conventions

- **`nodeId`** — Figma node ID string (e.g., `"123:456"`)
- All color values are hex strings: `"#FF0000"`, `"#FF000080"` (with alpha)
- Dimensions are in pixels (numbers)
- Optional fields are marked with `?`
- Tools return structured JSON (never raw strings)
- Error responses follow the format in SPEC.md §5.2

---

## 1. Read Tools

Read tools use the Figma REST API where possible (no plugin required).
Tools marked with `[plugin]` require the Figma plugin to be connected.

---

### `get_node`

Get detailed data for one or more nodes.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeIds` | `string[]` | Yes | Node IDs to retrieve |
| `depth` | `number` | No | Child traversal depth (default: 1, max: 5) |
| `properties` | `string[]` | No | Filter to specific properties (e.g., `["fills", "autoLayout"]`) |

**Returns:** Array of node objects with requested properties.

---

### `get_selection` `[plugin]`

Get the currently selected nodes in Figma.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `includeChildren` | `boolean` | No | Include children of selected nodes (default: false) |
| `depth` | `number` | No | Child depth if includeChildren is true (default: 1) |

**Returns:** Array of selected node objects.

---

### `get_page`

Get page structure and metadata.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pageId` | `string` | No | Specific page ID (default: current page) |
| `depth` | `number` | No | Traversal depth (default: 1) |
| `verbosity` | `"summary" \| "standard" \| "full"` | No | Detail level (default: "summary") |

**Returns:** Page node with children at requested depth/verbosity.

---

### `search_nodes` `[plugin]`

Search for nodes by name, type, or properties.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | No | Search by node name (substring match) |
| `type` | `NodeType` | No | Filter by node type |
| `withinId` | `string` | No | Scope search to children of this node |
| `hasAutoLayout` | `boolean` | No | Filter to nodes with auto-layout |
| `hasChildren` | `boolean` | No | Filter to container nodes |
| `limit` | `number` | No | Max results (default: 20) |

**Returns:** Array of matching node summaries (id, name, type, parent).

---

### `screenshot` `[plugin]`

Capture a screenshot of a node or the current page.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | No | Node to capture (default: current page) |
| `format` | `"png" \| "jpg" \| "svg"` | No | Image format (default: "png") |
| `scale` | `number` | No | Scale factor 0.5-4 (default: 2) |

**Returns:** Base64-encoded image data with dimensions.

---

### `get_styles`

Get all styles from the current file.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `types` | `("fill" \| "text" \| "effect" \| "grid")[]` | No | Filter by style type |

**Returns:** Array of style definitions with resolved values.

---

### `get_variables`

Get variables and collections from the current file.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `collection` | `string` | No | Filter by collection name (substring) |
| `namePattern` | `string` | No | Filter by variable name (regex) |
| `resolvedType` | `"COLOR" \| "FLOAT" \| "STRING" \| "BOOLEAN"` | No | Filter by type |
| `resolveAliases` | `boolean` | No | Resolve alias chains to final values (default: false) |

**Returns:** Collections with their variables and values per mode.

---

### `get_components`

Get published components and component sets.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | No | Search by component name |
| `includeVariants` | `boolean` | No | Include variant details (default: false) |
| `limit` | `number` | No | Max results (default: 25) |

**Returns:** Array of component definitions with keys and properties.

---

## 2. Write Tools — Nodes

### `create_node`

Create a single node or a composite node tree. This is the primary creation tool.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `NodeType` | Yes | Node type to create |
| `parentId` | `string` | No | Parent node (default: current page) |
| `name` | `string` | No | Node name |
| `position` | `{ x: number, y: number }` | No | Position within parent |
| `size` | `{ width: number, height?: number }` | No | Dimensions (height defaults to width for shapes) |
| `fills` | `Fill[]` | No | Fill paints |
| `strokes` | `Stroke[]` | No | Stroke paints |
| `strokeWeight` | `number` | No | Stroke thickness |
| `effects` | `Effect[]` | No | Effects (shadows, blur) |
| `cornerRadius` | `number \| CornerRadius` | No | Corner radius (uniform or per-corner) |
| `opacity` | `number` | No | Opacity 0-1 |
| `autoLayout` | `AutoLayoutParams` | No | Auto-layout configuration |
| `layoutGrids` | `LayoutGrid[]` | No | Layout grids |
| `constraints` | `Constraints` | No | Constraints (non-AL frames) |
| `text` | `string` | No | Text content (TEXT nodes only) |
| `textStyle` | `TextStyle` | No | Text styling (TEXT nodes only) |
| `children` | `CreateNodeParams[]` | No | Child nodes (recursive) |

**`NodeType` enum:**
```
FRAME | RECTANGLE | ELLIPSE | TEXT | LINE | POLYGON |
STAR | VECTOR | SECTION | COMPONENT | COMPONENT_SET
```

**Returns:**
```json
{
  "nodeId": "123:456",
  "name": "Card",
  "type": "FRAME",
  "children": [
    { "nodeId": "123:457", "name": "Title", "type": "TEXT" },
    { "nodeId": "123:458", "name": "Body", "type": "TEXT" }
  ]
}
```

**Example — create a styled card with auto-layout and children:**
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
      "type": "TEXT",
      "name": "Title",
      "text": "Card Title",
      "textStyle": { "fontSize": 24, "fontWeight": 700, "fontFamily": "Inter" },
      "layoutChild": { "alignSelf": "stretch" }
    },
    {
      "type": "TEXT",
      "name": "Description",
      "text": "Card description text goes here.",
      "textStyle": { "fontSize": 16, "fontFamily": "Inter", "lineHeight": { "value": 150, "unit": "percent" } },
      "layoutChild": { "alignSelf": "stretch" }
    },
    {
      "type": "FRAME",
      "name": "Actions",
      "autoLayout": { "direction": "horizontal", "spacing": 8, "primaryAxisSizing": "auto", "counterAxisSizing": "auto" },
      "children": [
        {
          "type": "FRAME",
          "name": "Button",
          "fills": [{ "type": "solid", "color": "#0033B8" }],
          "cornerRadius": 8,
          "autoLayout": { "direction": "horizontal", "padding": { "top": 10, "right": 20, "bottom": 10, "left": 20 } },
          "children": [
            {
              "type": "TEXT",
              "text": "Action",
              "textStyle": { "fontSize": 14, "fontWeight": 600, "fontFamily": "Inter", "color": "#FFFFFF" }
            }
          ]
        }
      ]
    }
  ]
}
```

---

### `update_node`

Update one or more properties on an existing node. Batch-friendly — set any combination of properties in a single call.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Target node |
| `name` | `string` | No | Rename |
| `position` | `{ x: number, y: number }` | No | Move |
| `size` | `{ width?: number, height?: number }` | No | Resize |
| `fills` | `Fill[]` | No | Replace fills |
| `strokes` | `Stroke[]` | No | Replace strokes |
| `strokeWeight` | `number` | No | Stroke thickness |
| `effects` | `Effect[]` | No | Replace effects |
| `cornerRadius` | `number \| CornerRadius` | No | Corner radius |
| `opacity` | `number` | No | Opacity 0-1 |
| `visible` | `boolean` | No | Show/hide |
| `locked` | `boolean` | No | Lock/unlock |
| `blendMode` | `BlendMode` | No | Blend mode |
| `clipsContent` | `boolean` | No | Clip content to frame |
| `autoLayout` | `AutoLayoutParams` | No | Set/update auto-layout |
| `layoutGrids` | `LayoutGrid[]` | No | Set/update grids |
| `constraints` | `Constraints` | No | Set/update constraints |
| `layoutChild` | `LayoutChildParams` | No | Update this node's layout behavior in parent |

**Returns:** Updated node summary.

---

### `batch_update_nodes`

Update multiple nodes in a single atomic operation.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `updates` | `UpdateNodeParams[]` | Yes | Array of update operations (1-50) |

Each entry in `updates` has the same shape as `update_node` params.

**Returns:** Array of updated node summaries. If any update fails, all are rolled back.

---

### `delete_nodes`

Delete one or more nodes.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeIds` | `string[]` | Yes | Nodes to delete (1-50) |

**Returns:** `{ deleted: string[], notFound: string[] }`

---

### `clone_node`

Duplicate a node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Node to clone |
| `parentId` | `string` | No | New parent (default: same parent) |
| `position` | `{ x: number, y: number }` | No | Position for clone |
| `name` | `string` | No | Name for clone |

**Returns:** Cloned node summary with new nodeId.

---

### `reparent_node`

Move a node to a different parent, optionally at a specific index.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Node to move |
| `parentId` | `string` | Yes | New parent |
| `index` | `number` | No | Insertion index in parent's children (default: append) |

**Returns:** Updated node summary.

---

### `reorder_children`

Reorder children within a parent (z-index control).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `parentId` | `string` | Yes | Parent node |
| `childIds` | `string[]` | Yes | Children in desired order (first = bottommost) |

**Returns:** Updated parent summary.

---

## 3. Write Tools — Text

### `set_text`

Set text content and optionally style it. Handles font loading automatically.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Text node ID |
| `text` | `string` | No | New text content |
| `style` | `TextStyle` | No | Text styling |
| `styleRanges` | `TextStyleRange[]` | No | Mixed styling (bold part of text, etc.) |

**`TextStyle` object:**
```typescript
{
  fontFamily?: string       // e.g., "Inter", "Plus Jakarta Sans"
  fontWeight?: number       // 100-900
  fontSize?: number         // in px
  lineHeight?: number | { value: number, unit: "percent" | "pixels" }
  letterSpacing?: number | { value: number, unit: "percent" | "pixels" }
  color?: string            // hex color for text fill
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED"
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM"
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH"
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE"
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE"
  maxLines?: number         // truncation limit
  paragraphSpacing?: number
}
```

**`TextStyleRange` object:**
```typescript
{
  start: number     // character offset
  end: number       // character offset
  style: TextStyle  // style to apply to this range
}
```

**Returns:** Updated text node summary.

---

## 4. Write Tools — Visual Properties

### `set_fills`

Set fill paints on a node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Target node |
| `fills` | `Fill[]` | Yes | Fill paints |

**`Fill` types:**
```typescript
// Solid fill
{ type: "solid", color: string, opacity?: number }

// Linear gradient
{
  type: "linear-gradient",
  stops: { position: number, color: string }[],
  angle?: number  // degrees, default 180 (top to bottom)
}

// Radial gradient
{
  type: "radial-gradient",
  stops: { position: number, color: string }[],
  center?: { x: number, y: number }  // 0-1 normalized
}

// Image fill
{
  type: "image",
  imageHash: string,
  scaleMode?: "FILL" | "FIT" | "CROP" | "TILE"
}
```

---

### `set_strokes`

Set strokes on a node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Target node |
| `strokes` | `Stroke[]` | Yes | Stroke paints (same types as Fill) |
| `strokeWeight` | `number` | No | Thickness in px |
| `strokeAlign` | `"INSIDE" \| "OUTSIDE" \| "CENTER"` | No | Alignment |
| `dashPattern` | `number[]` | No | Dash array (e.g., `[4, 4]`) |
| `strokeCap` | `"NONE" \| "ROUND" \| "SQUARE" \| "ARROW_LINES" \| "ARROW_EQUILATERAL"` | No | Line cap |
| `strokeJoin` | `"MITER" \| "BEVEL" \| "ROUND"` | No | Line join |

---

### `set_effects`

Set effects (shadows, blur) on a node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Target node |
| `effects` | `Effect[]` | Yes | Effect list |

**`Effect` types:**
```typescript
// Drop shadow
{
  type: "drop-shadow",
  color: string,          // hex with alpha
  offset: { x: number, y: number },
  blur: number,
  spread?: number,
  visible?: boolean
}

// Inner shadow
{
  type: "inner-shadow",
  color: string,
  offset: { x: number, y: number },
  blur: number,
  spread?: number,
  visible?: boolean
}

// Layer blur
{
  type: "layer-blur",
  blur: number,
  visible?: boolean
}

// Background blur
{
  type: "background-blur",
  blur: number,
  visible?: boolean
}
```

---

### `set_corner_radius`

Set corner radius on a node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Target node |
| `radius` | `number \| CornerRadius` | Yes | Uniform or per-corner |

**`CornerRadius` object:**
```typescript
{
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number
}
```

---

## 5. Write Tools — Layout

### `set_auto_layout`

Configure auto-layout on a frame. Can also remove auto-layout.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Frame node |
| `enabled` | `boolean` | No | Set false to remove auto-layout |
| `direction` | `"horizontal" \| "vertical"` | No | Layout direction |
| `wrap` | `boolean` | No | Enable wrap (creates "WRAP" mode) |
| `spacing` | `number \| "auto"` | No | Item spacing (`"auto"` = space-between) |
| `padding` | `number \| Padding` | No | Uniform or per-side padding |
| `primaryAxisAlign` | `"min" \| "center" \| "max" \| "space-between"` | No | Main axis alignment |
| `counterAxisAlign` | `"min" \| "center" \| "max" \| "baseline"` | No | Cross axis alignment |
| `primaryAxisSizing` | `"fixed" \| "hug"` | No | Main axis sizing |
| `counterAxisSizing` | `"fixed" \| "hug"` | No | Cross axis sizing |
| `strokesIncludedInLayout` | `boolean` | No | Include strokes in layout |
| `itemReverseZIndex` | `boolean` | No | Reverse z-order |

**`Padding` object:**
```typescript
{
  top: number,
  right: number,
  bottom: number,
  left: number
}
```

**Shorthand:** A single `number` applies uniform padding to all sides.

**Returns:** Updated node with layout properties.

**Example — vertical stack with padding and gap:**
```json
{
  "nodeId": "123:456",
  "direction": "vertical",
  "spacing": 16,
  "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 },
  "primaryAxisSizing": "auto",
  "counterAxisSizing": "fixed",
  "counterAxisAlign": "min"
}
```

---

### `set_layout_child`

Configure how a child behaves within its auto-layout parent.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Child node |
| `alignSelf` | `"inherit" \| "stretch"` | No | Cross-axis alignment override |
| `grow` | `number` | No | `0` = fixed, `1` = fill container |
| `positioning` | `"auto" \| "absolute"` | No | Layout positioning mode |
| `position` | `{ x: number, y: number }` | No | Position (only for absolute) |
| `horizontalConstraint` | `"min" \| "center" \| "max" \| "stretch" \| "scale"` | No | Horizontal constraint (absolute only) |
| `verticalConstraint` | `"min" \| "center" \| "max" \| "stretch" \| "scale"` | No | Vertical constraint (absolute only) |

**Returns:** Updated child node summary.

**Example — make a child fill the container width:**
```json
{
  "nodeId": "123:457",
  "alignSelf": "stretch",
  "grow": 1
}
```

---

### `batch_set_layout_children`

Configure multiple children's layout behavior in one call.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `parentId` | `string` | Yes | Parent frame with auto-layout |
| `children` | `LayoutChildUpdate[]` | Yes | Array of child updates |

**`LayoutChildUpdate`:**
```typescript
{
  nodeId: string,
  alignSelf?: "inherit" | "stretch",
  grow?: number,
  positioning?: "auto" | "absolute"
}
```

---

### `set_layout_grid`

Set layout grids on a frame.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Frame node |
| `grids` | `LayoutGrid[]` | Yes | Grid configurations |

**`LayoutGrid` types:**
```typescript
// Column grid
{
  pattern: "columns",
  count: number,           // number of columns
  gutterSize: number,      // gap between columns
  alignment: "min" | "center" | "max" | "stretch",
  offset?: number,         // margin from edge
  sectionSize?: number,    // column width (if not stretch)
  color?: string           // grid color (hex with alpha, for Figma display)
}

// Row grid
{
  pattern: "rows",
  count: number,
  gutterSize: number,
  alignment: "min" | "center" | "max" | "stretch",
  offset?: number,
  sectionSize?: number,
  color?: string
}

// Uniform grid
{
  pattern: "grid",
  sectionSize: number,     // cell size
  color?: string
}
```

**Example — 12-column grid with 24px gutters:**
```json
{
  "nodeId": "123:456",
  "grids": [
    {
      "pattern": "columns",
      "count": 12,
      "gutterSize": 24,
      "alignment": "stretch",
      "offset": 0
    }
  ]
}
```

---

### `set_constraints`

Set constraints for a node inside a non-auto-layout frame.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Target node |
| `horizontal` | `"min" \| "center" \| "max" \| "stretch" \| "scale"` | No | Horizontal constraint |
| `vertical` | `"min" \| "center" \| "max" \| "stretch" \| "scale"` | No | Vertical constraint |

**Mapping to Figma terms:**
| Value | Figma UI term |
|-------|--------------|
| `"min"` | Left / Top |
| `"center"` | Center |
| `"max"` | Right / Bottom |
| `"stretch"` | Left & Right / Top & Bottom |
| `"scale"` | Scale |

---

## 6. Write Tools — Components

### `instantiate_component`

Create an instance of a component from the document or a library.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `componentKey` | `string` | No | Component key (published components) |
| `nodeId` | `string` | No | Component node ID (local components) |
| `parentId` | `string` | No | Parent for the instance |
| `position` | `{ x: number, y: number }` | No | Position |
| `variant` | `Record<string, string>` | No | Variant property values |
| `overrides` | `Record<string, string \| boolean>` | No | Property overrides |

Must provide either `componentKey` or `nodeId`.

**Returns:** Instance node summary with component info.

---

### `set_instance_properties`

Update properties on a component instance.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Instance node |
| `properties` | `Record<string, string \| boolean>` | Yes | Property values |
| `resetOverrides` | `string[]` | No | Property names to reset to default |

**Returns:** Updated instance summary.

---

### `create_component`

Convert an existing frame to a component.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Frame to convert |
| `description` | `string` | No | Component description |

**Returns:** Component node with key.

---

### `create_component_set`

Combine multiple components into a component set (variant group).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `componentIds` | `string[]` | Yes | Component nodes to combine |
| `name` | `string` | No | Component set name |

**Returns:** Component set node.

---

### `add_component_property`

Add a property to a component or component set.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Component or component set |
| `name` | `string` | Yes | Property name |
| `type` | `"BOOLEAN" \| "TEXT" \| "INSTANCE_SWAP" \| "VARIANT"` | Yes | Property type |
| `defaultValue` | `string \| boolean` | Yes | Default value |

---

### `edit_component_property`

Modify an existing component property.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Component or component set |
| `propertyName` | `string` | Yes | Full property name (with suffix) |
| `name` | `string` | No | New name |
| `defaultValue` | `string \| boolean` | No | New default value |

---

### `delete_component_property`

Remove a property from a component.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Component or component set |
| `propertyName` | `string` | Yes | Full property name (with suffix) |

---

### `set_description`

Set description text on a component, component set, or style.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nodeId` | `string` | Yes | Target node |
| `description` | `string` | Yes | Plain text description |

---

## 7. Write Tools — Variables & Tokens

### `create_variable_collection`

Create a new variable collection.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Collection name |
| `initialModeName` | `string` | No | Name for the default mode |
| `additionalModes` | `string[]` | No | Extra modes to create |

**Returns:** Collection ID and mode IDs.

---

### `delete_variable_collection`

Delete a collection and all its variables.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `collectionId` | `string` | Yes | Collection to delete |

---

### `create_variables`

Create one or more variables in a collection.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `collectionId` | `string` | Yes | Target collection |
| `variables` | `VariableDefinition[]` | Yes | Variables to create (1-100) |

**`VariableDefinition`:**
```typescript
{
  name: string,
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN",
  description?: string,
  valuesByMode?: Record<string, string | number | boolean>
}
```

---

### `update_variables`

Update variable values (one or many).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `updates` | `VariableUpdate[]` | Yes | Updates to apply (1-100) |

**`VariableUpdate`:**
```typescript
{
  variableId: string,
  modeId: string,
  value: string | number | boolean
}
```

---

### `delete_variable`

Delete a single variable.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `variableId` | `string` | Yes | Variable to delete |

---

### `rename_variable`

Rename a variable.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `variableId` | `string` | Yes | Variable to rename |
| `newName` | `string` | Yes | New name (supports `/` for grouping) |

---

### `add_mode`

Add a mode to a collection.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `collectionId` | `string` | Yes | Target collection |
| `modeName` | `string` | Yes | Mode name |

---

### `rename_mode`

Rename an existing mode.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `collectionId` | `string` | Yes | Collection ID |
| `modeId` | `string` | Yes | Mode to rename |
| `newName` | `string` | Yes | New name |

---

### `setup_design_tokens`

Create a complete token system in one atomic operation: collection + modes + variables.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `collectionName` | `string` | Yes | Collection name |
| `modes` | `string[]` | Yes | Mode names (first = default) |
| `tokens` | `TokenDefinition[]` | Yes | Token definitions (1-100) |

**`TokenDefinition`:**
```typescript
{
  name: string,
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN",
  description?: string,
  values: Record<string, string | number | boolean>  // keyed by mode NAME
}
```

---

## 8. Write Tools — Page & Document

### `create_page`

Create a new page in the document.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Page name |
| `index` | `number` | No | Position in page list |

**Returns:** Page node with ID.

---

### `rename_page`

Rename a page.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pageId` | `string` | Yes | Page to rename |
| `name` | `string` | Yes | New name |

---

### `delete_page`

Delete a page and all its contents.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pageId` | `string` | Yes | Page to delete |

---

### `set_current_page`

Switch the active page in Figma.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pageId` | `string` | Yes | Page to switch to |

---

## 9. Write Tools — Comments

### `post_comment`

Post a comment on the file.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | Comment text |
| `nodeId` | `string` | No | Pin to a specific node |
| `position` | `{ x: number, y: number }` | No | Comment position on canvas |
| `replyTo` | `string` | No | Comment ID to reply to |

---

### `delete_comment`

Delete a comment.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `commentId` | `string` | Yes | Comment to delete |

---

## 10. Utility Tools

### `execute`

Run arbitrary JavaScript in Figma's plugin context. Escape hatch for operations not covered by dedicated tools.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | `string` | Yes | JavaScript code with access to `figma` global |
| `timeout` | `number` | No | Execution timeout in ms (default: 10000, max: 30000) |

**Returns:** Serialized return value from the code.

**Restrictions:**
- No network access (`fetch` is blocked)
- No UI manipulation (`__html__` is blocked)
- Code is wrapped in an async IIFE
- Timeout enforced by the plugin

---

### `get_status`

Get Rex connection status and health.

No parameters.

**Returns:**
```json
{
  "state": "CONNECTED",
  "transport": { "http": true, "websocket": true },
  "plugin": {
    "connected": true,
    "fileKey": "abc123",
    "fileName": "My Design File",
    "lastHeartbeat": "2026-03-09T12:00:00Z"
  },
  "queue": {
    "pending": 0,
    "inFlight": 0,
    "completed": 142,
    "failed": 1
  },
  "uptime": 3600
}
```

---

### `batch_execute`

Execute multiple independent operations in a single atomic call. More efficient than multiple individual tool calls.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `operations` | `Operation[]` | Yes | Operations to execute (1-50) |
| `atomic` | `boolean` | No | Roll back all if any fails (default: true) |

**`Operation`:**
```typescript
{
  tool: string,       // tool name (e.g., "update_node", "set_auto_layout")
  params: object      // tool parameters
}
```

**Returns:** Array of results in order, or error with rollback info if atomic and any failed.

---

## 11. Shared Types

### Colors

All colors are hex strings. Alpha is supported via 8-digit hex:
- `"#FF0000"` — red, fully opaque
- `"#FF000080"` — red, 50% opacity
- `"#0033B8"` — Mynt brand blue

### BlendMode

```
"NORMAL" | "DARKEN" | "MULTIPLY" | "COLOR_BURN" |
"LIGHTEN" | "SCREEN" | "COLOR_DODGE" |
"OVERLAY" | "SOFT_LIGHT" | "HARD_LIGHT" |
"DIFFERENCE" | "EXCLUSION" | "HUE" |
"SATURATION" | "COLOR" | "LUMINOSITY"
```

### AutoLayoutParams

```typescript
{
  direction?: "horizontal" | "vertical"
  wrap?: boolean
  spacing?: number | "auto"
  padding?: number | { top: number, right: number, bottom: number, left: number }
  primaryAxisAlign?: "min" | "center" | "max" | "space-between"
  counterAxisAlign?: "min" | "center" | "max" | "baseline"
  primaryAxisSizing?: "fixed" | "hug"
  counterAxisSizing?: "fixed" | "hug"
  strokesIncludedInLayout?: boolean
  itemReverseZIndex?: boolean
}
```

### LayoutChildParams

```typescript
{
  alignSelf?: "inherit" | "stretch"
  grow?: number              // 0 = fixed size, 1 = fill container
  positioning?: "auto" | "absolute"
  position?: { x: number, y: number }
  horizontalConstraint?: "min" | "center" | "max" | "stretch" | "scale"
  verticalConstraint?: "min" | "center" | "max" | "stretch" | "scale"
}
```

### CornerRadius

```typescript
number  // uniform all corners
| {
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number
}
```

### Padding

```typescript
number  // uniform all sides
| {
  top: number,
  right: number,
  bottom: number,
  left: number
}
```

---

*See [SPEC.md](./SPEC.md) for architecture and [PROTOCOL.md](./PROTOCOL.md) for plugin communication protocol.*
