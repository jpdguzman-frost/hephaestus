import { randomBytes } from "node:crypto";
import { ConnectionState } from "../shared/types.js";
import { RexError } from "../shared/errors.js";
import { ErrorCategory } from "../shared/types.js";
import type { Logger } from "../shared/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** User identity from the Figma plugin (via figma.currentUser). */
export interface PluginUser {
  id: string;
  name: string;
  photoUrl?: string | null;
}

/** Plugin connection info stored during an active session. */
export interface PluginSession {
  sessionId: string;
  pluginId: string;
  fileKey: string;
  fileName: string;
  user?: PluginUser;
  capabilities?: PluginCapabilities;
  connectedAt: number;
  lastHeartbeat: number;
  transport: "http" | "websocket";
}

/** Capabilities reported by the plugin during handshake. */
export interface PluginCapabilities {
  maxConcurrent?: number;
  supportedTypes?: string[];
  figmaVersion?: string;
  pluginVersion?: string;
}

/** Connect request payload from the plugin. */
export interface ConnectPayload {
  pluginId: string;
  fileKey: string;
  fileName: string;
  user?: PluginUser;
  authResponse?: string;
  capabilities?: PluginCapabilities;
}

// ─── Connection State Machine ───────────────────────────────────────────────

/**
 * Manages the connection state machine between the relay server and the Figma plugin.
 *
 * States per SPEC.md §4.1:
 *   WAITING   → plugin connects  → POLLING
 *   POLLING   → WS upgrade       → CONNECTED
 *   CONNECTED → WS drops         → DEGRADED
 *   DEGRADED  → WS reconnects    → CONNECTED
 *   any       → plugin stops     → WAITING
 */
export class ConnectionManager {
  private _state: ConnectionState = ConnectionState.WAITING;
  private _session: PluginSession | null = null;
  private readonly authSecret: string;
  private readonly logger: Logger;

  constructor(logger: Logger, authSecret?: string) {
    this.logger = logger.child({ component: "connection" });
    // Generate a per-session 32-byte hex secret
    this.authSecret = authSecret ?? randomBytes(32).toString("hex");
    this.logger.info("Connection manager initialized", {
      authSecretLength: this.authSecret.length,
    });
  }

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /** Current plugin session, if any. */
  get session(): PluginSession | null {
    return this._session;
  }

  /** The auth secret for this server session. */
  get secret(): string {
    return this.authSecret;
  }

  /** Whether a plugin is actively connected (POLLING, CONNECTED, or DEGRADED). */
  get isConnected(): boolean {
    return (
      this._state === ConnectionState.POLLING ||
      this._state === ConnectionState.CONNECTED ||
      this._state === ConnectionState.DEGRADED
    );
  }

  /** Whether WebSocket transport is active. */
  get isWebSocketActive(): boolean {
    return this._state === ConnectionState.CONNECTED;
  }

  /**
   * Validate the X-Auth-Token header.
   * Throws RexError if invalid.
   */
  validateAuth(token: string | undefined): void {
    if (!token || token !== this.authSecret) {
      throw new RexError({
        category: ErrorCategory.INVALID_PARAMS,
        message: "Invalid or missing authentication token",
        retryable: false,
        suggestion: "Ensure the plugin is configured with the correct auth secret.",
      });
    }
  }

  /**
   * Handle plugin connection (POST /connect).
   * Transitions: WAITING → POLLING.
   * Returns session info and config for the plugin.
   */
  connect(payload: ConnectPayload): PluginSession {
    // If already connected, disconnect the old session first
    if (this._session) {
      this.logger.warn("Replacing existing session", {
        oldPluginId: this._session.pluginId,
        newPluginId: payload.pluginId,
      });
      this.disconnect("replaced by new connection");
    }

    const sessionId = "sess_" + randomBytes(12).toString("hex");
    const now = Date.now();

    this._session = {
      sessionId,
      pluginId: payload.pluginId,
      fileKey: payload.fileKey,
      fileName: payload.fileName,
      user: payload.user,
      capabilities: payload.capabilities,
      connectedAt: now,
      lastHeartbeat: now,
      transport: "http",
    };

    this.transition(ConnectionState.POLLING);

    this.logger.info("Plugin connected", {
      sessionId,
      pluginId: payload.pluginId,
      fileKey: payload.fileKey,
      fileName: payload.fileName,
    });

    return this._session;
  }

  /**
   * Handle WebSocket upgrade.
   * Transitions: POLLING → CONNECTED, or DEGRADED → CONNECTED.
   */
  upgradeToWebSocket(sessionId: string): void {
    if (!this._session || this._session.sessionId !== sessionId) {
      throw new RexError({
        category: ErrorCategory.INVALID_PARAMS,
        message: "Invalid session ID for WebSocket upgrade",
        retryable: false,
        suggestion: "Perform HTTP handshake (POST /connect) before upgrading to WebSocket.",
      });
    }

    this._session.transport = "websocket";
    this.transition(ConnectionState.CONNECTED);

    this.logger.info("WebSocket upgrade successful", {
      sessionId,
      pluginId: this._session.pluginId,
    });
  }

  /**
   * Handle WebSocket disconnection.
   * Transitions: CONNECTED → DEGRADED.
   */
  downgradeToPolling(): void {
    if (this._session) {
      this._session.transport = "http";
    }
    if (this._state === ConnectionState.CONNECTED) {
      this.transition(ConnectionState.DEGRADED);
      this.logger.warn("WebSocket dropped, degraded to HTTP polling");
    }
  }

  /**
   * Handle clean plugin disconnect (POST /disconnect).
   * Transitions: any → WAITING.
   */
  disconnect(reason?: string): void {
    const sessionId = this._session?.sessionId;
    this._session = null;
    this.transition(ConnectionState.WAITING);

    this.logger.info("Plugin disconnected", {
      sessionId,
      reason: reason ?? "clean disconnect",
    });
  }

  /**
   * Record a heartbeat from the plugin.
   * Updates lastHeartbeat timestamp.
   */
  recordHeartbeat(): void {
    if (this._session) {
      this._session.lastHeartbeat = Date.now();
    }
  }

  /**
   * Record that a poll was received (implicit heartbeat for HTTP mode).
   */
  recordPoll(): void {
    this.recordHeartbeat();
  }

  /**
   * Validate that a plugin ID matches the current session.
   */
  validatePluginId(pluginId: string | undefined): void {
    if (!this._session) {
      throw new RexError({
        category: ErrorCategory.PLUGIN_NOT_RUNNING,
        message: "No plugin session active",
        retryable: true,
        suggestion: "Start the Figma plugin and wait for it to connect.",
      });
    }
    if (pluginId && pluginId !== this._session.pluginId) {
      throw new RexError({
        category: ErrorCategory.INVALID_PARAMS,
        message: "Plugin ID mismatch",
        retryable: false,
        suggestion: "The plugin ID does not match the active session.",
      });
    }
  }

  /**
   * Get connection info for the health endpoint.
   */
  getConnectionInfo(): Record<string, unknown> {
    if (!this._session) {
      return { state: this._state };
    }
    return {
      state: this._state,
      transport: this._session.transport,
      pluginId: this._session.pluginId,
      fileKey: this._session.fileKey,
      fileName: this._session.fileName,
      user: this._session.user,
      lastHeartbeat: new Date(this._session.lastHeartbeat).toISOString(),
      uptime: Date.now() - this._session.connectedAt,
    };
  }

  /** Transition to a new state with logging. */
  private transition(newState: ConnectionState): void {
    const oldState = this._state;
    this._state = newState;
    this.logger.info("Connection state transition", {
      from: oldState,
      to: newState,
    });
  }
}
