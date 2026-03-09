/**
 * Structured JSON logger for MCP compatibility.
 *
 * Outputs structured JSON lines to stderr (stdout is reserved for MCP stdio transport).
 * Supports level filtering and contextual fields.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/**
 * Create a structured logger that outputs JSON to stderr.
 *
 * @param minLevel - Minimum log level to output (default: "info")
 * @param baseFields - Fields included in every log entry
 */
export function createLogger(
  minLevel: LogLevel = "info",
  baseFields: Record<string, unknown> = {},
): Logger {
  const minOrder = LOG_LEVEL_ORDER[minLevel];

  function write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LOG_LEVEL_ORDER[level] < minOrder) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...baseFields,
      ...fields,
    };

    // Write to stderr — stdout is reserved for MCP stdio transport
    process.stderr.write(JSON.stringify(entry) + "\n");
  }

  return {
    debug(message: string, fields?: Record<string, unknown>) {
      write("debug", message, fields);
    },
    info(message: string, fields?: Record<string, unknown>) {
      write("info", message, fields);
    },
    warn(message: string, fields?: Record<string, unknown>) {
      write("warn", message, fields);
    },
    error(message: string, fields?: Record<string, unknown>) {
      write("error", message, fields);
    },
    child(childFields: Record<string, unknown>): Logger {
      return createLogger(minLevel, { ...baseFields, ...childFields });
    },
  };
}
