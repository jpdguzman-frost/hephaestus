// ─── Memory Configuration ────────────────────────────────────────────────────

import type { MemoryConfig } from "./types.js";

const DEFAULT_SERVICE_URL = "https://aux.frostdesigngroup.com/rex";

/**
 * Load memory configuration from environment variables.
 *
 * Two modes:
 * - Service mode (default): HTTP client to remote memory service
 * - Direct mode: REX_MEMORY_DIRECT=true → direct MongoDB connection
 *
 * Memory is enabled by default via the hosted service.
 * Set REX_MEMORY_ENABLED=false to disable entirely.
 */
export function loadMemoryConfig(): MemoryConfig {
  const disabled = process.env["REX_MEMORY_ENABLED"] === "false" ||
    process.env["REX_MEMORY_ENABLED"] === "0";

  return {
    enabled: !disabled,
    serviceUrl: process.env["REX_MEMORY_SERVICE_URL"] ?? DEFAULT_SERVICE_URL,
    mongoUri:
      process.env["REX_MEMORY_MONGO_URI"] ?? "mongodb://localhost:27017",
    dbName: process.env["REX_MEMORY_DB_NAME"] ?? "rex",
    maxMemoriesPerSession: parseInt(
      process.env["REX_MEMORY_MAX_PER_SESSION"] ?? "30",
      10,
    ),
    cleanupIntervalHours: parseInt(
      process.env["REX_MEMORY_CLEANUP_HOURS"] ?? "24",
      10,
    ),
  };
}
