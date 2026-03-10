/**
 * MCP Server initialization and tool registration.
 *
 * Sets up the @modelcontextprotocol/sdk Server with stdio transport,
 * registers all tools from API.md with Zod input schemas,
 * and embeds the relay server for plugin communication.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { Config } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { RelayServer } from "../relay/server.js";
import { routeToolCall } from "./tool-router.js";
import { schemaRegistry, type ToolName } from "../tools/schemas.js";

// ─── Tool Definitions ───────────────────────────────────────────────────────

/**
 * Complete tool definitions: name, description, and input schema.
 * Every tool from API.md is registered here.
 */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Descriptions for every tool, keyed by tool name.
 * These are shown to the AI client for tool selection.
 */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  // ── Read Tools ──────────────────────────────────────────────────────────
  get_node:
    "Get detailed data for one or more nodes by ID. Supports depth traversal and property filtering.",
  get_selection:
    "Get the currently selected nodes in Figma. Requires the plugin to be connected.",
  get_page:
    "Get page structure and metadata. Can return summary, standard, or full detail levels.",
  search_nodes:
    "Search for nodes by name, type, or properties. Supports scoping to a subtree.",
  screenshot:
    "Capture a screenshot of a node or the current page as PNG, JPG, or SVG. For large frames, use maxDimension (e.g. 1024) to auto-downscale and avoid timeout. Scale accepts 0.5-4.",
  get_styles:
    "Get all styles (fill, text, effect, grid) from the current file.",
  get_variables:
    "Get variables and collections from the current file. Supports filtering by collection, name pattern, and type.",
  get_components:
    "Get published components and component sets. Supports search and variant details.",

  // ── Write Tools: Nodes ──────────────────────────────────────────────────
  create_node:
    "Create a single node or a composite node tree with children, styles, auto-layout, and effects. Atomic: creates the full tree or nothing. NOTE: layoutSizingHorizontal/Vertical='FILL' can only be set AFTER the node is a child of an auto-layout frame — use update_node after reparenting if needed.",
  update_node:
    "Update one or more properties on an existing node. Batch-friendly: set any combination of properties in a single call.",
  batch_update_nodes:
    "Update multiple nodes in a single atomic operation. If any update fails, all are rolled back.",
  delete_nodes:
    "Delete one or more nodes by ID.",
  clone_node:
    "Duplicate a node, optionally to a different parent with a new position and name.",
  reparent_node:
    "Move a node to a different parent, optionally at a specific child index.",
  reorder_children:
    "Reorder children within a parent for z-index control. First ID = bottommost.",

  // ── Write Tools: Text ───────────────────────────────────────────────────
  set_text:
    "Set text content and optionally style it. Handles font loading automatically. Supports mixed styling via style ranges.",

  // ── Write Tools: Visual Properties ──────────────────────────────────────
  set_fills:
    "Set fill paints on a node. Supports solid, linear gradient, radial gradient, and image fills.",
  set_strokes:
    "Set strokes on a node with weight, alignment, dash pattern, cap, and join options.",
  set_effects:
    "Set effects (drop shadow, inner shadow, layer blur, background blur) on a node.",
  set_corner_radius:
    "Set corner radius on a node. Supports uniform or per-corner values.",

  // ── Write Tools: Layout ─────────────────────────────────────────────────
  set_auto_layout:
    "Configure auto-layout on a frame: direction, spacing, padding, alignment, sizing. Can also remove auto-layout. NOTE: counterAxisSizingMode only accepts FIXED or AUTO (not FILL). To get fill behavior, use layoutSizingHorizontal/Vertical='FILL' on the child via update_node.",
  set_layout_child:
    "Configure how a child behaves within its auto-layout parent: alignment, grow, positioning. NOTE: To make a child fill its parent's width/height, set layoutSizingHorizontal/Vertical='FILL' via update_node instead of counterAxisSizingMode='FILL'.",
  batch_set_layout_children:
    "Configure multiple children's layout behavior in one call within an auto-layout parent.",
  set_layout_grid:
    "Set layout grids (columns, rows, or uniform grid) on a frame.",
  set_constraints:
    "Set constraints for a node inside a non-auto-layout frame.",

  // ── Write Tools: Components ─────────────────────────────────────────────
  instantiate_component:
    "Create an instance of a component from the document or a library. Supports variant selection and property overrides.",
  set_instance_properties:
    "Update properties on a component instance. Can also reset overrides to defaults.",
  create_component:
    "Convert an existing frame to a component with an optional description.",
  create_component_set:
    "Combine multiple components into a component set (variant group).",
  add_component_property:
    "Add a property (boolean, text, instance swap, or variant) to a component or component set.",
  edit_component_property:
    "Modify an existing component property's name or default value.",
  delete_component_property:
    "Remove a property from a component or component set.",
  set_description:
    "Set a description on a component, component set, or style.",

  // ── Write Tools: Variables & Tokens ─────────────────────────────────────
  create_variable_collection:
    "Create a new variable collection with optional initial mode name and additional modes.",
  delete_variable_collection:
    "Delete a collection and all its variables.",
  create_variables:
    "Create one or more variables in a collection with type, description, and values by mode.",
  update_variables:
    "Update variable values for specific modes. Supports batch updates up to 100.",
  delete_variable:
    "Delete a single variable by ID.",
  rename_variable:
    "Rename a variable. Supports '/' for grouping.",
  add_mode:
    "Add a mode to a variable collection.",
  rename_mode:
    "Rename an existing mode in a variable collection.",
  setup_design_tokens:
    "Create a complete token system in one atomic operation: collection + modes + variables with values.",

  // ── Write Tools: Page & Document ────────────────────────────────────────
  create_page:
    "Create a new page in the document at an optional position.",
  rename_page:
    "Rename a page.",
  delete_page:
    "Delete a page and all its contents.",
  set_current_page:
    "Switch the active page in Figma.",

  // ── Write Tools: Comments ───────────────────────────────────────────────
  post_comment:
    "Post a comment on the file, optionally pinned to a node or position. Supports replies.",
  delete_comment:
    "Delete a comment by ID.",

  // ── Utility Tools ───────────────────────────────────────────────────────
  execute:
    "Run arbitrary JavaScript in Figma's plugin context. Escape hatch for operations not covered by dedicated tools. 10s timeout, no network access.",
  get_status:
    "Get Rex connection status, transport info, plugin state, command queue stats, and uptime.",
  batch_execute:
    "Execute multiple independent operations in a single atomic call. More efficient than multiple individual tool calls.",

  // ── Chat Tools ──────────────────────────────────────────────────────────
  wait_for_chat:
    "Long-poll for a chat message from the Figma plugin. Returns when a message arrives or after timeout. IMPORTANT: You MUST call this tool again after every response you send — it is a continuous listening loop. After timeout, call it again immediately. After receiving a message and responding with send_chat_response, call it again immediately. Never stop the loop unless the user explicitly asks you to stop listening.",
  send_chat_response:
    "Send a response message back to the Figma plugin chat interface. After calling this, you MUST call wait_for_chat again immediately to continue listening for the next message.",
  send_chat_chunk:
    "Send a streaming text chunk to the Figma plugin chat. Call multiple times with done:false for each chunk, then once with done:true for the final chunk. This creates a real-time typing effect in the plugin.",
};

// ─── Schema Conversion ─────────────────────────────────────────────────────

/**
 * Convert a Zod schema to JSON Schema for MCP tool registration.
 */
function zodSchemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>;
}

/**
 * Build the full list of tool definitions for MCP registration.
 */
function buildToolDefinitions(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Register all tools from the schema registry
  for (const [name, schema] of Object.entries(schemaRegistry)) {
    const description = TOOL_DESCRIPTIONS[name];
    if (!description) {
      throw new Error(`Missing description for tool: ${name}`);
    }
    tools.push({
      name,
      description,
      inputSchema: zodSchemaToJsonSchema(schema),
    });
  }

  // get_status has no input parameters
  tools.push({
    name: "get_status",
    description: TOOL_DESCRIPTIONS["get_status"]!,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  });

  return tools;
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

export class RexMcpServer {
  private readonly server: Server;
  private readonly relay: RelayServer;
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly toolDefinitions: ToolDefinition[];

  constructor(config: Config, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: "mcp-server" });
    this.toolDefinitions = buildToolDefinitions();

    // Create MCP server
    this.server = new Server(
      {
        name: "rex",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // Create embedded relay server
    this.relay = new RelayServer(config, logger);

    // Register MCP request handlers
    this.registerHandlers();
  }

  /**
   * Start the MCP server on stdio transport and the embedded relay server.
   */
  async start(): Promise<void> {
    // Start the relay server first (HTTP + WS)
    await this.relay.start();
    this.logger.info("Relay server started", {
      host: this.config.relay.host,
      port: this.config.relay.port,
    });

    // Connect MCP server to stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info("MCP server listening on stdio");
  }

  /**
   * Gracefully shut down both servers.
   */
  async stop(): Promise<void> {
    this.logger.info("Shutting down Rex");

    try {
      await this.server.close();
    } catch (err) {
      this.logger.error("Error closing MCP server", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await this.relay.stop();
    } catch (err) {
      this.logger.error("Error closing relay server", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.logger.info("Rex shut down complete");
  }

  /**
   * Get the relay server instance (for direct access to command queue, etc.).
   */
  getRelay(): RelayServer {
    return this.relay;
  }

  // ─── Handler Registration ───────────────────────────────────────────────

  private registerHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolDefinitions.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      this.logger.debug("Tool call received", { tool: name });

      try {
        const result = await routeToolCall(
          name as ToolName | "get_status",
          args ?? {},
          this.relay,
          this.config,
          this.logger,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        // Format error per SPEC.md section 5.2
        const { toRexError } = await import("../shared/errors.js");
        const hErr = toRexError(err);
        const errorResponse = hErr.toResponse();

        this.logger.error("Tool call failed", {
          tool: name,
          category: hErr.category,
          message: hErr.message,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(errorResponse, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }
}
