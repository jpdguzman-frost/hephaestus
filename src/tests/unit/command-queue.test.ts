import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommandQueue } from "../../relay/command-queue.js";
import { CommandStatus, CommandType, ErrorCategory } from "../../shared/types.js";
import type { Command, CommandResult } from "../../shared/types.js";
import type { CommandsConfig } from "../../shared/config.js";
import { RexError } from "../../shared/errors.js";
import type { Logger } from "../../shared/logger.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}

function createDefaultConfig(overrides?: Partial<CommandsConfig>): CommandsConfig {
  return {
    defaultTtl: 30000,
    maxRetries: 1,
    maxConcurrent: 10,
    maxPerSecond: 100,
    ...overrides,
  };
}

let commandCounter = 0;

function createCommand(overrides?: Partial<Command>): Command {
  commandCounter++;
  return {
    id: `cmd-${commandCounter}`,
    type: CommandType.PING,
    payload: {},
    timestamp: Date.now(),
    ttl: 30000,
    ...overrides,
  };
}

function createResult(commandId: string, overrides?: Partial<CommandResult>): CommandResult {
  return {
    id: commandId,
    status: "success",
    result: { ok: true },
    duration: 10,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CommandQueue", () => {
  let queue: CommandQueue;
  let logger: Logger;
  let config: CommandsConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    commandCounter = 0;
    logger = createMockLogger();
    config = createDefaultConfig();
    queue = new CommandQueue(config, logger);
  });

  afterEach(() => {
    queue.destroy();
    vi.useRealTimers();
  });

  // ─── Enqueue ────────────────────────────────────────────────────────────

  describe("enqueue", () => {
    it("returns a promise and sets QUEUED status", () => {
      const cmd = createCommand();
      const promise = queue.enqueue(cmd);

      expect(promise).toBeInstanceOf(Promise);

      const entry = queue.get(cmd.id);
      expect(entry).toBeDefined();
      expect(entry!.status).toBe(CommandStatus.QUEUED);
      expect(entry!.retryCount).toBe(0);
      expect(entry!.command).toBe(cmd);
    });

    it("emits 'enqueued' event", () => {
      const handler = vi.fn();
      queue.on("enqueued", handler);

      const cmd = createCommand();
      queue.enqueue(cmd);

      expect(handler).toHaveBeenCalledWith(cmd);
    });

    it("appears in getPending() after enqueue", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);

      const pending = queue.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].command.id).toBe(cmd.id);
    });
  });

  // ─── markSent ───────────────────────────────────────────────────────────

  describe("markSent", () => {
    it("transitions command to SENT status", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);

      queue.markSent(cmd.id);

      const entry = queue.get(cmd.id);
      expect(entry!.status).toBe(CommandStatus.SENT);
      expect(entry!.sentAt).toBeDefined();
      expect(typeof entry!.sentAt).toBe("number");
    });

    it("emits 'sent' event", () => {
      const handler = vi.fn();
      queue.on("sent", handler);

      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      expect(handler).toHaveBeenCalledWith(cmd.id);
    });

    it("moves command from pending to in-flight", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);
      expect(queue.getPending()).toHaveLength(1);
      expect(queue.getInFlight()).toHaveLength(0);

      queue.markSent(cmd.id);
      expect(queue.getPending()).toHaveLength(0);
      expect(queue.getInFlight()).toHaveLength(1);
    });

    it("does nothing for unknown command ID", () => {
      // Should not throw
      queue.markSent("nonexistent");
    });
  });

  // ─── markAcknowledged ───────────────────────────────────────────────────

  describe("markAcknowledged", () => {
    it("transitions command to ACKNOWLEDGED status", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      queue.markAcknowledged(cmd.id);

      const entry = queue.get(cmd.id);
      expect(entry!.status).toBe(CommandStatus.ACKNOWLEDGED);
      expect(entry!.acknowledgedAt).toBeDefined();
    });

    it("emits 'acknowledged' event", () => {
      const handler = vi.fn();
      queue.on("acknowledged", handler);

      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);
      queue.markAcknowledged(cmd.id);

      expect(handler).toHaveBeenCalledWith(cmd.id);
    });
  });

  // ─── complete ───────────────────────────────────────────────────────────

  describe("complete", () => {
    it("transitions command to COMPLETED and resolves the promise", async () => {
      const cmd = createCommand();
      const promise = queue.enqueue(cmd);
      queue.markSent(cmd.id);

      const result = createResult(cmd.id);
      queue.complete(cmd.id, result);

      const resolved = await promise;
      expect(resolved).toBe(result);
      expect(resolved.status).toBe("success");
    });

    it("emits 'completed' event with result", () => {
      const handler = vi.fn();
      queue.on("completed", handler);

      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      const result = createResult(cmd.id);
      queue.complete(cmd.id, result);

      expect(handler).toHaveBeenCalledWith(cmd.id, result);
    });

    it("removes command from the queue after completion", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      queue.complete(cmd.id, createResult(cmd.id));

      expect(queue.get(cmd.id)).toBeUndefined();
      expect(queue.getStats().total).toBe(0);
    });

    it("caches result for idempotency when idempotencyKey is set", async () => {
      const cmd = createCommand({ idempotencyKey: "idem-key-1" });
      const promise1 = queue.enqueue(cmd);
      queue.markSent(cmd.id);

      const result = createResult(cmd.id, { result: { data: "cached" } });
      queue.complete(cmd.id, result);
      await promise1;

      // Enqueue again with same idempotencyKey should return cached result
      const cmd2 = createCommand({ idempotencyKey: "idem-key-1" });
      const promise2 = queue.enqueue(cmd2);
      const cachedResult = await promise2;

      expect(cachedResult).toEqual(result);
    });
  });

  // ─── TTL Expiration ─────────────────────────────────────────────────────

  describe("TTL expiration", () => {
    it("expires QUEUED commands after their TTL", async () => {
      const cmd = createCommand({ ttl: 2000 });
      const promise = queue.enqueue(cmd);

      // Advance time past the TTL
      vi.advanceTimersByTime(3000);

      await expect(promise).rejects.toThrow(RexError);
      await expect(promise).rejects.toMatchObject({
        category: ErrorCategory.COMMAND_TIMEOUT,
        retryable: false,
      });
    });

    it("emits 'expired' event for TTL-expired commands", () => {
      const handler = vi.fn();
      queue.on("expired", handler);

      const cmd = createCommand({ ttl: 1500 });
      queue.enqueue(cmd);

      vi.advanceTimersByTime(2000);

      expect(handler).toHaveBeenCalledWith(cmd.id);
    });

    it("times out in-flight commands after TTL from sentAt", async () => {
      const cmd = createCommand({ ttl: 5000 });
      const promise = queue.enqueue(cmd);
      queue.markSent(cmd.id);

      // TTL enforcement checks every 1000ms
      vi.advanceTimersByTime(6000);

      // After timeout + max retries (1 retry allowed), should eventually fail
      // First timeout triggers retry, second timeout after retry triggers failure
      vi.advanceTimersByTime(7000);

      await expect(promise).rejects.toThrow(RexError);
    });

    it("uses defaultTtl when command has no ttl set", async () => {
      const configWithShortTtl = createDefaultConfig({ defaultTtl: 2000 });
      queue.destroy();
      queue = new CommandQueue(configWithShortTtl, logger);

      const cmd = createCommand({ ttl: 0 });
      // ttl=0 is falsy, so enforceTTL uses defaultTtl
      const promise = queue.enqueue(cmd);

      vi.advanceTimersByTime(3000);

      await expect(promise).rejects.toThrow(RexError);
    });
  });

  // ─── Retry Logic ────────────────────────────────────────────────────────

  describe("retry logic", () => {
    it("retries once on timeout (TIMEOUT -> RETRY -> re-queued)", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      queue.timeout(cmd.id);

      const entry = queue.get(cmd.id);
      expect(entry).toBeDefined();
      expect(entry!.status).toBe(CommandStatus.RETRY);
      expect(entry!.retryCount).toBe(1);
    });

    it("emits 'timeout' and 'retry' events on first timeout", () => {
      const timeoutHandler = vi.fn();
      const retryHandler = vi.fn();
      queue.on("timeout", timeoutHandler);
      queue.on("retry", retryHandler);

      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      queue.timeout(cmd.id);

      expect(timeoutHandler).toHaveBeenCalledWith(cmd.id);
      expect(retryHandler).toHaveBeenCalledWith(cmd.id, 1);
    });

    it("transitions back to QUEUED after retry backoff", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      queue.timeout(cmd.id);

      // First retry has 0ms backoff
      vi.advanceTimersByTime(0);

      const entry = queue.get(cmd.id);
      expect(entry!.status).toBe(CommandStatus.QUEUED);
    });

    it("fails after max retries exhausted", async () => {
      const cmd = createCommand();
      const promise = queue.enqueue(cmd);
      queue.markSent(cmd.id);

      // First timeout -> retry
      queue.timeout(cmd.id);
      vi.advanceTimersByTime(0);
      queue.markSent(cmd.id);

      // Second timeout -> should fail (maxRetries = 1)
      queue.timeout(cmd.id);

      await expect(promise).rejects.toThrow(RexError);
      await expect(promise).rejects.toMatchObject({
        category: ErrorCategory.COMMAND_TIMEOUT,
        retryable: false,
      });
    });

    it("emits 'failed' event after max retries", () => {
      const handler = vi.fn();
      queue.on("failed", handler);

      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);

      // Exhaust retries
      queue.timeout(cmd.id);
      vi.advanceTimersByTime(0);
      queue.markSent(cmd.id);
      queue.timeout(cmd.id);

      expect(handler).toHaveBeenCalledWith(cmd.id, expect.any(RexError));
    });

    it("clears sentAt and acknowledgedAt on retry", () => {
      const cmd = createCommand();
      queue.enqueue(cmd);
      queue.markSent(cmd.id);
      queue.markAcknowledged(cmd.id);

      queue.timeout(cmd.id);

      // After retry starts but before it transitions to QUEUED
      const entry = queue.get(cmd.id);
      expect(entry!.sentAt).toBeUndefined();
      expect(entry!.acknowledgedAt).toBeUndefined();
    });
  });

  // ─── Rate Limiting ──────────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("rejects when over maxPerSecond rate limit", () => {
      const restrictedConfig = createDefaultConfig({ maxPerSecond: 5 });
      queue.destroy();
      queue = new CommandQueue(restrictedConfig, logger);

      // Enqueue up to the limit
      for (let i = 0; i < 5; i++) {
        queue.enqueue(createCommand());
      }

      // The 6th should throw
      expect(() => queue.enqueue(createCommand())).toThrow(RexError);
      expect(() => queue.enqueue(createCommand())).toThrow(/Rate limit exceeded/);
    });

    it("rate limit error is marked as retryable", () => {
      const restrictedConfig = createDefaultConfig({ maxPerSecond: 1 });
      queue.destroy();
      queue = new CommandQueue(restrictedConfig, logger);

      queue.enqueue(createCommand());

      try {
        queue.enqueue(createCommand());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RexError);
        expect((err as RexError).retryable).toBe(true);
        expect((err as RexError).category).toBe(ErrorCategory.INTERNAL_ERROR);
      }
    });

    it("allows commands again after rate window passes", () => {
      const restrictedConfig = createDefaultConfig({ maxPerSecond: 2 });
      queue.destroy();
      queue = new CommandQueue(restrictedConfig, logger);

      queue.enqueue(createCommand());
      queue.enqueue(createCommand());

      // Should reject now
      expect(() => queue.enqueue(createCommand())).toThrow(RexError);

      // Advance past the 1-second window
      vi.advanceTimersByTime(1100);

      // Should accept again
      expect(() => queue.enqueue(createCommand())).not.toThrow();
    });
  });

  // ─── Concurrency Limiting ──────────────────────────────────────────────

  describe("concurrency limiting", () => {
    it("rejects when over maxConcurrent pending + in-flight", () => {
      const restrictedConfig = createDefaultConfig({ maxConcurrent: 3 });
      queue.destroy();
      queue = new CommandQueue(restrictedConfig, logger);

      for (let i = 0; i < 3; i++) {
        queue.enqueue(createCommand());
      }

      expect(() => queue.enqueue(createCommand())).toThrow(RexError);
      expect(() => queue.enqueue(createCommand())).toThrow(/Max concurrent commands reached/);
    });

    it("concurrency error is marked as retryable", () => {
      const restrictedConfig = createDefaultConfig({ maxConcurrent: 1 });
      queue.destroy();
      queue = new CommandQueue(restrictedConfig, logger);

      queue.enqueue(createCommand());

      try {
        queue.enqueue(createCommand());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RexError);
        expect((err as RexError).retryable).toBe(true);
      }
    });

    it("allows new commands after in-flight ones complete", () => {
      const restrictedConfig = createDefaultConfig({ maxConcurrent: 2 });
      queue.destroy();
      queue = new CommandQueue(restrictedConfig, logger);

      const cmd1 = createCommand();
      const cmd2 = createCommand();
      queue.enqueue(cmd1);
      queue.enqueue(cmd2);

      // Should reject now
      expect(() => queue.enqueue(createCommand())).toThrow();

      // Complete one command
      queue.markSent(cmd1.id);
      queue.complete(cmd1.id, createResult(cmd1.id));

      // Should accept again
      expect(() => queue.enqueue(createCommand())).not.toThrow();
    });
  });

  // ─── Idempotency ───────────────────────────────────────────────────────

  describe("idempotency", () => {
    it("returns cached result for duplicate idempotency key", async () => {
      const cmd1 = createCommand({ idempotencyKey: "unique-op-1" });
      const promise1 = queue.enqueue(cmd1);
      queue.markSent(cmd1.id);

      const expectedResult = createResult(cmd1.id, { result: { answer: 42 } });
      queue.complete(cmd1.id, expectedResult);
      await promise1;

      // Second command with same key
      const cmd2 = createCommand({ idempotencyKey: "unique-op-1" });
      const result2 = await queue.enqueue(cmd2);

      expect(result2).toEqual(expectedResult);
      // The second command should NOT be in the queue
      expect(queue.get(cmd2.id)).toBeUndefined();
    });

    it("does not cache results for commands without idempotency key", async () => {
      const cmd1 = createCommand();
      const promise1 = queue.enqueue(cmd1);
      queue.markSent(cmd1.id);
      queue.complete(cmd1.id, createResult(cmd1.id));
      await promise1;

      // Second command without key should be queued normally
      const cmd2 = createCommand();
      queue.enqueue(cmd2);
      expect(queue.get(cmd2.id)).toBeDefined();
      expect(queue.get(cmd2.id)!.status).toBe(CommandStatus.QUEUED);
    });

    it("cache entry expires after TTL (5 minutes)", async () => {
      const cmd1 = createCommand({ idempotencyKey: "expiring-op" });
      const promise1 = queue.enqueue(cmd1);
      queue.markSent(cmd1.id);
      queue.complete(cmd1.id, createResult(cmd1.id));
      await promise1;

      // Advance past idempotency TTL (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      // Should be treated as a new command
      const cmd2 = createCommand({ idempotencyKey: "expiring-op" });
      queue.enqueue(cmd2);
      expect(queue.get(cmd2.id)).toBeDefined();
      expect(queue.get(cmd2.id)!.status).toBe(CommandStatus.QUEUED);
    });
  });

  // ─── Queue Stats ──────────────────────────────────────────────────────

  describe("getStats", () => {
    it("returns correct counts for pending, in-flight, and total", () => {
      const cmd1 = createCommand();
      const cmd2 = createCommand();
      const cmd3 = createCommand();

      queue.enqueue(cmd1);
      queue.enqueue(cmd2);
      queue.enqueue(cmd3);

      queue.markSent(cmd1.id);
      queue.markSent(cmd2.id);
      queue.markAcknowledged(cmd2.id);

      const stats = queue.getStats();
      expect(stats.pending).toBe(1);   // cmd3
      expect(stats.inFlight).toBe(2);  // cmd1 (SENT) + cmd2 (ACKNOWLEDGED)
      expect(stats.total).toBe(3);
    });

    it("returns zeroes when queue is empty", () => {
      const stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.inFlight).toBe(0);
      expect(stats.total).toBe(0);
    });
  });

  // ─── Destroy ──────────────────────────────────────────────────────────

  describe("destroy", () => {
    it("rejects all pending commands with CONNECTION_LOST error", async () => {
      const cmd1 = createCommand();
      const cmd2 = createCommand();
      const promise1 = queue.enqueue(cmd1);
      const promise2 = queue.enqueue(cmd2);

      queue.destroy();

      await expect(promise1).rejects.toMatchObject({
        category: ErrorCategory.CONNECTION_LOST,
      });
      await expect(promise2).rejects.toMatchObject({
        category: ErrorCategory.CONNECTION_LOST,
      });
    });

    it("clears the queue and removes all listeners", () => {
      queue.enqueue(createCommand());
      queue.enqueue(createCommand());

      queue.destroy();

      expect(queue.getStats().total).toBe(0);
      expect(queue.listenerCount("enqueued")).toBe(0);
    });
  });
});
