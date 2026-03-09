import { describe, it, expect } from "vitest";
import {
  getNodeSchema,
  getSelectionSchema,
  getPageSchema,
  searchNodesSchema,
  screenshotSchema,
  getStylesSchema,
  getVariablesSchema,
  getComponentsSchema,
  createNodeSchema,
  updateNodeSchema,
  batchUpdateNodesSchema,
  deleteNodesSchema,
  cloneNodeSchema,
  reparentNodeSchema,
  reorderChildrenSchema,
  setTextSchema,
  setFillsSchema,
  setStrokesSchema,
  setEffectsSchema,
  setCornerRadiusSchema,
  setAutoLayoutSchema,
  setLayoutChildSchema,
  batchSetLayoutChildrenSchema,
  setLayoutGridSchema,
  setConstraintsSchema,
  instantiateComponentSchema,
  setInstancePropertiesSchema,
  createComponentSchema,
  createComponentSetSchema,
  addComponentPropertySchema,
  editComponentPropertySchema,
  deleteComponentPropertySchema,
  setDescriptionSchema,
  createVariableCollectionSchema,
  deleteVariableCollectionSchema,
  createVariablesSchema,
  updateVariablesSchema,
  deleteVariableSchema,
  renameVariableSchema,
  addModeSchema,
  renameModeSchema,
  setupDesignTokensSchema,
  createPageSchema,
  renamePageSchema,
  deletePageSchema,
  setCurrentPageSchema,
  postCommentSchema,
  deleteCommentSchema,
  executeSchema,
  batchExecuteSchema,
} from "../../tools/schemas.js";

// ─── Read Tool Schemas ──────────────────────────────────────────────────────

describe("Read tool schemas", () => {
  describe("getNodeSchema", () => {
    it("accepts valid input", () => {
      const result = getNodeSchema.safeParse({ nodeIds: ["123:456"] });
      expect(result.success).toBe(true);
    });

    it("accepts with optional depth and properties", () => {
      const result = getNodeSchema.safeParse({
        nodeIds: ["1:2", "3:4"],
        depth: 3,
        properties: ["fills", "name"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty nodeIds array", () => {
      const result = getNodeSchema.safeParse({ nodeIds: [] });
      expect(result.success).toBe(false);
    });

    it("rejects missing nodeIds", () => {
      const result = getNodeSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects depth out of range", () => {
      const result = getNodeSchema.safeParse({ nodeIds: ["1:1"], depth: 10 });
      expect(result.success).toBe(false);
    });

    it("rejects depth below minimum", () => {
      const result = getNodeSchema.safeParse({ nodeIds: ["1:1"], depth: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe("getSelectionSchema", () => {
    it("accepts empty object (all optional)", () => {
      expect(getSelectionSchema.safeParse({}).success).toBe(true);
    });

    it("accepts all fields", () => {
      expect(getSelectionSchema.safeParse({ includeChildren: true, depth: 2 }).success).toBe(true);
    });

    it("rejects invalid type for includeChildren", () => {
      expect(getSelectionSchema.safeParse({ includeChildren: "yes" }).success).toBe(false);
    });
  });

  describe("getPageSchema", () => {
    it("accepts empty object", () => {
      expect(getPageSchema.safeParse({}).success).toBe(true);
    });

    it("accepts valid verbosity values", () => {
      expect(getPageSchema.safeParse({ verbosity: "summary" }).success).toBe(true);
      expect(getPageSchema.safeParse({ verbosity: "standard" }).success).toBe(true);
      expect(getPageSchema.safeParse({ verbosity: "full" }).success).toBe(true);
    });

    it("rejects invalid verbosity", () => {
      expect(getPageSchema.safeParse({ verbosity: "verbose" }).success).toBe(false);
    });
  });

  describe("searchNodesSchema", () => {
    it("accepts empty object (all optional)", () => {
      expect(searchNodesSchema.safeParse({}).success).toBe(true);
    });

    it("accepts valid node type filter", () => {
      expect(searchNodesSchema.safeParse({ type: "FRAME" }).success).toBe(true);
    });

    it("rejects invalid node type", () => {
      expect(searchNodesSchema.safeParse({ type: "INVALID" }).success).toBe(false);
    });
  });

  describe("screenshotSchema", () => {
    it("accepts empty object", () => {
      expect(screenshotSchema.safeParse({}).success).toBe(true);
    });

    it("accepts valid format and scale", () => {
      expect(screenshotSchema.safeParse({ format: "png", scale: 2 }).success).toBe(true);
    });

    it("rejects scale below minimum", () => {
      expect(screenshotSchema.safeParse({ scale: 0.1 }).success).toBe(false);
    });

    it("rejects scale above maximum", () => {
      expect(screenshotSchema.safeParse({ scale: 5 }).success).toBe(false);
    });

    it("rejects invalid format", () => {
      expect(screenshotSchema.safeParse({ format: "gif" }).success).toBe(false);
    });
  });

  describe("getStylesSchema", () => {
    it("accepts empty object", () => {
      expect(getStylesSchema.safeParse({}).success).toBe(true);
    });

    it("accepts valid types array", () => {
      expect(getStylesSchema.safeParse({ types: ["fill", "text"] }).success).toBe(true);
    });

    it("rejects invalid style type", () => {
      expect(getStylesSchema.safeParse({ types: ["color"] }).success).toBe(false);
    });
  });

  describe("getVariablesSchema", () => {
    it("accepts empty object", () => {
      expect(getVariablesSchema.safeParse({}).success).toBe(true);
    });

    it("accepts valid resolvedType", () => {
      expect(getVariablesSchema.safeParse({ resolvedType: "COLOR" }).success).toBe(true);
    });
  });

  describe("getComponentsSchema", () => {
    it("accepts empty object", () => {
      expect(getComponentsSchema.safeParse({}).success).toBe(true);
    });

    it("accepts all optional fields", () => {
      expect(getComponentsSchema.safeParse({
        query: "button",
        includeVariants: true,
        limit: 20,
      }).success).toBe(true);
    });
  });
});

// ─── Write Tool Schemas — Nodes ──────────────────────────────────────────────

describe("Write tool schemas — Nodes", () => {
  describe("createNodeSchema", () => {
    it("accepts minimal valid input", () => {
      const result = createNodeSchema.safeParse({ type: "FRAME" });
      expect(result.success).toBe(true);
    });

    it("accepts full input with nested children", () => {
      const result = createNodeSchema.safeParse({
        type: "FRAME",
        parentId: "0:1",
        name: "Container",
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 },
        fills: [{ type: "solid", color: "#FF0000" }],
        cornerRadius: 8,
        children: [
          {
            type: "RECTANGLE",
            name: "Child",
            size: { width: 50 },
          },
          {
            type: "FRAME",
            name: "Nested",
            children: [
              { type: "TEXT", text: "Deep child" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid node type", () => {
      const result = createNodeSchema.safeParse({ type: "INVALID_TYPE" });
      expect(result.success).toBe(false);
    });

    it("rejects missing type field", () => {
      const result = createNodeSchema.safeParse({ name: "No type" });
      expect(result.success).toBe(false);
    });

    it("accepts opacity at boundaries", () => {
      expect(createNodeSchema.safeParse({ type: "FRAME", opacity: 0 }).success).toBe(true);
      expect(createNodeSchema.safeParse({ type: "FRAME", opacity: 1 }).success).toBe(true);
    });

    it("rejects opacity out of range", () => {
      expect(createNodeSchema.safeParse({ type: "FRAME", opacity: 1.5 }).success).toBe(false);
      expect(createNodeSchema.safeParse({ type: "FRAME", opacity: -0.1 }).success).toBe(false);
    });
  });

  describe("updateNodeSchema", () => {
    it("accepts valid input", () => {
      const result = updateNodeSchema.safeParse({
        nodeId: "123:456",
        name: "Updated",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing nodeId", () => {
      const result = updateNodeSchema.safeParse({ name: "No ID" });
      expect(result.success).toBe(false);
    });

    it("accepts all optional fields", () => {
      const result = updateNodeSchema.safeParse({
        nodeId: "1:1",
        name: "Full",
        position: { x: 10, y: 20 },
        size: { width: 100, height: 50 },
        visible: false,
        locked: true,
        blendMode: "MULTIPLY",
        clipsContent: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid blendMode", () => {
      const result = updateNodeSchema.safeParse({
        nodeId: "1:1",
        blendMode: "INVALID",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("batchUpdateNodesSchema", () => {
    it("accepts array of updates", () => {
      const result = batchUpdateNodesSchema.safeParse({
        updates: [
          { nodeId: "1:1", name: "A" },
          { nodeId: "2:2", name: "B" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty updates array", () => {
      const result = batchUpdateNodesSchema.safeParse({ updates: [] });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteNodesSchema", () => {
    it("accepts valid nodeIds", () => {
      expect(deleteNodesSchema.safeParse({ nodeIds: ["1:1"] }).success).toBe(true);
    });

    it("rejects empty array", () => {
      expect(deleteNodesSchema.safeParse({ nodeIds: [] }).success).toBe(false);
    });
  });

  describe("cloneNodeSchema", () => {
    it("accepts nodeId only", () => {
      expect(cloneNodeSchema.safeParse({ nodeId: "1:1" }).success).toBe(true);
    });

    it("accepts all optional fields", () => {
      expect(cloneNodeSchema.safeParse({
        nodeId: "1:1",
        parentId: "2:2",
        position: { x: 10, y: 20 },
        name: "Clone",
      }).success).toBe(true);
    });
  });

  describe("reparentNodeSchema", () => {
    it("accepts required fields", () => {
      expect(reparentNodeSchema.safeParse({
        nodeId: "1:1",
        parentId: "2:2",
      }).success).toBe(true);
    });

    it("rejects missing parentId", () => {
      expect(reparentNodeSchema.safeParse({ nodeId: "1:1" }).success).toBe(false);
    });
  });

  describe("reorderChildrenSchema", () => {
    it("accepts valid input", () => {
      expect(reorderChildrenSchema.safeParse({
        parentId: "1:1",
        childIds: ["2:2", "3:3"],
      }).success).toBe(true);
    });

    it("rejects empty childIds", () => {
      expect(reorderChildrenSchema.safeParse({
        parentId: "1:1",
        childIds: [],
      }).success).toBe(false);
    });
  });
});

// ─── Write Tool Schemas — Text ──────────────────────────────────────────────

describe("Write tool schemas — Text", () => {
  describe("setTextSchema", () => {
    it("accepts nodeId with text", () => {
      expect(setTextSchema.safeParse({
        nodeId: "1:1",
        text: "Hello",
      }).success).toBe(true);
    });

    it("accepts with style", () => {
      expect(setTextSchema.safeParse({
        nodeId: "1:1",
        style: {
          fontFamily: "Inter",
          fontWeight: 400,
          fontSize: 16,
          color: "#000000",
        },
      }).success).toBe(true);
    });

    it("accepts with styleRanges", () => {
      expect(setTextSchema.safeParse({
        nodeId: "1:1",
        styleRanges: [
          { start: 0, end: 5, style: { fontWeight: 700 } },
        ],
      }).success).toBe(true);
    });

    it("rejects fontWeight out of range", () => {
      expect(setTextSchema.safeParse({
        nodeId: "1:1",
        style: { fontWeight: 50 },
      }).success).toBe(false);

      expect(setTextSchema.safeParse({
        nodeId: "1:1",
        style: { fontWeight: 1000 },
      }).success).toBe(false);
    });

    it("accepts lineHeight as number or object", () => {
      expect(setTextSchema.safeParse({
        nodeId: "1:1",
        style: { lineHeight: 24 },
      }).success).toBe(true);

      expect(setTextSchema.safeParse({
        nodeId: "1:1",
        style: { lineHeight: { value: 150, unit: "percent" } },
      }).success).toBe(true);
    });
  });
});

// ─── Write Tool Schemas — Visual Properties ──────────────────────────────────

describe("Write tool schemas — Visual Properties", () => {
  describe("setFillsSchema", () => {
    it("accepts solid fill", () => {
      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [{ type: "solid", color: "#FF0000" }],
      }).success).toBe(true);
    });

    it("accepts gradient fill", () => {
      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [{
          type: "linear-gradient",
          stops: [
            { position: 0, color: "#000000" },
            { position: 1, color: "#FFFFFF" },
          ],
        }],
      }).success).toBe(true);
    });

    it("accepts image fill", () => {
      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [{ type: "image", imageHash: "abc123" }],
      }).success).toBe(true);
    });

    it("rejects invalid fill type", () => {
      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [{ type: "pattern", color: "#FF0000" }],
      }).success).toBe(false);
    });

    it("rejects invalid hex color format", () => {
      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [{ type: "solid", color: "red" }],
      }).success).toBe(false);

      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [{ type: "solid", color: "#GGG" }],
      }).success).toBe(false);
    });

    it("accepts hex color with alpha", () => {
      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [{ type: "solid", color: "#FF000080" }],
      }).success).toBe(true);
    });

    it("accepts empty fills array", () => {
      expect(setFillsSchema.safeParse({
        nodeId: "1:1",
        fills: [],
      }).success).toBe(true);
    });
  });

  describe("setStrokesSchema", () => {
    it("accepts valid strokes with options", () => {
      expect(setStrokesSchema.safeParse({
        nodeId: "1:1",
        strokes: [{ type: "solid", color: "#000000" }],
        strokeWeight: 2,
        strokeAlign: "CENTER",
        dashPattern: [5, 5],
        strokeCap: "ROUND",
        strokeJoin: "MITER",
      }).success).toBe(true);
    });

    it("rejects invalid strokeAlign", () => {
      expect(setStrokesSchema.safeParse({
        nodeId: "1:1",
        strokes: [{ type: "solid", color: "#000000" }],
        strokeAlign: "LEFT",
      }).success).toBe(false);
    });
  });

  describe("setEffectsSchema", () => {
    it("accepts drop shadow", () => {
      expect(setEffectsSchema.safeParse({
        nodeId: "1:1",
        effects: [{
          type: "drop-shadow",
          color: "#00000040",
          offset: { x: 0, y: 4 },
          blur: 8,
        }],
      }).success).toBe(true);
    });

    it("accepts inner shadow", () => {
      expect(setEffectsSchema.safeParse({
        nodeId: "1:1",
        effects: [{
          type: "inner-shadow",
          color: "#00000020",
          offset: { x: 0, y: 2 },
          blur: 4,
          spread: 1,
        }],
      }).success).toBe(true);
    });

    it("accepts layer blur", () => {
      expect(setEffectsSchema.safeParse({
        nodeId: "1:1",
        effects: [{ type: "layer-blur", blur: 10 }],
      }).success).toBe(true);
    });

    it("accepts background blur", () => {
      expect(setEffectsSchema.safeParse({
        nodeId: "1:1",
        effects: [{ type: "background-blur", blur: 20, visible: true }],
      }).success).toBe(true);
    });

    it("rejects invalid effect type", () => {
      expect(setEffectsSchema.safeParse({
        nodeId: "1:1",
        effects: [{ type: "outer-glow", blur: 5 }],
      }).success).toBe(false);
    });
  });

  describe("setCornerRadiusSchema", () => {
    it("accepts uniform radius", () => {
      expect(setCornerRadiusSchema.safeParse({
        nodeId: "1:1",
        radius: 8,
      }).success).toBe(true);
    });

    it("accepts per-corner radius", () => {
      expect(setCornerRadiusSchema.safeParse({
        nodeId: "1:1",
        radius: {
          topLeft: 8,
          topRight: 8,
          bottomRight: 0,
          bottomLeft: 0,
        },
      }).success).toBe(true);
    });

    it("rejects incomplete per-corner radius", () => {
      expect(setCornerRadiusSchema.safeParse({
        nodeId: "1:1",
        radius: { topLeft: 8 },
      }).success).toBe(false);
    });
  });
});

// ─── Write Tool Schemas — Layout ─────────────────────────────────────────────

describe("Write tool schemas — Layout", () => {
  describe("setAutoLayoutSchema", () => {
    it("accepts minimal input", () => {
      expect(setAutoLayoutSchema.safeParse({ nodeId: "1:1" }).success).toBe(true);
    });

    it("accepts full auto-layout config", () => {
      expect(setAutoLayoutSchema.safeParse({
        nodeId: "1:1",
        enabled: true,
        direction: "vertical",
        wrap: true,
        spacing: 12,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        primaryAxisAlign: "space-between",
        counterAxisAlign: "center",
        primaryAxisSizing: "hug",
        counterAxisSizing: "fixed",
      }).success).toBe(true);
    });

    it("accepts 'auto' spacing", () => {
      expect(setAutoLayoutSchema.safeParse({
        nodeId: "1:1",
        spacing: "auto",
      }).success).toBe(true);
    });

    it("accepts uniform padding number", () => {
      expect(setAutoLayoutSchema.safeParse({
        nodeId: "1:1",
        padding: 16,
      }).success).toBe(true);
    });

    it("rejects invalid direction", () => {
      expect(setAutoLayoutSchema.safeParse({
        nodeId: "1:1",
        direction: "diagonal",
      }).success).toBe(false);
    });
  });

  describe("setLayoutChildSchema", () => {
    it("accepts valid input", () => {
      expect(setLayoutChildSchema.safeParse({
        nodeId: "1:1",
        alignSelf: "stretch",
        grow: 1,
        positioning: "auto",
      }).success).toBe(true);
    });

    it("accepts constraint values", () => {
      expect(setLayoutChildSchema.safeParse({
        nodeId: "1:1",
        horizontalConstraint: "stretch",
        verticalConstraint: "center",
      }).success).toBe(true);
    });
  });

  describe("batchSetLayoutChildrenSchema", () => {
    it("accepts valid input", () => {
      expect(batchSetLayoutChildrenSchema.safeParse({
        parentId: "1:1",
        children: [
          { nodeId: "2:2", grow: 1 },
          { nodeId: "3:3", alignSelf: "stretch" },
        ],
      }).success).toBe(true);
    });

    it("rejects empty children array", () => {
      expect(batchSetLayoutChildrenSchema.safeParse({
        parentId: "1:1",
        children: [],
      }).success).toBe(false);
    });
  });

  describe("setLayoutGridSchema", () => {
    it("accepts column grid", () => {
      expect(setLayoutGridSchema.safeParse({
        nodeId: "1:1",
        grids: [{
          pattern: "columns",
          count: 12,
          gutterSize: 20,
          alignment: "stretch",
        }],
      }).success).toBe(true);
    });

    it("accepts row grid", () => {
      expect(setLayoutGridSchema.safeParse({
        nodeId: "1:1",
        grids: [{
          pattern: "rows",
          count: 6,
          gutterSize: 10,
          alignment: "center",
        }],
      }).success).toBe(true);
    });

    it("accepts uniform grid", () => {
      expect(setLayoutGridSchema.safeParse({
        nodeId: "1:1",
        grids: [{ pattern: "grid", sectionSize: 8 }],
      }).success).toBe(true);
    });

    it("rejects invalid pattern", () => {
      expect(setLayoutGridSchema.safeParse({
        nodeId: "1:1",
        grids: [{ pattern: "diagonal", sectionSize: 8 }],
      }).success).toBe(false);
    });
  });

  describe("setConstraintsSchema", () => {
    it("accepts valid constraints", () => {
      expect(setConstraintsSchema.safeParse({
        nodeId: "1:1",
        horizontal: "stretch",
        vertical: "min",
      }).success).toBe(true);
    });

    it("accepts nodeId only (both constraints optional)", () => {
      expect(setConstraintsSchema.safeParse({ nodeId: "1:1" }).success).toBe(true);
    });
  });
});

// ─── Write Tool Schemas — Components ─────────────────────────────────────────

describe("Write tool schemas — Components", () => {
  describe("instantiateComponentSchema", () => {
    it("accepts componentKey", () => {
      expect(instantiateComponentSchema.safeParse({
        componentKey: "abc123",
      }).success).toBe(true);
    });

    it("accepts nodeId", () => {
      expect(instantiateComponentSchema.safeParse({
        nodeId: "1:1",
      }).success).toBe(true);
    });

    it("accepts with variant and overrides", () => {
      expect(instantiateComponentSchema.safeParse({
        componentKey: "abc123",
        variant: { Size: "Large", State: "Active" },
        overrides: { "Button Label": "Click me", "Icon Visible": true },
      }).success).toBe(true);
    });
  });

  describe("setInstancePropertiesSchema", () => {
    it("accepts valid input", () => {
      expect(setInstancePropertiesSchema.safeParse({
        nodeId: "1:1",
        properties: { "Label": "Hello", "Visible": true },
      }).success).toBe(true);
    });

    it("rejects missing properties", () => {
      expect(setInstancePropertiesSchema.safeParse({
        nodeId: "1:1",
      }).success).toBe(false);
    });
  });

  describe("addComponentPropertySchema", () => {
    it("accepts valid input", () => {
      expect(addComponentPropertySchema.safeParse({
        nodeId: "1:1",
        name: "showIcon",
        type: "BOOLEAN",
        defaultValue: true,
      }).success).toBe(true);
    });

    it("accepts TEXT type with string default", () => {
      expect(addComponentPropertySchema.safeParse({
        nodeId: "1:1",
        name: "label",
        type: "TEXT",
        defaultValue: "Click me",
      }).success).toBe(true);
    });

    it("rejects invalid property type", () => {
      expect(addComponentPropertySchema.safeParse({
        nodeId: "1:1",
        name: "color",
        type: "COLOR",
        defaultValue: "#FF0000",
      }).success).toBe(false);
    });
  });

  describe("createComponentSchema", () => {
    it("accepts nodeId only", () => {
      expect(createComponentSchema.safeParse({ nodeId: "1:1" }).success).toBe(true);
    });
  });

  describe("createComponentSetSchema", () => {
    it("accepts valid componentIds", () => {
      expect(createComponentSetSchema.safeParse({
        componentIds: ["1:1", "2:2"],
      }).success).toBe(true);
    });

    it("rejects empty componentIds", () => {
      expect(createComponentSetSchema.safeParse({
        componentIds: [],
      }).success).toBe(false);
    });
  });

  describe("setDescriptionSchema", () => {
    it("accepts valid input", () => {
      expect(setDescriptionSchema.safeParse({
        nodeId: "1:1",
        description: "A button component",
      }).success).toBe(true);
    });

    it("rejects missing description", () => {
      expect(setDescriptionSchema.safeParse({ nodeId: "1:1" }).success).toBe(false);
    });
  });
});

// ─── Write Tool Schemas — Variables ──────────────────────────────────────────

describe("Write tool schemas — Variables", () => {
  describe("createVariableCollectionSchema", () => {
    it("accepts name only", () => {
      expect(createVariableCollectionSchema.safeParse({
        name: "Colors",
      }).success).toBe(true);
    });

    it("accepts with modes", () => {
      expect(createVariableCollectionSchema.safeParse({
        name: "Colors",
        initialModeName: "Light",
        additionalModes: ["Dark", "High Contrast"],
      }).success).toBe(true);
    });
  });

  describe("createVariablesSchema", () => {
    it("accepts valid variables", () => {
      expect(createVariablesSchema.safeParse({
        collectionId: "col:1",
        variables: [
          {
            name: "primary",
            resolvedType: "COLOR",
            valuesByMode: { "mode1": "#FF0000" },
          },
        ],
      }).success).toBe(true);
    });

    it("rejects empty variables array", () => {
      expect(createVariablesSchema.safeParse({
        collectionId: "col:1",
        variables: [],
      }).success).toBe(false);
    });

    it("rejects invalid resolvedType", () => {
      expect(createVariablesSchema.safeParse({
        collectionId: "col:1",
        variables: [{ name: "x", resolvedType: "INTEGER" }],
      }).success).toBe(false);
    });
  });

  describe("updateVariablesSchema", () => {
    it("accepts valid updates", () => {
      expect(updateVariablesSchema.safeParse({
        updates: [
          { variableId: "v:1", modeId: "m:1", value: "#00FF00" },
          { variableId: "v:2", modeId: "m:1", value: 16 },
        ],
      }).success).toBe(true);
    });

    it("rejects empty updates", () => {
      expect(updateVariablesSchema.safeParse({ updates: [] }).success).toBe(false);
    });
  });

  describe("setupDesignTokensSchema", () => {
    it("accepts valid design tokens", () => {
      expect(setupDesignTokensSchema.safeParse({
        collectionName: "Design Tokens",
        modes: ["Light", "Dark"],
        tokens: [
          {
            name: "color/primary",
            resolvedType: "COLOR",
            values: { Light: "#0066FF", Dark: "#3388FF" },
          },
        ],
      }).success).toBe(true);
    });

    it("rejects empty modes", () => {
      expect(setupDesignTokensSchema.safeParse({
        collectionName: "Tokens",
        modes: [],
        tokens: [{ name: "x", resolvedType: "COLOR", values: {} }],
      }).success).toBe(false);
    });

    it("rejects empty tokens", () => {
      expect(setupDesignTokensSchema.safeParse({
        collectionName: "Tokens",
        modes: ["Default"],
        tokens: [],
      }).success).toBe(false);
    });
  });

  describe("other variable schemas", () => {
    it("deleteVariableCollectionSchema accepts collectionId", () => {
      expect(deleteVariableCollectionSchema.safeParse({ collectionId: "c:1" }).success).toBe(true);
    });

    it("deleteVariableSchema accepts variableId", () => {
      expect(deleteVariableSchema.safeParse({ variableId: "v:1" }).success).toBe(true);
    });

    it("renameVariableSchema accepts variableId and newName", () => {
      expect(renameVariableSchema.safeParse({
        variableId: "v:1",
        newName: "renamed",
      }).success).toBe(true);
    });

    it("addModeSchema accepts collectionId and modeName", () => {
      expect(addModeSchema.safeParse({
        collectionId: "c:1",
        modeName: "Dark",
      }).success).toBe(true);
    });

    it("renameModeSchema accepts all required fields", () => {
      expect(renameModeSchema.safeParse({
        collectionId: "c:1",
        modeId: "m:1",
        newName: "Dark Theme",
      }).success).toBe(true);
    });
  });
});

// ─── Write Tool Schemas — Pages ──────────────────────────────────────────────

describe("Write tool schemas — Pages", () => {
  it("createPageSchema accepts name", () => {
    expect(createPageSchema.safeParse({ name: "New Page" }).success).toBe(true);
  });

  it("createPageSchema accepts name and index", () => {
    expect(createPageSchema.safeParse({ name: "Page 2", index: 1 }).success).toBe(true);
  });

  it("renamePageSchema requires pageId and name", () => {
    expect(renamePageSchema.safeParse({ pageId: "p:1", name: "Renamed" }).success).toBe(true);
    expect(renamePageSchema.safeParse({ pageId: "p:1" }).success).toBe(false);
  });

  it("deletePageSchema requires pageId", () => {
    expect(deletePageSchema.safeParse({ pageId: "p:1" }).success).toBe(true);
    expect(deletePageSchema.safeParse({}).success).toBe(false);
  });

  it("setCurrentPageSchema requires pageId", () => {
    expect(setCurrentPageSchema.safeParse({ pageId: "p:1" }).success).toBe(true);
  });
});

// ─── Write Tool Schemas — Comments ───────────────────────────────────────────

describe("Write tool schemas — Comments", () => {
  it("postCommentSchema accepts message", () => {
    expect(postCommentSchema.safeParse({ message: "Great work!" }).success).toBe(true);
  });

  it("postCommentSchema accepts all optional fields", () => {
    expect(postCommentSchema.safeParse({
      message: "Fix this",
      nodeId: "1:1",
      position: { x: 100, y: 200 },
      replyTo: "comment-123",
    }).success).toBe(true);
  });

  it("postCommentSchema rejects missing message", () => {
    expect(postCommentSchema.safeParse({}).success).toBe(false);
  });

  it("deleteCommentSchema requires commentId", () => {
    expect(deleteCommentSchema.safeParse({ commentId: "c:1" }).success).toBe(true);
    expect(deleteCommentSchema.safeParse({}).success).toBe(false);
  });
});

// ─── Utility Schemas ─────────────────────────────────────────────────────────

describe("Utility schemas", () => {
  describe("executeSchema", () => {
    it("accepts code", () => {
      expect(executeSchema.safeParse({ code: "return 42" }).success).toBe(true);
    });

    it("accepts code with timeout", () => {
      expect(executeSchema.safeParse({ code: "return 42", timeout: 5000 }).success).toBe(true);
    });

    it("rejects timeout over 30000", () => {
      expect(executeSchema.safeParse({ code: "x", timeout: 60000 }).success).toBe(false);
    });

    it("rejects missing code", () => {
      expect(executeSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("batchExecuteSchema", () => {
    it("accepts valid operations", () => {
      expect(batchExecuteSchema.safeParse({
        operations: [
          { tool: "create_node", params: { type: "FRAME" } },
          { tool: "update_node", params: { nodeId: "1:1", name: "X" } },
        ],
      }).success).toBe(true);
    });

    it("accepts atomic flag", () => {
      expect(batchExecuteSchema.safeParse({
        operations: [{ tool: "create_node", params: {} }],
        atomic: true,
      }).success).toBe(true);
    });

    it("rejects empty operations", () => {
      expect(batchExecuteSchema.safeParse({ operations: [] }).success).toBe(false);
    });
  });
});
