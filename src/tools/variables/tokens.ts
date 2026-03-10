import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import { setupDesignTokensSchema } from "../schemas.js";
import type { ToolContext } from "../components/instantiate.js";

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * setup_design_tokens — Create a complete token system in one atomic operation:
 * collection + modes + variables. The plugin executes this as a single transaction,
 * rolling back all created entities if any step fails.
 */
export async function setupDesignTokens(
  params: z.infer<typeof setupDesignTokensSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: CommandType.SETUP_DESIGN_TOKENS,
    payload: {
      collectionName: params.collectionName,
      modes: params.modes,
      tokens: params.tokens,
    },
    timestamp: Date.now(),
    ttl: ctx.config.defaultTtl,
    atomic: true,
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
