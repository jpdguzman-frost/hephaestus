import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../shared/config.js";
import type { Config } from "../../shared/config.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTempDir(): string {
  const dir = join(tmpdir(), "hephaestus-test-" + randomBytes(6).toString("hex"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfigFile(dir: string, config: Record<string, unknown>): string {
  const filePath = join(dir, "hephaestus.config.json");
  writeFileSync(filePath, JSON.stringify(config));
  return filePath;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("loadConfig", () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = createTempDir();
    // Clear relevant env vars
    delete process.env["FIGMA_PAT"];
    delete process.env["RELAY_PORT"];
    delete process.env["RELAY_HOST"];
    delete process.env["LOG_LEVEL"];
    delete process.env["WS_ENABLED"];
  });

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
    // Clean up temp dir
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ─── Defaults ───────────────────────────────────────────────────────────

  describe("defaults", () => {
    it("applies all defaults when no config file exists", () => {
      const config = loadConfig(join(tempDir, "nonexistent.json"));

      expect(config.relay.port).toBe(7780);
      expect(config.relay.host).toBe("127.0.0.1");
      expect(config.polling.defaultInterval).toBe(300);
      expect(config.polling.burstInterval).toBe(100);
      expect(config.polling.idleInterval).toBe(500);
      expect(config.polling.idleThreshold).toBe(10000);
      expect(config.websocket.enabled).toBe(true);
      expect(config.websocket.heartbeatInterval).toBe(5000);
      expect(config.websocket.heartbeatTimeout).toBe(3000);
      expect(config.websocket.reconnectBackoff).toEqual([500, 1000, 2000, 4000, 8000, 15000]);
      expect(config.commands.defaultTtl).toBe(60000);
      expect(config.commands.maxRetries).toBe(1);
      expect(config.commands.maxConcurrent).toBe(10);
      expect(config.commands.maxPerSecond).toBe(100);
      expect(config.figma.personalAccessToken).toBeUndefined();
      expect(config.figma.preloadFonts).toEqual(["Inter", "Plus Jakarta Sans"]);
    });
  });

  // ─── Config File Overrides ──────────────────────────────────────────────

  describe("config file values", () => {
    it("overrides defaults from config file", () => {
      const filePath = writeConfigFile(tempDir, {
        relay: { port: 8080, host: "localhost" },
        commands: { maxConcurrent: 20 },
      });

      const config = loadConfig(filePath);

      expect(config.relay.port).toBe(8080);
      expect(config.relay.host).toBe("localhost");
      expect(config.commands.maxConcurrent).toBe(20);
      // Other defaults should still apply
      expect(config.polling.defaultInterval).toBe(300);
    });

    it("reads figma PAT from config file", () => {
      const filePath = writeConfigFile(tempDir, {
        figma: { personalAccessToken: "figd_test_token" },
      });

      const config = loadConfig(filePath);
      expect(config.figma.personalAccessToken).toBe("figd_test_token");
    });

    it("overrides websocket config from file", () => {
      const filePath = writeConfigFile(tempDir, {
        websocket: {
          enabled: false,
          heartbeatInterval: 10000,
        },
      });

      const config = loadConfig(filePath);
      expect(config.websocket.enabled).toBe(false);
      expect(config.websocket.heartbeatInterval).toBe(10000);
      // Default should still apply for non-overridden fields
      expect(config.websocket.heartbeatTimeout).toBe(3000);
    });
  });

  // ─── Environment Variable Overrides ─────────────────────────────────────

  describe("environment variable overrides", () => {
    it("FIGMA_PAT overrides config", () => {
      const filePath = writeConfigFile(tempDir, {
        figma: { personalAccessToken: "from-file" },
      });

      process.env["FIGMA_PAT"] = "from-env";
      const config = loadConfig(filePath);
      expect(config.figma.personalAccessToken).toBe("from-env");
    });

    it("RELAY_PORT overrides config", () => {
      const filePath = writeConfigFile(tempDir, {
        relay: { port: 8080 },
      });

      process.env["RELAY_PORT"] = "9090";
      const config = loadConfig(filePath);
      expect(config.relay.port).toBe(9090);
    });

    it("RELAY_HOST overrides config", () => {
      process.env["RELAY_HOST"] = "0.0.0.0";
      const config = loadConfig(join(tempDir, "nonexistent.json"));
      expect(config.relay.host).toBe("0.0.0.0");
    });

    it("WS_ENABLED=false disables websocket", () => {
      process.env["WS_ENABLED"] = "false";
      const config = loadConfig(join(tempDir, "nonexistent.json"));
      expect(config.websocket.enabled).toBe(false);
    });

    it("WS_ENABLED=true enables websocket", () => {
      const filePath = writeConfigFile(tempDir, {
        websocket: { enabled: false },
      });

      process.env["WS_ENABLED"] = "true";
      const config = loadConfig(filePath);
      expect(config.websocket.enabled).toBe(true);
    });

    it("WS_ENABLED=1 enables websocket", () => {
      process.env["WS_ENABLED"] = "1";
      const config = loadConfig(join(tempDir, "nonexistent.json"));
      expect(config.websocket.enabled).toBe(true);
    });

    it("ignores invalid RELAY_PORT", () => {
      process.env["RELAY_PORT"] = "not-a-number";
      const config = loadConfig(join(tempDir, "nonexistent.json"));
      expect(config.relay.port).toBe(7780); // default
    });
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  describe("validation", () => {
    it("rejects port below 1024", () => {
      const filePath = writeConfigFile(tempDir, {
        relay: { port: 80 },
      });

      expect(() => loadConfig(filePath)).toThrow();
    });

    it("rejects port above 65535", () => {
      const filePath = writeConfigFile(tempDir, {
        relay: { port: 70000 },
      });

      expect(() => loadConfig(filePath)).toThrow();
    });

    it("rejects negative defaultTtl", () => {
      const filePath = writeConfigFile(tempDir, {
        commands: { defaultTtl: -100 },
      });

      expect(() => loadConfig(filePath)).toThrow();
    });

    it("rejects maxRetries below 0", () => {
      const filePath = writeConfigFile(tempDir, {
        commands: { maxRetries: -1 },
      });

      expect(() => loadConfig(filePath)).toThrow();
    });
  });

  // ─── Priority ───────────────────────────────────────────────────────────

  describe("priority: env > file > defaults", () => {
    it("env vars take precedence over file values", () => {
      const filePath = writeConfigFile(tempDir, {
        relay: { port: 8080 },
        figma: { personalAccessToken: "file-token" },
      });

      process.env["RELAY_PORT"] = "9999";
      process.env["FIGMA_PAT"] = "env-token";

      const config = loadConfig(filePath);
      expect(config.relay.port).toBe(9999);
      expect(config.figma.personalAccessToken).toBe("env-token");
    });

    it("file values take precedence over defaults", () => {
      const filePath = writeConfigFile(tempDir, {
        commands: { maxPerSecond: 50 },
      });

      const config = loadConfig(filePath);
      expect(config.commands.maxPerSecond).toBe(50);
    });
  });
});
