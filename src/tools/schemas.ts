import { z } from "zod";

// ============================================================================
// Shared Enums
// ============================================================================

export const nodeTypeEnum = z.enum([
  "FRAME",
  "RECTANGLE",
  "ELLIPSE",
  "TEXT",
  "LINE",
  "POLYGON",
  "STAR",
  "VECTOR",
  "SECTION",
  "COMPONENT",
  "COMPONENT_SET",
]);

export const blendModeEnum = z.enum([
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
]);

export const constraintValueEnum = z.enum([
  "min",
  "center",
  "max",
  "stretch",
  "scale",
]);

export const resolvedTypeEnum = z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]);

// ============================================================================
// Shared Primitives
// ============================================================================

/** Hex color string, e.g. "#FF0000" or "#FF000080" (with alpha) */
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);

const position = z.object({
  x: z.number(),
  y: z.number(),
});

const size = z.object({
  width: z.number().positive(),
  height: z.number().positive().optional(),
});

const sizeOptionalBoth = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
});

// ============================================================================
// Shared Composite Types: Padding, CornerRadius
// ============================================================================

const paddingObject = z.object({
  top: z.number().min(0),
  right: z.number().min(0),
  bottom: z.number().min(0),
  left: z.number().min(0),
});

/** Uniform number or per-side object */
const padding = z.union([z.number().min(0), paddingObject]);

const cornerRadiusObject = z.object({
  topLeft: z.number().min(0),
  topRight: z.number().min(0),
  bottomRight: z.number().min(0),
  bottomLeft: z.number().min(0),
});

/** Uniform number or per-corner object */
const cornerRadius = z.union([z.number().min(0), cornerRadiusObject]);

// ============================================================================
// Shared Composite Types: Fill
// ============================================================================

const gradientStop = z.object({
  position: z.number().min(0).max(1),
  color: hexColor,
});

const solidFill = z.object({
  type: z.literal("solid"),
  color: hexColor,
  opacity: z.number().min(0).max(1).optional(),
});

const linearGradientFill = z.object({
  type: z.literal("linear-gradient"),
  stops: z.array(gradientStop),
  angle: z.number().optional(),
});

const radialGradientFill = z.object({
  type: z.literal("radial-gradient"),
  stops: z.array(gradientStop),
  center: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
});

const imageFill = z.object({
  type: z.literal("image"),
  imageHash: z.string(),
  scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional(),
});

const fill = z.discriminatedUnion("type", [
  solidFill,
  linearGradientFill,
  radialGradientFill,
  imageFill,
]);

export type Fill = z.infer<typeof fill>;

// ============================================================================
// Shared Composite Types: Stroke (same paint types as Fill)
// ============================================================================

const stroke = fill;

export type Stroke = z.infer<typeof stroke>;

// ============================================================================
// Shared Composite Types: Effect
// ============================================================================

/** Normalize effect type names: accept both Figma API format (DROP_SHADOW) and kebab-case (drop-shadow). */
const effectTypeMap: Record<string, string> = {
  "DROP_SHADOW": "drop-shadow",
  "INNER_SHADOW": "inner-shadow",
  "LAYER_BLUR": "layer-blur",
  "BACKGROUND_BLUR": "background-blur",
};

const normalizeEffectType = z.string().transform((v) => effectTypeMap[v] ?? v);

const dropShadowEffect = z.object({
  type: z.union([z.literal("drop-shadow"), z.literal("DROP_SHADOW")]).transform(() => "drop-shadow" as const),
  color: hexColor,
  offset: position,
  blur: z.number().min(0),
  radius: z.number().min(0).optional(),
  spread: z.number().optional(),
  visible: z.boolean().optional(),
  blendMode: z.string().optional(),
});

const innerShadowEffect = z.object({
  type: z.union([z.literal("inner-shadow"), z.literal("INNER_SHADOW")]).transform(() => "inner-shadow" as const),
  color: hexColor,
  offset: position,
  blur: z.number().min(0),
  radius: z.number().min(0).optional(),
  spread: z.number().optional(),
  visible: z.boolean().optional(),
  blendMode: z.string().optional(),
});

const layerBlurEffect = z.object({
  type: z.union([z.literal("layer-blur"), z.literal("LAYER_BLUR")]).transform(() => "layer-blur" as const),
  blur: z.number().min(0),
  visible: z.boolean().optional(),
});

const backgroundBlurEffect = z.object({
  type: z.union([z.literal("background-blur"), z.literal("BACKGROUND_BLUR")]).transform(() => "background-blur" as const),
  blur: z.number().min(0),
  visible: z.boolean().optional(),
});

const effect = z.union([
  dropShadowEffect,
  innerShadowEffect,
  layerBlurEffect,
  backgroundBlurEffect,
]);

export type Effect = z.infer<typeof effect>;

// ============================================================================
// Shared Composite Types: AutoLayoutParams
// ============================================================================

const autoLayoutParams = z.object({
  direction: z.enum(["horizontal", "vertical"]).optional(),
  wrap: z.boolean().optional(),
  spacing: z.union([z.number().min(0), z.literal("auto")]).optional(),
  padding: padding.optional(),
  primaryAxisAlign: z
    .enum(["min", "center", "max", "space-between"])
    .optional(),
  counterAxisAlign: z.enum(["min", "center", "max", "baseline"]).optional(),
  primaryAxisSizing: z.enum(["fixed", "hug"]).optional(),
  counterAxisSizing: z.enum(["fixed", "hug"]).optional(),
  strokesIncludedInLayout: z.boolean().optional(),
  itemReverseZIndex: z.boolean().optional(),
});

export type AutoLayoutParams = z.infer<typeof autoLayoutParams>;

// ============================================================================
// Shared Composite Types: LayoutChildParams
// ============================================================================

const layoutChildParams = z.object({
  alignSelf: z.enum(["inherit", "stretch"]).optional(),
  grow: z.number().optional(),
  positioning: z.enum(["auto", "absolute"]).optional(),
  position: position.optional(),
  horizontalConstraint: constraintValueEnum.optional(),
  verticalConstraint: constraintValueEnum.optional(),
});

export type LayoutChildParams = z.infer<typeof layoutChildParams>;

// ============================================================================
// Shared Composite Types: Constraints
// ============================================================================

const constraints = z.object({
  horizontal: constraintValueEnum.optional(),
  vertical: constraintValueEnum.optional(),
});

export type Constraints = z.infer<typeof constraints>;

// ============================================================================
// Shared Composite Types: LayoutGrid
// ============================================================================

const columnGrid = z.object({
  pattern: z.literal("columns"),
  count: z.number(),
  gutterSize: z.number(),
  alignment: z.enum(["min", "center", "max", "stretch"]),
  offset: z.number().optional(),
  sectionSize: z.number().optional(),
  color: hexColor.optional(),
});

const rowGrid = z.object({
  pattern: z.literal("rows"),
  count: z.number(),
  gutterSize: z.number(),
  alignment: z.enum(["min", "center", "max", "stretch"]),
  offset: z.number().optional(),
  sectionSize: z.number().optional(),
  color: hexColor.optional(),
});

const uniformGrid = z.object({
  pattern: z.literal("grid"),
  sectionSize: z.number(),
  color: hexColor.optional(),
});

const layoutGrid = z.discriminatedUnion("pattern", [
  columnGrid,
  rowGrid,
  uniformGrid,
]);

export type LayoutGrid = z.infer<typeof layoutGrid>;

// ============================================================================
// Shared Composite Types: TextStyle
// ============================================================================

const lineHeightObject = z.object({
  value: z.number(),
  unit: z.enum(["percent", "pixels"]),
});

const letterSpacingObject = z.object({
  value: z.number(),
  unit: z.enum(["percent", "pixels"]),
});

const textStyle = z.object({
  fontFamily: z.string().optional(),
  fontWeight: z.number().min(100).max(900).optional(),
  fontSize: z.number().positive().optional(),
  lineHeight: z.union([z.number(), lineHeightObject]).optional(),
  letterSpacing: z.union([z.number(), letterSpacingObject]).optional(),
  color: hexColor.optional(),
  textAlignHorizontal: z
    .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
    .optional(),
  textAlignVertical: z.enum(["TOP", "CENTER", "BOTTOM"]).optional(),
  textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional(),
  textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE"]).optional(),
  textAutoResize: z
    .enum(["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"])
    .optional(),
  maxLines: z.number().optional(),
  paragraphSpacing: z.number().optional(),
});

export type TextStyle = z.infer<typeof textStyle>;

// ============================================================================
// Shared Composite Types: TextStyleRange
// ============================================================================

const textStyleRange = z.object({
  start: z.number(),
  end: z.number(),
  style: textStyle,
});

export type TextStyleRange = z.infer<typeof textStyleRange>;

// ============================================================================
// 1. Read Tools
// ============================================================================

/** get_node — accepts nodeIds as a single string or an array of strings */
export const getNodeSchema = z.object({
  nodeIds: z.union([z.string(), z.array(z.string()).min(1)]).transform((v) =>
    typeof v === "string" ? [v] : v,
  ),
  depth: z.number().min(0).max(5).optional(),
  properties: z.array(z.string()).optional(),
});

/** get_selection */
export const getSelectionSchema = z.object({
  includeChildren: z.boolean().optional(),
  depth: z.number().optional(),
});

/** get_page */
export const getPageSchema = z.object({
  pageId: z.string().optional(),
  depth: z.number().optional(),
  verbosity: z.enum(["summary", "standard", "full"]).optional(),
});

/** search_nodes */
export const searchNodesSchema = z.object({
  query: z.string().optional(),
  type: nodeTypeEnum.optional(),
  withinId: z.string().optional(),
  hasAutoLayout: z.boolean().optional(),
  hasChildren: z.boolean().optional(),
  limit: z.number().optional(),
});

/** screenshot — scale accepts string or number, coerced to number */
export const screenshotSchema = z.object({
  nodeId: z.string().optional(),
  format: z.enum(["png", "jpg", "svg"]).optional(),
  scale: z.union([z.number(), z.string().transform(Number)])
    .pipe(z.number().min(0.5).max(4))
    .optional(),
  maxDimension: z.number().min(100).max(4096).optional(),
});

/** get_styles */
export const getStylesSchema = z.object({
  types: z.array(z.enum(["fill", "text", "effect", "grid"])).optional(),
});

/** get_variables */
export const getVariablesSchema = z.object({
  collection: z.string().optional(),
  namePattern: z.string().optional(),
  resolvedType: resolvedTypeEnum.optional(),
  resolveAliases: z.boolean().optional(),
});

/** get_components */
export const getComponentsSchema = z.object({
  query: z.string().optional(),
  includeVariants: z.boolean().optional(),
  limit: z.number().optional(),
});

// ============================================================================
// 2. Write Tools -- Nodes
// ============================================================================

/**
 * create_node — recursive schema (children have the same shape).
 * We use z.lazy() to support the recursive `children` field.
 */
const baseCreateNodeFields = {
  type: nodeTypeEnum,
  parentId: z.string().optional(),
  name: z.string().optional(),
  position: position.optional(),
  size: size.optional(),
  fills: z.array(fill).optional(),
  strokes: z.array(stroke).optional(),
  strokeWeight: z.number().min(0).optional(),
  effects: z.array(effect).optional(),
  cornerRadius: cornerRadius.optional(),
  opacity: z.number().min(0).max(1).optional(),
  autoLayout: autoLayoutParams.optional(),
  layoutGrids: z.array(layoutGrid).optional(),
  constraints: constraints.optional(),
  text: z.string().optional(),
  textStyle: textStyle.optional(),
  layoutChild: layoutChildParams.optional(),
};

/** Recursive type for create_node input */
export interface CreateNodeInput {
  type: z.infer<typeof nodeTypeEnum>;
  parentId?: string;
  name?: string;
  position?: { x: number; y: number };
  size?: { width: number; height?: number };
  fills?: Fill[];
  strokes?: Stroke[];
  strokeWeight?: number;
  effects?: Effect[];
  cornerRadius?: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  opacity?: number;
  autoLayout?: AutoLayoutParams;
  layoutGrids?: LayoutGrid[];
  constraints?: Constraints;
  text?: string;
  textStyle?: TextStyle;
  layoutChild?: LayoutChildParams;
  children?: CreateNodeInput[];
}

export const createNodeSchema: z.ZodType<CreateNodeInput> = z.lazy(() =>
  z.object({
    ...baseCreateNodeFields,
    children: z.array(createNodeSchema).optional(),
  }),
);

/** update_node */
export const updateNodeSchema = z.object({
  nodeId: z.string(),
  name: z.string().optional(),
  position: position.optional(),
  size: sizeOptionalBoth.optional(),
  fills: z.array(fill).optional(),
  strokes: z.array(stroke).optional(),
  strokeWeight: z.number().min(0).optional(),
  effects: z.array(effect).optional(),
  cornerRadius: cornerRadius.optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  blendMode: blendModeEnum.optional(),
  clipsContent: z.boolean().optional(),
  autoLayout: autoLayoutParams.optional(),
  layoutGrids: z.array(layoutGrid).optional(),
  constraints: constraints.optional(),
  layoutChild: layoutChildParams.optional(),
});

/** batch_update_nodes */
export const batchUpdateNodesSchema = z.object({
  updates: z.array(updateNodeSchema).min(1).max(50),
});

/** delete_nodes */
export const deleteNodesSchema = z.object({
  nodeIds: z.array(z.string()).min(1).max(50),
});

/** clone_node */
export const cloneNodeSchema = z.object({
  nodeId: z.string(),
  parentId: z.string().optional(),
  position: position.optional(),
  name: z.string().optional(),
});

/** reparent_node */
export const reparentNodeSchema = z.object({
  nodeId: z.string(),
  parentId: z.string(),
  index: z.number().optional(),
});

/** reorder_children */
export const reorderChildrenSchema = z.object({
  parentId: z.string(),
  childIds: z.array(z.string()).min(1),
});

// ============================================================================
// 3. Write Tools -- Text
// ============================================================================

/** set_text */
export const setTextSchema = z.object({
  nodeId: z.string(),
  text: z.string().optional(),
  style: textStyle.optional(),
  styleRanges: z.array(textStyleRange).optional(),
});

// ============================================================================
// 4. Write Tools -- Visual Properties
// ============================================================================

/** set_fills */
export const setFillsSchema = z.object({
  nodeId: z.string(),
  fills: z.array(fill),
});

/** set_strokes */
export const setStrokesSchema = z.object({
  nodeId: z.string(),
  strokes: z.array(stroke),
  strokeWeight: z.number().min(0).optional(),
  strokeAlign: z.enum(["INSIDE", "OUTSIDE", "CENTER"]).optional(),
  dashPattern: z.array(z.number()).optional(),
  strokeCap: z
    .enum(["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"])
    .optional(),
  strokeJoin: z.enum(["MITER", "BEVEL", "ROUND"]).optional(),
});

/** set_effects */
export const setEffectsSchema = z.object({
  nodeId: z.string(),
  effects: z.array(effect),
});

/** set_corner_radius */
export const setCornerRadiusSchema = z.object({
  nodeId: z.string(),
  radius: cornerRadius,
});

// ============================================================================
// 5. Write Tools -- Layout
// ============================================================================

/** set_auto_layout */
export const setAutoLayoutSchema = z.object({
  nodeId: z.string(),
  enabled: z.boolean().optional(),
  direction: z.enum(["horizontal", "vertical"]).optional(),
  wrap: z.boolean().optional(),
  spacing: z.union([z.number().min(0), z.literal("auto")]).optional(),
  padding: padding.optional(),
  primaryAxisAlign: z
    .enum(["min", "center", "max", "space-between"])
    .optional(),
  counterAxisAlign: z.enum(["min", "center", "max", "baseline"]).optional(),
  primaryAxisSizing: z.enum(["fixed", "hug"]).optional(),
  counterAxisSizing: z.enum(["fixed", "hug"]).optional(),
  strokesIncludedInLayout: z.boolean().optional(),
  itemReverseZIndex: z.boolean().optional(),
});

/** set_layout_child */
export const setLayoutChildSchema = z.object({
  nodeId: z.string(),
  alignSelf: z.enum(["inherit", "stretch"]).optional(),
  grow: z.number().optional(),
  positioning: z.enum(["auto", "absolute"]).optional(),
  position: position.optional(),
  horizontalConstraint: constraintValueEnum.optional(),
  verticalConstraint: constraintValueEnum.optional(),
});

/** batch_set_layout_children — LayoutChildUpdate */
const layoutChildUpdate = z.object({
  nodeId: z.string(),
  alignSelf: z.enum(["inherit", "stretch"]).optional(),
  grow: z.number().optional(),
  positioning: z.enum(["auto", "absolute"]).optional(),
});

export const batchSetLayoutChildrenSchema = z.object({
  parentId: z.string(),
  children: z.array(layoutChildUpdate).min(1),
});

/** set_layout_grid */
export const setLayoutGridSchema = z.object({
  nodeId: z.string(),
  grids: z.array(layoutGrid),
});

/** set_constraints */
export const setConstraintsSchema = z.object({
  nodeId: z.string(),
  horizontal: constraintValueEnum.optional(),
  vertical: constraintValueEnum.optional(),
});

// ============================================================================
// 6. Write Tools -- Components
// ============================================================================

/** instantiate_component */
export const instantiateComponentSchema = z.object({
  componentKey: z.string().optional(),
  nodeId: z.string().optional(),
  parentId: z.string().optional(),
  position: position.optional(),
  variant: z.record(z.string(), z.string()).optional(),
  overrides: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

/** set_instance_properties */
export const setInstancePropertiesSchema = z.object({
  nodeId: z.string(),
  properties: z.record(z.string(), z.union([z.string(), z.boolean()])),
  resetOverrides: z.array(z.string()).optional(),
});

/** create_component */
export const createComponentSchema = z.object({
  nodeId: z.string(),
  description: z.string().optional(),
});

/** create_component_set */
export const createComponentSetSchema = z.object({
  componentIds: z.array(z.string()).min(1),
  name: z.string().optional(),
});

/** add_component_property */
export const addComponentPropertySchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]),
  defaultValue: z.union([z.string(), z.boolean()]),
});

/** edit_component_property */
export const editComponentPropertySchema = z.object({
  nodeId: z.string(),
  propertyName: z.string(),
  name: z.string().optional(),
  defaultValue: z.union([z.string(), z.boolean()]).optional(),
});

/** delete_component_property */
export const deleteComponentPropertySchema = z.object({
  nodeId: z.string(),
  propertyName: z.string(),
});

/** set_description */
export const setDescriptionSchema = z.object({
  nodeId: z.string(),
  description: z.string(),
});

// ============================================================================
// 7. Write Tools -- Variables & Tokens
// ============================================================================

/** create_variable_collection */
export const createVariableCollectionSchema = z.object({
  name: z.string(),
  initialModeName: z.string().optional(),
  additionalModes: z.array(z.string()).optional(),
});

/** delete_variable_collection */
export const deleteVariableCollectionSchema = z.object({
  collectionId: z.string(),
});

/** VariableDefinition (used by create_variables) */
const variableDefinition = z.object({
  name: z.string(),
  resolvedType: resolvedTypeEnum,
  description: z.string().optional(),
  valuesByMode: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

/** create_variables */
export const createVariablesSchema = z.object({
  collectionId: z.string(),
  variables: z.array(variableDefinition).min(1).max(100),
});

/** VariableUpdate (used by update_variables) */
const variableUpdate = z.object({
  variableId: z.string(),
  modeId: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

/** update_variables */
export const updateVariablesSchema = z.object({
  updates: z.array(variableUpdate).min(1).max(100),
});

/** delete_variable */
export const deleteVariableSchema = z.object({
  variableId: z.string(),
});

/** rename_variable */
export const renameVariableSchema = z.object({
  variableId: z.string(),
  newName: z.string(),
});

/** add_mode */
export const addModeSchema = z.object({
  collectionId: z.string(),
  modeName: z.string(),
});

/** rename_mode */
export const renameModeSchema = z.object({
  collectionId: z.string(),
  modeId: z.string(),
  newName: z.string(),
});

/** TokenDefinition (used by setup_design_tokens) */
const tokenDefinition = z.object({
  name: z.string(),
  resolvedType: resolvedTypeEnum,
  description: z.string().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

/** setup_design_tokens */
export const setupDesignTokensSchema = z.object({
  collectionName: z.string(),
  modes: z.array(z.string()).min(1),
  tokens: z.array(tokenDefinition).min(1).max(100),
});

// ============================================================================
// 8. Write Tools -- Page & Document
// ============================================================================

/** create_page */
export const createPageSchema = z.object({
  name: z.string(),
  index: z.number().optional(),
});

/** rename_page */
export const renamePageSchema = z.object({
  pageId: z.string(),
  name: z.string(),
});

/** delete_page */
export const deletePageSchema = z.object({
  pageId: z.string(),
});

/** set_current_page */
export const setCurrentPageSchema = z.object({
  pageId: z.string(),
});

// ============================================================================
// 9. Write Tools -- Comments
// ============================================================================

/** post_comment */
export const postCommentSchema = z.object({
  message: z.string(),
  nodeId: z.string().optional(),
  position: position.optional(),
  replyTo: z.string().optional(),
});

/** delete_comment */
export const deleteCommentSchema = z.object({
  commentId: z.string(),
});

// ============================================================================
// 10. Utility Tools
// ============================================================================

/** execute */
export const executeSchema = z.object({
  code: z.string(),
  timeout: z.number().max(30000).optional(),
});

/** Operation (used by batch_execute) */
const operation = z.object({
  tool: z.string(),
  params: z.record(z.string(), z.unknown()),
});

/** batch_execute */
export const batchExecuteSchema = z.object({
  operations: z.array(operation).min(1).max(50),
  atomic: z.boolean().optional(),
});

// ============================================================================
// 11. Chat Tools
// ============================================================================

/** wait_for_chat — long-poll for a chat message from the plugin */
export const waitForChatSchema = z.object({
  timeout: z.number().min(1000).max(120000).optional(),
});

/** send_chat_response — send a response back to the plugin chat */
export const sendChatResponseSchema = z.object({
  messageId: z.string(),
  message: z.string(),
  isError: z.boolean().optional(),
});

/** send_chat_chunk — send a streaming chunk to the plugin chat */
export const sendChatChunkSchema = z.object({
  messageId: z.string(),
  delta: z.string(),
  done: z.boolean().optional(),
});

// ============================================================================
// Schema Registry — maps tool names to their Zod schemas
// ============================================================================

export const schemaRegistry = {
  // Read tools
  get_node: getNodeSchema,
  get_selection: getSelectionSchema,
  get_page: getPageSchema,
  search_nodes: searchNodesSchema,
  screenshot: screenshotSchema,
  get_styles: getStylesSchema,
  get_variables: getVariablesSchema,
  get_components: getComponentsSchema,

  // Write — Nodes
  create_node: createNodeSchema,
  update_node: updateNodeSchema,
  batch_update_nodes: batchUpdateNodesSchema,
  delete_nodes: deleteNodesSchema,
  clone_node: cloneNodeSchema,
  reparent_node: reparentNodeSchema,
  reorder_children: reorderChildrenSchema,

  // Write — Text
  set_text: setTextSchema,

  // Write — Visual
  set_fills: setFillsSchema,
  set_strokes: setStrokesSchema,
  set_effects: setEffectsSchema,
  set_corner_radius: setCornerRadiusSchema,

  // Write — Layout
  set_auto_layout: setAutoLayoutSchema,
  set_layout_child: setLayoutChildSchema,
  batch_set_layout_children: batchSetLayoutChildrenSchema,
  set_layout_grid: setLayoutGridSchema,
  set_constraints: setConstraintsSchema,

  // Write — Components
  instantiate_component: instantiateComponentSchema,
  set_instance_properties: setInstancePropertiesSchema,
  create_component: createComponentSchema,
  create_component_set: createComponentSetSchema,
  add_component_property: addComponentPropertySchema,
  edit_component_property: editComponentPropertySchema,
  delete_component_property: deleteComponentPropertySchema,
  set_description: setDescriptionSchema,

  // Write — Variables & Tokens
  create_variable_collection: createVariableCollectionSchema,
  delete_variable_collection: deleteVariableCollectionSchema,
  create_variables: createVariablesSchema,
  update_variables: updateVariablesSchema,
  delete_variable: deleteVariableSchema,
  rename_variable: renameVariableSchema,
  add_mode: addModeSchema,
  rename_mode: renameModeSchema,
  setup_design_tokens: setupDesignTokensSchema,

  // Write — Pages
  create_page: createPageSchema,
  rename_page: renamePageSchema,
  delete_page: deletePageSchema,
  set_current_page: setCurrentPageSchema,

  // Write — Comments
  post_comment: postCommentSchema,
  delete_comment: deleteCommentSchema,

  // Utility
  execute: executeSchema,
  batch_execute: batchExecuteSchema,

  // Chat
  wait_for_chat: waitForChatSchema,
  send_chat_response: sendChatResponseSchema,
  send_chat_chunk: sendChatChunkSchema,
} as const;

export type ToolName = keyof typeof schemaRegistry;
