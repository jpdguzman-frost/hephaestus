/**
 * set_fills handler — Sets fill paints on a node.
 *
 * Sends a SET_FILLS command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import type { z } from "zod";
import type { setFillsSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type SetFillsInput = z.infer<typeof setFillsSchema>;

/**
 * Handler for the set_fills tool.
 *
 * Replaces all fills on the target node with the provided fill paints.
 */
export async function setFills(
  params: SetFillsInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const command: Command = {
    id: commandId,
    type: CommandType.SET_FILLS,
    payload: {
      nodeId: params.nodeId,
      fills: params.fills,
    },
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `set_fills_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "SET_FILLS command failed",
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
