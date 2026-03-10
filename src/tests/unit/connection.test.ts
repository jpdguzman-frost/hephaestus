import { describe, it, expect, beforeEach } from "vitest";
import { ConnectionManager } from "../../relay/connection.js";
import type { ConnectPayload } from "../../relay/connection.js";
import { ConnectionState, ErrorCategory } from "../../shared/types.js";
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

const TEST_AUTH_SECRET = "a".repeat(64); // 32 bytes as hex = 64 chars

function createConnectPayload(overrides?: Partial<ConnectPayload>): ConnectPayload {
  return {
    pluginId: "test-plugin",
    fileKey: "test-file-key",
    fileName: "Test File.fig",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ConnectionManager", () => {
  let manager: ConnectionManager;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    manager = new ConnectionManager(logger, TEST_AUTH_SECRET);
  });

  // ─── Initial State ──────────────────────────────────────────────────────

  describe("initial state", () => {
    it("starts in WAITING state", () => {
      expect(manager.state).toBe(ConnectionState.WAITING);
    });

    it("has no active session", () => {
      expect(manager.session).toBeNull();
    });

    it("isConnected is false", () => {
      expect(manager.isConnected).toBe(false);
    });

    it("isWebSocketActive is false", () => {
      expect(manager.isWebSocketActive).toBe(false);
    });

    it("stores the provided auth secret", () => {
      expect(manager.secret).toBe(TEST_AUTH_SECRET);
    });

    it("generates auth secret if none provided", () => {
      const autoManager = new ConnectionManager(logger);
      expect(autoManager.secret).toBeDefined();
      expect(autoManager.secret.length).toBe(64); // 32 bytes = 64 hex chars
    });
  });

  // ─── Auth Validation ────────────────────────────────────────────────────

  describe("validateAuth", () => {
    it("accepts valid auth token", () => {
      expect(() => manager.validateAuth(TEST_AUTH_SECRET)).not.toThrow();
    });

    it("rejects undefined token", () => {
      expect(() => manager.validateAuth(undefined)).toThrow(RexError);
      expect(() => manager.validateAuth(undefined)).toThrow(/Invalid or missing authentication/);
    });

    it("rejects empty string token", () => {
      expect(() => manager.validateAuth("")).toThrow(RexError);
    });

    it("rejects wrong token", () => {
      expect(() => manager.validateAuth("wrong-token")).toThrow(RexError);
    });

    it("error has correct category and retryable flag", () => {
      try {
        manager.validateAuth("bad");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RexError);
        const he = err as RexError;
        expect(he.category).toBe(ErrorCategory.INVALID_PARAMS);
        expect(he.retryable).toBe(false);
      }
    });
  });

  // ─── State Transitions ─────────────────────────────────────────────────

  describe("connect (WAITING -> POLLING)", () => {
    it("transitions from WAITING to POLLING", () => {
      manager.connect(createConnectPayload());
      expect(manager.state).toBe(ConnectionState.POLLING);
    });

    it("creates a session with correct fields", () => {
      const payload = createConnectPayload({
        pluginId: "my-plugin",
        fileKey: "abc123",
        fileName: "My Design.fig",
      });
      const session = manager.connect(payload);

      expect(session.pluginId).toBe("my-plugin");
      expect(session.fileKey).toBe("abc123");
      expect(session.fileName).toBe("My Design.fig");
      expect(session.transport).toBe("http");
      expect(session.sessionId).toMatch(/^sess_/);
      expect(session.connectedAt).toBeGreaterThan(0);
      expect(session.lastHeartbeat).toBeGreaterThan(0);
    });

    it("isConnected becomes true", () => {
      manager.connect(createConnectPayload());
      expect(manager.isConnected).toBe(true);
    });

    it("replaces existing session on re-connect", () => {
      const session1 = manager.connect(createConnectPayload({ pluginId: "plugin-1" }));
      const session2 = manager.connect(createConnectPayload({ pluginId: "plugin-2" }));

      expect(session2.pluginId).toBe("plugin-2");
      expect(session2.sessionId).not.toBe(session1.sessionId);
      expect(manager.state).toBe(ConnectionState.POLLING);
    });
  });

  describe("upgradeToWebSocket (POLLING -> CONNECTED)", () => {
    it("transitions from POLLING to CONNECTED", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);

      expect(manager.state).toBe(ConnectionState.CONNECTED);
    });

    it("sets transport to websocket", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);

      expect(manager.session!.transport).toBe("websocket");
    });

    it("isWebSocketActive becomes true", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);

      expect(manager.isWebSocketActive).toBe(true);
    });

    it("rejects invalid session ID", () => {
      manager.connect(createConnectPayload());

      expect(() => manager.upgradeToWebSocket("wrong-session")).toThrow(RexError);
      expect(() => manager.upgradeToWebSocket("wrong-session")).toThrow(/Invalid session ID/);
    });

    it("rejects upgrade when no session exists", () => {
      expect(() => manager.upgradeToWebSocket("any")).toThrow(RexError);
    });
  });

  describe("downgradeToPolling (CONNECTED -> DEGRADED)", () => {
    it("transitions from CONNECTED to DEGRADED", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);

      manager.downgradeToPolling();

      expect(manager.state).toBe(ConnectionState.DEGRADED);
    });

    it("sets transport back to http", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);

      manager.downgradeToPolling();

      expect(manager.session!.transport).toBe("http");
    });

    it("isWebSocketActive becomes false", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);

      manager.downgradeToPolling();

      expect(manager.isWebSocketActive).toBe(false);
    });

    it("isConnected remains true in DEGRADED state", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);

      manager.downgradeToPolling();

      expect(manager.isConnected).toBe(true);
    });
  });

  describe("reconnect (DEGRADED -> CONNECTED)", () => {
    it("can upgrade again from DEGRADED to CONNECTED", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);
      manager.downgradeToPolling();

      expect(manager.state).toBe(ConnectionState.DEGRADED);

      manager.upgradeToWebSocket(session.sessionId);

      expect(manager.state).toBe(ConnectionState.CONNECTED);
      expect(manager.isWebSocketActive).toBe(true);
    });
  });

  describe("disconnect (any -> WAITING)", () => {
    it("transitions from POLLING to WAITING", () => {
      manager.connect(createConnectPayload());
      manager.disconnect();

      expect(manager.state).toBe(ConnectionState.WAITING);
    });

    it("transitions from CONNECTED to WAITING", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);
      manager.disconnect();

      expect(manager.state).toBe(ConnectionState.WAITING);
    });

    it("transitions from DEGRADED to WAITING", () => {
      const session = manager.connect(createConnectPayload());
      manager.upgradeToWebSocket(session.sessionId);
      manager.downgradeToPolling();
      manager.disconnect();

      expect(manager.state).toBe(ConnectionState.WAITING);
    });

    it("clears the session", () => {
      manager.connect(createConnectPayload());
      manager.disconnect();

      expect(manager.session).toBeNull();
      expect(manager.isConnected).toBe(false);
    });
  });

  // ─── Session Tracking ───────────────────────────────────────────────────

  describe("session tracking", () => {
    it("stores pluginId on connect", () => {
      manager.connect(createConnectPayload({ pluginId: "tracked-plugin" }));
      expect(manager.session!.pluginId).toBe("tracked-plugin");
    });

    it("stores fileKey on connect", () => {
      manager.connect(createConnectPayload({ fileKey: "tracked-file" }));
      expect(manager.session!.fileKey).toBe("tracked-file");
    });

    it("stores fileName on connect", () => {
      manager.connect(createConnectPayload({ fileName: "TrackedFile.fig" }));
      expect(manager.session!.fileName).toBe("TrackedFile.fig");
    });

    it("stores capabilities on connect", () => {
      manager.connect(createConnectPayload({
        capabilities: {
          maxConcurrent: 5,
          figmaVersion: "116.0",
          pluginVersion: "0.1.0",
        },
      }));
      expect(manager.session!.capabilities).toEqual({
        maxConcurrent: 5,
        figmaVersion: "116.0",
        pluginVersion: "0.1.0",
      });
    });
  });

  // ─── Heartbeat ─────────────────────────────────────────────────────────

  describe("recordHeartbeat / recordPoll", () => {
    it("updates lastHeartbeat timestamp", () => {
      const session = manager.connect(createConnectPayload());
      const initialHeartbeat = session.lastHeartbeat;

      // Small delay simulation
      manager.recordHeartbeat();

      expect(manager.session!.lastHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);
    });

    it("recordPoll delegates to recordHeartbeat", () => {
      manager.connect(createConnectPayload());
      // Should not throw
      manager.recordPoll();
      expect(manager.session!.lastHeartbeat).toBeGreaterThan(0);
    });
  });

  // ─── Plugin ID Validation ──────────────────────────────────────────────

  describe("validatePluginId", () => {
    it("passes when pluginId matches session", () => {
      manager.connect(createConnectPayload({ pluginId: "my-plugin" }));
      expect(() => manager.validatePluginId("my-plugin")).not.toThrow();
    });

    it("passes when pluginId is undefined (optional check)", () => {
      manager.connect(createConnectPayload());
      expect(() => manager.validatePluginId(undefined)).not.toThrow();
    });

    it("throws when no session is active", () => {
      expect(() => manager.validatePluginId("any")).toThrow(RexError);
      expect(() => manager.validatePluginId("any")).toThrow(/No plugin session active/);
    });

    it("throws when pluginId does not match", () => {
      manager.connect(createConnectPayload({ pluginId: "correct-plugin" }));

      expect(() => manager.validatePluginId("wrong-plugin")).toThrow(RexError);
      expect(() => manager.validatePluginId("wrong-plugin")).toThrow(/Plugin ID mismatch/);
    });

    it("no-session error has PLUGIN_NOT_RUNNING category", () => {
      try {
        manager.validatePluginId("any");
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as RexError).category).toBe(ErrorCategory.PLUGIN_NOT_RUNNING);
        expect((err as RexError).retryable).toBe(true);
      }
    });
  });

  // ─── Connection Info ───────────────────────────────────────────────────

  describe("getConnectionInfo", () => {
    it("returns state only when no session", () => {
      const info = manager.getConnectionInfo();
      expect(info).toEqual({ state: ConnectionState.WAITING });
    });

    it("returns full info when session is active", () => {
      manager.connect(createConnectPayload({
        pluginId: "test-plugin",
        fileKey: "file-123",
        fileName: "Design.fig",
      }));

      const info = manager.getConnectionInfo();
      expect(info.state).toBe(ConnectionState.POLLING);
      expect(info.transport).toBe("http");
      expect(info.pluginId).toBe("test-plugin");
      expect(info.fileKey).toBe("file-123");
      expect(info.fileName).toBe("Design.fig");
      expect(info.lastHeartbeat).toBeDefined();
      expect(info.uptime).toBeDefined();
    });
  });
});
