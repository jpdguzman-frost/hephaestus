// ─── Command Executor Registry ──────────────────────────────────────────────
// Maps command types to executor functions and handles the full execution flow:
// TTL check -> idempotency check -> lookup -> pre-process -> execute -> serialize -> cache

import { IdempotencyCache } from "./idempotency";
import { serializeNode } from "./serializer";

// Import all executors
import {
  executeCreateNode,
  executeUpdateNode,
  executeDeleteNodes,
  executeCloneNode,
  executeReparentNode,
  executeReorderChildren,
} from "./executors/nodes";
import { executeSetText } from "./executors/text";
import {
  executeSetFills,
  executeSetStrokes,
  executeSetEffects,
  executeSetCornerRadius,
} from "./executors/visual";
import {
  executeSetAutoLayout,
  executeSetLayoutChild,
  executeBatchSetLayoutChildren,
  executeSetLayoutGrid,
  executeSetConstraints,
} from "./executors/layout";
import {
  executeInstantiateComponent,
  executeSetInstanceProperties,
  executeCreateComponent,
  executeCreateComponentSet,
  executeAddComponentProperty,
  executeEditComponentProperty,
  executeDeleteComponentProperty,
  executeSetDescription,
} from "./executors/components";
import {
  executeCreateVariableCollection,
  executeDeleteVariableCollection,
  executeCreateVariables,
  executeUpdateVariables,
  executeDeleteVariable,
  executeRenameVariable,
  executeAddMode,
  executeRenameMode,
  executeSetupDesignTokens,
} from "./executors/variables";
import {
  executeCreatePage,
  executeRenamePage,
  executeDeletePage,
  executeSetCurrentPage,
} from "./executors/pages";
import { executeExecute, executePing } from "./executors/utility";

// ─── Types (duplicated for sandbox isolation) ───────────────────────────────

interface Command {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  ttl: number;
  idempotencyKey?: string;
  atomic?: boolean;
  batchId?: string;
  batchSeq?: number;
  batchTotal?: number;
}

interface CommandResult {
  id: string;
  status: "success" | "error";
  result?: Record<string, unknown>;
  error?: {
    category: string;
    message: string;
    figmaError?: string;
    nodeId?: string;
    retryable: boolean;
    suggestion?: string;
  };
  duration: number;
  timestamp: number;
  batchId?: string;
  batchSeq?: number;
}

type ExecutorFn = (payload: Record<string, unknown>) => Promise<unknown>;

// ─── Read Command Executors ─────────────────────────────────────────────────

async function executeGetNode(payload: Record<string, unknown>): Promise<unknown> {
  const nodeIds = payload.nodeIds as string[];
  const depth = (payload.depth as number) ?? 1;
  const results: unknown[] = [];

  for (const id of nodeIds) {
    const node = figma.getNodeById(id) as SceneNode;
    if (node) {
      results.push(serializeNode(node, depth));
    } else {
      results.push({ nodeId: id, error: "not found" });
    }
  }

  return { nodes: results };
}

async function executeGetSelection(payload: Record<string, unknown>): Promise<unknown> {
  const selection = figma.currentPage.selection;
  const includeChildren = (payload.includeChildren as boolean) ?? false;
  const depth = includeChildren ? ((payload.depth as number) ?? 1) : 0;

  return {
    nodes: selection.map(node => serializeNode(node, depth)),
    count: selection.length,
  };
}

async function executeSearchNodes(payload: Record<string, unknown>): Promise<unknown> {
  const query = payload.query as string | undefined;
  const type = payload.type as string | undefined;
  const withinId = payload.withinId as string | undefined;
  const limit = (payload.limit as number) ?? 20;

  const searchRoot = withinId
    ? (figma.getNodeById(withinId) as BaseNode & ChildrenMixin)
    : figma.currentPage;

  if (!searchRoot || !("children" in searchRoot)) {
    throw new Error("Search root not found or cannot have children");
  }

  const results: unknown[] = [];

  function search(node: BaseNode): void {
    if (results.length >= limit) return;

    // Type filter
    if (type && node.type !== type) {
      // Continue searching children
    } else if (query) {
      // Name match (case-insensitive substring)
      if (node.name.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          nodeId: node.id,
          name: node.name,
          type: node.type,
          parentId: node.parent ? node.parent.id : undefined,
        });
      }
    } else if (type && node.type === type) {
      results.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        parentId: node.parent ? node.parent.id : undefined,
      });
    }

    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        if (results.length >= limit) break;
        search(child);
      }
    }
  }

  for (const child of searchRoot.children) {
    if (results.length >= limit) break;
    search(child);
  }

  return { nodes: results, count: results.length };
}

async function executeScreenshot(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string | undefined;
  const format = (payload.format as string) ?? "png";
  const scale = (payload.scale as number) ?? 2;

  let target: SceneNode;
  if (nodeId) {
    const node = figma.getNodeById(nodeId) as SceneNode;
    if (!node) throw new Error(`Node ${nodeId} not found`);
    target = node;
  } else {
    // Capture current page — use the first top-level frame or the page selection
    const selection = figma.currentPage.selection;
    if (selection.length > 0) {
      target = selection[0];
    } else if (figma.currentPage.children.length > 0) {
      target = figma.currentPage.children[0] as SceneNode;
    } else {
      throw new Error("No node to capture — page is empty");
    }
  }

  var settings: ExportSettings;
  if (format === "svg") {
    settings = { format: "SVG" };
  } else if (format === "jpg") {
    settings = { format: "JPG", constraint: { type: "SCALE", value: scale } };
  } else {
    settings = { format: "PNG", constraint: { type: "SCALE", value: scale } };
  }

  var bytes = await (target as SceneNode).exportAsync(settings);

  // Manual base64 encoding — btoa is not available in Figma's plugin sandbox
  var base64 = uint8ArrayToBase64(bytes);

  return {
    data: base64,
    format: format,
    width: target.width * scale,
    height: target.height * scale,
    nodeId: target.id,
  };
}

// ─── Base64 Encoding (no btoa in Figma sandbox) ─────────────────────────────

var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  var result = "";
  var len = bytes.length;
  var i = 0;
  while (i < len) {
    var a = bytes[i++] || 0;
    var b = i < len ? bytes[i++] : 0;
    var c = i < len ? bytes[i++] : 0;
    var triplet = (a << 16) | (b << 8) | c;
    result += B64_CHARS[(triplet >> 18) & 0x3f];
    result += B64_CHARS[(triplet >> 12) & 0x3f];
    result += (i - 2 < len) ? B64_CHARS[(triplet >> 6) & 0x3f] : "=";
    result += (i - 1 < len) ? B64_CHARS[triplet & 0x3f] : "=";
  }
  return result;
}

// ─── Style/Variable/Component Read Executors ────────────────────────────────

async function executeGetStyles(payload: Record<string, unknown>): Promise<unknown> {
  var types = payload.types as string[] | undefined;
  var styles: unknown[] = [];

  var textStyles = figma.getLocalTextStyles();
  var paintStyles = figma.getLocalPaintStyles();
  var effectStyles = figma.getLocalEffectStyles();
  var gridStyles = figma.getLocalGridStyles();

  if (!types || types.indexOf("text") !== -1) {
    for (var i = 0; i < textStyles.length; i++) {
      var ts = textStyles[i];
      styles.push({
        key: ts.key,
        name: ts.name,
        type: "TEXT",
        description: ts.description,
        fontSize: ts.fontSize,
        fontName: ts.fontName,
      });
    }
  }

  if (!types || types.indexOf("fill") !== -1) {
    for (var j = 0; j < paintStyles.length; j++) {
      var ps = paintStyles[j];
      styles.push({
        key: ps.key,
        name: ps.name,
        type: "FILL",
        description: ps.description,
        paintCount: ps.paints.length,
      });
    }
  }

  if (!types || types.indexOf("effect") !== -1) {
    for (var k = 0; k < effectStyles.length; k++) {
      var es = effectStyles[k];
      styles.push({
        key: es.key,
        name: es.name,
        type: "EFFECT",
        description: es.description,
        effectCount: es.effects.length,
      });
    }
  }

  if (!types || types.indexOf("grid") !== -1) {
    for (var g = 0; g < gridStyles.length; g++) {
      var gs = gridStyles[g];
      styles.push({
        key: gs.key,
        name: gs.name,
        type: "GRID",
        description: gs.description,
      });
    }
  }

  return { styles: styles, count: styles.length };
}

async function executeGetVariables(payload: Record<string, unknown>): Promise<unknown> {
  var collections = figma.variables.getLocalVariableCollections();
  var collectionFilter = payload.collection as string | undefined;
  var namePattern = payload.namePattern as string | undefined;
  var resolvedType = payload.resolvedType as string | undefined;

  var result: unknown[] = [];

  for (var i = 0; i < collections.length; i++) {
    var col = collections[i];

    // Filter by collection name
    if (collectionFilter && col.name.toLowerCase().indexOf(collectionFilter.toLowerCase()) === -1) {
      continue;
    }

    var variables: unknown[] = [];
    for (var j = 0; j < col.variableIds.length; j++) {
      var v = figma.variables.getVariableById(col.variableIds[j]);
      if (!v) continue;

      // Filter by name pattern
      if (namePattern) {
        var regex = new RegExp(namePattern, "i");
        if (!regex.test(v.name)) continue;
      }

      // Filter by resolved type
      if (resolvedType && v.resolvedType !== resolvedType) continue;

      var valuesByMode: Record<string, unknown> = {};
      for (var m = 0; m < col.modes.length; m++) {
        var mode = col.modes[m];
        valuesByMode[mode.name] = v.valuesByMode[mode.modeId];
      }

      variables.push({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        description: v.description,
        valuesByMode: valuesByMode,
      });
    }

    result.push({
      id: col.id,
      name: col.name,
      modes: col.modes.map(function(m) { return { modeId: m.modeId, name: m.name }; }),
      variables: variables,
    });
  }

  return { collections: result };
}

async function executeGetComponents(payload: Record<string, unknown>): Promise<unknown> {
  var query = payload.query as string | undefined;
  var limit = (payload.limit as number) || 25;

  var components: unknown[] = [];

  function searchForComponents(node: BaseNode): void {
    if (components.length >= limit) return;

    if (node.type === "COMPONENT") {
      var comp = node as ComponentNode;
      if (!query || comp.name.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
        components.push({
          nodeId: comp.id,
          key: comp.key,
          name: comp.name,
          description: comp.description,
          parent: comp.parent ? comp.parent.name : null,
        });
      }
    }

    if (node.type === "COMPONENT_SET") {
      var set = node as ComponentSetNode;
      if (!query || set.name.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
        components.push({
          nodeId: set.id,
          key: set.key,
          name: set.name,
          description: set.description,
          type: "COMPONENT_SET",
          variantCount: set.children.length,
        });
      }
    }

    if ("children" in node) {
      var children = (node as ChildrenMixin).children;
      for (var i = 0; i < children.length; i++) {
        if (components.length >= limit) break;
        searchForComponents(children[i]);
      }
    }
  }

  // Search all pages
  for (var p = 0; p < figma.root.children.length; p++) {
    if (components.length >= limit) break;
    searchForComponents(figma.root.children[p]);
  }

  return { components: components, count: components.length };
}

// ─── Executor Registry ──────────────────────────────────────────────────────

const EXECUTOR_MAP: Record<string, ExecutorFn> = {
  // Node commands
  CREATE_NODE: executeCreateNode,
  UPDATE_NODE: executeUpdateNode,
  DELETE_NODES: executeDeleteNodes,
  CLONE_NODE: executeCloneNode,
  REPARENT_NODE: executeReparentNode,
  REORDER_CHILDREN: executeReorderChildren,

  // Text commands
  SET_TEXT: executeSetText,

  // Visual commands
  SET_FILLS: executeSetFills,
  SET_STROKES: executeSetStrokes,
  SET_EFFECTS: executeSetEffects,
  SET_CORNER_RADIUS: executeSetCornerRadius,

  // Layout commands
  SET_AUTO_LAYOUT: executeSetAutoLayout,
  SET_LAYOUT_CHILD: executeSetLayoutChild,
  BATCH_SET_LAYOUT_CHILDREN: executeBatchSetLayoutChildren,
  SET_LAYOUT_GRID: executeSetLayoutGrid,
  SET_CONSTRAINTS: executeSetConstraints,

  // Component commands
  INSTANTIATE_COMPONENT: executeInstantiateComponent,
  SET_INSTANCE_PROPERTIES: executeSetInstanceProperties,
  CREATE_COMPONENT: executeCreateComponent,
  CREATE_COMPONENT_SET: executeCreateComponentSet,
  ADD_COMPONENT_PROPERTY: executeAddComponentProperty,
  EDIT_COMPONENT_PROPERTY: executeEditComponentProperty,
  DELETE_COMPONENT_PROPERTY: executeDeleteComponentProperty,
  SET_DESCRIPTION: executeSetDescription,

  // Variable commands
  CREATE_VARIABLE_COLLECTION: executeCreateVariableCollection,
  DELETE_VARIABLE_COLLECTION: executeDeleteVariableCollection,
  CREATE_VARIABLES: executeCreateVariables,
  UPDATE_VARIABLES: executeUpdateVariables,
  DELETE_VARIABLE: executeDeleteVariable,
  RENAME_VARIABLE: executeRenameVariable,
  ADD_MODE: executeAddMode,
  RENAME_MODE: executeRenameMode,
  SETUP_DESIGN_TOKENS: executeSetupDesignTokens,

  // Page commands
  CREATE_PAGE: executeCreatePage,
  RENAME_PAGE: executeRenamePage,
  DELETE_PAGE: executeDeletePage,
  SET_CURRENT_PAGE: executeSetCurrentPage,

  // Read commands
  GET_NODE: executeGetNode,
  GET_SELECTION: executeGetSelection,
  SEARCH_NODES: executeSearchNodes,
  SCREENSHOT: executeScreenshot,
  GET_STYLES: executeGetStyles,
  GET_VARIABLES: executeGetVariables,
  GET_COMPONENTS: executeGetComponents,

  // Utility commands
  EXECUTE: executeExecute,
  PING: executePing,
};

// Read commands that can be interleaved with writes
const READ_COMMANDS = new Set(["GET_NODE", "GET_SELECTION", "SEARCH_NODES", "SCREENSHOT", "PING", "GET_STYLES", "GET_VARIABLES", "GET_COMPONENTS"]);

// ─── Executor Class ─────────────────────────────────────────────────────────

export class Executor {
  private cache = new IdempotencyCache();
  private queue: Command[] = [];
  private processing = false;

  /**
   * Get the list of supported command types.
   */
  getSupportedTypes(): string[] {
    return Object.keys(EXECUTOR_MAP);
  }

  /**
   * Execute a command and return a result envelope.
   * Commands are queued for sequential FIFO execution.
   */
  async executeCommand(command: Command): Promise<CommandResult> {
    var start = Date.now();

    // Signal forging start for all commands (reads and writes)
    figma.ui.postMessage({ type: "forging-start" });

    try {
      // 1. Check TTL
      if (Date.now() - command.timestamp > command.ttl) {
        return {
          id: command.id,
          status: "error",
          error: {
            category: "COMMAND_TIMEOUT",
            message: `Command expired (TTL: ${command.ttl}ms)`,
            retryable: false,
          },
          duration: Date.now() - start,
          timestamp: Date.now(),
          batchId: command.batchId,
          batchSeq: command.batchSeq,
        };
      }

      // 2. Check idempotency cache
      if (command.idempotencyKey && this.cache.has(command.idempotencyKey)) {
        const cached = this.cache.get(command.idempotencyKey);
        return {
          id: command.id,
          status: "success",
          result: cached as Record<string, unknown>,
          duration: Date.now() - start,
          timestamp: Date.now(),
          batchId: command.batchId,
          batchSeq: command.batchSeq,
        };
      }

      // 3. Lookup executor
      const executor = EXECUTOR_MAP[command.type];
      if (!executor) {
        return {
          id: command.id,
          status: "error",
          error: {
            category: "INVALID_OPERATION",
            message: `Unknown command type: ${command.type}`,
            retryable: false,
            suggestion: `Supported types: ${Object.keys(EXECUTOR_MAP).join(", ")}`,
          },
          duration: Date.now() - start,
          timestamp: Date.now(),
          batchId: command.batchId,
          batchSeq: command.batchSeq,
        };
      }

      // 4. Execute with timeout (use full TTL, no artificial cap)
      const timeout = command.ttl;
      const result = await Promise.race([
        executor(command.payload),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout);
        }),
      ]);

      // 5. Cache result if idempotency key present
      if (command.idempotencyKey) {
        this.cache.set(command.idempotencyKey, result);
      }

      return {
        id: command.id,
        status: "success",
        result: result as Record<string, unknown>,
        duration: Date.now() - start,
        timestamp: Date.now(),
        batchId: command.batchId,
        batchSeq: command.batchSeq,
      };

    } catch (error: unknown) {
      var err = error as Error;
      var category = categorizeError(err);

      return {
        id: command.id,
        status: "error",
        error: {
          category: category,
          message: err.message || String(err),
          figmaError: err.message,
          retryable: isRetryable(category),
          suggestion: getSuggestion(category, err),
        },
        duration: Date.now() - start,
        timestamp: Date.now(),
        batchId: command.batchId,
        batchSeq: command.batchSeq,
      };
    } finally {
      figma.ui.postMessage({ type: "forging-stop" });
    }
  }

  /**
   * Execute an array of commands sequentially (FIFO).
   * Read commands can be interleaved when marked as priority.
   */
  async executeCommands(commands: Command[]): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    for (const cmd of commands) {
      const result = await this.executeCommand(cmd);
      results.push(result);
    }
    return results;
  }
}

// ─── Error Classification ───────────────────────────────────────────────────

function categorizeError(error: Error): string {
  const msg = (error.message ? error.message.toLowerCase() : "") || "";

  if (msg.includes("not found") || msg.includes("does not exist")) {
    return "NODE_NOT_FOUND";
  }
  if (msg.includes("font")) {
    return "FONT_NOT_LOADED";
  }
  if (msg.includes("read-only") || msg.includes("readonly") || msg.includes("cannot set")) {
    return "READ_ONLY_PROPERTY";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "COMMAND_TIMEOUT";
  }
  if (msg.includes("invalid") || msg.includes("must provide") || msg.includes("unknown")) {
    return "INVALID_PARAMS";
  }

  return "INTERNAL_ERROR";
}

function isRetryable(category: string): boolean {
  return ["COMMAND_TIMEOUT", "FONT_NOT_LOADED", "CONNECTION_LOST"].includes(category);
}

function getSuggestion(category: string, error: Error): string | undefined {
  switch (category) {
    case "NODE_NOT_FOUND":
      return "Use get_selection or search_nodes to find the correct node ID";
    case "FONT_NOT_LOADED":
      return "Ensure the font is installed or use a system font like 'Inter'";
    case "COMMAND_TIMEOUT":
      return "Try a simpler operation or increase the timeout";
    default:
      return undefined;
  }
}
