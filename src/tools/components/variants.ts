import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import {
  createComponentSchema,
  createComponentSetSchema,
} from "../schemas.js";
import type { ToolContext } from "./instantiate.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function executeCommand(
  commandType: CommandType,
  payload: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: commandType,
    payload,
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
        nodeId: result.error!.nodeId,
        figmaError: result.error!.figmaError,
        suggestion: result.error!.suggestion,
      });
    }

    return result.result ?? { success: true };
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * create_component — Convert an existing frame to a component.
 */
export async function createComponent(
  params: z.infer<typeof createComponentSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.CREATE_COMPONENT,
    {
      nodeId: params.nodeId,
      ...(params.description !== undefined && { description: params.description }),
    },
    ctx,
  );
}

/**
 * create_component_set — Combine multiple components into a component set (variant group).
 */
export async function createComponentSet(
  params: z.infer<typeof createComponentSetSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.CREATE_COMPONENT_SET,
    {
      componentIds: params.componentIds,
      ...(params.name !== undefined && { name: params.name }),
    },
    ctx,
  );
}
