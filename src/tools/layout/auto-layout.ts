import { v4 as uuid } from "uuid";
import { z } from "zod";
import { CommandType } from "../../shared/types.js";
import type { Command, CommandResult } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import { setAutoLayoutSchema } from "../schemas.js";
import type { ToolContext } from "../types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SetAutoLayoutInput = z.infer<typeof setAutoLayoutSchema>;

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Configure auto-layout on a frame node.
 * Can set direction, spacing, padding, alignment, sizing, and other AL properties.
 * Pass `enabled: false` to remove auto-layout from the frame.
 */
export async function setAutoLayout(
  params: SetAutoLayoutInput,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: CommandType.SET_AUTO_LAYOUT,
    payload: {
      nodeId: params.nodeId,
      ...(params.enabled !== undefined && { enabled: params.enabled }),
      ...(params.direction !== undefined && { direction: params.direction }),
      ...(params.wrap !== undefined && { wrap: params.wrap }),
      ...(params.spacing !== undefined && { spacing: params.spacing }),
      ...(params.padding !== undefined && { padding: params.padding }),
      ...(params.primaryAxisAlign !== undefined && { primaryAxisAlign: params.primaryAxisAlign }),
      ...(params.counterAxisAlign !== undefined && { counterAxisAlign: params.counterAxisAlign }),
      ...(params.primaryAxisSizing !== undefined && { primaryAxisSizing: params.primaryAxisSizing }),
      ...(params.counterAxisSizing !== undefined && { counterAxisSizing: params.counterAxisSizing }),
      ...(params.strokesIncludedInLayout !== undefined && {
        strokesIncludedInLayout: params.strokesIncludedInLayout,
      }),
      ...(params.itemReverseZIndex !== undefined && { itemReverseZIndex: params.itemReverseZIndex }),
    },
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
    throw toHephaestusError(err, commandId);
  }
}
