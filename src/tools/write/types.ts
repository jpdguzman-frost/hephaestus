/**
 * Shared context type for all write tool handlers.
 */

import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import type { FigmaClient } from "../../rest-api/client.js";

/** Context object passed to every write handler. */
export interface WriteHandlerContext {
  /** Command queue for sending commands to the Figma plugin. */
  commandQueue: CommandQueue;
  /** Loaded Rex config. */
  config: Config;
  /** REST API client for direct Figma API calls (comments, etc.). */
  restApiClient: FigmaClient;
  /** Current Figma file key (needed for REST API calls). */
  fileKey: string;
}
