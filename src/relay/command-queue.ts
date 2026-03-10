import { EventEmitter } from "node:events";
import type { Command, CommandResult } from "../shared/types.js";
import { CommandStatus, ErrorCategory } from "../shared/types.js";
import { RexError } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { CommandsConfig } from "../shared/config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A command with lifecycle tracking metadata. */
export interface QueuedCommand {
  command: Command;
  status: CommandStatus;
  retryCount: number;
  createdAt: number;
  sentAt?: number;
  acknowledgedAt?: number;
  completedAt?: number;
  result?: CommandResult;
  /** Promise resolve callback for callers waiting on this command. */
  resolve?: (result: CommandResult) => void;
  /** Promise reject callback for callers waiting on this command. */
  reject?: (error: RexError) => void;
}

/** Events emitted by the command queue. */
export interface CommandQueueEvents {
  enqueued: (command: Command) => void;
  sent: (commandId: string) => void;
  acknowledged: (commandId: string) => void;
  completed: (commandId: string, result: CommandResult) => void;
  timeout: (commandId: string) => void;
  retry: (commandId: string, attempt: number) => void;
  failed: (commandId: string, error: RexError) => void;
  expired: (commandId: string) => void;
}

/** LRU cache entry for idempotency. */
interface IdempotencyCacheEntry {
  result: CommandResult;
  createdAt: number;
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxPerSecond: number;

  constructor(maxPerSecond: number) {
    this.maxPerSecond = maxPerSecond;
  }

  /** Returns true if the request is allowed. */
  tryAcquire(): boolean {
    const now = Date.now();
    // Remove timestamps older than 1 second
    this.timestamps = this.timestamps.filter((t) => now - t < 1000);
    if (this.timestamps.length >= this.maxPerSecond) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}

// ─── LRU Cache ──────────────────────────────────────────────────────────────

class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Delete oldest (first) entry
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }
}

// ─── Command Queue ──────────────────────────────────────────────────────────

const IDEMPOTENCY_CACHE_MAX = 500;
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class CommandQueue extends EventEmitter {
  private readonly queue = new Map<string, QueuedCommand>();
  private readonly idempotencyCache = new LRUCache<string, IdempotencyCacheEntry>(IDEMPOTENCY_CACHE_MAX);
  private readonly rateLimiter: RateLimiter;
  private readonly config: CommandsConfig;
  private readonly logger: Logger;
  private ttlTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CommandsConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: "command-queue" });
    this.rateLimiter = new RateLimiter(config.maxPerSecond);

    // Start TTL enforcement timer (checks every second)
    this.ttlTimer = setInterval(() => this.enforceTTL(), 1000);
  }

  /**
   * Enqueue a command for delivery to the plugin.
   * Returns a promise that resolves when the command completes.
   */
  enqueue(command: Command): Promise<CommandResult> {
    // Rate limiting check
    if (!this.rateLimiter.tryAcquire()) {
      throw new RexError({
        category: ErrorCategory.INTERNAL_ERROR,
        message: "Rate limit exceeded: max " + this.config.maxPerSecond + " commands/sec",
        retryable: true,
        commandId: command.id,
        suggestion: "Wait briefly and retry. The command queue is processing at capacity.",
      });
    }

    // Concurrent pending check
    const pendingCount = this.getPending().length + this.getInFlight().length;
    if (pendingCount >= this.config.maxConcurrent) {
      throw new RexError({
        category: ErrorCategory.INTERNAL_ERROR,
        message: "Max concurrent commands reached: " + this.config.maxConcurrent,
        retryable: true,
        commandId: command.id,
        suggestion: "Wait for pending commands to complete before sending more.",
      });
    }

    // Idempotency check — return cached result if available
    if (command.idempotencyKey) {
      const cached = this.idempotencyCache.get(command.idempotencyKey);
      if (cached && Date.now() - cached.createdAt < IDEMPOTENCY_TTL_MS) {
        this.logger.debug("Idempotency cache hit", {
          commandId: command.id,
          idempotencyKey: command.idempotencyKey,
        });
        return Promise.resolve(cached.result);
      }
    }

    const promise = new Promise<CommandResult>((resolve, reject) => {
      const queued: QueuedCommand = {
        command,
        status: CommandStatus.QUEUED,
        retryCount: 0,
        createdAt: Date.now(),
        resolve,
        reject,
      };

      this.queue.set(command.id, queued);
      this.emit("enqueued", command);
      this.logger.debug("Command enqueued", {
        commandId: command.id,
        type: command.type,
      });
    });

    // Attach a no-op catch to prevent unhandled rejection warnings
    // when the caller doesn't catch (e.g., fire-and-forget or server shutdown).
    // The caller's copy of the promise is still independently rejectable.
    promise.catch(() => {});

    return promise;
  }

  /** Mark a command as sent to the plugin. */
  markSent(id: string): void {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("markSent: command not found", { commandId: id });
      return;
    }
    entry.status = CommandStatus.SENT;
    entry.sentAt = Date.now();
    this.emit("sent", id);
    this.logger.debug("Command sent", { commandId: id });
  }

  /** Mark a command as acknowledged by the plugin. */
  markAcknowledged(id: string): void {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("markAcknowledged: command not found", { commandId: id });
      return;
    }
    entry.status = CommandStatus.ACKNOWLEDGED;
    entry.acknowledgedAt = Date.now();
    this.emit("acknowledged", id);
    this.logger.debug("Command acknowledged", { commandId: id });
  }

  /** Complete a command with a result. */
  complete(id: string, result: CommandResult): void {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("complete: command not found", { commandId: id });
      return;
    }

    entry.status = CommandStatus.COMPLETED;
    entry.completedAt = Date.now();
    entry.result = result;

    // Cache the result for idempotency
    if (entry.command.idempotencyKey) {
      this.idempotencyCache.set(entry.command.idempotencyKey, {
        result,
        createdAt: Date.now(),
      });
    }

    this.emit("completed", id, result);
    this.logger.debug("Command completed", {
      commandId: id,
      status: result.status,
      duration: result.duration,
    });

    // Resolve the waiting promise
    entry.resolve?.(result);

    // Clean up from active queue
    this.queue.delete(id);
  }

  /** Mark a command as timed out. May trigger retry. */
  timeout(id: string): void {
    const entry = this.queue.get(id);
    if (!entry) return;

    entry.status = CommandStatus.TIMEOUT;
    this.emit("timeout", id);
    this.logger.warn("Command timed out", {
      commandId: id,
      type: entry.command.type,
      retryCount: entry.retryCount,
    });

    // Attempt retry if within limits
    if (entry.retryCount < this.config.maxRetries) {
      this.retry(id);
    } else {
      this.fail(id, new RexError({
        category: ErrorCategory.COMMAND_TIMEOUT,
        message: "Command timed out after " + entry.command.ttl + "ms (retries exhausted)",
        retryable: false,
        commandId: id,
        suggestion: "The Figma plugin may be unresponsive. Check the plugin status.",
      }));
    }
  }

  /** Retry a command. Resets status to QUEUED with incremented retry count. */
  retry(id: string): void {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("retry: command not found", { commandId: id });
      return;
    }

    entry.retryCount++;
    entry.status = CommandStatus.RETRY;
    entry.sentAt = undefined;
    entry.acknowledgedAt = undefined;

    this.emit("retry", id, entry.retryCount);
    this.logger.info("Command retrying", {
      commandId: id,
      attempt: entry.retryCount,
    });

    // Apply backoff delay per SPEC.md §5.3 — immediate for timeout retries
    // After the brief delay, transition back to QUEUED so it can be re-sent
    const backoffMs = entry.retryCount === 1 ? 0 : 1000;
    setTimeout(() => {
      const current = this.queue.get(id);
      if (current && current.status === CommandStatus.RETRY) {
        current.status = CommandStatus.QUEUED;
        current.createdAt = Date.now(); // Reset TTL baseline
      }
    }, backoffMs);
  }

  /** Permanently fail a command. */
  private fail(id: string, error: RexError): void {
    const entry = this.queue.get(id);
    if (!entry) return;

    entry.status = CommandStatus.FAILED;
    entry.completedAt = Date.now();

    this.emit("failed", id, error);
    this.logger.error("Command failed", {
      commandId: id,
      category: error.category,
      message: error.message,
    });

    // Reject the waiting promise
    entry.reject?.(error);

    // Clean up
    this.queue.delete(id);
  }

  /** Get all commands in QUEUED state (ready to be sent). */
  getPending(): QueuedCommand[] {
    const pending: QueuedCommand[] = [];
    for (const entry of this.queue.values()) {
      if (entry.status === CommandStatus.QUEUED) {
        pending.push(entry);
      }
    }
    return pending;
  }

  /** Get all commands in SENT or ACKNOWLEDGED state (waiting for result). */
  getInFlight(): QueuedCommand[] {
    const inFlight: QueuedCommand[] = [];
    for (const entry of this.queue.values()) {
      if (entry.status === CommandStatus.SENT || entry.status === CommandStatus.ACKNOWLEDGED) {
        inFlight.push(entry);
      }
    }
    return inFlight;
  }

  /** Get a specific queued command by ID. */
  get(id: string): QueuedCommand | undefined {
    return this.queue.get(id);
  }

  /** Get queue statistics for health reporting. */
  getStats(): {
    pending: number;
    inFlight: number;
    total: number;
  } {
    let pending = 0;
    let inFlight = 0;
    for (const entry of this.queue.values()) {
      if (entry.status === CommandStatus.QUEUED) pending++;
      if (entry.status === CommandStatus.SENT || entry.status === CommandStatus.ACKNOWLEDGED) inFlight++;
    }
    return { pending, inFlight, total: this.queue.size };
  }

  /** Enforce TTL on all commands — expire stale ones, timeout in-flight ones. */
  private enforceTTL(): void {
    const now = Date.now();

    for (const [id, entry] of this.queue) {
      const age = now - entry.createdAt;
      const ttl = entry.command.ttl || this.config.defaultTtl;

      if (entry.status === CommandStatus.QUEUED && age > ttl) {
        // Command expired before it was sent
        entry.status = CommandStatus.EXPIRED;
        this.emit("expired", id);
        this.logger.warn("Command expired before send", {
          commandId: id,
          type: entry.command.type,
          age,
        });
        entry.reject?.(new RexError({
          category: ErrorCategory.COMMAND_TIMEOUT,
          message: "Command expired before delivery (TTL: " + ttl + "ms)",
          retryable: false,
          commandId: id,
        }));
        this.queue.delete(id);
      } else if (
        (entry.status === CommandStatus.SENT || entry.status === CommandStatus.ACKNOWLEDGED) &&
        entry.sentAt &&
        now - entry.sentAt > ttl
      ) {
        // Command timed out waiting for result
        this.timeout(id);
      }
    }
  }

  /** Clean up timers. Call when shutting down. */
  destroy(): void {
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }

    // Reject all pending commands
    for (const [id, entry] of this.queue) {
      entry.reject?.(new RexError({
        category: ErrorCategory.CONNECTION_LOST,
        message: "Server shutting down",
        retryable: false,
        commandId: id,
      }));
    }
    this.queue.clear();
    this.removeAllListeners();
  }
}
