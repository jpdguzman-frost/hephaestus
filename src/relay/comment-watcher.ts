/**
 * Comment Watcher — polls Figma REST API for @rex mentions in comments.
 *
 * When a comment containing "@rex" is found, it's injected into the chat
 * inbox so Claude picks it up via wait_for_chat. Each comment is only
 * processed once (tracked by comment ID).
 */

import { FigmaClient } from "../rest-api/client.js";
import { getComments, type FigmaComment } from "../rest-api/comments.js";
import type { Config } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";

const MENTION_PATTERN = /@rex\b/i;
const POLL_INTERVAL_MS = 10_000; // Check every 10 seconds

export class CommentWatcher {
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly onMention: (msg: {
    id: string;
    message: string;
    selection: unknown[];
    timestamp: number;
    commentId: string;
    user: string;
    nodeId?: string;
  }) => void;

  private client: FigmaClient | null = null;
  private fileKey: string | null = null;
  private processedIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    config: Config,
    logger: Logger,
    onMention: (msg: {
      id: string;
      message: string;
      selection: unknown[];
      timestamp: number;
      commentId: string;
      user: string;
      nodeId?: string;
    }) => void,
  ) {
    this.config = config;
    this.logger = logger.child({ component: "comment-watcher" });
    this.onMention = onMention;
  }

  /**
   * Start watching for @rex comments on a file.
   * Call this after plugin connects and provides a file key.
   */
  start(fileKey: string): void {
    if (this.running) this.stop();

    // Need a PAT to use the REST API
    if (!this.config.figma.personalAccessToken) {
      this.logger.debug("Comment watcher disabled: no FIGMA_PAT configured");
      return;
    }

    this.fileKey = fileKey;
    this.client = new FigmaClient({ config: this.config, logger: this.logger });
    this.running = true;

    // Seed processed IDs with existing comments on first poll
    this.seedAndStart();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.client = null;
    this.fileKey = null;
  }

  private async seedAndStart(): Promise<void> {
    // Fetch existing comments so we don't process old ones
    try {
      const response = await getComments(this.client!, this.fileKey!);
      for (const comment of response.comments) {
        this.processedIds.add(comment.id);
      }
      this.logger.info("Comment watcher started", {
        fileKey: this.fileKey,
        existingComments: response.comments.length,
      });
    } catch (err) {
      this.logger.warn("Failed to seed comment watcher, starting fresh", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Start polling
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error("Comment poll error", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.running || !this.client || !this.fileKey) return;

    try {
      const response = await getComments(this.client, this.fileKey);

      for (const comment of response.comments) {
        // Skip already processed
        if (this.processedIds.has(comment.id)) continue;
        this.processedIds.add(comment.id);

        // Check for @rex mention
        if (!MENTION_PATTERN.test(comment.message)) continue;

        // Extract the instruction (strip @rex from the message)
        const instruction = comment.message.replace(MENTION_PATTERN, "").trim();
        if (!instruction) continue;

        this.logger.info("@rex mention detected", {
          commentId: comment.id,
          user: comment.user.handle,
          instruction: instruction.substring(0, 100),
        });

        // Extract node ID from comment metadata if pinned to a node
        const nodeId = this.extractNodeId(comment);

        // Build selection context from the pinned node
        const selection: Array<{ id: string; name: string; type: string }> = [];
        if (nodeId) {
          selection.push({ id: nodeId, name: "commented node", type: "UNKNOWN" });
        }

        // Inject into chat inbox
        this.onMention({
          id: "comment_" + comment.id,
          message: `[Comment by ${comment.user.handle}] ${instruction}`,
          selection,
          timestamp: new Date(comment.created_at).getTime(),
          commentId: comment.id,
          user: comment.user.handle,
          nodeId: nodeId || undefined,
        });
      }
    } catch (err) {
      // Rate limit or network error — just skip this cycle
      this.logger.debug("Comment poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private extractNodeId(comment: FigmaComment): string | null {
    if (!comment.client_meta) return null;
    const meta = comment.client_meta as Record<string, unknown>;
    if (typeof meta.node_id === "string") return meta.node_id;
    return null;
  }
}
