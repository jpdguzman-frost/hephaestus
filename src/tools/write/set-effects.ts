/**
 * set_effects handler — Sets effects (shadows, blur) on a node.
 *
 * Sends a SET_EFFECTS command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import type { z } from "zod";
import type { setEffectsSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type SetEffectsInput = z.infer<typeof setEffectsSchema>;

/**
 * Handler for the set_effects tool.
 *
 * Replaces all effects on the target node with the provided effect list.
 */
export async function setEffects(
  params: SetEffectsInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const command: Command = {
    id: commandId,
    type: CommandType.SET_EFFECTS,
    payload: {
      nodeId: params.nodeId,
      effects: params.effects,
    },
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `set_effects_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "SET_EFFECTS command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        nodeId: result.error?.nodeId ?? params.nodeId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? {};
  } catch (err) {
    throw toRexError(err, commandId);
  }
}
