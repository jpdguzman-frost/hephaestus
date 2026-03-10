/**
 * search_nodes handler [plugin] — searches for nodes by name, type, or properties.
 *
 * Requires the plugin to be connected. Sends a SEARCH_NODES command
 * to the plugin via the command queue and awaits the result.
 *
 * The plugin performs the search within the Figma document using the
 * figma.currentPage.findAll() API, which has access to the full node tree.
 */

import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { searchNodesSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, internalError } from "../../shared/errors.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SearchNodesParams = z.infer<typeof searchNodesSchema>;

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Search for nodes by name, type, or properties via plugin command.
 *
 * Returns an array of matching node summaries (id, name, type, parent).
 */
export async function searchNodes(
  params: SearchNodesParams,
  context: HandlerContext,
): Promise<Record<string, unknown>> {
  const {
    query,
    type,
    withinId,
    hasAutoLayout,
    hasChildren,
    limit = 20,
  } = params;
  const { commandQueue, config } = context;

  const command: Command = {
    id: randomUUID(),
    type: CommandType.SEARCH_NODES,
    payload: {
      query,
      type,
      withinId,
      hasAutoLayout,
      hasChildren,
      limit,
    },
    timestamp: Date.now(),
    ttl: config.commands.defaultTtl,
  };

  try {
    const result: CommandResult = await commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "Plugin returned an error for search_nodes",
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
      `Failed to search nodes: ${err instanceof Error ? err.message : String(err)}`,
      { commandId: command.id, cause: err },
    );
  }
}
