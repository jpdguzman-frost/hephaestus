/**
 * set_strokes handler — Sets strokes on a node.
 *
 * Sends a SET_STROKES command to the plugin via the relay command queue.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import type { z } from "zod";
import type { setStrokesSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type SetStrokesInput = z.infer<typeof setStrokesSchema>;

/**
 * Handler for the set_strokes tool.
 *
 * Replaces all strokes on the target node with the provided stroke paints
 * and optional stroke properties (weight, alignment, dash pattern, caps, joins).
 */
export async function setStrokes(
  params: SetStrokesInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const payload: Record<string, unknown> = {
    nodeId: params.nodeId,
    strokes: params.strokes,
  };

  if (params.strokeWeight !== undefined) payload.strokeWeight = params.strokeWeight;
  if (params.strokeAlign !== undefined) payload.strokeAlign = params.strokeAlign;
  if (params.dashPattern !== undefined) payload.dashPattern = params.dashPattern;
  if (params.strokeCap !== undefined) payload.strokeCap = params.strokeCap;
  if (params.strokeJoin !== undefined) payload.strokeJoin = params.strokeJoin;

  const command: Command = {
    id: commandId,
    type: CommandType.SET_STROKES,
    payload,
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `set_strokes_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "SET_STROKES command failed",
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
