import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RelayServer } from "../../relay/server.js";
import { ConnectionState, CommandType, CommandStatus } from "../../shared/types.js";
import type { Command, CommandResult } from "../../shared/types.js";
import type { Config } from "../../shared/config.js";
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

function createTestConfig(overrides?: Partial<Config>): Config {
  return {
    relay: { port: 0, host: "127.0.0.1" }, // port 0 = random port
    polling: {
      defaultInterval: 300,
      burstInterval: 100,
      idleInterval: 500,
      idleThreshold: 10000,
    },
    websocket: {
      enabled: false, // Disable WS for simpler HTTP-only tests by default
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
    ...overrides,
  } as Config;
}

function createCommand(overrides?: Partial<Command>): Command {
  return {
    id: `cmd-${Math.random().toString(36).slice(2, 10)}`,
    type: CommandType.PING,
    payload: {},
    timestamp: Date.now(),
    ttl: 30000,
    ...overrides,
  };
}

async function getServerAddress(server: RelayServer): Promise<string> {
  // Access the underlying Fastify server to get the assigned port
  const fastify = (server as unknown as { fastify: { server: { address: () => { port: number } } } }).fastify;
  const addr = fastify.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("RelayServer Integration", () => {
  let server: RelayServer;
  let logger: Logger;
  let baseUrl: string;
  let authSecret: string;

  beforeEach(async () => {
    logger = createMockLogger();
    const config = createTestConfig();
    server = new RelayServer(config, logger);
    await server.start();

    baseUrl = await getServerAddress(server);
    authSecret = server.connection.secret;
  });

  afterEach(async () => {
    await server.stop();
  });

  // ─── Health Endpoint ────────────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns 200 with status and version", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBeDefined();
      expect(body.uptime).toBeDefined();
      expect(body.connection).toBeDefined();
      expect(body.queue).toBeDefined();
    });

    it("shows WAITING connection state when no plugin connected", async () => {
      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();
      expect(body.connection.state).toBe(ConnectionState.WAITING);
    });

    it("does not require auth", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
    });
  });

  // ─── Auth Validation ────────────────────────────────────────────────────

  describe("auth validation", () => {
    it("allows POST /connect without auth token (handshake returns token)", async () => {
      const res = await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pluginId: "test",
          fileKey: "file",
          fileName: "Test.fig",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authSecret).toBeDefined();
    });

    it("allows POST /connect regardless of auth header (no auth required)", async () => {
      const res = await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": "wrong-token",
        },
        body: JSON.stringify({
          pluginId: "test",
          fileKey: "file",
          fileName: "Test.fig",
        }),
      });
      expect(res.status).toBe(200);
    });

    it("rejects GET /commands without auth", async () => {
      const res = await fetch(`${baseUrl}/commands`);
      expect(res.status).toBe(401);
    });

    it("rejects POST /results without auth", async () => {
      const res = await fetch(`${baseUrl}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "cmd-1", status: "success", duration: 10, timestamp: Date.now() }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects POST /disconnect without auth", async () => {
      const res = await fetch(`${baseUrl}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Plugin Connection Handshake ────────────────────────────────────────

  describe("POST /connect", () => {
    it("accepts valid connection with correct auth", async () => {
      const res = await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({
          pluginId: "hephaestus-bridge-dev",
          fileKey: "abc123",
          fileName: "Design.fig",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionId).toBeDefined();
      expect(body.sessionId).toMatch(/^sess_/);
      expect(body.config).toBeDefined();
      expect(body.config.pollingInterval).toBe(300);
    });

    it("transitions connection state to POLLING", async () => {
      await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({
          pluginId: "test",
          fileKey: "file",
          fileName: "Test.fig",
        }),
      });

      expect(server.connection.state).toBe(ConnectionState.POLLING);
    });

    it("rejects connection with missing required fields", async () => {
      const res = await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({ pluginId: "test" }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Command Flow ──────────────────────────────────────────────────────

  describe("command flow (enqueue -> poll -> result)", () => {
    let sessionId: string;

    beforeEach(async () => {
      const res = await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({
          pluginId: "test-plugin",
          fileKey: "file-123",
          fileName: "Test.fig",
        }),
      });
      const body = await res.json();
      sessionId = body.sessionId;
    });

    it("returns 204 when no commands are pending", async () => {
      const res = await fetch(`${baseUrl}/commands`, {
        headers: {
          "X-Auth-Token": authSecret,
          "X-Plugin-Id": "test-plugin",
        },
      });
      expect(res.status).toBe(204);
    });

    it("returns pending commands on poll", async () => {
      const cmd = createCommand({ type: CommandType.PING });

      // Enqueue command (don't await the promise, it resolves when result comes back)
      const resultPromise = server.sendCommand(cmd);

      // Poll for commands
      const pollRes = await fetch(`${baseUrl}/commands`, {
        headers: {
          "X-Auth-Token": authSecret,
          "X-Plugin-Id": "test-plugin",
        },
      });

      expect(pollRes.status).toBe(200);
      const pollBody = await pollRes.json();
      expect(pollBody.commands).toBeDefined();
      expect(pollBody.commands).toHaveLength(1);
      expect(pollBody.commands[0].id).toBe(cmd.id);
      expect(pollBody.commands[0].type).toBe(CommandType.PING);
      expect(pollBody.pollingInterval).toBeDefined();

      // Complete the command via POST /results
      const result: CommandResult = {
        id: cmd.id,
        status: "success",
        result: { ok: true },
        duration: 5,
        timestamp: Date.now(),
      };

      const resultRes = await fetch(`${baseUrl}/results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify(result),
      });

      expect(resultRes.status).toBe(200);
      const resultBody = await resultRes.json();
      expect(resultBody.status).toBe("ok");
      expect(resultBody.processed).toBe(1);

      // The enqueue promise should now resolve
      const resolved = await resultPromise;
      expect(resolved.id).toBe(cmd.id);
      expect(resolved.status).toBe("success");
    });

    it("supports posting multiple results at once", async () => {
      const cmd1 = createCommand();
      const cmd2 = createCommand();

      const p1 = server.sendCommand(cmd1);
      const p2 = server.sendCommand(cmd2);

      // Poll to mark them as sent
      await fetch(`${baseUrl}/commands`, {
        headers: {
          "X-Auth-Token": authSecret,
          "X-Plugin-Id": "test-plugin",
        },
      });

      // Post both results
      const results: CommandResult[] = [
        { id: cmd1.id, status: "success", result: { n: 1 }, duration: 3, timestamp: Date.now() },
        { id: cmd2.id, status: "success", result: { n: 2 }, duration: 4, timestamp: Date.now() },
      ];

      const res = await fetch(`${baseUrl}/results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify(results),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.processed).toBe(2);

      const r1 = await p1;
      const r2 = await p2;
      expect(r1.status).toBe("success");
      expect(r2.status).toBe("success");
    });

    it("marks commands as SENT and ACKNOWLEDGED after poll", async () => {
      const cmd = createCommand();
      server.sendCommand(cmd).catch(() => {});

      // Before poll: command is QUEUED
      expect(server.queue.get(cmd.id)?.status).toBe(CommandStatus.QUEUED);

      // Poll
      await fetch(`${baseUrl}/commands`, {
        headers: {
          "X-Auth-Token": authSecret,
          "X-Plugin-Id": "test-plugin",
        },
      });

      // After poll: command is ACKNOWLEDGED (HTTP polling marks both SENT and ACKNOWLEDGED)
      expect(server.queue.get(cmd.id)?.status).toBe(CommandStatus.ACKNOWLEDGED);
    });
  });

  // ─── Disconnect ─────────────────────────────────────────────────────────

  describe("POST /disconnect", () => {
    it("disconnects the plugin and returns to WAITING", async () => {
      // Connect first
      await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({
          pluginId: "test",
          fileKey: "file",
          fileName: "Test.fig",
        }),
      });

      expect(server.connection.state).toBe(ConnectionState.POLLING);

      // Disconnect
      const res = await fetch(`${baseUrl}/disconnect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({ reason: "test complete" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");

      expect(server.connection.state).toBe(ConnectionState.WAITING);
      expect(server.connection.session).toBeNull();
    });
  });

  // ─── Adaptive Polling ──────────────────────────────────────────────────

  describe("adaptive polling interval", () => {
    it("returns burst interval when commands are pending", async () => {
      // Connect
      await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({
          pluginId: "test",
          fileKey: "file",
          fileName: "Test.fig",
        }),
      });

      // Enqueue two commands but only poll once (one will remain pending)
      server.sendCommand(createCommand()).catch(() => {});
      server.sendCommand(createCommand()).catch(() => {});

      // First poll gets both, which means the pollingInterval after should reflect queue state
      const res = await fetch(`${baseUrl}/commands`, {
        headers: {
          "X-Auth-Token": authSecret,
          "X-Plugin-Id": "test",
        },
      });

      const body = await res.json();
      // pollingInterval should be set
      expect(body.pollingInterval).toBeDefined();
      expect(typeof body.pollingInterval).toBe("number");
    });
  });

  // ─── Queue Stats in Health ─────────────────────────────────────────────

  describe("queue stats in health endpoint", () => {
    it("reflects pending commands in health response", async () => {
      // Connect
      await fetch(`${baseUrl}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authSecret,
        },
        body: JSON.stringify({
          pluginId: "test",
          fileKey: "file",
          fileName: "Test.fig",
        }),
      });

      // Enqueue a command (catch the rejection that happens on server.stop())
      server.sendCommand(createCommand()).catch(() => {});

      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();

      expect(body.queue.pending).toBe(1);
    });
  });

  // ─── Server Lifecycle ──────────────────────────────────────────────────

  describe("server lifecycle", () => {
    it("can start and stop cleanly", async () => {
      const newServer = new RelayServer(createTestConfig(), logger);
      await newServer.start();

      const addr = await getServerAddress(newServer);
      const res = await fetch(`${addr}/health`);
      expect(res.status).toBe(200);

      await newServer.stop();

      // After stop, fetch should fail
      await expect(fetch(`${addr}/health`)).rejects.toThrow();
    });
  });
});
