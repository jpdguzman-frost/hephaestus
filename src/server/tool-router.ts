/**
 * Tool Router — routes MCP tool calls to the appropriate handler.
 *
 * Responsibilities:
 * - Map tool names to handler functions
 * - Validate inputs against Zod schemas
 * - For plugin-required tools: enqueue command via command queue, await result
 * - For REST API tools: call Figma REST API directly
 * - Serialize responses to MCP content format
 * - Handle errors: catch RexError, format per SPEC.md section 5.2
 */

import { v4 as uuidv4 } from "uuid";
import { ZodError } from "zod";

import type { Config } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { Command, CommandResult } from "../shared/types.js";
import { CommandType, ErrorCategory } from "../shared/types.js";
import { RexError, validationError, toRexError } from "../shared/errors.js";
import { schemaRegistry, type ToolName } from "../tools/schemas.js";
import type { RelayServer } from "../relay/server.js";

// ─── Tool Routing Category ─────────────────────────────────────────────────

/**
 * How a tool is executed:
 * - "plugin"  — requires the Figma plugin; routed through command queue
 * - "rest"    — uses the Figma REST API directly (no plugin needed)
 * - "local"   — handled locally within the MCP server (e.g., get_status)
 */
type ToolCategory = "plugin" | "rest" | "local";

/**
 * Maps each tool name to its execution category and command type (if plugin).
 */
interface ToolRoute {
  category: ToolCategory;
  commandType?: CommandType;
  /** If true, try REST handler first, fall back to plugin on failure. */
  restFallback?: boolean;
}

const TOOL_ROUTES: Record<string, ToolRoute> = {
  // ── Read Tools ──────────────────────────────────────────────────────────
  get_node:       { category: "plugin", commandType: CommandType.GET_NODE },
  get_selection:  { category: "plugin", commandType: CommandType.GET_SELECTION },
  get_page:       { category: "plugin", commandType: CommandType.GET_NODE },      // Uses plugin for live data
  search_nodes:   { category: "plugin", commandType: CommandType.SEARCH_NODES },
  screenshot:     { category: "plugin", commandType: CommandType.SCREENSHOT },
  get_styles:     { category: "plugin", commandType: CommandType.GET_STYLES, restFallback: true },
  get_variables:  { category: "plugin", commandType: CommandType.GET_VARIABLES, restFallback: true },
  get_components: { category: "plugin", commandType: CommandType.GET_COMPONENTS, restFallback: true },

  // ── Write Tools: Nodes ──────────────────────────────────────────────────
  create_node:        { category: "plugin", commandType: CommandType.CREATE_NODE },
  update_node:        { category: "plugin", commandType: CommandType.UPDATE_NODE },
  batch_update_nodes: { category: "plugin", commandType: CommandType.UPDATE_NODE },
  delete_nodes:       { category: "plugin", commandType: CommandType.DELETE_NODES },
  clone_node:         { category: "plugin", commandType: CommandType.CLONE_NODE },
  reparent_node:      { category: "plugin", commandType: CommandType.REPARENT_NODE },
  reorder_children:   { category: "plugin", commandType: CommandType.REORDER_CHILDREN },

  // ── Write Tools: Text ───────────────────────────────────────────────────
  set_text: { category: "plugin", commandType: CommandType.SET_TEXT },

  // ── Write Tools: Visual Properties ──────────────────────────────────────
  set_fills:         { category: "plugin", commandType: CommandType.SET_FILLS },
  set_strokes:       { category: "plugin", commandType: CommandType.SET_STROKES },
  set_effects:       { category: "plugin", commandType: CommandType.SET_EFFECTS },
  set_corner_radius: { category: "plugin", commandType: CommandType.SET_CORNER_RADIUS },

  // ── Write Tools: Layout ─────────────────────────────────────────────────
  set_auto_layout:           { category: "plugin", commandType: CommandType.SET_AUTO_LAYOUT },
  set_layout_child:          { category: "plugin", commandType: CommandType.SET_LAYOUT_CHILD },
  batch_set_layout_children: { category: "plugin", commandType: CommandType.BATCH_SET_LAYOUT_CHILDREN },
  set_layout_grid:           { category: "plugin", commandType: CommandType.SET_LAYOUT_GRID },
  set_constraints:           { category: "plugin", commandType: CommandType.SET_CONSTRAINTS },

  // ── Write Tools: Components ─────────────────────────────────────────────
  instantiate_component:     { category: "plugin", commandType: CommandType.INSTANTIATE_COMPONENT },
  set_instance_properties:   { category: "plugin", commandType: CommandType.SET_INSTANCE_PROPERTIES },
  create_component:          { category: "plugin", commandType: CommandType.CREATE_COMPONENT },
  create_component_set:      { category: "plugin", commandType: CommandType.CREATE_COMPONENT_SET },
  add_component_property:    { category: "plugin", commandType: CommandType.ADD_COMPONENT_PROPERTY },
  edit_component_property:   { category: "plugin", commandType: CommandType.EDIT_COMPONENT_PROPERTY },
  delete_component_property: { category: "plugin", commandType: CommandType.DELETE_COMPONENT_PROPERTY },
  set_description:           { category: "plugin", commandType: CommandType.SET_DESCRIPTION },

  // ── Write Tools: Variables & Tokens ─────────────────────────────────────
  create_variable_collection: { category: "plugin", commandType: CommandType.CREATE_VARIABLE_COLLECTION },
  delete_variable_collection: { category: "plugin", commandType: CommandType.DELETE_VARIABLE_COLLECTION },
  create_variables:           { category: "plugin", commandType: CommandType.CREATE_VARIABLES },
  update_variables:           { category: "plugin", commandType: CommandType.UPDATE_VARIABLES },
  delete_variable:            { category: "plugin", commandType: CommandType.DELETE_VARIABLE },
  rename_variable:            { category: "plugin", commandType: CommandType.RENAME_VARIABLE },
  add_mode:                   { category: "plugin", commandType: CommandType.ADD_MODE },
  rename_mode:                { category: "plugin", commandType: CommandType.RENAME_MODE },
  setup_design_tokens:        { category: "plugin", commandType: CommandType.SETUP_DESIGN_TOKENS },

  // ── Write Tools: Pages ──────────────────────────────────────────────────
  create_page:      { category: "plugin", commandType: CommandType.CREATE_PAGE },
  rename_page:      { category: "plugin", commandType: CommandType.RENAME_PAGE },
  delete_page:      { category: "plugin", commandType: CommandType.DELETE_PAGE },
  set_current_page: { category: "plugin", commandType: CommandType.SET_CURRENT_PAGE },

  // ── Write Tools: Comments ───────────────────────────────────────────────
  post_comment:   { category: "rest" },
  delete_comment: { category: "rest" },

  // ── Utility Tools ───────────────────────────────────────────────────────
  execute:       { category: "plugin", commandType: CommandType.EXECUTE },
  get_status:    { category: "local" },
  batch_execute: { category: "plugin", commandType: CommandType.EXECUTE },

  // ── Chat Tools ───────────────────────────────────────────────────────────
  wait_for_chat:       { category: "local" },
  send_chat_response:  { category: "local" },
  send_chat_chunk:     { category: "local" },
};

// ─── Handler Types ──────────────────────────────────────────────────────────

/**
 * A tool handler receives validated params and returns a result object.
 * Handlers are organized by domain in src/tools/{read,write,layout,...}/.
 */
export type ToolHandler = (
  params: Record<string, unknown>,
  context: ToolContext,
) => Promise<Record<string, unknown>>;

/**
 * Context passed to every tool handler.
 */
export interface ToolContext {
  relay: RelayServer;
  config: Config;
  logger: Logger;
  /** Enqueue a command to the plugin and wait for the result. */
  enqueueCommand: (type: CommandType, payload: Record<string, unknown>) => Promise<CommandResult>;
}

// ─── REST API Tool Handlers (Stubs) ─────────────────────────────────────────

/**
 * REST API tool handlers.
 *
 * These are stub implementations that will be filled in by the REST API
 * workstream. Each handler calls the Figma REST API client directly.
 */

async function handleGetStyles(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  // TODO: Implement via FigmaClient — src/tools/read/get-styles.ts
  const { getFile } = await import("../rest-api/index.js");
  const { FigmaClient } = await import("../rest-api/index.js");
  const client = new FigmaClient({ config: context.config, logger: context.logger });

  // For now, get styles requires a file key from the plugin connection
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey as string | undefined;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin.",
    });
  }

  const file = await getFile(client, fileKey, { depth: 0 });
  const styles = file.styles ?? {};
  const types = params["types"] as string[] | undefined;

  const result = Object.entries(styles)
    .filter(([_key, style]) => !types || types.includes(style.styleType?.toLowerCase() ?? ""))
    .map(([key, style]) => ({
      key,
      name: style.name,
      type: style.styleType,
      description: style.description,
    }));

  return { styles: result };
}

async function handleGetVariables(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  // TODO: Implement via FigmaClient — src/tools/read/get-styles.ts
  const { getLocalVariables } = await import("../rest-api/index.js");
  const { FigmaClient } = await import("../rest-api/index.js");
  const client = new FigmaClient({ config: context.config, logger: context.logger });

  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey as string | undefined;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin.",
    });
  }

  const response = await getLocalVariables(client, fileKey);
  const collections = Object.values(response.meta?.variableCollections ?? {});
  const variables = Object.values(response.meta?.variables ?? {});

  // Apply filters
  const collectionFilter = params["collection"] as string | undefined;
  const namePattern = params["namePattern"] as string | undefined;
  const resolvedType = params["resolvedType"] as string | undefined;

  let filteredCollections = collections;
  if (collectionFilter) {
    filteredCollections = collections.filter((c) =>
      c.name.toLowerCase().includes(collectionFilter.toLowerCase()),
    );
  }

  const collectionIds = new Set(filteredCollections.map((c) => c.id));
  let filteredVars = variables.filter((v) => collectionIds.has(v.variableCollectionId));

  if (namePattern) {
    const regex = new RegExp(namePattern, "i");
    filteredVars = filteredVars.filter((v) => regex.test(v.name));
  }

  if (resolvedType) {
    filteredVars = filteredVars.filter((v) => v.resolvedType === resolvedType);
  }

  return {
    collections: filteredCollections.map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes,
      variables: filteredVars
        .filter((v) => v.variableCollectionId === c.id)
        .map((v) => ({
          id: v.id,
          name: v.name,
          resolvedType: v.resolvedType,
          description: v.description,
          valuesByMode: v.valuesByMode,
        })),
    })),
  };
}

async function handleGetComponents(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  // TODO: Implement via FigmaClient — src/tools/read/get-styles.ts
  const { getFileComponents, getFileComponentSets } = await import("../rest-api/index.js");
  const { FigmaClient } = await import("../rest-api/index.js");
  const client = new FigmaClient({ config: context.config, logger: context.logger });

  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey as string | undefined;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin.",
    });
  }

  const query = params["query"] as string | undefined;
  const includeVariants = params["includeVariants"] as boolean | undefined;
  const limit = (params["limit"] as number | undefined) ?? 25;

  const [componentsRes, componentSetsRes] = await Promise.all([
    getFileComponents(client, fileKey),
    includeVariants ? getFileComponentSets(client, fileKey) : Promise.resolve(null),
  ]);

  let components = componentsRes.meta?.components ?? [];

  if (query) {
    const q = query.toLowerCase();
    components = components.filter((c) => c.name.toLowerCase().includes(q));
  }

  components = components.slice(0, limit);

  const result: Record<string, unknown> = {
    components: components.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      containingFrame: c.containing_frame,
    })),
  };

  if (componentSetsRes) {
    result["componentSets"] = componentSetsRes.meta?.component_sets ?? [];
  }

  return result;
}

async function handlePostComment(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { postComment } = await import("../rest-api/index.js");
  const { FigmaClient } = await import("../rest-api/index.js");
  const client = new FigmaClient({ config: context.config, logger: context.logger });

  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey as string | undefined;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin.",
    });
  }

  const nodeId = params["nodeId"] as string | undefined;
  const replyTo = params["replyTo"] as string | undefined;
  const commentParams = {
    message: params["message"] as string,
    ...(nodeId ? { client_meta: { node_id: nodeId, node_offset: { x: 0, y: 0 } } } : {}),
    ...(replyTo ? { comment_id: replyTo } : {}),
  };

  const response = await postComment(client, fileKey, commentParams);
  return response as unknown as Record<string, unknown>;
}

async function handleDeleteComment(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { deleteComment } = await import("../rest-api/index.js");
  const { FigmaClient } = await import("../rest-api/index.js");
  const client = new FigmaClient({ config: context.config, logger: context.logger });

  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey as string | undefined;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin.",
    });
  }

  await deleteComment(client, fileKey, params["commentId"] as string);
  return { deleted: true, commentId: params["commentId"] };
}

// ─── REST Handler Registry ──────────────────────────────────────────────────

const REST_HANDLERS: Record<string, ToolHandler> = {
  get_styles: handleGetStyles,
  get_variables: handleGetVariables,
  get_components: handleGetComponents,
  post_comment: handlePostComment,
  delete_comment: handleDeleteComment,
};

// ─── Local Tool Handlers ────────────────────────────────────────────────────

async function handleGetStatus(
  _params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const queueStats = context.relay.queue.getStats();
  const healthMetrics = context.relay.heartbeat.getMetrics();

  const state = connectionInfo["state"] as string;
  const transport = connectionInfo["transport"] as string | undefined;

  return {
    state,
    transport: {
      http: true,
      websocket: transport === "websocket",
    },
    plugin: {
      connected: state !== "WAITING",
      fileKey: connectionInfo["fileKey"] ?? null,
      fileName: connectionInfo["fileName"] ?? null,
      lastHeartbeat: connectionInfo["lastHeartbeat"] ?? null,
    },
    queue: {
      pending: queueStats.pending,
      inFlight: queueStats.inFlight,
      completed: healthMetrics.commands.success,
      failed: healthMetrics.commands.failed,
    },
    uptime: Math.floor(healthMetrics.connection.uptime / 1000),
  };
}

async function handleWaitForChat(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const timeout = (params["timeout"] as number | undefined) ?? 30000;

  const msg = await context.relay.waitForChatMessage(timeout);

  if (!msg) {
    return {
      status: "timeout",
      message: "No chat message received within timeout period. Call wait_for_chat again to keep listening.",
      _hint: "IMPORTANT: Call wait_for_chat again immediately to continue listening for messages.",
    };
  }

  return {
    status: "received",
    id: msg.id,
    message: msg.message,
    selection: msg.selection,
    timestamp: msg.timestamp,
    _hint: "After processing this message and sending a response with send_chat_response, call wait_for_chat again to listen for the next message.",
  };
}

async function handleSendChatResponse(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const messageId = params["messageId"] as string;
  const message = params["message"] as string;
  const isError = (params["isError"] as boolean | undefined) ?? false;

  context.relay.sendChatResponse({
    id: messageId,
    message,
    timestamp: Date.now(),
    isError,
  });

  return {
    status: "sent",
    messageId,
    _hint: "Response delivered. Call wait_for_chat now to listen for the next message from the plugin.",
  };
}

async function handleSendChatChunk(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const messageId = params["messageId"] as string;
  const delta = params["delta"] as string;
  const done = (params["done"] as boolean | undefined) ?? false;

  context.relay.sendChatChunk({
    id: messageId,
    delta,
    done,
    timestamp: Date.now(),
  });

  if (done) {
    return {
      status: "sent",
      messageId,
      _hint: "Final chunk delivered. Call wait_for_chat now to listen for the next message from the plugin.",
    };
  }

  return { status: "chunk_sent", messageId };
}

const LOCAL_HANDLERS: Record<string, ToolHandler> = {
  get_status: handleGetStatus,
  wait_for_chat: handleWaitForChat,
  send_chat_response: handleSendChatResponse,
  send_chat_chunk: handleSendChatChunk,
};

// ─── Main Router ────────────────────────────────────────────────────────────

/**
 * Route a tool call to the appropriate handler.
 *
 * 1. Validate the tool name exists
 * 2. Validate input against Zod schema
 * 3. Route to plugin (command queue), REST API, or local handler
 * 4. Return the result
 */
export async function routeToolCall(
  toolName: ToolName | "get_status",
  args: Record<string, unknown>,
  relay: RelayServer,
  config: Config,
  logger: Logger,
): Promise<Record<string, unknown>> {
  const route = TOOL_ROUTES[toolName];
  if (!route) {
    throw validationError(`Unknown tool: ${toolName}`, {
      suggestion: "Use get_status to check available tools, or check the tool name for typos.",
    });
  }

  // Validate input against Zod schema (skip for tools with no schema like get_status)
  let validatedParams: Record<string, unknown> = args;
  if (toolName !== "get_status") {
    const schema = schemaRegistry[toolName as ToolName];
    if (schema) {
      try {
        validatedParams = schema.parse(args) as Record<string, unknown>;
      } catch (err) {
        if (err instanceof ZodError) {
          const issues = err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw validationError(`Invalid parameters for ${toolName}: ${issues}`, {
            category: ErrorCategory.SCHEMA_VIOLATION,
            suggestion: `Check the parameter types and required fields for ${toolName}.`,
          });
        }
        throw err;
      }
    }
  }

  // Build tool context
  const context: ToolContext = {
    relay,
    config,
    logger: logger.child({ tool: toolName }),
    enqueueCommand: (type: CommandType, payload: Record<string, unknown>) =>
      enqueuePluginCommand(type, payload, relay, config),
  };

  // Signal activity to the plugin (shows forging animation)
  // Skip for wait_for_chat and send_chat_chunk — no animation while long-polling or streaming
  if (toolName !== "wait_for_chat" && toolName !== "send_chat_chunk") {
    relay.signalActivity(true);
  }

  try {
    // Route based on category
    switch (route.category) {
      case "plugin": {
        // REST-first fallback: try REST API, fall back to plugin on failure
        if (route.restFallback && REST_HANDLERS[toolName]) {
          try {
            const result = await REST_HANDLERS[toolName](validatedParams, context);
            context.logger.debug(`${toolName} served via REST API`);
            return result;
          } catch (restErr) {
            context.logger.warn(
              `${toolName} REST fallback failed, routing to plugin: ${(restErr as Error).message}`,
            );
            // Fall through to plugin
          }
        }
        return await handlePluginTool(toolName, validatedParams, route, context);
      }

      case "rest": {
        const handler = REST_HANDLERS[toolName];
        if (!handler) {
          throw new RexError({
            category: ErrorCategory.INTERNAL_ERROR,
            message: `No REST handler registered for tool: ${toolName}`,
            retryable: false,
          });
        }
        return await handler(validatedParams, context);
      }

      case "local": {
        const handler = LOCAL_HANDLERS[toolName];
        if (!handler) {
          throw new RexError({
            category: ErrorCategory.INTERNAL_ERROR,
            message: `No local handler registered for tool: ${toolName}`,
            retryable: false,
          });
        }
        return await handler(validatedParams, context);
      }

      default:
        throw new RexError({
          category: ErrorCategory.INTERNAL_ERROR,
          message: `Unknown tool category for: ${toolName}`,
          retryable: false,
        });
    }
  } finally {
    // Signal activity complete
    if (toolName !== "wait_for_chat" && toolName !== "send_chat_chunk") {
      relay.signalActivity(false);
    }
  }
}

// ─── Plugin Tool Handling ───────────────────────────────────────────────────

/**
 * Handle a plugin-routed tool call:
 * 1. Build a Command envelope
 * 2. Enqueue it in the command queue
 * 3. Wait for the result from the plugin
 * 4. Extract and return the result data
 */
async function handlePluginTool(
  toolName: string,
  params: Record<string, unknown>,
  route: ToolRoute,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  if (!route.commandType) {
    throw new RexError({
      category: ErrorCategory.INTERNAL_ERROR,
      message: `No command type mapped for plugin tool: ${toolName}`,
      retryable: false,
    });
  }

  // Special handling for batch_execute: execute each operation as a sub-command
  if (toolName === "batch_execute") {
    return handleBatchExecute(params, context);
  }

  const result = await context.enqueueCommand(route.commandType, params);

  // Check for error in the command result
  if (result.status === "error") {
    throw new RexError({
      category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
      message: result.error?.message ?? "Plugin command failed",
      retryable: result.error?.retryable ?? false,
      commandId: result.id,
      nodeId: result.error?.nodeId,
      figmaError: result.error?.figmaError,
      suggestion: result.error?.suggestion,
    });
  }

  return result.result ?? {};
}

/**
 * Handle batch_execute: run multiple operations, optionally atomic.
 */
async function handleBatchExecute(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const operations = params["operations"] as Array<{ tool: string; params: Record<string, unknown> }>;
  const atomic = (params["atomic"] as boolean | undefined) ?? true;
  const batchId = uuidv4();

  const results: Array<Record<string, unknown>> = [];
  const errors: Array<{ index: number; error: Record<string, unknown> }> = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]!;
    const route = TOOL_ROUTES[op.tool];

    if (!route || !route.commandType) {
      const err = { index: i, error: { message: `Unknown tool in batch: ${op.tool}` } };
      if (atomic) {
        return {
          status: "error",
          message: `Batch failed at operation ${i}: unknown tool "${op.tool}"`,
          completedResults: results,
          errors: [err],
        };
      }
      errors.push(err);
      results.push({ error: err.error });
      continue;
    }

    try {
      const command = buildCommand(route.commandType, op.params, context.config, batchId, i, operations.length);
      const result = await context.relay.sendCommand(command);

      if (result.status === "error") {
        const err = { index: i, error: result.error ?? { message: "Unknown error" } };
        if (atomic) {
          return {
            status: "error",
            message: `Batch failed at operation ${i}`,
            completedResults: results,
            errors: [err],
          };
        }
        errors.push(err);
        results.push({ error: result.error });
      } else {
        results.push(result.result ?? {});
      }
    } catch (caught) {
      const hErr = toRexError(caught);
      const err = { index: i, error: hErr.toResponse().error as Record<string, unknown> };
      if (atomic) {
        return {
          status: "error",
          message: `Batch failed at operation ${i}: ${hErr.message}`,
          completedResults: results,
          errors: [err],
        };
      }
      errors.push(err);
      results.push({ error: err.error });
    }
  }

  return {
    status: errors.length > 0 ? "partial" : "success",
    results,
    ...(errors.length > 0 && { errors }),
  };
}

// ─── Command Building ───────────────────────────────────────────────────────

/**
 * Build a Command envelope and enqueue it via the relay server.
 */
function enqueuePluginCommand(
  type: CommandType,
  payload: Record<string, unknown>,
  relay: RelayServer,
  config: Config,
): Promise<CommandResult> {
  const command = buildCommand(type, payload, config);
  return relay.sendCommand(command);
}

/**
 * Build a Command envelope with a unique ID and TTL.
 */
function buildCommand(
  type: CommandType,
  payload: Record<string, unknown>,
  config: Config,
  batchId?: string,
  batchSeq?: number,
  batchTotal?: number,
): Command {
  // Screenshots of large frames can take a long time to render — use 2x TTL
  const ttl = type === CommandType.SCREENSHOT
    ? config.commands.defaultTtl * 2
    : config.commands.defaultTtl;

  const command: Command = {
    id: uuidv4(),
    type,
    payload,
    timestamp: Date.now(),
    ttl,
  };

  if (batchId !== undefined) {
    command.batchId = batchId;
    command.batchSeq = batchSeq;
    command.batchTotal = batchTotal;
    command.atomic = true;
  }

  return command;
}
