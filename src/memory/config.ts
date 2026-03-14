// ─── Memory Configuration ────────────────────────────────────────────────────

import type { MemoryConfig } from "./types.js";

const SERVICE_URL = "https://aux.frostdesigngroup.com/rex";

export function loadMemoryConfig(): MemoryConfig {
  const disabled = process.env["REX_MEMORY_ENABLED"] === "false" ||
    process.env["REX_MEMORY_ENABLED"] === "0";

  return {
    enabled: !disabled,
    serviceUrl: process.env["REX_MEMORY_URL"] ?? SERVICE_URL,
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
