/**
 * set_corner_radius handler — Sets corner radius on a node.
 *
 * Sends a SET_CORNER_RADIUS command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import type { z } from "zod";
import type { setCornerRadiusSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type SetCornerRadiusInput = z.infer<typeof setCornerRadiusSchema>;

/**
 * Handler for the set_corner_radius tool.
 *
 * Sets a uniform or per-corner radius on the target node.
 */
export async function setCornerRadius(
  params: SetCornerRadiusInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const command: Command = {
    id: commandId,
    type: CommandType.SET_CORNER_RADIUS,
    payload: {
      nodeId: params.nodeId,
      radius: params.radius,
    },
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `set_corner_radius_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "SET_CORNER_RADIUS command failed",
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
