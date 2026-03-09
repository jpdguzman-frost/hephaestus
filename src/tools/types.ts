import type { CommandQueue } from "../relay/command-queue.js";
import type { CommandsConfig } from "../shared/config.js";

/**
 * Context object passed to all tool handlers.
 * Provides access to the command queue for dispatching commands
 * and the commands configuration (TTL, retries, etc.).
 */
export interface ToolContext {
  /** Command queue for enqueuing commands to the Figma plugin. */
  commandQueue: CommandQueue;
  /** Commands configuration (TTL, max retries, rate limits). */
  config: CommandsConfig;
}
