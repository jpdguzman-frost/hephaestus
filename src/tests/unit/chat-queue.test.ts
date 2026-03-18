import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RelayServer } from "../../relay/server.js";
import type { Config } from "../../shared/config.js";
import type { Logger } from "../../shared/logger.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: vi.fn(),
    error: noop,
    child: () => logger,
  };
  return logger;
}

function createTestConfig(): Config {
  return {
    relay: { port: 0, host: "127.0.0.1" },
    polling: {
      defaultInterval: 300,
      burstInterval: 100,
      idleInterval: 500,
      idleThreshold: 10000,
    },
    websocket: {
      enabled: false,
      heartbeatInterval: 5000,
      heartbeatTimeout: 3000,
      reconnectBackoff: [500, 1000, 2000, 4000, 8000, 15000],
    },
    commands: {
      defaultTtl: 30000,
      maxRetries: 1,
      maxConcurrent: 10,
      maxPerSecond: 100,
    },
    figma: {
      preloadFonts: ["Inter"],
    },
  } as Config;
}

function createChatMessage(id?: string, message?: string) {
  return {
    id: id ?? `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    message: message ?? "test message",
    selection: [],
    timestamp: Date.now(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Chat Message Queue", () => {
  let server: RelayServer;
  let logger: Logger;

  beforeEach(async () => {
    logger = createMockLogger();
    server = new RelayServer(createTestConfig(), logger);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("enqueueChatMessage", () => {
    it("queues messages when no waiter exists", () => {
      const msg = createChatMessage("msg-1", "hello");
      server.enqueueChatMessage(msg);

      expect(server.pendingChatCount).toBe(1);
    });

    it("delivers directly to waiter when one exists", async () => {
      const msg = createChatMessage("msg-1", "hello");

      // Start waiting (will block until message arrives or timeout)
      const waitPromise = server.waitForChatMessage(5000);

      // Enqueue — should resolve the waiter immediately
      server.enqueueChatMessage(msg);

      const received = await waitPromise;
      expect(received).not.toBeNull();
      expect(received!.id).toBe("msg-1");
      expect(received!.message).toBe("hello");

      // Queue should be empty — message went directly to waiter
      expect(server.pendingChatCount).toBe(0);
    });

    it("enforces queue bound of 50 messages", () => {
      // Fill the queue to max
      for (let i = 0; i < 50; i++) {
        server.enqueueChatMessage(createChatMessage(`msg-${i}`, `message ${i}`));
      }
      expect(server.pendingChatCount).toBe(50);

      // Add one more — should drop oldest
      server.enqueueChatMessage(createChatMessage("msg-50", "overflow message"));
      expect(server.pendingChatCount).toBe(50);

      // Verify warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        "Chat inbox overflow — dropped oldest message",
        expect.objectContaining({ droppedId: "msg-0" }),
      );
    });

    it("drops oldest message on overflow", async () => {
      // Fill queue
      for (let i = 0; i < 50; i++) {
        server.enqueueChatMessage(createChatMessage(`msg-${i}`, `message ${i}`));
      }

      // Overflow with new message
      server.enqueueChatMessage(createChatMessage("msg-new", "new message"));

      // First dequeued should be msg-1 (msg-0 was dropped)
      const first = await server.waitForChatMessage(100);
      expect(first).not.toBeNull();
      expect(first!.id).toBe("msg-1");
    });
  });

  describe("waitForChatMessage", () => {
    it("returns immediately when messages are queued", async () => {
      server.enqueueChatMessage(createChatMessage("msg-1", "hello"));
      server.enqueueChatMessage(createChatMessage("msg-2", "world"));

      const msg = await server.waitForChatMessage(5000);
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe("msg-1");

      // Second message still queued
      expect(server.pendingChatCount).toBe(1);
    });

    it("returns null on timeout with empty queue", async () => {
      const msg = await server.waitForChatMessage(100);
      expect(msg).toBeNull();
    });

    it("preserves FIFO order", async () => {
      server.enqueueChatMessage(createChatMessage("msg-1", "first"));
      server.enqueueChatMessage(createChatMessage("msg-2", "second"));
      server.enqueueChatMessage(createChatMessage("msg-3", "third"));

      const first = await server.waitForChatMessage(100);
      const second = await server.waitForChatMessage(100);
      const third = await server.waitForChatMessage(100);

      expect(first!.message).toBe("first");
      expect(second!.message).toBe("second");
      expect(third!.message).toBe("third");
    });

    it("blocks until message arrives", async () => {
      // Start waiting
      const waitPromise = server.waitForChatMessage(5000);

      // Small delay, then enqueue
      await new Promise((resolve) => setTimeout(resolve, 50));
      server.enqueueChatMessage(createChatMessage("msg-1", "delayed"));

      const msg = await waitPromise;
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe("msg-1");
    });
  });

  describe("pendingChatCount", () => {
    it("starts at 0", () => {
      expect(server.pendingChatCount).toBe(0);
    });

    it("increments on enqueue", () => {
      server.enqueueChatMessage(createChatMessage());
      expect(server.pendingChatCount).toBe(1);

      server.enqueueChatMessage(createChatMessage());
      expect(server.pendingChatCount).toBe(2);
    });

    it("decrements on dequeue", async () => {
      server.enqueueChatMessage(createChatMessage());
      server.enqueueChatMessage(createChatMessage());
      expect(server.pendingChatCount).toBe(2);

      await server.waitForChatMessage(100);
      expect(server.pendingChatCount).toBe(1);

      await server.waitForChatMessage(100);
      expect(server.pendingChatCount).toBe(0);
    });

    it("stays at 0 when waiter consumes directly", async () => {
      const waitPromise = server.waitForChatMessage(5000);
      server.enqueueChatMessage(createChatMessage());

      await waitPromise;
      expect(server.pendingChatCount).toBe(0);
    });
  });
});
