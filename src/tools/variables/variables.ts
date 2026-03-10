import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import {
  createVariablesSchema,
  updateVariablesSchema,
  deleteVariableSchema,
  renameVariableSchema,
  addModeSchema,
  renameModeSchema,
} from "../schemas.js";
import type { ToolContext } from "../components/instantiate.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function executeCommand(
  commandType: CommandType,
  payload: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: commandType,
    payload,
    timestamp: Date.now(),
    ttl: ctx.config.defaultTtl,
  };

  try {
    const result: CommandResult = await ctx.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error!.category,
        message: result.error!.message,
        retryable: result.error!.retryable,
        commandId,
        nodeId: result.error!.nodeId,
        figmaError: result.error!.figmaError,
        suggestion: result.error!.suggestion,
      });
    }

    return result.result ?? { success: true };
  } catch (err) {
    throw toRexError(err, commandId);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * create_variables — Create one or more variables in a collection (batch, 1-100).
 */
export async function createVariables(
  params: z.infer<typeof createVariablesSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.CREATE_VARIABLES,
    {
      collectionId: params.collectionId,
      variables: params.variables,
    },
    ctx,
  );
}

/**
 * update_variables — Update variable values (batch, 1-100).
 */
export async function updateVariables(
  params: z.infer<typeof updateVariablesSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.UPDATE_VARIABLES,
    {
      updates: params.updates,
    },
    ctx,
  );
}

/**
 * delete_variable — Delete a single variable.
 */
export async function deleteVariable(
  params: z.infer<typeof deleteVariableSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.DELETE_VARIABLE,
    {
      variableId: params.variableId,
    },
    ctx,
  );
}

/**
 * rename_variable — Rename a variable (supports `/` for grouping).
 */
export async function renameVariable(
  params: z.infer<typeof renameVariableSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.RENAME_VARIABLE,
    {
      variableId: params.variableId,
      newName: params.newName,
    },
    ctx,
  );
}

/**
 * add_mode — Add a mode to a variable collection.
 */
export async function addMode(
  params: z.infer<typeof addModeSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.ADD_MODE,
    {
      collectionId: params.collectionId,
      modeName: params.modeName,
    },
    ctx,
  );
}

/**
 * rename_mode — Rename an existing mode in a collection.
 */
export async function renameMode(
  params: z.infer<typeof renameModeSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.RENAME_MODE,
    {
      collectionId: params.collectionId,
      modeId: params.modeId,
      newName: params.newName,
    },
    ctx,
  );
}
