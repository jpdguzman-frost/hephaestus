import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import {
  createVariableCollectionSchema,
  deleteVariableCollectionSchema,
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
      throw new HephaestusError({
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
    throw toHephaestusError(err, commandId);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * create_variable_collection — Create a new variable collection with optional modes.
 */
export async function createVariableCollection(
  params: z.infer<typeof createVariableCollectionSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.CREATE_VARIABLE_COLLECTION,
    {
      name: params.name,
      ...(params.initialModeName !== undefined && { initialModeName: params.initialModeName }),
      ...(params.additionalModes !== undefined && { additionalModes: params.additionalModes }),
    },
    ctx,
  );
}

/**
 * delete_variable_collection — Delete a collection and all its variables.
 */
export async function deleteVariableCollection(
  params: z.infer<typeof deleteVariableCollectionSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.DELETE_VARIABLE_COLLECTION,
    {
      collectionId: params.collectionId,
    },
    ctx,
  );
}
