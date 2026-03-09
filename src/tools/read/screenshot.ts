/**
 * screenshot handler [plugin] — captures a screenshot of a node or the current page.
 *
 * Requires the plugin to be connected. The plugin uses the Figma
 * `node.exportAsync()` API to render the node and returns the base64-encoded
 * image data along with dimensions.
 */

import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { screenshotSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { HephaestusError, internalError } from "../../shared/errors.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ScreenshotParams = z.infer<typeof screenshotSchema>;

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Capture a screenshot of a node or the current page via plugin command.
 *
 * Returns base64-encoded image data with format and dimensions.
 */
export async function screenshot(
  params: ScreenshotParams,
  context: HandlerContext,
): Promise<Record<string, unknown>> {
  const { nodeId, format = "png", scale = 2 } = params;
  const { commandQueue, config } = context;

  const command: Command = {
    id: randomUUID(),
    type: CommandType.SCREENSHOT,
    payload: {
      nodeId,
      format,
      scale,
    },
    timestamp: Date.now(),
    // Screenshots can take longer — extend TTL
    ttl: Math.max(config.commands.defaultTtl, 60_000),
  };

  try {
    const result: CommandResult = await commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "Plugin returned an error for screenshot",
        retryable: result.error?.retryable ?? false,
        commandId: command.id,
        nodeId,
        suggestion: result.error?.suggestion,
        figmaError: result.error?.figmaError,
      });
    }

    return result.result ?? {};
  } catch (err) {
    if (err instanceof HephaestusError) throw err;
    throw internalError(
      `Failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`,
      { commandId: command.id, cause: err },
    );
  }
}
