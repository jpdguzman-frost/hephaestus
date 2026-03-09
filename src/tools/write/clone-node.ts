/**
 * clone_node handler — Duplicates a node.
 *
 * Sends a CLONE_NODE command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import type { z } from "zod";
import type { cloneNodeSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type CloneNodeInput = z.infer<typeof cloneNodeSchema>;

/**
 * Handler for the clone_node tool.
 *
 * Duplicates a node, optionally placing it under a new parent
 * at a specified position with a new name.
 */
export async function cloneNode(
  params: CloneNodeInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const payload: Record<string, unknown> = {
    nodeId: params.nodeId,
  };
  if (params.parentId !== undefined) payload.parentId = params.parentId;
  if (params.position !== undefined) payload.position = params.position;
  if (params.name !== undefined) payload.name = params.name;

  const command: Command = {
    id: commandId,
    type: CommandType.CLONE_NODE,
    payload,
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `clone_node_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "CLONE_NODE command failed",
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
