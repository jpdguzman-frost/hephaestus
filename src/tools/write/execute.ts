/**
 * execute and batch_execute handlers.
 *
 * execute: Runs arbitrary JavaScript in Figma's plugin context.
 * batch_execute: Runs multiple operations atomically with a shared batchId.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, toRexError, validationError } from "../../shared/errors.js";
import type { z } from "zod";
import type { executeSchema, batchExecuteSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type ExecuteInput = z.infer<typeof executeSchema>;
type BatchExecuteInput = z.infer<typeof batchExecuteSchema>;

/** Default execution timeout for execute commands. */
const DEFAULT_EXECUTE_TIMEOUT = 10_000;
/** Maximum execution timeout. */
const MAX_EXECUTE_TIMEOUT = 30_000;

/**
 * Handler for the execute tool.
 *
 * Runs arbitrary JavaScript code in Figma's plugin context.
 * Code has access to the `figma` global but no network access.
 */
export async function execute(
  params: ExecuteInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();
  const timeout = Math.min(
    params.timeout ?? DEFAULT_EXECUTE_TIMEOUT,
    MAX_EXECUTE_TIMEOUT,
  );

  const command: Command = {
    id: commandId,
    type: CommandType.EXECUTE,
    payload: {
      code: params.code,
      timeout,
    },
    timestamp: Date.now(),
    ttl: timeout + 5_000, // Give extra headroom beyond the code timeout
    idempotencyKey: `execute_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "EXECUTE command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? {};
  } catch (err) {
    throw toRexError(err, commandId);
  }
}

/**
 * Map a tool name to its CommandType.
 * Used by batchExecute to translate tool names to command types.
 */
const TOOL_TO_COMMAND_TYPE: Record<string, CommandType> = {
  create_node: CommandType.CREATE_NODE,
  update_node: CommandType.UPDATE_NODE,
  delete_nodes: CommandType.DELETE_NODES,
  clone_node: CommandType.CLONE_NODE,
  reparent_node: CommandType.REPARENT_NODE,
  reorder_children: CommandType.REORDER_CHILDREN,
  set_text: CommandType.SET_TEXT,
  set_fills: CommandType.SET_FILLS,
  set_strokes: CommandType.SET_STROKES,
  set_effects: CommandType.SET_EFFECTS,
  set_corner_radius: CommandType.SET_CORNER_RADIUS,
  set_auto_layout: CommandType.SET_AUTO_LAYOUT,
  set_layout_child: CommandType.SET_LAYOUT_CHILD,
  batch_set_layout_children: CommandType.BATCH_SET_LAYOUT_CHILDREN,
  set_layout_grid: CommandType.SET_LAYOUT_GRID,
  set_constraints: CommandType.SET_CONSTRAINTS,
  instantiate_component: CommandType.INSTANTIATE_COMPONENT,
  set_instance_properties: CommandType.SET_INSTANCE_PROPERTIES,
  create_component: CommandType.CREATE_COMPONENT,
  create_component_set: CommandType.CREATE_COMPONENT_SET,
  add_component_property: CommandType.ADD_COMPONENT_PROPERTY,
  edit_component_property: CommandType.EDIT_COMPONENT_PROPERTY,
  delete_component_property: CommandType.DELETE_COMPONENT_PROPERTY,
  set_description: CommandType.SET_DESCRIPTION,
  create_variable_collection: CommandType.CREATE_VARIABLE_COLLECTION,
  delete_variable_collection: CommandType.DELETE_VARIABLE_COLLECTION,
  create_variables: CommandType.CREATE_VARIABLES,
  update_variables: CommandType.UPDATE_VARIABLES,
  delete_variable: CommandType.DELETE_VARIABLE,
  rename_variable: CommandType.RENAME_VARIABLE,
  add_mode: CommandType.ADD_MODE,
  rename_mode: CommandType.RENAME_MODE,
  setup_design_tokens: CommandType.SETUP_DESIGN_TOKENS,
  create_page: CommandType.CREATE_PAGE,
  rename_page: CommandType.RENAME_PAGE,
  delete_page: CommandType.DELETE_PAGE,
  set_current_page: CommandType.SET_CURRENT_PAGE,
  execute: CommandType.EXECUTE,
};

/**
 * Handler for the batch_execute tool.
 *
 * Executes multiple operations atomically. Each operation is translated
 * to its corresponding command type and sent with a shared batchId.
 * If atomic is true (default) and any operation fails, all are rolled back.
 */
export async function batchExecute(
  params: BatchExecuteInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const batchId = randomUUID();
  const atomic = params.atomic !== false; // default true
  const batchTotal = params.operations.length;

  // Validate all tool names up front
  for (const op of params.operations) {
    if (!TOOL_TO_COMMAND_TYPE[op.tool]) {
      throw validationError(
        `Unknown tool name in batch_execute: "${op.tool}"`,
        { suggestion: `Valid tool names: ${Object.keys(TOOL_TO_COMMAND_TYPE).join(", ")}` },
      );
    }
  }

  const promises: Promise<CommandResult>[] = params.operations.map(
    (op, index) => {
      const commandId = randomUUID();
      const commandType = TOOL_TO_COMMAND_TYPE[op.tool]!;

      const command: Command = {
        id: commandId,
        type: commandType,
        payload: op.params as Record<string, unknown>,
        timestamp: Date.now(),
        ttl: context.config.commands.defaultTtl,
        idempotencyKey: `batch_exec_${batchId}_${index}`,
        atomic,
        batchId,
        batchSeq: index,
        batchTotal,
      };

      return context.commandQueue.enqueue(command);
    },
  );

  try {
    const results = await Promise.all(promises);

    // Check for failures
    const errors = results.filter((r) => r.status === "error");
    if (errors.length > 0) {
      const firstError = errors[0]!.error;
      throw new RexError({
        category: firstError?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: `Batch execute failed: ${errors.length}/${batchTotal} operations failed. First error: ${firstError?.message ?? "Unknown"}`,
        retryable: firstError?.retryable ?? false,
        figmaError: firstError?.figmaError,
        suggestion: atomic
          ? "All operations were rolled back. Fix the failing operation and retry the entire batch."
          : firstError?.suggestion,
      });
    }

    return {
      batchId,
      atomic,
      results: results.map((r) => r.result ?? {}),
    };
  } catch (err) {
    throw toRexError(err);
  }
}
