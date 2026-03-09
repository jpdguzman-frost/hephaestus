/**
 * reparent_node handler — Moves a node to a different parent.
 *
 * Sends a REPARENT_NODE command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import type { z } from "zod";
import type { reparentNodeSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type ReparentNodeInput = z.infer<typeof reparentNodeSchema>;

/**
 * Handler for the reparent_node tool.
 *
 * Moves a node to a new parent, optionally at a specific insertion index.
 */
export async function reparentNode(
  params: ReparentNodeInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const payload: Record<string, unknown> = {
    nodeId: params.nodeId,
    parentId: params.parentId,
  };
  if (params.index !== undefined) payload.index = params.index;

  const command: Command = {
    id: commandId,
    type: CommandType.REPARENT_NODE,
    payload,
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `reparent_node_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "REPARENT_NODE command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        nodeId: result.error?.nodeId ?? params.nodeId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? {};
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}
