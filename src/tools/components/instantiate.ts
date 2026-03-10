import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import { instantiateComponentSchema } from "../schemas.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { CommandsConfig } from "../../shared/config.js";

// ─── Context ─────────────────────────────────────────────────────────────────

export interface ToolContext {
  commandQueue: CommandQueue;
  config: CommandsConfig;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * instantiate_component — Create an instance of a component from the document
 * or a library. Requires either componentKey (published) or nodeId (local).
 */
export async function instantiateComponent(
  params: z.infer<typeof instantiateComponentSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: CommandType.INSTANTIATE_COMPONENT,
    payload: {
      ...(params.componentKey !== undefined && { componentKey: params.componentKey }),
      ...(params.nodeId !== undefined && { nodeId: params.nodeId }),
      ...(params.parentId !== undefined && { parentId: params.parentId }),
      ...(params.position !== undefined && { position: params.position }),
      ...(params.variant !== undefined && { variant: params.variant }),
      ...(params.overrides !== undefined && { overrides: params.overrides }),
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
        nodeId: result.error!.nodeId,
        figmaError: result.error!.figmaError,
        suggestion: result.error!.suggestion,
      });
    }

    return result.result ?? { success: true };
  } catch (err) {
    throw toRexError(err, commandId);
  }
}
