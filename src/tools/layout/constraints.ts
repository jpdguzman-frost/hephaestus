import { v4 as uuid } from "uuid";
import { z } from "zod";
import { CommandType } from "../../shared/types.js";
import type { Command, CommandResult } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import { setConstraintsSchema } from "../schemas.js";
import type { ToolContext } from "../types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SetConstraintsInput = z.infer<typeof setConstraintsSchema>;

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Set constraints on a node inside a non-auto-layout frame.
 * Controls how the node responds when its parent is resized.
 *
 * Constraint values map to Figma UI terms:
 *  - "min"     → Left / Top
 *  - "center"  → Center
 *  - "max"     → Right / Bottom
 *  - "stretch" → Left & Right / Top & Bottom
 *  - "scale"   → Scale
 */
export async function setConstraints(
  params: SetConstraintsInput,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: CommandType.SET_CONSTRAINTS,
    payload: {
      nodeId: params.nodeId,
      ...(params.horizontal !== undefined && { horizontal: params.horizontal }),
      ...(params.vertical !== undefined && { vertical: params.vertical }),
    },
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
        nodeId: result.error!.nodeId ?? params.nodeId,
        figmaError: result.error!.figmaError,
        suggestion: result.error!.suggestion,
      });
    }

    return {
      success: true,
      nodeId: params.nodeId,
      ...result.result,
    };
  } catch (err) {
    throw toRexError(err, commandId);
  }
}
