import { v4 as uuid } from "uuid";
import { z } from "zod";
import { CommandType } from "../../shared/types.js";
import type { Command, CommandResult } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import { setLayoutChildSchema, batchSetLayoutChildrenSchema } from "../schemas.js";
import type { ToolContext } from "../types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SetLayoutChildInput = z.infer<typeof setLayoutChildSchema>;
export type BatchSetLayoutChildrenInput = z.infer<typeof batchSetLayoutChildrenSchema>;

// ─── setLayoutChild Handler ──────────────────────────────────────────────────

/**
 * Configure how a child node behaves within its auto-layout parent.
 * Controls alignment, grow behavior, and positioning mode.
 */
export async function setLayoutChild(
  params: SetLayoutChildInput,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: CommandType.SET_LAYOUT_CHILD,
    payload: {
      nodeId: params.nodeId,
      ...(params.alignSelf !== undefined && { alignSelf: params.alignSelf }),
      ...(params.grow !== undefined && { grow: params.grow }),
      ...(params.positioning !== undefined && { positioning: params.positioning }),
      ...(params.position !== undefined && { position: params.position }),
      ...(params.horizontalConstraint !== undefined && {
        horizontalConstraint: params.horizontalConstraint,
      }),
      ...(params.verticalConstraint !== undefined && {
        verticalConstraint: params.verticalConstraint,
      }),
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

// ─── batchSetLayoutChildren Handler ──────────────────────────────────────────

/**
 * Configure multiple children's layout behavior in a single call.
 * All children must belong to the specified auto-layout parent.
 */
export async function batchSetLayoutChildren(
  params: BatchSetLayoutChildrenInput,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: CommandType.BATCH_SET_LAYOUT_CHILDREN,
    payload: {
      parentId: params.parentId,
      children: params.children,
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
        nodeId: result.error!.nodeId ?? params.parentId,
        figmaError: result.error!.figmaError,
        suggestion: result.error!.suggestion,
      });
    }

    return {
      success: true,
      parentId: params.parentId,
      childCount: params.children.length,
      ...result.result,
    };
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}
