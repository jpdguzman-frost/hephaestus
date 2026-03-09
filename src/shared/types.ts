// ─── Command Types ───────────────────────────────────────────────────────────

/**
 * All command types supported by the Hephaestus plugin protocol.
 * Each maps to a specific executor function in the plugin.
 */
export enum CommandType {
  // Node commands
  CREATE_NODE = "CREATE_NODE",
  UPDATE_NODE = "UPDATE_NODE",
  DELETE_NODES = "DELETE_NODES",
  CLONE_NODE = "CLONE_NODE",
  REPARENT_NODE = "REPARENT_NODE",
  REORDER_CHILDREN = "REORDER_CHILDREN",

  // Text commands
  SET_TEXT = "SET_TEXT",

  // Visual commands
  SET_FILLS = "SET_FILLS",
  SET_STROKES = "SET_STROKES",
  SET_EFFECTS = "SET_EFFECTS",
  SET_CORNER_RADIUS = "SET_CORNER_RADIUS",

  // Layout commands
  SET_AUTO_LAYOUT = "SET_AUTO_LAYOUT",
  SET_LAYOUT_CHILD = "SET_LAYOUT_CHILD",
  BATCH_SET_LAYOUT_CHILDREN = "BATCH_SET_LAYOUT_CHILDREN",
  SET_LAYOUT_GRID = "SET_LAYOUT_GRID",
  SET_CONSTRAINTS = "SET_CONSTRAINTS",

  // Component commands
  INSTANTIATE_COMPONENT = "INSTANTIATE_COMPONENT",
  SET_INSTANCE_PROPERTIES = "SET_INSTANCE_PROPERTIES",
  CREATE_COMPONENT = "CREATE_COMPONENT",
  CREATE_COMPONENT_SET = "CREATE_COMPONENT_SET",
  ADD_COMPONENT_PROPERTY = "ADD_COMPONENT_PROPERTY",
  EDIT_COMPONENT_PROPERTY = "EDIT_COMPONENT_PROPERTY",
  DELETE_COMPONENT_PROPERTY = "DELETE_COMPONENT_PROPERTY",
  SET_DESCRIPTION = "SET_DESCRIPTION",

  // Variable commands
  CREATE_VARIABLE_COLLECTION = "CREATE_VARIABLE_COLLECTION",
  DELETE_VARIABLE_COLLECTION = "DELETE_VARIABLE_COLLECTION",
  CREATE_VARIABLES = "CREATE_VARIABLES",
  UPDATE_VARIABLES = "UPDATE_VARIABLES",
  DELETE_VARIABLE = "DELETE_VARIABLE",
  RENAME_VARIABLE = "RENAME_VARIABLE",
  ADD_MODE = "ADD_MODE",
  RENAME_MODE = "RENAME_MODE",
  SETUP_DESIGN_TOKENS = "SETUP_DESIGN_TOKENS",

  // Page commands
  CREATE_PAGE = "CREATE_PAGE",
  RENAME_PAGE = "RENAME_PAGE",
  DELETE_PAGE = "DELETE_PAGE",
  SET_CURRENT_PAGE = "SET_CURRENT_PAGE",

  // Read commands (plugin-only)
  GET_NODE = "GET_NODE",
  GET_SELECTION = "GET_SELECTION",
  SEARCH_NODES = "SEARCH_NODES",
  SCREENSHOT = "SCREENSHOT",
  GET_STYLES = "GET_STYLES",
  GET_VARIABLES = "GET_VARIABLES",
  GET_COMPONENTS = "GET_COMPONENTS",

  // Utility commands
  EXECUTE = "EXECUTE",
  PING = "PING",
}

// ─── Command Wire Format ─────────────────────────────────────────────────────

/** Command envelope sent from MCP server to plugin. */
export interface Command {
  /** Unique command ID (UUID v4) */
  id: string;

  /** Command type — maps to a plugin executor function */
  type: CommandType;

  /** Command-specific payload */
  payload: Record<string, unknown>;

  /** Unix timestamp (ms) when the command was created */
  timestamp: number;

  /** Time-to-live in ms — command expires if not executed within this window */
  ttl: number;

  /** Optional idempotency key for retry safety */
  idempotencyKey?: string;

  /** Whether this command is part of an atomic batch */
  atomic?: boolean;

  /** Batch ID if this command is part of a batch */
  batchId?: string;

  /** Sequence number within a batch (for ordering) */
  batchSeq?: number;

  /** Total commands in the batch */
  batchTotal?: number;
}

/** Result envelope sent from plugin back to MCP server. */
export interface CommandResult {
  /** Matches the command ID */
  id: string;

  /** Execution status */
  status: "success" | "error";

  /** Result data (on success) */
  result?: Record<string, unknown>;

  /** Error details (on failure) */
  error?: {
    category: ErrorCategory;
    message: string;
    figmaError?: string;
    nodeId?: string;
    retryable: boolean;
    suggestion?: string;
  };

  /** Execution duration in ms */
  duration: number;

  /** Unix timestamp (ms) when execution completed */
  timestamp: number;

  /** Batch ID if this is part of a batch */
  batchId?: string;

  /** Sequence number within batch */
  batchSeq?: number;
}

// ─── Command Lifecycle ───────────────────────────────────────────────────────

/** Tracks the lifecycle state of a command in the queue. */
export enum CommandStatus {
  QUEUED = "QUEUED",
  SENT = "SENT",
  ACKNOWLEDGED = "ACKNOWLEDGED",
  COMPLETED = "COMPLETED",
  TIMEOUT = "TIMEOUT",
  RETRY = "RETRY",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
}

// ─── Connection State ────────────────────────────────────────────────────────

/** Connection state machine states. */
export enum ConnectionState {
  /** Server listening, no plugin connected */
  WAITING = "WAITING",
  /** Plugin connected via HTTP polling only */
  POLLING = "POLLING",
  /** Plugin connected via WebSocket + HTTP fallback */
  CONNECTED = "CONNECTED",
  /** WebSocket dropped, operating on HTTP polling only */
  DEGRADED = "DEGRADED",
}

// ─── Error Categories ────────────────────────────────────────────────────────

export enum ErrorCategory {
  // Connection errors — transient, auto-retry
  CONNECTION_LOST = "CONNECTION_LOST",
  PLUGIN_NOT_RUNNING = "PLUGIN_NOT_RUNNING",
  COMMAND_TIMEOUT = "COMMAND_TIMEOUT",

  // Figma API errors — may be retryable
  NODE_NOT_FOUND = "NODE_NOT_FOUND",
  INVALID_OPERATION = "INVALID_OPERATION",
  FONT_NOT_LOADED = "FONT_NOT_LOADED",
  READ_ONLY_PROPERTY = "READ_ONLY_PROPERTY",

  // Validation errors — never retry, fix input
  INVALID_PARAMS = "INVALID_PARAMS",
  SCHEMA_VIOLATION = "SCHEMA_VIOLATION",

  // Internal errors — bug in Hephaestus
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERIALIZATION_ERROR = "SERIALIZATION_ERROR",
}

// ─── Node Types ──────────────────────────────────────────────────────────────

export enum NodeType {
  FRAME = "FRAME",
  RECTANGLE = "RECTANGLE",
  ELLIPSE = "ELLIPSE",
  TEXT = "TEXT",
  LINE = "LINE",
  POLYGON = "POLYGON",
  STAR = "STAR",
  VECTOR = "VECTOR",
  SECTION = "SECTION",
  COMPONENT = "COMPONENT",
  COMPONENT_SET = "COMPONENT_SET",
}

// ─── Blend Modes ─────────────────────────────────────────────────────────────

export enum BlendMode {
  NORMAL = "NORMAL",
  DARKEN = "DARKEN",
  MULTIPLY = "MULTIPLY",
  COLOR_BURN = "COLOR_BURN",
  LIGHTEN = "LIGHTEN",
  SCREEN = "SCREEN",
  COLOR_DODGE = "COLOR_DODGE",
  OVERLAY = "OVERLAY",
  SOFT_LIGHT = "SOFT_LIGHT",
  HARD_LIGHT = "HARD_LIGHT",
  DIFFERENCE = "DIFFERENCE",
  EXCLUSION = "EXCLUSION",
  HUE = "HUE",
  SATURATION = "SATURATION",
  COLOR = "COLOR",
  LUMINOSITY = "LUMINOSITY",
}

// ─── Visual Types ────────────────────────────────────────────────────────────

/** Gradient color stop. */
export interface GradientStop {
  position: number;
  color: string;
}

/** Solid fill paint. */
export interface SolidFill {
  type: "solid";
  color: string;
  opacity?: number;
}

/** Linear gradient fill paint. */
export interface LinearGradientFill {
  type: "linear-gradient";
  stops: GradientStop[];
  angle?: number;
}

/** Radial gradient fill paint. */
export interface RadialGradientFill {
  type: "radial-gradient";
  stops: GradientStop[];
  center?: { x: number; y: number };
}

/** Image fill paint. */
export interface ImageFill {
  type: "image";
  imageHash: string;
  scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
}

/** Discriminated union of all fill types. */
export type Fill = SolidFill | LinearGradientFill | RadialGradientFill | ImageFill;

/** Stroke paint — same types as Fill, with stroke-specific params on the tool. */
export type Stroke = SolidFill | LinearGradientFill | RadialGradientFill | ImageFill;

/** Drop shadow effect. */
export interface DropShadowEffect {
  type: "drop-shadow";
  color: string;
  offset: { x: number; y: number };
  blur: number;
  spread?: number;
  visible?: boolean;
}

/** Inner shadow effect. */
export interface InnerShadowEffect {
  type: "inner-shadow";
  color: string;
  offset: { x: number; y: number };
  blur: number;
  spread?: number;
  visible?: boolean;
}

/** Layer blur effect. */
export interface LayerBlurEffect {
  type: "layer-blur";
  blur: number;
  visible?: boolean;
}

/** Background blur effect. */
export interface BackgroundBlurEffect {
  type: "background-blur";
  blur: number;
  visible?: boolean;
}

/** Discriminated union of all effect types. */
export type Effect = DropShadowEffect | InnerShadowEffect | LayerBlurEffect | BackgroundBlurEffect;

// ─── Geometry Types ──────────────────────────────────────────────────────────

/** Per-corner radius specification. */
export interface CornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/** Per-side padding specification. */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ─── Layout Types ────────────────────────────────────────────────────────────

/** Auto-layout configuration parameters. */
export interface AutoLayoutParams {
  enabled?: boolean;
  direction?: "horizontal" | "vertical";
  wrap?: boolean;
  spacing?: number | "auto";
  padding?: number | Padding;
  primaryAxisAlign?: "min" | "center" | "max" | "space-between";
  counterAxisAlign?: "min" | "center" | "max" | "baseline";
  primaryAxisSizing?: "fixed" | "hug";
  counterAxisSizing?: "fixed" | "hug";
  strokesIncludedInLayout?: boolean;
  itemReverseZIndex?: boolean;
}

/** Layout child behavior within an auto-layout parent. */
export interface LayoutChildParams {
  alignSelf?: "inherit" | "stretch";
  grow?: number;
  positioning?: "auto" | "absolute";
  position?: { x: number; y: number };
  horizontalConstraint?: "min" | "center" | "max" | "stretch" | "scale";
  verticalConstraint?: "min" | "center" | "max" | "stretch" | "scale";
}

// ─── Text Types ──────────────────────────────────────────────────────────────

/** Text styling properties. */
export interface TextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeight?: number | { value: number; unit: "percent" | "pixels" };
  letterSpacing?: number | { value: number; unit: "percent" | "pixels" };
  color?: string;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  maxLines?: number;
  paragraphSpacing?: number;
}

/** A styled range within a text node. */
export interface TextStyleRange {
  start: number;
  end: number;
  style: TextStyle;
}

// ─── Serialized Node Types ───────────────────────────────────────────────────

/** Serialized paint for node data responses. */
export interface SerializedPaint {
  type: string;
  color?: string;
  opacity?: number;
  stops?: GradientStop[];
  angle?: number;
  center?: { x: number; y: number };
  imageHash?: string;
  scaleMode?: string;
}

/** Serialized effect for node data responses. */
export interface SerializedEffect {
  type: string;
  color?: string;
  offset?: { x: number; y: number };
  blur?: number;
  spread?: number;
  visible?: boolean;
}

/** Serialized auto-layout data for node responses. */
export interface SerializedAutoLayout {
  direction: "horizontal" | "vertical";
  wrap?: boolean;
  spacing: number;
  padding: Padding;
  primaryAxisAlign: string;
  counterAxisAlign: string;
  primaryAxisSizing: "hug" | "fixed";
  counterAxisSizing: "hug" | "fixed";
}

/** Serialized text style for node responses. */
export interface SerializedTextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeight?: number | { value: number; unit: "percent" | "pixels" };
  letterSpacing?: number | { value: number; unit: "percent" | "pixels" };
  color?: string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textDecoration?: string;
  textCase?: string;
  textAutoResize?: string;
}

/** Serialized Figma node — the canonical shape returned by read operations. */
export interface SerializedNode {
  nodeId: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number;
  opacity?: number;
  fills?: SerializedPaint[];
  strokes?: SerializedPaint[];
  effects?: SerializedEffect[];
  cornerRadius?: number | CornerRadius;
  autoLayout?: SerializedAutoLayout;
  constraints?: { horizontal: string; vertical: string };
  children?: SerializedNode[];
  // Text-specific
  characters?: string;
  textStyle?: SerializedTextStyle;
  // Component-specific
  componentKey?: string;
  componentProperties?: Record<string, { type: string; value: string | boolean }>;
  // Circular reference marker
  circular?: boolean;
}
