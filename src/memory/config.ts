// ─── Memory Configuration ────────────────────────────────────────────────────

import type { MemoryConfig } from "./types.js";

/**
 * Load memory configuration from environment variables.
 *
 * Two modes:
 * - Service mode: REX_MEMORY_SERVICE_URL is set → HTTP client to remote service
 * - Direct mode: REX_MEMORY_ENABLED=true → direct MongoDB connection
 *
 * Service mode takes precedence if both are set.
 */
export function loadMemoryConfig(): MemoryConfig {
  return {
    enabled:
      process.env["REX_MEMORY_ENABLED"] === "true" ||
      process.env["REX_MEMORY_ENABLED"] === "1" ||
      !!process.env["REX_MEMORY_SERVICE_URL"],
    serviceUrl: process.env["REX_MEMORY_SERVICE_URL"],
    mongoUri:
      process.env["REX_MEMORY_MONGO_URI"] ?? "mongodb://localhost:27017",
    dbName: process.env["REX_MEMORY_DB_NAME"] ?? "rex_memory",
    teamId: process.env["REX_MEMORY_TEAM_ID"] ?? "default",
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
