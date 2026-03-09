import { v4 as uuid } from "uuid";
import { z } from "zod";
import { CommandType } from "../../shared/types.js";
import type { Command, CommandResult } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import { setLayoutGridSchema } from "../schemas.js";
import type { ToolContext } from "../types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SetLayoutGridInput = z.infer<typeof setLayoutGridSchema>;

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Set layout grids on a frame node.
 * Supports column grids, row grids, and uniform grids.
 * Replaces all existing grids on the frame.
 */
export async function setLayoutGrid(
  params: SetLayoutGridInput,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: CommandType.SET_LAYOUT_GRID,
    payload: {
      nodeId: params.nodeId,
      grids: params.grids,
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
      gridCount: params.grids.length,
      ...result.result,
    };
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}
