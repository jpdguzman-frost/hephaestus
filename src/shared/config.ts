import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// ─── Config Schema ───────────────────────────────────────────────────────────

const PaddingArraySchema = z.array(z.number().int().positive()).min(1).max(6);

const RelayConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7780),
  host: z.string().default("127.0.0.1"),
});

const PollingConfigSchema = z.object({
  defaultInterval: z.number().int().positive().default(300),
  burstInterval: z.number().int().positive().default(100),
  idleInterval: z.number().int().positive().default(500),
  idleThreshold: z.number().int().positive().default(10000),
});

const WebSocketConfigSchema = z.object({
  enabled: z.boolean().default(true),
  heartbeatInterval: z.number().int().positive().default(5000),
  heartbeatTimeout: z.number().int().positive().default(3000),
  reconnectBackoff: PaddingArraySchema.default([500, 1000, 2000, 4000, 8000, 15000]),
});

const CommandsConfigSchema = z.object({
  defaultTtl: z.number().int().positive().default(60000),
  maxRetries: z.number().int().min(0).default(1),
  maxConcurrent: z.number().int().positive().default(10),
  maxPerSecond: z.number().int().positive().default(100),
});

const FigmaConfigSchema = z.object({
  personalAccessToken: z.string().optional(),
  preloadFonts: z.array(z.string()).default(["Inter", "Plus Jakarta Sans"]),
});

const ConfigSchema = z.object({
  relay: RelayConfigSchema.default({}),
  polling: PollingConfigSchema.default({}),
  websocket: WebSocketConfigSchema.default({}),
  commands: CommandsConfigSchema.default({}),
  figma: FigmaConfigSchema.default({}),
});

// ─── Exported Types ──────────────────────────────────────────────────────────

export type Config = z.infer<typeof ConfigSchema>;
export type RelayConfig = z.infer<typeof RelayConfigSchema>;
export type PollingConfig = z.infer<typeof PollingConfigSchema>;
export type WebSocketConfig = z.infer<typeof WebSocketConfigSchema>;
export type CommandsConfig = z.infer<typeof CommandsConfigSchema>;
export type FigmaConfig = z.infer<typeof FigmaConfigSchema>;

// ─── Config Loader ───────────────────────────────────────────────────────────

/**
 * Load configuration from file and environment variables.
 *
 * Priority (highest to lowest):
 * 1. Environment variables (FIGMA_PAT, RELAY_PORT, RELAY_HOST, etc.)
 * 2. Config file (rex.config.json)
 * 3. Defaults
 *
 * @param configPath - Path to config file (default: rex.config.json in cwd)
 */
export function loadConfig(configPath?: string): Config {
  const filePath = configPath ?? resolve(process.cwd(), "rex.config.json");

  // Attempt to read config file
  let fileConfig: Record<string, unknown> = {};
  try {
    const raw = readFileSync(filePath, "utf-8");
    fileConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Config file is optional — use defaults
  }

  // Apply environment variable overrides
  const envOverrides = getEnvironmentOverrides();
  const merged = deepMerge(fileConfig, envOverrides);

  // Validate and return
  return ConfigSchema.parse(merged);
}

// ─── Environment Variable Mapping ────────────────────────────────────────────

function getEnvironmentOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  // Figma PAT
  const figmaPat = process.env["FIGMA_PAT"];
  if (figmaPat) {
    overrides["figma"] = { personalAccessToken: figmaPat };
  }

  // Relay port
  const relayPort = process.env["RELAY_PORT"];
  if (relayPort) {
    const port = parseInt(relayPort, 10);
    if (!isNaN(port)) {
      overrides["relay"] = { ...(overrides["relay"] as Record<string, unknown> | undefined), port };
    }
  }

  // Relay host
  const relayHost = process.env["RELAY_HOST"];
  if (relayHost) {
    overrides["relay"] = { ...(overrides["relay"] as Record<string, unknown> | undefined), host: relayHost };
  }

  // Log level (not in config schema, but useful for the logger)
  const logLevel = process.env["LOG_LEVEL"];
  if (logLevel) {
    overrides["logLevel"] = logLevel;
  }

  // WebSocket enable/disable
  const wsEnabled = process.env["WS_ENABLED"];
  if (wsEnabled !== undefined) {
    overrides["websocket"] = {
      ...(overrides["websocket"] as Record<string, unknown> | undefined),
      enabled: wsEnabled === "true" || wsEnabled === "1",
    };
  }

  return overrides;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Deep merge two objects. Source values override target values.
 * Arrays are replaced, not concatenated.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}
