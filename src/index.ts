#!/usr/bin/env node

/**
 * Rex — Figma MCP Server
 *
 * Entry point. Parses CLI args, loads config, creates the MCP server
 * with embedded relay server, and starts listening on stdio.
 * Handles graceful shutdown on SIGINT/SIGTERM.
 */

import { loadConfig } from "./shared/config.js";
import { createLogger, type LogLevel } from "./shared/logger.js";
import { RexMcpServer } from "./server/mcp-server.js";

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

interface CliArgs {
  configPath?: string;
  logLevel: LogLevel;
  port?: number;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    logLevel: "info",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--config":
      case "-c":
        result.configPath = args[++i];
        break;
      case "--log-level":
      case "-l":
        result.logLevel = args[++i] as LogLevel;
        break;
      case "--port":
      case "-p": {
        const port = parseInt(args[++i] ?? "", 10);
        if (!isNaN(port)) {
          result.port = port;
        }
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--version":
      case "-v":
        // eslint-disable-next-line no-console
        console.error("rex v0.1.0");
        process.exit(0);
        break;
      default:
        // Ignore unknown args
        break;
    }
  }

  // Environment variable overrides
  const envLogLevel = process.env["LOG_LEVEL"];
  if (envLogLevel && ["debug", "info", "warn", "error"].includes(envLogLevel)) {
    result.logLevel = envLogLevel as LogLevel;
  }

  return result;
}

function printUsage(): void {
  const usage = `
Rex — Figma MCP Server

Usage: rex [options]

Options:
  -c, --config <path>     Path to config file (default: rex.config.json)
  -l, --log-level <level> Log level: debug, info, warn, error (default: info)
  -p, --port <port>       Relay server port (default: 7780)
  -h, --help              Show this help message
  -v, --version           Show version

Environment variables:
  FIGMA_PAT               Figma Personal Access Token (required for REST API)
  RELAY_PORT              Relay server port override
  RELAY_HOST              Relay server host override (default: 127.0.0.1)
  LOG_LEVEL               Log level override
  WS_ENABLED              Enable/disable WebSocket (true/false)
`.trim();
  // Write to stderr since stdout is reserved for MCP stdio transport
  process.stderr.write(usage + "\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cliArgs = parseCliArgs();

  // Set port env var before loading config if specified via CLI
  if (cliArgs.port) {
    process.env["RELAY_PORT"] = String(cliArgs.port);
  }

  // Load configuration (merges file + env vars + defaults)
  const config = loadConfig(cliArgs.configPath);

  // Create logger (outputs to stderr, stdout reserved for MCP)
  const logger = createLogger(cliArgs.logLevel, {
    service: "rex",
    version: "0.1.0",
  });

  logger.info("Starting Rex MCP server", {
    relayPort: config.relay.port,
    relayHost: config.relay.host,
    wsEnabled: config.websocket.enabled,
    logLevel: cliArgs.logLevel,
  });

  // Create MCP server with embedded relay
  const server = new RexMcpServer(config, logger);

  // ─── Graceful Shutdown ──────────────────────────────────────────────────

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Received shutdown signal", { signal });

    try {
      await server.stop();
    } catch (err) {
      logger.error("Error during shutdown", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Handle uncaught errors gracefully
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", {
      error: err.message,
      stack: err.stack,
    });
    void shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  // ─── Start ────────────────────────────────────────────────────────────

  try {
    await server.start();
  } catch (err) {
    logger.error("Failed to start Rex", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

// Run
void main();

// ─── Re-exports for library usage ───────────────────────────────────────────

export { type Config, loadConfig } from "./shared/config.js";
export { RexError, connectionError, figmaApiError, validationError, internalError } from "./shared/errors.js";
export { createLogger, type Logger, type LogLevel } from "./shared/logger.js";
export * from "./shared/types.js";
export { RexMcpServer } from "./server/mcp-server.js";
