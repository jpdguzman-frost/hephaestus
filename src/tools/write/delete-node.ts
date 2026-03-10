/**
 * delete_nodes handler — Deletes one or more nodes.
 *
 * Sends a DELETE_NODES command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import type { z } from "zod";
import type { deleteNodesSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type DeleteNodesInput = z.infer<typeof deleteNodesSchema>;

/**
 * Handler for the delete_nodes tool.
 *
 * Deletes one or more nodes. Returns lists of deleted and not-found node IDs.
 */
export async function deleteNodes(
  params: DeleteNodesInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const command: Command = {
    id: commandId,
    type: CommandType.DELETE_NODES,
    payload: {
      nodeIds: params.nodeIds,
    },
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `delete_nodes_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "DELETE_NODES command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? { deleted: [], notFound: [] };
  } catch (err) {
    throw toRexError(err, commandId);
  }
}
