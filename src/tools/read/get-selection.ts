/**
 * get_selection handler [plugin] — gets the currently selected nodes in Figma.
 *
 * Requires the plugin to be connected. Sends a GET_SELECTION command
 * to the plugin via the command queue and awaits the result.
 */

import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { getSelectionSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, internalError } from "../../shared/errors.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GetSelectionParams = z.infer<typeof getSelectionSchema>;

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Get the currently selected nodes in Figma via plugin command.
 */
export async function getSelection(
  params: GetSelectionParams,
  context: HandlerContext,
): Promise<Record<string, unknown>> {
  const { includeChildren = false, depth = 1 } = params;
  const { commandQueue, config } = context;

  const command: Command = {
    id: randomUUID(),
    type: CommandType.GET_SELECTION,
    payload: {
      includeChildren,
      depth,
    },
    timestamp: Date.now(),
    ttl: config.commands.defaultTtl,
  };

  try {
    const result: CommandResult = await commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "Plugin returned an error for get_selection",
        retryable: result.error?.retryable ?? false,
        commandId: command.id,
        suggestion: result.error?.suggestion,
        figmaError: result.error?.figmaError,
      });
    }

    return result.result ?? { nodes: [] };
  } catch (err) {
    if (err instanceof RexError) throw err;
    throw internalError(
      `Failed to get selection: ${err instanceof Error ? err.message : String(err)}`,
      { commandId: command.id, cause: err },
    );
  }
}
