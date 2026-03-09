/**
 * reorder_children handler — Reorders children within a parent (z-index control).
 *
 * Sends a REORDER_CHILDREN command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import type { z } from "zod";
import type { reorderChildrenSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type ReorderChildrenInput = z.infer<typeof reorderChildrenSchema>;

/**
 * Handler for the reorder_children tool.
 *
 * Reorders children of a parent node. The childIds array specifies
 * the desired order (first = bottommost in z-index).
 */
export async function reorderChildren(
  params: ReorderChildrenInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const command: Command = {
    id: commandId,
    type: CommandType.REORDER_CHILDREN,
    payload: {
      parentId: params.parentId,
      childIds: params.childIds,
    },
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `reorder_children_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "REORDER_CHILDREN command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        nodeId: result.error?.nodeId ?? params.parentId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? {};
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}
