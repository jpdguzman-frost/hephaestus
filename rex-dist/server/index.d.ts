#!/usr/bin/env node
import { z } from 'zod';
import { EventEmitter } from 'node:events';

declare const WebSocketConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    heartbeatInterval: z.ZodDefault<z.ZodNumber>;
    heartbeatTimeout: z.ZodDefault<z.ZodNumber>;
    reconnectBackoff: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    heartbeatInterval: number;
    heartbeatTimeout: number;
    reconnectBackoff: number[];
}, {
    enabled?: boolean | undefined;
    heartbeatInterval?: number | undefined;
    heartbeatTimeout?: number | undefined;
    reconnectBackoff?: number[] | undefined;
}>;
declare const CommandsConfigSchema: z.ZodObject<{
    defaultTtl: z.ZodDefault<z.ZodNumber>;
    maxRetries: z.ZodDefault<z.ZodNumber>;
    maxConcurrent: z.ZodDefault<z.ZodNumber>;
    maxPerSecond: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    defaultTtl: number;
    maxRetries: number;
    maxConcurrent: number;
    maxPerSecond: number;
}, {
    defaultTtl?: number | undefined;
    maxRetries?: number | undefined;
    maxConcurrent?: number | undefined;
    maxPerSecond?: number | undefined;
}>;
declare const ConfigSchema: z.ZodObject<{
    relay: z.ZodDefault<z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        host: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
    }, {
        port?: number | undefined;
        host?: string | undefined;
    }>>;
    polling: z.ZodDefault<z.ZodObject<{
        defaultInterval: z.ZodDefault<z.ZodNumber>;
        burstInterval: z.ZodDefault<z.ZodNumber>;
        idleInterval: z.ZodDefault<z.ZodNumber>;
        idleThreshold: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        defaultInterval: number;
        burstInterval: number;
        idleInterval: number;
        idleThreshold: number;
    }, {
        defaultInterval?: number | undefined;
        burstInterval?: number | undefined;
        idleInterval?: number | undefined;
        idleThreshold?: number | undefined;
    }>>;
    websocket: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        heartbeatInterval: z.ZodDefault<z.ZodNumber>;
        heartbeatTimeout: z.ZodDefault<z.ZodNumber>;
        reconnectBackoff: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        heartbeatInterval: number;
        heartbeatTimeout: number;
        reconnectBackoff: number[];
    }, {
        enabled?: boolean | undefined;
        heartbeatInterval?: number | undefined;
        heartbeatTimeout?: number | undefined;
        reconnectBackoff?: number[] | undefined;
    }>>;
    commands: z.ZodDefault<z.ZodObject<{
        defaultTtl: z.ZodDefault<z.ZodNumber>;
        maxRetries: z.ZodDefault<z.ZodNumber>;
        maxConcurrent: z.ZodDefault<z.ZodNumber>;
        maxPerSecond: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        defaultTtl: number;
        maxRetries: number;
        maxConcurrent: number;
        maxPerSecond: number;
    }, {
        defaultTtl?: number | undefined;
        maxRetries?: number | undefined;
        maxConcurrent?: number | undefined;
        maxPerSecond?: number | undefined;
    }>>;
    figma: z.ZodDefault<z.ZodObject<{
        personalAccessToken: z.ZodOptional<z.ZodString>;
        preloadFonts: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        preloadFonts: string[];
        personalAccessToken?: string | undefined;
    }, {
        personalAccessToken?: string | undefined;
        preloadFonts?: string[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    relay: {
        port: number;
        host: string;
    };
    polling: {
        defaultInterval: number;
        burstInterval: number;
        idleInterval: number;
        idleThreshold: number;
    };
    websocket: {
        enabled: boolean;
        heartbeatInterval: number;
        heartbeatTimeout: number;
        reconnectBackoff: number[];
    };
    commands: {
        defaultTtl: number;
        maxRetries: number;
        maxConcurrent: number;
        maxPerSecond: number;
    };
    figma: {
        preloadFonts: string[];
        personalAccessToken?: string | undefined;
    };
}, {
    relay?: {
        port?: number | undefined;
        host?: string | undefined;
    } | undefined;
    polling?: {
        defaultInterval?: number | undefined;
        burstInterval?: number | undefined;
        idleInterval?: number | undefined;
        idleThreshold?: number | undefined;
    } | undefined;
    websocket?: {
        enabled?: boolean | undefined;
        heartbeatInterval?: number | undefined;
        heartbeatTimeout?: number | undefined;
        reconnectBackoff?: number[] | undefined;
    } | undefined;
    commands?: {
        defaultTtl?: number | undefined;
        maxRetries?: number | undefined;
        maxConcurrent?: number | undefined;
        maxPerSecond?: number | undefined;
    } | undefined;
    figma?: {
        personalAccessToken?: string | undefined;
        preloadFonts?: string[] | undefined;
    } | undefined;
}>;
type Config = z.infer<typeof ConfigSchema>;
type WebSocketConfig = z.infer<typeof WebSocketConfigSchema>;
type CommandsConfig = z.infer<typeof CommandsConfigSchema>;
/**
 * Load configuration from file and environment variables.
 *
 * Priority (highest to lowest):
 * 1. Environment variables (FIGMA_PAT, RELAY_PORT, RELAY_HOST, etc.)
 * 2. Config file (rex.config.json)
 * 3. Defaults
 *
 * @param configPath - Path to config file (default: rex.config.json in cwd)
 */
declare function loadConfig(configPath?: string): Config;

/**
 * All command types supported by the Rex plugin protocol.
 * Each maps to a specific executor function in the plugin.
 */
declare enum CommandType {
    CREATE_NODE = "CREATE_NODE",
    UPDATE_NODE = "UPDATE_NODE",
    DELETE_NODES = "DELETE_NODES",
    CLONE_NODE = "CLONE_NODE",
    REPARENT_NODE = "REPARENT_NODE",
    REORDER_CHILDREN = "REORDER_CHILDREN",
    SET_TEXT = "SET_TEXT",
    SET_FILLS = "SET_FILLS",
    SET_STROKES = "SET_STROKES",
    SET_EFFECTS = "SET_EFFECTS",
    SET_CORNER_RADIUS = "SET_CORNER_RADIUS",
    SET_AUTO_LAYOUT = "SET_AUTO_LAYOUT",
    SET_LAYOUT_CHILD = "SET_LAYOUT_CHILD",
    BATCH_SET_LAYOUT_CHILDREN = "BATCH_SET_LAYOUT_CHILDREN",
    SET_LAYOUT_GRID = "SET_LAYOUT_GRID",
    SET_CONSTRAINTS = "SET_CONSTRAINTS",
    INSTANTIATE_COMPONENT = "INSTANTIATE_COMPONENT",
    SET_INSTANCE_PROPERTIES = "SET_INSTANCE_PROPERTIES",
    CREATE_COMPONENT = "CREATE_COMPONENT",
    CREATE_COMPONENT_SET = "CREATE_COMPONENT_SET",
    ADD_COMPONENT_PROPERTY = "ADD_COMPONENT_PROPERTY",
    EDIT_COMPONENT_PROPERTY = "EDIT_COMPONENT_PROPERTY",
    DELETE_COMPONENT_PROPERTY = "DELETE_COMPONENT_PROPERTY",
    SET_DESCRIPTION = "SET_DESCRIPTION",
    CREATE_VARIABLE_COLLECTION = "CREATE_VARIABLE_COLLECTION",
    DELETE_VARIABLE_COLLECTION = "DELETE_VARIABLE_COLLECTION",
    CREATE_VARIABLES = "CREATE_VARIABLES",
    UPDATE_VARIABLES = "UPDATE_VARIABLES",
    DELETE_VARIABLE = "DELETE_VARIABLE",
    RENAME_VARIABLE = "RENAME_VARIABLE",
    ADD_MODE = "ADD_MODE",
    RENAME_MODE = "RENAME_MODE",
    SETUP_DESIGN_TOKENS = "SETUP_DESIGN_TOKENS",
    CREATE_PAGE = "CREATE_PAGE",
    RENAME_PAGE = "RENAME_PAGE",
    DELETE_PAGE = "DELETE_PAGE",
    SET_CURRENT_PAGE = "SET_CURRENT_PAGE",
    GET_NODE = "GET_NODE",
    GET_SELECTION = "GET_SELECTION",
    SEARCH_NODES = "SEARCH_NODES",
    SCREENSHOT = "SCREENSHOT",
    GET_STYLES = "GET_STYLES",
    GET_VARIABLES = "GET_VARIABLES",
    GET_COMPONENTS = "GET_COMPONENTS",
    EXECUTE = "EXECUTE",
    PING = "PING"
}
/** Command envelope sent from MCP server to plugin. */
interface Command {
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
interface CommandResult {
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
/** Tracks the lifecycle state of a command in the queue. */
declare enum CommandStatus {
    QUEUED = "QUEUED",
    SENT = "SENT",
    ACKNOWLEDGED = "ACKNOWLEDGED",
    COMPLETED = "COMPLETED",
    TIMEOUT = "TIMEOUT",
    RETRY = "RETRY",
    FAILED = "FAILED",
    EXPIRED = "EXPIRED"
}
/** Connection state machine states. */
declare enum ConnectionState {
    /** Server listening, no plugin connected */
    WAITING = "WAITING",
    /** Plugin connected via HTTP polling only */
    POLLING = "POLLING",
    /** Plugin connected via WebSocket + HTTP fallback */
    CONNECTED = "CONNECTED",
    /** WebSocket dropped, operating on HTTP polling only */
    DEGRADED = "DEGRADED"
}
declare enum ErrorCategory {
    CONNECTION_LOST = "CONNECTION_LOST",
    PLUGIN_NOT_RUNNING = "PLUGIN_NOT_RUNNING",
    COMMAND_TIMEOUT = "COMMAND_TIMEOUT",
    NODE_NOT_FOUND = "NODE_NOT_FOUND",
    INVALID_OPERATION = "INVALID_OPERATION",
    FONT_NOT_LOADED = "FONT_NOT_LOADED",
    READ_ONLY_PROPERTY = "READ_ONLY_PROPERTY",
    INVALID_PARAMS = "INVALID_PARAMS",
    SCHEMA_VIOLATION = "SCHEMA_VIOLATION",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    SERIALIZATION_ERROR = "SERIALIZATION_ERROR"
}
declare enum NodeType {
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
    COMPONENT_SET = "COMPONENT_SET"
}
declare enum BlendMode {
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
    LUMINOSITY = "LUMINOSITY"
}
/** Gradient color stop. */
interface GradientStop {
    position: number;
    color: string;
}
/** Solid fill paint. */
interface SolidFill {
    type: "solid";
    color: string;
    opacity?: number;
}
/** Linear gradient fill paint. */
interface LinearGradientFill {
    type: "linear-gradient";
    stops: GradientStop[];
    angle?: number;
}
/** Radial gradient fill paint. */
interface RadialGradientFill {
    type: "radial-gradient";
    stops: GradientStop[];
    center?: {
        x: number;
        y: number;
    };
}
/** Image fill paint. */
interface ImageFill {
    type: "image";
    imageHash: string;
    scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
}
/** Discriminated union of all fill types. */
type Fill = SolidFill | LinearGradientFill | RadialGradientFill | ImageFill;
/** Stroke paint — same types as Fill, with stroke-specific params on the tool. */
type Stroke = SolidFill | LinearGradientFill | RadialGradientFill | ImageFill;
/** Drop shadow effect. */
interface DropShadowEffect {
    type: "drop-shadow";
    color: string;
    offset: {
        x: number;
        y: number;
    };
    blur: number;
    spread?: number;
    visible?: boolean;
}
/** Inner shadow effect. */
interface InnerShadowEffect {
    type: "inner-shadow";
    color: string;
    offset: {
        x: number;
        y: number;
    };
    blur: number;
    spread?: number;
    visible?: boolean;
}
/** Layer blur effect. */
interface LayerBlurEffect {
    type: "layer-blur";
    blur: number;
    visible?: boolean;
}
/** Background blur effect. */
interface BackgroundBlurEffect {
    type: "background-blur";
    blur: number;
    visible?: boolean;
}
/** Discriminated union of all effect types. */
type Effect = DropShadowEffect | InnerShadowEffect | LayerBlurEffect | BackgroundBlurEffect;
/** Per-corner radius specification. */
interface CornerRadius {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
}
/** Per-side padding specification. */
interface Padding {
    top: number;
    right: number;
    bottom: number;
    left: number;
}
/** Auto-layout configuration parameters. */
interface AutoLayoutParams {
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
interface LayoutChildParams {
    alignSelf?: "inherit" | "stretch";
    grow?: number;
    positioning?: "auto" | "absolute";
    position?: {
        x: number;
        y: number;
    };
    horizontalConstraint?: "min" | "center" | "max" | "stretch" | "scale";
    verticalConstraint?: "min" | "center" | "max" | "stretch" | "scale";
}
/** Text styling properties. */
interface TextStyle {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    lineHeight?: number | {
        value: number;
        unit: "percent" | "pixels";
    };
    letterSpacing?: number | {
        value: number;
        unit: "percent" | "pixels";
    };
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
interface TextStyleRange {
    start: number;
    end: number;
    style: TextStyle;
}
/** Serialized paint for node data responses. */
interface SerializedPaint {
    type: string;
    color?: string;
    opacity?: number;
    stops?: GradientStop[];
    angle?: number;
    center?: {
        x: number;
        y: number;
    };
    imageHash?: string;
    scaleMode?: string;
}
/** Serialized effect for node data responses. */
interface SerializedEffect {
    type: string;
    color?: string;
    offset?: {
        x: number;
        y: number;
    };
    blur?: number;
    spread?: number;
    visible?: boolean;
}
/** Serialized auto-layout data for node responses. */
interface SerializedAutoLayout {
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
interface SerializedTextStyle {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    lineHeight?: number | {
        value: number;
        unit: "percent" | "pixels";
    };
    letterSpacing?: number | {
        value: number;
        unit: "percent" | "pixels";
    };
    color?: string;
    textAlignHorizontal?: string;
    textAlignVertical?: string;
    textDecoration?: string;
    textCase?: string;
    textAutoResize?: string;
}
/** Serialized Figma node — the canonical shape returned by read operations. */
interface SerializedNode {
    nodeId: string;
    name: string;
    type: string;
    visible: boolean;
    locked: boolean;
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
    rotation?: number;
    opacity?: number;
    fills?: SerializedPaint[];
    strokes?: SerializedPaint[];
    effects?: SerializedEffect[];
    cornerRadius?: number | CornerRadius;
    autoLayout?: SerializedAutoLayout;
    constraints?: {
        horizontal: string;
        vertical: string;
    };
    children?: SerializedNode[];
    characters?: string;
    textStyle?: SerializedTextStyle;
    componentKey?: string;
    componentProperties?: Record<string, {
        type: string;
        value: string | boolean;
    }>;
    circular?: boolean;
}

/**
 * Structured error for all Rex operations.
 * Carries category, retryable flag, and optional suggestion for the AI client.
 */
declare class RexError extends Error {
    readonly category: ErrorCategory;
    readonly retryable: boolean;
    readonly suggestion?: string;
    readonly commandId?: string;
    readonly nodeId?: string;
    readonly figmaError?: string;
    constructor(options: {
        category: ErrorCategory;
        message: string;
        retryable: boolean;
        suggestion?: string;
        commandId?: string;
        nodeId?: string;
        figmaError?: string;
        cause?: unknown;
    });
    /**
     * Serialize to the error response format defined in SPEC.md section 5.2.
     */
    toResponse(): ErrorResponse;
}
/** Serialized error response matching SPEC.md section 5.2. */
interface ErrorResponse {
    error: {
        category: ErrorCategory;
        message: string;
        commandId?: string;
        retryable: boolean;
        suggestion?: string;
        figmaError?: string;
        nodeId?: string;
    };
}
/** Create a connection-related error (transient, auto-retry). */
declare function connectionError(message: string, options?: {
    category?: ErrorCategory.CONNECTION_LOST | ErrorCategory.PLUGIN_NOT_RUNNING | ErrorCategory.COMMAND_TIMEOUT;
    commandId?: string;
    suggestion?: string;
    cause?: unknown;
}): RexError;
/** Create a Figma API error (may or may not be retryable). */
declare function figmaApiError(message: string, options?: {
    category?: ErrorCategory.NODE_NOT_FOUND | ErrorCategory.INVALID_OPERATION | ErrorCategory.FONT_NOT_LOADED | ErrorCategory.READ_ONLY_PROPERTY;
    retryable?: boolean;
    commandId?: string;
    nodeId?: string;
    figmaError?: string;
    suggestion?: string;
    cause?: unknown;
}): RexError;
/** Create a validation error (never retryable, fix input). */
declare function validationError(message: string, options?: {
    category?: ErrorCategory.INVALID_PARAMS | ErrorCategory.SCHEMA_VIOLATION;
    commandId?: string;
    suggestion?: string;
    cause?: unknown;
}): RexError;
/** Create an internal error (bug in Rex, never retryable). */
declare function internalError(message: string, options?: {
    category?: ErrorCategory.INTERNAL_ERROR | ErrorCategory.SERIALIZATION_ERROR;
    commandId?: string;
    suggestion?: string;
    cause?: unknown;
}): RexError;

/**
 * Structured JSON logger for MCP compatibility.
 *
 * Outputs structured JSON lines to stderr (stdout is reserved for MCP stdio transport).
 * Supports level filtering and contextual fields.
 */
type LogLevel = "debug" | "info" | "warn" | "error";
interface Logger {
    debug(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
    child(fields: Record<string, unknown>): Logger;
}
/**
 * Create a structured logger that outputs JSON to stderr.
 *
 * @param minLevel - Minimum log level to output (default: "info")
 * @param baseFields - Fields included in every log entry
 */
declare function createLogger(minLevel?: LogLevel, baseFields?: Record<string, unknown>): Logger;

/** A command with lifecycle tracking metadata. */
interface QueuedCommand {
    command: Command;
    status: CommandStatus;
    retryCount: number;
    createdAt: number;
    sentAt?: number;
    acknowledgedAt?: number;
    completedAt?: number;
    result?: CommandResult;
    /** Promise resolve callback for callers waiting on this command. */
    resolve?: (result: CommandResult) => void;
    /** Promise reject callback for callers waiting on this command. */
    reject?: (error: RexError) => void;
}
declare class CommandQueue extends EventEmitter {
    private readonly queue;
    private readonly idempotencyCache;
    private readonly rateLimiter;
    private readonly config;
    private readonly logger;
    private ttlTimer;
    constructor(config: CommandsConfig, logger: Logger);
    /**
     * Enqueue a command for delivery to the plugin.
     * Returns a promise that resolves when the command completes.
     */
    enqueue(command: Command): Promise<CommandResult>;
    /** Mark a command as sent to the plugin. */
    markSent(id: string): void;
    /** Mark a command as acknowledged by the plugin. */
    markAcknowledged(id: string): void;
    /** Complete a command with a result. */
    complete(id: string, result: CommandResult): void;
    /** Mark a command as timed out. May trigger retry. */
    timeout(id: string): void;
    /** Retry a command. Resets status to QUEUED with incremented retry count. */
    retry(id: string): void;
    /** Permanently fail a command. */
    private fail;
    /** Get all commands in QUEUED state (ready to be sent). */
    getPending(): QueuedCommand[];
    /** Get all commands in SENT or ACKNOWLEDGED state (waiting for result). */
    getInFlight(): QueuedCommand[];
    /** Get a specific queued command by ID. */
    get(id: string): QueuedCommand | undefined;
    /** Get queue statistics for health reporting. */
    getStats(): {
        pending: number;
        inFlight: number;
        total: number;
    };
    /** Enforce TTL on all commands — expire stale ones, timeout in-flight ones. */
    private enforceTTL;
    /** Clean up timers. Call when shutting down. */
    destroy(): void;
}

/** User identity from the Figma plugin (via figma.currentUser). */
interface PluginUser {
    id: string;
    name: string;
    photoUrl?: string | null;
}
/** Plugin connection info stored during an active session. */
interface PluginSession {
    sessionId: string;
    pluginId: string;
    fileKey: string;
    fileName: string;
    pageId?: string;
    pageName?: string;
    user?: PluginUser;
    capabilities?: PluginCapabilities;
    connectedAt: number;
    lastHeartbeat: number;
    transport: "http" | "websocket";
}
/** Capabilities reported by the plugin during handshake. */
interface PluginCapabilities {
    maxConcurrent?: number;
    supportedTypes?: string[];
    figmaVersion?: string;
    pluginVersion?: string;
}
/** Connect request payload from the plugin. */
interface ConnectPayload {
    pluginId: string;
    fileKey: string;
    fileName: string;
    pageId?: string;
    pageName?: string;
    user?: PluginUser;
    authResponse?: string;
    capabilities?: PluginCapabilities;
}
/**
 * Manages the connection state machine between the relay server and the Figma plugin.
 *
 * States per SPEC.md §4.1:
 *   WAITING   → plugin connects  → POLLING
 *   POLLING   → WS upgrade       → CONNECTED
 *   CONNECTED → WS drops         → DEGRADED
 *   DEGRADED  → WS reconnects    → CONNECTED
 *   any       → plugin stops     → WAITING
 */
declare class ConnectionManager {
    private _state;
    private _session;
    private readonly authSecret;
    private readonly logger;
    constructor(logger: Logger, authSecret?: string);
    /** Current connection state. */
    get state(): ConnectionState;
    /** Current plugin session, if any. */
    get session(): PluginSession | null;
    /** The auth secret for this server session. */
    get secret(): string;
    /** Whether a plugin is actively connected (POLLING, CONNECTED, or DEGRADED). */
    get isConnected(): boolean;
    /** Whether WebSocket transport is active. */
    get isWebSocketActive(): boolean;
    /**
     * Validate the X-Auth-Token header.
     * Throws RexError if invalid.
     */
    validateAuth(token: string | undefined): void;
    /**
     * Handle plugin connection (POST /connect).
     * Transitions: WAITING → POLLING.
     * Returns session info and config for the plugin.
     */
    connect(payload: ConnectPayload): PluginSession;
    /**
     * Handle WebSocket upgrade.
     * Transitions: POLLING → CONNECTED, or DEGRADED → CONNECTED.
     */
    upgradeToWebSocket(sessionId: string): void;
    /**
     * Handle WebSocket disconnection.
     * Transitions: CONNECTED → DEGRADED.
     */
    downgradeToPolling(): void;
    /**
     * Handle clean plugin disconnect (POST /disconnect).
     * Transitions: any → WAITING.
     */
    disconnect(reason?: string): void;
    /**
     * Record a heartbeat from the plugin.
     * Updates lastHeartbeat timestamp.
     */
    recordHeartbeat(): void;
    /**
     * Record that a poll was received (implicit heartbeat for HTTP mode).
     */
    recordPoll(): void;
    /**
     * Validate that a plugin ID matches the current session.
     */
    validatePluginId(pluginId: string | undefined): void;
    /**
     * Get connection info for the health endpoint.
     */
    getConnectionInfo(): Record<string, unknown>;
    /** Transition to a new state with logging. */
    private transition;
}

/** Health metrics tracked by the heartbeat monitor. */
interface HealthMetrics {
    commands: {
        total: number;
        success: number;
        failed: number;
        timeout: number;
        retried: number;
    };
    latency: {
        /** Running average latency in ms. */
        avg: number;
        /** 95th percentile latency in ms. */
        p95: number;
        /** All recorded latencies (bounded circular buffer). */
        samples: number[];
    };
    connection: {
        uptime: number;
        reconnects: number;
    };
    transport: {
        httpPolls: number;
        wsMessages: number;
    };
}
declare class HeartbeatMonitor {
    private readonly logger;
    private readonly wsConfig;
    private readonly connection;
    private lastPollTime;
    private missedPolls;
    private pollCheckTimer;
    private awaitingPong;
    private missedPongs;
    private pingTimer;
    private pongTimeout;
    private pingSender;
    private readonly metrics;
    private onPollTimeout;
    private onPongTimeout;
    constructor(connection: ConnectionManager, wsConfig: WebSocketConfig, logger: Logger);
    /**
     * Start monitoring HTTP polling health.
     * Checks at the expected poll interval whether we have received a poll recently.
     *
     * @param expectedInterval - Expected poll interval in ms (default 300ms from config)
     * @param onTimeout - Callback when too many polls are missed
     */
    startPollMonitoring(_expectedInterval: number, onTimeout: () => void): void;
    /** Record that a poll was received. Resets missed poll counter. */
    recordPoll(): void;
    /**
     * Start WebSocket heartbeat (ping/pong).
     *
     * @param sendPing - Function to send a ping message over the WebSocket
     * @param onTimeout - Callback when too many pongs are missed
     */
    startWsHeartbeat(sendPing: () => void, onTimeout: () => void): void;
    /** Record that a pong was received. Resets missed pong counter. */
    recordPong(): void;
    /** Record a WebSocket message. */
    recordWsMessage(): void;
    /** Stop WebSocket heartbeat monitoring. */
    stopWsHeartbeat(): void;
    /** Record a command being processed. */
    recordCommandTotal(): void;
    /** Record a successful command with its latency. */
    recordCommandSuccess(latencyMs: number): void;
    /** Record a failed command. */
    recordCommandFailed(): void;
    /** Record a timed-out command. */
    recordCommandTimeout(): void;
    /** Record a retried command. */
    recordCommandRetried(): void;
    /** Record a WebSocket reconnection. */
    recordReconnect(): void;
    /** Add a latency sample and recalculate stats. */
    private addLatencySample;
    /** Get current health metrics snapshot. */
    getMetrics(): HealthMetrics;
    /** Get a summary suitable for the /health endpoint. */
    getHealthSummary(): Record<string, unknown>;
    /** Clean up all timers. */
    destroy(): void;
}

type MemoryScope = "user" | "team" | "file" | "page";
type MemoryCategory = "decision" | "convention" | "context" | "rejection" | "relationship" | "preference" | "correction";
type MemorySource = "explicit" | "inferred" | "corrected";
interface MemoryUser {
    id: string;
    name: string;
}
interface MemoryEntry {
    _id: string;
    scope: MemoryScope;
    userId?: string;
    fileKey?: string;
    fileName?: string;
    componentKey?: string;
    category: MemoryCategory;
    content: string;
    tags: string[];
    source: MemorySource;
    createdBy: MemoryUser;
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt: Date;
    confidence: number;
    supersededBy?: string;
    relatedTo?: string[];
    accessCount: number;
}
interface MemoryConfig {
    enabled: boolean;
    serviceUrl?: string;
    mongoUri: string;
    dbName: string;
    maxMemoriesPerSession: number;
    cleanupIntervalHours: number;
}
/** Context passed to memory operations from the active session. */
interface MemoryContext {
    userId?: string;
    userName?: string;
    fileKey?: string;
    fileName?: string;
    pageId?: string;
    pageName?: string;
    componentKey?: string;
}

interface CreateMemoryInput$1 {
    scope: MemoryScope;
    category: MemoryCategory;
    content: string;
    tags?: string[];
    source?: MemorySource;
    context: MemoryContext;
}
interface QueryMemoryInput$1 {
    query?: string;
    scope?: MemoryScope;
    category?: MemoryCategory;
    componentKey?: string;
    context: MemoryContext;
    limit?: number;
    includeSuperseded?: boolean;
}
interface CleanupOptions$1 {
    dryRun?: boolean;
    maxAgeDays?: number;
    minConfidence?: number;
    removeSuperseded?: boolean;
}
interface CleanupResult$1 {
    staleCount: number;
    lowConfidenceCount: number;
    supersededCount: number;
    totalRemoved: number;
    dryRun: boolean;
}
declare class MemoryStore {
    private client;
    private db;
    private memories;
    private config;
    private logger;
    constructor(config: MemoryConfig, logger: Logger);
    /** Connect to MongoDB and set up indexes. */
    connect(): Promise<void>;
    /** Disconnect from MongoDB. */
    disconnect(): Promise<void>;
    /** Whether the memory store is connected and usable. */
    get isConnected(): boolean;
    /** Store a new memory. Checks for conflicts and supersedes if needed. */
    remember(input: CreateMemoryInput$1): Promise<MemoryEntry>;
    /** Query memories relevant to a topic. */
    recall(input: QueryMemoryInput$1): Promise<MemoryEntry[]>;
    /** Delete a specific memory or memories matching a query. */
    forget(context: MemoryContext, id?: string, query?: string, scope?: MemoryScope): Promise<number>;
    /** List memories with optional filters. */
    list(context: MemoryContext, scope?: MemoryScope, category?: MemoryCategory, limit?: number, includeSuperseded?: boolean): Promise<MemoryEntry[]>;
    /** Load memories for a session (called on plugin connect). */
    loadForSession(context: MemoryContext, maxEntries?: number): Promise<MemoryEntry[]>;
    /** Clean up stale, low-confidence, and superseded memories. */
    cleanup(options?: CleanupOptions$1): Promise<CleanupResult$1>;
    /** Apply confidence decay to all memories (call periodically). */
    applyDecay(): Promise<number>;
    private ensureConnected;
    /** Find an existing memory with similar content in the same scope. */
    private findSimilar;
}

interface CreateMemoryInput {
    scope: MemoryScope;
    category: MemoryCategory;
    content: string;
    tags?: string[];
    source?: MemorySource;
    context: MemoryContext;
}
interface QueryMemoryInput {
    query?: string;
    scope?: MemoryScope;
    category?: MemoryCategory;
    context: MemoryContext;
    limit?: number;
    includeSuperseded?: boolean;
}
interface CleanupOptions {
    dryRun?: boolean;
    maxAgeDays?: number;
    minConfidence?: number;
    removeSuperseded?: boolean;
}
interface CleanupResult {
    staleCount: number;
    lowConfidenceCount: number;
    supersededCount: number;
    totalRemoved: number;
    dryRun: boolean;
}
declare class MemoryServiceClient {
    private baseUrl;
    private logger;
    private _connected;
    constructor(baseUrl: string, logger: Logger);
    get isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    remember(input: CreateMemoryInput): Promise<MemoryEntry>;
    recall(input: QueryMemoryInput): Promise<MemoryEntry[]>;
    forget(context: MemoryContext, id?: string, query?: string, scope?: MemoryScope): Promise<number>;
    list(context: MemoryContext, scope?: MemoryScope, category?: MemoryCategory, limit?: number, includeSuperseded?: boolean): Promise<MemoryEntry[]>;
    loadForSession(context: MemoryContext, maxEntries?: number): Promise<MemoryEntry[]>;
    cleanup(options?: CleanupOptions): Promise<CleanupResult>;
    applyDecay(): Promise<number>;
    private post;
}

declare class RelayServer {
    private readonly config;
    private readonly logger;
    readonly queue: CommandQueue;
    readonly connection: ConnectionManager;
    readonly heartbeat: HeartbeatMonitor;
    private fastify;
    private wss;
    private wsClient;
    private startTime;
    private pollingState;
    private chatInbox;
    private chatWaiters;
    private chatOutbox;
    private readonly commentWatcher;
    private readonly memoryConfig;
    private _memoryStore;
    /** Access the memory store (null if disabled/not connected). */
    get memoryStore(): MemoryStore | MemoryServiceClient | null;
    constructor(config: Config, logger: Logger);
    /** Wire command queue events to heartbeat metrics. */
    private wireQueueEvents;
    /**
     * Start the relay server.
     * Binds HTTP + WebSocket to the configured host:port.
     */
    start(): Promise<void>;
    /**
     * Stop the relay server gracefully.
     */
    stop(): Promise<void>;
    /** Track active tool count for nested/parallel tool calls. */
    private activeToolCount;
    /**
     * Signal that a tool is starting or finishing.
     * Pushes a lightweight notification to the plugin so the forging
     * animation shows while Claude is working — before commands even arrive.
     */
    signalActivity(active: boolean): void;
    /** Current activity state for HTTP polling responses. */
    private _activityState;
    /** Whether any tools are currently active (for polling responses). */
    get isActive(): boolean;
    /** Whether wait_for_chat is actively listening (for plugin to show/hide chat button). */
    private _chatListening;
    private chatListeningGraceTimer;
    get chatListening(): boolean;
    private setChatListening;
    /**
     * Schedule chatListening = false after a grace period.
     * Cancelled if wait_for_chat is called again before it fires.
     */
    private scheduleChatListeningTimeout;
    /**
     * Called by the plugin to send a chat message.
     * If an MCP tool is long-polling (via wait_for_chat), resolve it immediately.
     */
    enqueueChatMessage(msg: {
        id: string;
        message: string;
        selection: unknown[];
        timestamp: number;
    }): void;
    /**
     * Called by the MCP tool `wait_for_chat` to long-poll for a message.
     * Returns immediately if there's a queued message, otherwise waits up to timeoutMs.
     */
    waitForChatMessage(timeoutMs: number): Promise<{
        id: string;
        message: string;
        selection: unknown[];
        timestamp: number;
    } | null>;
    /**
     * Called by the MCP tool `send_chat_response` to push a response back to the plugin.
     * Delivers via WebSocket if connected, otherwise queues for HTTP polling.
     */
    sendChatResponse(response: {
        id: string;
        message: string;
        timestamp: number;
        isError?: boolean;
    }): void;
    /**
     * Called by the MCP tool `send_chat_chunk` to push a streaming chunk to the plugin.
     * Delivers via WebSocket if connected, otherwise queues for HTTP polling.
     */
    sendChatChunk(chunk: {
        id: string;
        delta: string;
        done: boolean;
        timestamp: number;
    }): void;
    /**
     * Get and drain pending chat responses for the plugin (called during HTTP polling).
     */
    drainChatResponses(): Array<{
        id: string;
        message: string;
        timestamp: number;
        isError?: boolean;
        _isChunk?: boolean;
        _done?: boolean;
    }>;
    /**
     * Send a command to the plugin.
     * Uses WebSocket if connected, otherwise queues for HTTP polling.
     */
    sendCommand(command: Command): Promise<CommandResult>;
    private registerRoutes;
    private handleHealth;
    private handleConnect;
    private handleGetCommands;
    private handlePostResults;
    private handleDisconnect;
    private handleUpgrade;
    private onWebSocketConnection;
    private onWsMessage;
    /** Send a command to the plugin via WebSocket. */
    private pushCommandViaWs;
    /** Send a ping message over WebSocket. */
    private wsSendPing;
    /** Calculate the suggested polling interval based on queue activity. */
    private calculatePollingInterval;
}

/**
 * MCP Server initialization and tool registration.
 *
 * Sets up the @modelcontextprotocol/sdk Server with stdio transport,
 * registers all tools from API.md with Zod input schemas,
 * and embeds the relay server for plugin communication.
 */

declare class RexMcpServer {
    private readonly server;
    private readonly relay;
    private readonly config;
    private readonly logger;
    private readonly toolDefinitions;
    constructor(config: Config, logger: Logger);
    /**
     * Start the MCP server on stdio transport and the embedded relay server.
     */
    start(): Promise<void>;
    /**
     * Gracefully shut down both servers.
     */
    stop(): Promise<void>;
    /**
     * Get the relay server instance (for direct access to command queue, etc.).
     */
    getRelay(): RelayServer;
    private registerHandlers;
}

export { type AutoLayoutParams, type BackgroundBlurEffect, BlendMode, type Command, type CommandResult, CommandStatus, CommandType, type Config, ConnectionState, type CornerRadius, type DropShadowEffect, type Effect, ErrorCategory, type Fill, type GradientStop, type ImageFill, type InnerShadowEffect, type LayerBlurEffect, type LayoutChildParams, type LinearGradientFill, type LogLevel, type Logger, NodeType, type Padding, type RadialGradientFill, RexError, RexMcpServer, type SerializedAutoLayout, type SerializedEffect, type SerializedNode, type SerializedPaint, type SerializedTextStyle, type SolidFill, type Stroke, type TextStyle, type TextStyleRange, connectionError, createLogger, figmaApiError, internalError, loadConfig, validationError };
