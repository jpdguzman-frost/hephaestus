#!/usr/bin/env node
import {
  FigmaClient,
  createLogger,
  getComments,
  loadConfig
} from "./chunk-PRDKVBQ5.js";
import {
  BlendMode,
  CommandStatus,
  CommandType,
  ConnectionState,
  ErrorCategory,
  NodeType,
  RexError,
  connectionError,
  figmaApiError,
  internalError,
  toRexError,
  validationError
} from "./chunk-ZSHX4C3A.js";

// src/index.ts
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// src/server/mcp-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// src/relay/server.ts
import Fastify from "fastify";
import { WebSocketServer, WebSocket } from "ws";

// src/relay/command-queue.ts
import { EventEmitter } from "events";
var RateLimiter = class {
  timestamps = [];
  maxPerSecond;
  constructor(maxPerSecond) {
    this.maxPerSecond = maxPerSecond;
  }
  /** Returns true if the request is allowed. */
  tryAcquire() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 1e3);
    if (this.timestamps.length >= this.maxPerSecond) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
};
var LRUCache = class {
  map = /* @__PURE__ */ new Map();
  maxSize;
  constructor(maxSize) {
    this.maxSize = maxSize;
  }
  get(key) {
    const value = this.map.get(key);
    if (value !== void 0) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== void 0) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, value);
  }
  has(key) {
    return this.map.has(key);
  }
  get size() {
    return this.map.size;
  }
};
var IDEMPOTENCY_CACHE_MAX = 500;
var IDEMPOTENCY_TTL_MS = 5 * 60 * 1e3;
var CommandQueue = class extends EventEmitter {
  queue = /* @__PURE__ */ new Map();
  idempotencyCache = new LRUCache(IDEMPOTENCY_CACHE_MAX);
  rateLimiter;
  config;
  logger;
  ttlTimer = null;
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: "command-queue" });
    this.rateLimiter = new RateLimiter(config.maxPerSecond);
    this.ttlTimer = setInterval(() => this.enforceTTL(), 1e3);
  }
  /**
   * Enqueue a command for delivery to the plugin.
   * Returns a promise that resolves when the command completes.
   */
  enqueue(command) {
    if (!this.rateLimiter.tryAcquire()) {
      throw new RexError({
        category: "INTERNAL_ERROR" /* INTERNAL_ERROR */,
        message: "Rate limit exceeded: max " + this.config.maxPerSecond + " commands/sec",
        retryable: true,
        commandId: command.id,
        suggestion: "Wait briefly and retry. The command queue is processing at capacity."
      });
    }
    const pendingCount = this.getPending().length + this.getInFlight().length;
    if (pendingCount >= this.config.maxConcurrent) {
      throw new RexError({
        category: "INTERNAL_ERROR" /* INTERNAL_ERROR */,
        message: "Max concurrent commands reached: " + this.config.maxConcurrent,
        retryable: true,
        commandId: command.id,
        suggestion: "Wait for pending commands to complete before sending more."
      });
    }
    if (command.idempotencyKey) {
      const cached = this.idempotencyCache.get(command.idempotencyKey);
      if (cached && Date.now() - cached.createdAt < IDEMPOTENCY_TTL_MS) {
        this.logger.debug("Idempotency cache hit", {
          commandId: command.id,
          idempotencyKey: command.idempotencyKey
        });
        return Promise.resolve(cached.result);
      }
    }
    const promise = new Promise((resolve, reject) => {
      const queued = {
        command,
        status: "QUEUED" /* QUEUED */,
        retryCount: 0,
        createdAt: Date.now(),
        resolve,
        reject
      };
      this.queue.set(command.id, queued);
      this.emit("enqueued", command);
      this.logger.debug("Command enqueued", {
        commandId: command.id,
        type: command.type
      });
    });
    promise.catch(() => {
    });
    return promise;
  }
  /** Mark a command as sent to the plugin. */
  markSent(id) {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("markSent: command not found", { commandId: id });
      return;
    }
    entry.status = "SENT" /* SENT */;
    entry.sentAt = Date.now();
    this.emit("sent", id);
    this.logger.debug("Command sent", { commandId: id });
  }
  /** Mark a command as acknowledged by the plugin. */
  markAcknowledged(id) {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("markAcknowledged: command not found", { commandId: id });
      return;
    }
    entry.status = "ACKNOWLEDGED" /* ACKNOWLEDGED */;
    entry.acknowledgedAt = Date.now();
    this.emit("acknowledged", id);
    this.logger.debug("Command acknowledged", { commandId: id });
  }
  /** Complete a command with a result. */
  complete(id, result) {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("complete: command not found", { commandId: id });
      return;
    }
    entry.status = "COMPLETED" /* COMPLETED */;
    entry.completedAt = Date.now();
    entry.result = result;
    if (entry.command.idempotencyKey) {
      this.idempotencyCache.set(entry.command.idempotencyKey, {
        result,
        createdAt: Date.now()
      });
    }
    this.emit("completed", id, result);
    this.logger.debug("Command completed", {
      commandId: id,
      status: result.status,
      duration: result.duration
    });
    entry.resolve?.(result);
    this.queue.delete(id);
  }
  /** Mark a command as timed out. May trigger retry. */
  timeout(id) {
    const entry = this.queue.get(id);
    if (!entry) return;
    entry.status = "TIMEOUT" /* TIMEOUT */;
    this.emit("timeout", id);
    this.logger.warn("Command timed out", {
      commandId: id,
      type: entry.command.type,
      retryCount: entry.retryCount
    });
    if (entry.retryCount < this.config.maxRetries) {
      this.retry(id);
    } else {
      this.fail(id, new RexError({
        category: "COMMAND_TIMEOUT" /* COMMAND_TIMEOUT */,
        message: "Command timed out after " + entry.command.ttl + "ms (retries exhausted)",
        retryable: false,
        commandId: id,
        suggestion: "The Figma plugin may be unresponsive. Check the plugin status."
      }));
    }
  }
  /** Retry a command. Resets status to QUEUED with incremented retry count. */
  retry(id) {
    const entry = this.queue.get(id);
    if (!entry) {
      this.logger.warn("retry: command not found", { commandId: id });
      return;
    }
    entry.retryCount++;
    entry.status = "RETRY" /* RETRY */;
    entry.sentAt = void 0;
    entry.acknowledgedAt = void 0;
    this.emit("retry", id, entry.retryCount);
    this.logger.info("Command retrying", {
      commandId: id,
      attempt: entry.retryCount
    });
    const backoffMs = entry.retryCount === 1 ? 0 : 1e3;
    setTimeout(() => {
      const current = this.queue.get(id);
      if (current && current.status === "RETRY" /* RETRY */) {
        current.status = "QUEUED" /* QUEUED */;
        current.createdAt = Date.now();
      }
    }, backoffMs);
  }
  /** Permanently fail a command. */
  fail(id, error) {
    const entry = this.queue.get(id);
    if (!entry) return;
    entry.status = "FAILED" /* FAILED */;
    entry.completedAt = Date.now();
    this.emit("failed", id, error);
    this.logger.error("Command failed", {
      commandId: id,
      category: error.category,
      message: error.message
    });
    entry.reject?.(error);
    this.queue.delete(id);
  }
  /** Get all commands in QUEUED state (ready to be sent). */
  getPending() {
    const pending = [];
    for (const entry of this.queue.values()) {
      if (entry.status === "QUEUED" /* QUEUED */) {
        pending.push(entry);
      }
    }
    return pending;
  }
  /** Get all commands in SENT or ACKNOWLEDGED state (waiting for result). */
  getInFlight() {
    const inFlight = [];
    for (const entry of this.queue.values()) {
      if (entry.status === "SENT" /* SENT */ || entry.status === "ACKNOWLEDGED" /* ACKNOWLEDGED */) {
        inFlight.push(entry);
      }
    }
    return inFlight;
  }
  /** Get a specific queued command by ID. */
  get(id) {
    return this.queue.get(id);
  }
  /** Get queue statistics for health reporting. */
  getStats() {
    let pending = 0;
    let inFlight = 0;
    for (const entry of this.queue.values()) {
      if (entry.status === "QUEUED" /* QUEUED */) pending++;
      if (entry.status === "SENT" /* SENT */ || entry.status === "ACKNOWLEDGED" /* ACKNOWLEDGED */) inFlight++;
    }
    return { pending, inFlight, total: this.queue.size };
  }
  /** Enforce TTL on all commands — expire stale ones, timeout in-flight ones. */
  enforceTTL() {
    const now = Date.now();
    for (const [id, entry] of this.queue) {
      const age = now - entry.createdAt;
      const ttl = entry.command.ttl || this.config.defaultTtl;
      if (entry.status === "QUEUED" /* QUEUED */ && age > ttl) {
        entry.status = "EXPIRED" /* EXPIRED */;
        this.emit("expired", id);
        this.logger.warn("Command expired before send", {
          commandId: id,
          type: entry.command.type,
          age
        });
        entry.reject?.(new RexError({
          category: "COMMAND_TIMEOUT" /* COMMAND_TIMEOUT */,
          message: "Command expired before delivery (TTL: " + ttl + "ms)",
          retryable: false,
          commandId: id
        }));
        this.queue.delete(id);
      } else if ((entry.status === "SENT" /* SENT */ || entry.status === "ACKNOWLEDGED" /* ACKNOWLEDGED */) && entry.sentAt && now - entry.sentAt > ttl) {
        this.timeout(id);
      }
    }
  }
  /** Clean up timers. Call when shutting down. */
  destroy() {
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }
    for (const [id, entry] of this.queue) {
      entry.reject?.(new RexError({
        category: "CONNECTION_LOST" /* CONNECTION_LOST */,
        message: "Server shutting down",
        retryable: false,
        commandId: id
      }));
    }
    this.queue.clear();
    this.removeAllListeners();
  }
};

// src/relay/connection.ts
import { randomBytes } from "crypto";
var ConnectionManager = class {
  _state = "WAITING" /* WAITING */;
  _session = null;
  authSecret;
  logger;
  constructor(logger, authSecret) {
    this.logger = logger.child({ component: "connection" });
    this.authSecret = authSecret ?? randomBytes(32).toString("hex");
    this.logger.info("Connection manager initialized", {
      authSecretLength: this.authSecret.length
    });
  }
  /** Current connection state. */
  get state() {
    return this._state;
  }
  /** Current plugin session, if any. */
  get session() {
    return this._session;
  }
  /** The auth secret for this server session. */
  get secret() {
    return this.authSecret;
  }
  /** Whether a plugin is actively connected (POLLING, CONNECTED, or DEGRADED). */
  get isConnected() {
    return this._state === "POLLING" /* POLLING */ || this._state === "CONNECTED" /* CONNECTED */ || this._state === "DEGRADED" /* DEGRADED */;
  }
  /** Whether WebSocket transport is active. */
  get isWebSocketActive() {
    return this._state === "CONNECTED" /* CONNECTED */;
  }
  /**
   * Validate the X-Auth-Token header.
   * Throws RexError if invalid.
   */
  validateAuth(token) {
    if (!token || token !== this.authSecret) {
      throw new RexError({
        category: "INVALID_PARAMS" /* INVALID_PARAMS */,
        message: "Invalid or missing authentication token",
        retryable: false,
        suggestion: "Ensure the plugin is configured with the correct auth secret."
      });
    }
  }
  /**
   * Handle plugin connection (POST /connect).
   * Transitions: WAITING → POLLING.
   * Returns session info and config for the plugin.
   */
  connect(payload) {
    if (this._session) {
      this.logger.warn("Replacing existing session", {
        oldPluginId: this._session.pluginId,
        newPluginId: payload.pluginId
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
      pageId: payload.pageId,
      pageName: payload.pageName,
      user: payload.user,
      capabilities: payload.capabilities,
      connectedAt: now,
      lastHeartbeat: now,
      transport: "http"
    };
    this.transition("POLLING" /* POLLING */);
    this.logger.info("Plugin connected", {
      sessionId,
      pluginId: payload.pluginId,
      fileKey: payload.fileKey,
      fileName: payload.fileName
    });
    return this._session;
  }
  /**
   * Handle WebSocket upgrade.
   * Transitions: POLLING → CONNECTED, or DEGRADED → CONNECTED.
   */
  upgradeToWebSocket(sessionId) {
    if (!this._session || this._session.sessionId !== sessionId) {
      throw new RexError({
        category: "INVALID_PARAMS" /* INVALID_PARAMS */,
        message: "Invalid session ID for WebSocket upgrade",
        retryable: false,
        suggestion: "Perform HTTP handshake (POST /connect) before upgrading to WebSocket."
      });
    }
    this._session.transport = "websocket";
    this.transition("CONNECTED" /* CONNECTED */);
    this.logger.info("WebSocket upgrade successful", {
      sessionId,
      pluginId: this._session.pluginId
    });
  }
  /**
   * Handle WebSocket disconnection.
   * Transitions: CONNECTED → DEGRADED.
   */
  downgradeToPolling() {
    if (this._session) {
      this._session.transport = "http";
    }
    if (this._state === "CONNECTED" /* CONNECTED */) {
      this.transition("DEGRADED" /* DEGRADED */);
      this.logger.warn("WebSocket dropped, degraded to HTTP polling");
    }
  }
  /**
   * Handle clean plugin disconnect (POST /disconnect).
   * Transitions: any → WAITING.
   */
  disconnect(reason) {
    const sessionId = this._session?.sessionId;
    this._session = null;
    this.transition("WAITING" /* WAITING */);
    this.logger.info("Plugin disconnected", {
      sessionId,
      reason: reason ?? "clean disconnect"
    });
  }
  /**
   * Record a heartbeat from the plugin.
   * Updates lastHeartbeat timestamp.
   */
  recordHeartbeat() {
    if (this._session) {
      this._session.lastHeartbeat = Date.now();
    }
  }
  /**
   * Record that a poll was received (implicit heartbeat for HTTP mode).
   */
  recordPoll() {
    this.recordHeartbeat();
  }
  /**
   * Validate that a plugin ID matches the current session.
   */
  validatePluginId(pluginId) {
    if (!this._session) {
      throw new RexError({
        category: "PLUGIN_NOT_RUNNING" /* PLUGIN_NOT_RUNNING */,
        message: "No plugin session active",
        retryable: true,
        suggestion: "Start the Figma plugin and wait for it to connect."
      });
    }
    if (pluginId && pluginId !== this._session.pluginId) {
      throw new RexError({
        category: "INVALID_PARAMS" /* INVALID_PARAMS */,
        message: "Plugin ID mismatch",
        retryable: false,
        suggestion: "The plugin ID does not match the active session."
      });
    }
  }
  /**
   * Get connection info for the health endpoint.
   */
  getConnectionInfo() {
    if (!this._session) {
      return { state: this._state };
    }
    return {
      state: this._state,
      transport: this._session.transport,
      pluginId: this._session.pluginId,
      fileKey: this._session.fileKey,
      fileName: this._session.fileName,
      pageId: this._session.pageId,
      pageName: this._session.pageName,
      user: this._session.user,
      lastHeartbeat: new Date(this._session.lastHeartbeat).toISOString(),
      uptime: Date.now() - this._session.connectedAt
    };
  }
  /** Transition to a new state with logging. */
  transition(newState) {
    const oldState = this._state;
    this._state = newState;
    this.logger.info("Connection state transition", {
      from: oldState,
      to: newState
    });
  }
};

// src/relay/heartbeat.ts
var MAX_LATENCY_SAMPLES = 1e3;
var MAX_MISSED_POLLS = 10;
var MAX_MISSED_PONGS = 2;
var HeartbeatMonitor = class {
  logger;
  wsConfig;
  connection;
  // Poll tracking
  lastPollTime = 0;
  missedPolls = 0;
  pollCheckTimer = null;
  // WebSocket pong tracking
  awaitingPong = false;
  missedPongs = 0;
  pingTimer = null;
  pongTimeout = null;
  pingSender = null;
  heartbeatPaused = false;
  // Metrics
  metrics = {
    commands: {
      total: 0,
      success: 0,
      failed: 0,
      timeout: 0,
      retried: 0
    },
    latency: {
      avg: 0,
      p95: 0,
      samples: []
    },
    connection: {
      uptime: 0,
      reconnects: 0
    },
    transport: {
      httpPolls: 0,
      wsMessages: 0
    }
  };
  // Callbacks
  onPollTimeout = null;
  onPongTimeout = null;
  constructor(connection, wsConfig, logger) {
    this.connection = connection;
    this.wsConfig = wsConfig;
    this.logger = logger.child({ component: "heartbeat" });
  }
  /**
   * Start monitoring HTTP polling health.
   * Checks at the expected poll interval whether we have received a poll recently.
   *
   * @param expectedInterval - Expected poll interval in ms (default 300ms from config)
   * @param onTimeout - Callback when too many polls are missed
   */
  startPollMonitoring(_expectedInterval, onTimeout) {
    if (this.pollCheckTimer) {
      clearInterval(this.pollCheckTimer);
      this.pollCheckTimer = null;
    }
    this.onPollTimeout = onTimeout;
    this.lastPollTime = Date.now();
    this.missedPolls = 0;
    const checkInterval = 5e3;
    this.pollCheckTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastPollTime;
      if (elapsed > 1e4) {
        this.missedPolls++;
        this.logger.warn("Missed poll detected", {
          missedPolls: this.missedPolls,
          maxMissed: MAX_MISSED_POLLS,
          elapsed
        });
        if (this.missedPolls >= MAX_MISSED_POLLS) {
          this.logger.error("Plugin disconnected: too many missed polls", {
            missedPolls: this.missedPolls
          });
          this.onPollTimeout?.();
        }
      } else {
        this.missedPolls = 0;
      }
    }, checkInterval);
  }
  /** Record that a poll was received. Resets missed poll counter. */
  recordPoll() {
    this.lastPollTime = Date.now();
    this.missedPolls = 0;
    this.metrics.transport.httpPolls++;
    this.connection.recordPoll();
  }
  /**
   * Start WebSocket heartbeat (ping/pong).
   *
   * @param sendPing - Function to send a ping message over the WebSocket
   * @param onTimeout - Callback when too many pongs are missed
   */
  startWsHeartbeat(sendPing, onTimeout) {
    this.pingSender = sendPing;
    this.onPongTimeout = onTimeout;
    this.missedPongs = 0;
    this.awaitingPong = false;
    this.pingTimer = setInterval(() => {
      if (this.heartbeatPaused) return;
      if (this.awaitingPong) {
        this.missedPongs++;
        this.logger.warn("Missed WebSocket pong", {
          missedPongs: this.missedPongs,
          maxMissed: MAX_MISSED_PONGS
        });
        if (this.missedPongs >= MAX_MISSED_PONGS) {
          this.logger.error("WebSocket connection dead: too many missed pongs");
          this.stopWsHeartbeat();
          this.onPongTimeout?.();
          return;
        }
      }
      this.awaitingPong = true;
      this.pingSender?.();
      this.pongTimeout = setTimeout(() => {
      }, this.wsConfig.heartbeatTimeout);
    }, this.wsConfig.heartbeatInterval);
  }
  /** Record that a pong was received. Resets missed pong counter. */
  recordPong() {
    this.awaitingPong = false;
    this.missedPongs = 0;
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    this.connection.recordHeartbeat();
  }
  /**
   * Pause WS heartbeat pings while the plugin is executing a command.
   * The plugin is single-threaded and cannot respond to pings during figma.* calls.
   */
  pauseWsHeartbeat() {
    this.heartbeatPaused = true;
  }
  /**
   * Resume WS heartbeat pings after command execution completes.
   * Resets missed pong counter since the pause was intentional.
   */
  resumeWsHeartbeat() {
    this.heartbeatPaused = false;
    this.missedPongs = 0;
    this.awaitingPong = false;
  }
  /** Record a WebSocket message. */
  recordWsMessage() {
    this.metrics.transport.wsMessages++;
  }
  /** Stop WebSocket heartbeat monitoring. */
  stopWsHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    this.awaitingPong = false;
    this.missedPongs = 0;
    this.pingSender = null;
  }
  // ─── Command Metrics ────────────────────────────────────────────────────
  /** Record a command being processed. */
  recordCommandTotal() {
    this.metrics.commands.total++;
  }
  /** Record a successful command with its latency. */
  recordCommandSuccess(latencyMs) {
    this.metrics.commands.success++;
    this.addLatencySample(latencyMs);
  }
  /** Record a failed command. */
  recordCommandFailed() {
    this.metrics.commands.failed++;
  }
  /** Record a timed-out command. */
  recordCommandTimeout() {
    this.metrics.commands.timeout++;
  }
  /** Record a retried command. */
  recordCommandRetried() {
    this.metrics.commands.retried++;
  }
  /** Record a WebSocket reconnection. */
  recordReconnect() {
    this.metrics.connection.reconnects++;
  }
  /** Add a latency sample and recalculate stats. */
  addLatencySample(ms) {
    const samples = this.metrics.latency.samples;
    samples.push(ms);
    if (samples.length > MAX_LATENCY_SAMPLES) {
      samples.shift();
    }
    const sum = samples.reduce((a, b) => a + b, 0);
    this.metrics.latency.avg = Math.round(sum / samples.length);
    const sorted = [...samples].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    this.metrics.latency.p95 = sorted[p95Index] ?? 0;
  }
  /** Get current health metrics snapshot. */
  getMetrics() {
    if (this.connection.session) {
      this.metrics.connection.uptime = Date.now() - this.connection.session.connectedAt;
    }
    return { ...this.metrics };
  }
  /** Get a summary suitable for the /health endpoint. */
  getHealthSummary() {
    const m = this.getMetrics();
    return {
      pending: 0,
      // Will be filled by server from queue stats
      inFlight: 0,
      completedTotal: m.commands.success,
      failedTotal: m.commands.failed,
      timeoutTotal: m.commands.timeout,
      averageLatency: m.latency.avg,
      p95Latency: m.latency.p95
    };
  }
  /** Clean up all timers. */
  destroy() {
    this.stopWsHeartbeat();
    if (this.pollCheckTimer) {
      clearInterval(this.pollCheckTimer);
      this.pollCheckTimer = null;
    }
  }
};

// src/relay/comment-watcher.ts
var MENTION_PATTERN = /@rex\b/i;
var POLL_INTERVAL_MS = 1e4;
var CommentWatcher = class {
  config;
  logger;
  onMention;
  client = null;
  fileKey = null;
  processedIds = /* @__PURE__ */ new Set();
  timer = null;
  running = false;
  constructor(config, logger, onMention) {
    this.config = config;
    this.logger = logger.child({ component: "comment-watcher" });
    this.onMention = onMention;
  }
  /**
   * Start watching for @rex comments on a file.
   * Call this after plugin connects and provides a file key.
   */
  start(fileKey) {
    if (this.running) this.stop();
    if (!this.config.figma.personalAccessToken) {
      this.logger.debug("Comment watcher disabled: no FIGMA_PAT configured");
      return;
    }
    this.fileKey = fileKey;
    this.client = new FigmaClient({ config: this.config, logger: this.logger });
    this.running = true;
    this.seedAndStart();
  }
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.client = null;
    this.fileKey = null;
  }
  async seedAndStart() {
    try {
      const response = await getComments(this.client, this.fileKey);
      for (const comment of response.comments) {
        this.processedIds.add(comment.id);
      }
      this.logger.info("Comment watcher started", {
        fileKey: this.fileKey,
        existingComments: response.comments.length
      });
    } catch (err) {
      this.logger.warn("Failed to seed comment watcher, starting fresh", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error("Comment poll error", {
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }, POLL_INTERVAL_MS);
  }
  async poll() {
    if (!this.running || !this.client || !this.fileKey) return;
    try {
      const response = await getComments(this.client, this.fileKey);
      for (const comment of response.comments) {
        if (this.processedIds.has(comment.id)) continue;
        this.processedIds.add(comment.id);
        if (!MENTION_PATTERN.test(comment.message)) continue;
        const instruction = comment.message.replace(MENTION_PATTERN, "").trim();
        if (!instruction) continue;
        this.logger.info("@rex mention detected", {
          commentId: comment.id,
          user: comment.user.handle,
          instruction: instruction.substring(0, 100)
        });
        const nodeId = this.extractNodeId(comment);
        const selection = [];
        if (nodeId) {
          selection.push({ id: nodeId, name: "commented node", type: "UNKNOWN" });
        }
        this.onMention({
          id: "comment_" + comment.id,
          message: `[Comment by ${comment.user.handle}] ${instruction}`,
          selection,
          timestamp: new Date(comment.created_at).getTime(),
          commentId: comment.id,
          user: comment.user.handle,
          nodeId: nodeId || void 0
        });
      }
    } catch (err) {
      this.logger.debug("Comment poll failed", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  extractNodeId(comment) {
    if (!comment.client_meta) return null;
    const meta = comment.client_meta;
    if (typeof meta.node_id === "string") return meta.node_id;
    return null;
  }
};

// src/memory/client.ts
var MemoryServiceClient = class {
  baseUrl;
  logger;
  _connected = false;
  _connecting = null;
  constructor(baseUrl, logger) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.logger = logger.child({ component: "memory-client" });
  }
  get isConnected() {
    return this._connected;
  }
  get url() {
    return this.baseUrl;
  }
  async connect() {
    try {
      const resp = await fetch(this.baseUrl + "/api/health");
      if (resp.ok) {
        this._connected = true;
        this.logger.info("Memory service connected", { url: this.baseUrl });
      } else {
        this.logger.warn("Memory service health check failed", {
          status: resp.status
        });
      }
    } catch (err) {
      this.logger.warn("Memory service unreachable", {
        url: this.baseUrl,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  /**
   * Ensure the client is connected, retrying if the initial connect failed.
   * Called lazily before each memory operation.
   */
  async ensureConnected() {
    if (this._connected) return true;
    if (this._connecting) {
      await this._connecting;
      return this._connected;
    }
    this._connecting = this.connect();
    try {
      await this._connecting;
    } finally {
      this._connecting = null;
    }
    return this._connected;
  }
  async disconnect() {
    this._connected = false;
  }
  async remember(input) {
    const resp = await this.post("/api/memories", input);
    return normalizeEntry(resp.memory);
  }
  async recall(input) {
    const resp = await this.post("/api/memories/recall", input);
    return normalizeEntries(resp.memories);
  }
  async forget(context, id, query, scope) {
    const resp = await this.post("/api/memories/forget", {
      id,
      query,
      scope,
      context
    });
    return resp.deleted ?? 0;
  }
  async list(context, scope, category, limit, includeSuperseded) {
    const resp = await this.post("/api/memories/list", {
      context,
      scope,
      category,
      limit,
      includeSuperseded
    });
    return normalizeEntries(resp.memories);
  }
  async loadForSession(context, maxEntries) {
    const resp = await this.post("/api/memories/session", {
      context,
      maxEntries
    });
    return normalizeEntries(resp.memories);
  }
  async cleanup(options) {
    return this.post("/api/memories/cleanup", {
      ...options
    });
  }
  async applyDecay() {
    const resp = await this.post("/api/memories/decay", {});
    return resp.modified ?? 0;
  }
  // ─── Chat History ─────────────────────────────────────────────────────────
  /**
   * Persist a chat message to the memory service. Fire-and-forget — caller
   * should not await this and should catch errors.
   */
  async saveChatMessage(entry, context) {
    const connected = await this.ensureConnected();
    if (!connected) return;
    const truncatedMessage = entry.message.length > 2e3 ? entry.message.slice(0, 2e3) : entry.message;
    await this.remember({
      scope: "file",
      category: "context",
      content: JSON.stringify({ ...entry, message: truncatedMessage }),
      tags: ["chat-history", entry.role],
      source: "explicit",
      context
    });
  }
  /**
   * Retrieve chat history for a file, sorted by timestamp ascending.
   */
  async getChatHistory(context, limit = 20) {
    const connected = await this.ensureConnected();
    if (!connected) return [];
    const entries = await this.recall({
      query: "chat-history",
      scope: "file",
      category: "context",
      context,
      limit: limit * 2
      // Over-fetch to account for non-chat entries
    });
    const chatEntries = [];
    for (const entry of entries) {
      if (!entry.tags?.includes("chat-history")) continue;
      try {
        const parsed = JSON.parse(entry.content);
        chatEntries.push(parsed);
      } catch {
      }
    }
    chatEntries.sort((a, b) => a.timestamp - b.timestamp);
    return chatEntries.slice(-limit);
  }
  // ─── Chat Sessions ──────────────────────────────────────────────────────────
  /** Create a new chat session. */
  async createSession(session, context) {
    const connected = await this.ensureConnected();
    if (!connected) return;
    await this.remember({
      scope: "file",
      category: "context",
      content: JSON.stringify(session),
      tags: ["chat-session", session.sessionId],
      source: "explicit",
      context
    });
  }
  /** List recent chat sessions for the current file, sorted by lastMessageAt descending. */
  async listSessions(context, limit = 20) {
    const connected = await this.ensureConnected();
    if (!connected) return [];
    const entries = await this.recall({
      query: "chat-session",
      scope: "file",
      category: "context",
      context,
      limit: limit * 5
    });
    const sessionMap = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      if (!entry.tags?.includes("chat-session")) continue;
      try {
        const parsed = JSON.parse(entry.content);
        const existing = sessionMap.get(parsed.sessionId);
        if (!existing || parsed.lastMessageAt > existing.lastMessageAt) {
          sessionMap.set(parsed.sessionId, parsed);
        }
      } catch {
      }
    }
    const sessions = Array.from(sessionMap.values());
    sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return sessions.slice(0, limit);
  }
  /** Update a session's metadata (name, summary, messageCount, lastMessageAt). */
  async updateSession(session, context) {
    const connected = await this.ensureConnected();
    if (!connected) return;
    await this.remember({
      scope: "file",
      category: "context",
      content: JSON.stringify(session),
      tags: ["chat-session", session.sessionId],
      source: "explicit",
      context
    });
  }
  /** Get messages for a specific session, sorted by timestamp ascending. */
  async getSessionMessages(sessionId, context, limit = 50) {
    const connected = await this.ensureConnected();
    if (!connected) return [];
    const entries = await this.recall({
      query: sessionId,
      scope: "file",
      category: "context",
      context,
      limit: limit * 3
    });
    const messages = [];
    for (const entry of entries) {
      if (!entry.tags?.includes("chat-message") || !entry.tags?.includes(sessionId)) continue;
      try {
        const parsed = JSON.parse(entry.content);
        messages.push(parsed);
      } catch {
      }
    }
    messages.sort((a, b) => a.timestamp - b.timestamp);
    return messages.slice(-limit);
  }
  // ─── HTTP Helpers ──────────────────────────────────────────────────────────
  async post(path2, body) {
    const url = this.baseUrl + path2;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Memory service ${resp.status}: ${text}`);
      }
      return await resp.json();
    } catch (err) {
      this.logger.error("Memory service request failed", {
        path: path2,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }
};
function normalizeEntry(raw) {
  if (raw.id && !raw._id) {
    raw._id = raw.id;
  }
  return raw;
}
function normalizeEntries(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(normalizeEntry);
}

// src/memory/config.ts
var SERVICE_URL = "https://aux.frostdesigngroup.com/rex";
function loadMemoryConfig() {
  const disabled = process.env["REX_MEMORY_ENABLED"] === "false" || process.env["REX_MEMORY_ENABLED"] === "0";
  return {
    enabled: !disabled,
    serviceUrl: process.env["REX_MEMORY_URL"] ?? SERVICE_URL,
    maxMemoriesPerSession: parseInt(
      process.env["REX_MEMORY_MAX_PER_SESSION"] ?? "30",
      10
    ),
    cleanupIntervalHours: parseInt(
      process.env["REX_MEMORY_CLEANUP_HOURS"] ?? "24",
      10
    )
  };
}

// src/relay/server.ts
var VERSION = "0.3.0";
var RelayServer = class {
  config;
  logger;
  queue;
  connection;
  heartbeat;
  fastify = null;
  wss = null;
  wsClient = null;
  startTime = 0;
  pollingState = { lastCommandTime: 0 };
  _boundPort = 0;
  /** The port the relay actually bound to (may differ from config if port was in use). */
  get boundPort() {
    return this._boundPort;
  }
  // Chat message queue (plugin → MCP server) — bounded FIFO queue
  CHAT_INBOX_MAX = 50;
  chatInbox = [];
  chatWaiters = [];
  // Chat response queue (MCP server → plugin) — bounded
  CHAT_OUTBOX_MAX = 50;
  chatOutbox = [];
  // Comment watcher for @rex mentions
  commentWatcher;
  // Memory system
  memoryConfig;
  _memoryStore = null;
  // Stream accumulator for persisting complete streaming responses
  streamAccumulator = /* @__PURE__ */ new Map();
  // Active chat session for session-based conversations
  _activeChatSession = null;
  /** The active chat session ID (null if no session selected). */
  get activeChatSessionId() {
    return this._activeChatSession?.sessionId ?? null;
  }
  /** The active chat session name. */
  get activeChatSessionName() {
    return this._activeChatSession?.name ?? null;
  }
  /** Update the active session's name (called when Claude names a session). */
  updateChatSessionName(name) {
    if (!this._activeChatSession) return;
    this._activeChatSession.name = name;
    this.logger.info("Chat session renamed", { sessionId: this._activeChatSession.sessionId, name });
    if (this._memoryStore && this.connection.session) {
      const pluginSession = this.connection.session;
      const ctx = {
        fileKey: pluginSession.fileKey,
        fileName: pluginSession.fileName,
        userId: pluginSession.user?.id,
        userName: pluginSession.user?.name
      };
      this._memoryStore.updateSession(this._activeChatSession, ctx).catch((err) => {
        this.logger.warn("Failed to persist session name", {
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }
  }
  /** Access the memory store (null if disabled/not connected). */
  get memoryStore() {
    return this._memoryStore;
  }
  constructor(config, logger) {
    this.config = config;
    this.logger = logger.child({ component: "relay-server" });
    this.queue = new CommandQueue(config.commands, this.logger);
    this.connection = new ConnectionManager(this.logger);
    this.heartbeat = new HeartbeatMonitor(
      this.connection,
      config.websocket,
      this.logger
    );
    this.commentWatcher = new CommentWatcher(config, this.logger, (msg) => {
      this.enqueueChatMessage(msg);
    });
    this.memoryConfig = loadMemoryConfig();
    this.wireQueueEvents();
  }
  /** Wire command queue events to heartbeat metrics. */
  wireQueueEvents() {
    this.queue.on("enqueued", () => {
      this.heartbeat.recordCommandTotal();
    });
    this.queue.on("completed", (_id, result) => {
      if (result.status === "success") {
        this.heartbeat.recordCommandSuccess(result.duration);
      } else {
        this.heartbeat.recordCommandFailed();
      }
    });
    this.queue.on("timeout", () => {
      this.heartbeat.recordCommandTimeout();
    });
    this.queue.on("retry", () => {
      this.heartbeat.recordCommandRetried();
    });
    this.queue.on("failed", () => {
      this.heartbeat.recordCommandFailed();
    });
  }
  /**
   * Start the relay server.
   * Binds HTTP + WebSocket to the configured host:port.
   */
  async start() {
    this.startTime = Date.now();
    const { host } = this.config.relay;
    this.fastify = Fastify({
      logger: false,
      // We use our own logger
      bodyLimit: 10 * 1024 * 1024
      // 10MB — screenshots and deep node trees can be large
    });
    this.fastify.addHook("onRequest", async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, X-Plugin-Id, X-Plugin-File, X-Plugin-Page, X-Session-Id, X-Auth-Token");
      if (request.method === "OPTIONS") {
        reply.status(204).send();
      }
    });
    this.registerRoutes(this.fastify);
    const port = await this.bindToAvailablePort(host);
    if (this.config.websocket.enabled) {
      const httpServer = this.fastify.server;
      this.wss = new WebSocketServer({ noServer: true });
      httpServer.on("upgrade", (request, socket, head) => {
        this.handleUpgrade(request, socket, head);
      });
      this.logger.info("WebSocket server ready on upgrade path /ws");
    }
    if (this.memoryConfig.enabled) {
      this._memoryStore = new MemoryServiceClient(
        this.memoryConfig.serviceUrl,
        this.logger
      );
      this._memoryStore.connect().catch((err) => {
        this.logger.warn("Memory service connection failed (non-fatal)", {
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }
    this.logger.info("Relay server started", { host, port });
  }
  /**
   * Try each port in the configured range until one binds successfully.
   * If port is 0 (test mode), let the OS assign a random port.
   * Returns the port that was bound.
   */
  async bindToAvailablePort(host) {
    const { port: preferredPort, portRangeStart, portRangeEnd } = this.config.relay;
    if (preferredPort === 0) {
      await this.fastify.listen({ host, port: 0 });
      const addr = this.fastify.server.address();
      this._boundPort = typeof addr === "object" && addr ? addr.port : 0;
      return this._boundPort;
    }
    const start = portRangeStart ?? preferredPort;
    const end = portRangeEnd ?? preferredPort;
    for (let port = start; port <= end; port++) {
      try {
        await this.fastify.listen({ host, port });
        this._boundPort = port;
        return port;
      } catch (err) {
        const code = err.code;
        if (code === "EADDRINUSE") {
          this.logger.debug("Port in use, trying next", { port });
          continue;
        }
        throw err;
      }
    }
    throw new RexError({
      category: "INTERNAL_ERROR" /* INTERNAL_ERROR */,
      message: `All Rex relay ports (${start}\u2013${end}) are in use`,
      retryable: false,
      suggestion: "Close an existing Rex session to free a port."
    });
  }
  /**
   * Stop the relay server gracefully.
   */
  async stop() {
    this.logger.info("Stopping relay server");
    if (this.wsClient) {
      this.wsClient.close(1001, "Server shutting down");
      this.wsClient = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    for (const waiter of this.chatWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.chatWaiters = [];
    this.chatInbox = [];
    this.chatOutbox = [];
    this.streamAccumulator.clear();
    this._activeChatSession = null;
    this.commentWatcher.stop();
    this.heartbeat.destroy();
    this.queue.destroy();
    if (this._memoryStore) {
      await this._memoryStore.disconnect();
      this._memoryStore = null;
    }
    if (this.fastify) {
      await this.fastify.close();
      this.fastify = null;
    }
    this.logger.info("Relay server stopped");
  }
  // ─── Activity Signal ──────────────────────────────────────────────────
  /** Track active tool count for nested/parallel tool calls. */
  activeToolCount = 0;
  /**
   * Signal that a tool is starting or finishing.
   * Pushes a lightweight notification to the plugin so the forging
   * animation shows while Claude is working — before commands even arrive.
   */
  signalActivity(active) {
    if (active) {
      this.activeToolCount++;
    } else {
      this.activeToolCount = Math.max(0, this.activeToolCount - 1);
    }
    const shouldForge = this.activeToolCount > 0;
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      const msg = {
        type: "command",
        id: "activity-signal",
        payload: { activity: shouldForge },
        timestamp: Date.now()
      };
      this.wsClient.send(JSON.stringify(msg));
    }
    this._activityState = shouldForge;
  }
  /** Current activity state for HTTP polling responses. */
  _activityState = false;
  /** Whether any tools are currently active (for polling responses). */
  get isActive() {
    return this._activityState;
  }
  // Chat is always available when server is running — messages queue in the bounded inbox.
  // The old chatListening state machine has been removed. Plugin always shows chat as available.
  // ─── Chat Infrastructure ──────────────────────────────────────────────
  /**
   * Called by the plugin to send a chat message.
   * Queue-first: message always enters the bounded FIFO inbox.
   * If a waiter exists, it consumes from the queue immediately.
   */
  enqueueChatMessage(msg) {
    this.persistChatMessage({
      id: msg.id,
      role: "user",
      message: msg.message,
      timestamp: msg.timestamp,
      fileKey: this.connection.session?.fileKey ?? "",
      selection: msg.selection
    });
    const waiter = this.chatWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
      return;
    }
    if (this.chatInbox.length >= this.CHAT_INBOX_MAX) {
      const dropped = this.chatInbox.shift();
      this.logger.warn("Chat inbox overflow \u2014 dropped oldest message", { droppedId: dropped?.id });
    }
    this.chatInbox.push(msg);
  }
  /** Number of pending chat messages in the inbox. */
  get pendingChatCount() {
    return this.chatInbox.length;
  }
  /** Persist a chat message to the remote memory service (fire-and-forget). */
  persistChatMessage(entry) {
    if (!this._memoryStore || !this.connection.session) return;
    const pluginSession = this.connection.session;
    const ctx = {
      fileKey: pluginSession.fileKey,
      fileName: pluginSession.fileName,
      userId: pluginSession.user?.id,
      userName: pluginSession.user?.name
    };
    const chatSession = this._activeChatSession;
    if (chatSession) {
      entry.sessionId = chatSession.sessionId;
    }
    const tags = chatSession ? ["chat-message", chatSession.sessionId] : ["chat-history", entry.role];
    this._memoryStore.remember({
      scope: "file",
      category: "context",
      content: JSON.stringify(entry.message.length > 2e3 ? { ...entry, message: entry.message.slice(0, 2e3) } : entry),
      tags,
      source: "explicit",
      context: ctx
    }).catch((err) => {
      this.logger.warn("Failed to persist chat message", {
        id: entry.id,
        error: err instanceof Error ? err.message : String(err)
      });
    });
    if (chatSession) {
      chatSession.messageCount++;
      chatSession.lastMessageAt = entry.timestamp;
      chatSession.summary = entry.message.slice(0, 100);
      if (this._memoryStore) {
        this._memoryStore.updateSession(chatSession, ctx).catch((err) => {
          this.logger.warn("Failed to update chat session", {
            sessionId: chatSession.sessionId,
            error: err instanceof Error ? err.message : String(err)
          });
        });
      }
    }
  }
  /**
   * Called by the MCP tool `wait_for_chat` to consume a message from the queue.
   * Returns immediately if messages are queued, otherwise waits up to timeoutMs.
   */
  waitForChatMessage(timeoutMs) {
    const queued = this.chatInbox.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.chatWaiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.chatWaiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      this.chatWaiters.push({ resolve, timer });
    });
  }
  /**
   * Called by the MCP tool `send_chat_response` to push a response back to the plugin.
   * Delivers via WebSocket if connected, otherwise queues for HTTP polling.
   */
  sendChatResponse(response) {
    if (!response.isError) {
      this.persistChatMessage({
        id: response.id,
        role: "assistant",
        message: response.message,
        timestamp: response.timestamp,
        fileKey: this.connection.session?.fileKey ?? ""
      });
    }
    if (this.chatOutbox.length >= this.CHAT_OUTBOX_MAX) {
      const dropped = this.chatOutbox.shift();
      this.logger.warn("Chat outbox overflow \u2014 dropped oldest response", { droppedId: dropped?.id });
    }
    this.chatOutbox.push(response);
    this.logger.debug("Chat response queued for delivery", { id: response.id, outboxSize: this.chatOutbox.length });
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      try {
        const msg = {
          type: "command",
          id: "chat-response",
          payload: { chatResponse: response },
          timestamp: Date.now()
        };
        this.wsClient.send(JSON.stringify(msg));
        this.logger.debug("Chat response also sent via WebSocket", { id: response.id });
      } catch {
        this.logger.warn("Chat response WS send failed \u2014 HTTP polling will deliver", { id: response.id });
      }
    } else {
      this.logger.debug("Chat response WS unavailable \u2014 HTTP polling only", { id: response.id });
    }
  }
  /**
   * Called by the MCP tool `send_chat_chunk` to push a streaming chunk to the plugin.
   * Delivers via WebSocket if connected, otherwise queues for HTTP polling.
   */
  sendChatChunk(chunk) {
    const acc = this.streamAccumulator.get(chunk.id) ?? "";
    this.streamAccumulator.set(chunk.id, acc + chunk.delta);
    if (chunk.done) {
      const fullText = this.streamAccumulator.get(chunk.id) ?? "";
      this.streamAccumulator.delete(chunk.id);
      this.persistChatMessage({
        id: chunk.id,
        role: "assistant",
        message: fullText,
        timestamp: chunk.timestamp,
        fileKey: this.connection.session?.fileKey ?? ""
      });
    }
    const wsOpen = this.wsClient?.readyState === WebSocket.OPEN;
    if (wsOpen) {
      try {
        const msg = {
          type: "command",
          id: "chat-chunk",
          payload: { chatChunk: chunk },
          timestamp: Date.now()
        };
        this.wsClient.send(JSON.stringify(msg));
        return;
      } catch {
      }
    }
    this.chatOutbox.push({ id: chunk.id, message: chunk.delta, timestamp: chunk.timestamp, _isChunk: true, _done: chunk.done });
  }
  /**
   * Get and drain pending chat responses for the plugin (called during HTTP polling).
   */
  drainChatResponses() {
    const responses = [...this.chatOutbox];
    this.chatOutbox = [];
    if (responses.length > 0) {
      this.logger.debug("Chat responses drained for HTTP delivery", {
        count: responses.length,
        ids: responses.map((r) => r.id)
      });
    }
    return responses;
  }
  /**
   * Send a command to the plugin.
   * Uses WebSocket if connected, otherwise queues for HTTP polling.
   * Pauses heartbeat while command is in-flight — the plugin is single-threaded
   * and cannot respond to pings during figma.* execution.
   */
  sendCommand(command) {
    this.heartbeat.pauseWsHeartbeat();
    const promise = this.queue.enqueue(command);
    promise.then(
      () => this.heartbeat.resumeWsHeartbeat(),
      () => this.heartbeat.resumeWsHeartbeat()
    );
    if (this.connection.isWebSocketActive && this.wsClient?.readyState === WebSocket.OPEN) {
      this.pushCommandViaWs(command);
    }
    return promise;
  }
  // ─── Route Registration ────────────────────────────────────────────────
  registerRoutes(app) {
    app.get("/health", async (_req, _reply) => {
      return this.handleHealth();
    });
    const authHook = async (req, reply) => {
      try {
        const token = req.headers["x-auth-token"];
        this.connection.validateAuth(token);
      } catch (err) {
        if (err instanceof RexError) {
          reply.code(401).send(err.toResponse());
        } else {
          reply.code(401).send({ error: { message: "Unauthorized" } });
        }
        return reply;
      }
    };
    app.post("/connect", async (req, reply) => {
      return this.handleConnect(req, reply);
    });
    app.get("/commands", {
      preHandler: authHook
    }, async (req, reply) => {
      return this.handleGetCommands(req, reply);
    });
    app.post("/results", {
      preHandler: authHook
    }, async (req, reply) => {
      return this.handlePostResults(req, reply);
    });
    app.post("/disconnect", {
      preHandler: authHook
    }, async (req, reply) => {
      return this.handleDisconnect(req, reply);
    });
    app.post("/chat/send", {
      preHandler: authHook
    }, async (req, _reply) => {
      const body = req.body;
      if (!body?.message) {
        return { error: "Missing message field" };
      }
      const chatMsg = {
        id: body.id || `chat_${Date.now()}`,
        message: body.message,
        selection: body.selection || [],
        timestamp: Date.now()
      };
      this.enqueueChatMessage(chatMsg);
      this.logger.info("Chat message received from plugin", { id: chatMsg.id });
      return { status: "ok", id: chatMsg.id };
    });
    app.get("/chat/responses", {
      preHandler: authHook
    }, async (_req, reply) => {
      const responses = this.drainChatResponses();
      if (responses.length === 0) {
        reply.code(204);
        return void 0;
      }
      return { responses };
    });
    app.get("/chat/history", {
      preHandler: authHook
    }, async (_req, _reply) => {
      if (!this._memoryStore || !this.connection.session) {
        return { messages: [] };
      }
      try {
        const ctx = {
          fileKey: this.connection.session.fileKey,
          fileName: this.connection.session.fileName,
          userId: this.connection.session.user?.id,
          userName: this.connection.session.user?.name
        };
        const messages = this._activeChatSession ? await this._memoryStore.getSessionMessages(this._activeChatSession.sessionId, ctx, 50) : await this._memoryStore.getChatHistory(ctx, 20);
        return { messages };
      } catch (err) {
        this.logger.warn("Failed to fetch chat history", {
          error: err instanceof Error ? err.message : String(err)
        });
        return { messages: [] };
      }
    });
    app.post("/session/create", {
      preHandler: authHook
    }, async (_req, _reply) => {
      const pluginSession = this.connection.session;
      if (!this._memoryStore || !pluginSession) {
        return { error: "Not connected" };
      }
      const now = Date.now();
      const session = {
        sessionId: "sess_chat_" + now,
        name: "New Session",
        summary: "",
        fileKey: pluginSession.fileKey,
        createdAt: now,
        lastMessageAt: now,
        messageCount: 0
      };
      const ctx = {
        fileKey: pluginSession.fileKey,
        fileName: pluginSession.fileName,
        userId: pluginSession.user?.id,
        userName: pluginSession.user?.name
      };
      try {
        await this._memoryStore.createSession(session, ctx);
        this._activeChatSession = session;
        this.logger.info("Chat session created", { sessionId: session.sessionId });
        return { session };
      } catch (err) {
        this.logger.warn("Failed to create chat session", {
          error: err instanceof Error ? err.message : String(err)
        });
        this._activeChatSession = session;
        return { session };
      }
    });
    app.get("/sessions", {
      preHandler: authHook
    }, async (_req, _reply) => {
      const pluginSession = this.connection.session;
      if (!this._memoryStore || !pluginSession) {
        return { sessions: [] };
      }
      try {
        const ctx = {
          fileKey: pluginSession.fileKey,
          fileName: pluginSession.fileName,
          userId: pluginSession.user?.id,
          userName: pluginSession.user?.name
        };
        const sessions = await this._memoryStore.listSessions(ctx, 20);
        return { sessions };
      } catch (err) {
        this.logger.warn("Failed to list sessions", {
          error: err instanceof Error ? err.message : String(err)
        });
        return { sessions: [] };
      }
    });
    app.post("/session/select", {
      preHandler: authHook
    }, async (req, _reply) => {
      const body = req.body;
      const pluginSession = this.connection.session;
      if (!body?.sessionId || !this._memoryStore || !pluginSession) {
        return { error: "Missing sessionId or not connected" };
      }
      const ctx = {
        fileKey: pluginSession.fileKey,
        fileName: pluginSession.fileName,
        userId: pluginSession.user?.id,
        userName: pluginSession.user?.name
      };
      try {
        const messages = await this._memoryStore.getSessionMessages(body.sessionId, ctx, 50);
        const sessions = await this._memoryStore.listSessions(ctx, 50);
        const session = sessions.find((s) => s.sessionId === body.sessionId);
        if (session) {
          this._activeChatSession = session;
        } else {
          this._activeChatSession = {
            sessionId: body.sessionId,
            name: "Session",
            summary: "",
            fileKey: pluginSession.fileKey,
            createdAt: Date.now(),
            lastMessageAt: Date.now(),
            messageCount: messages.length
          };
        }
        this.logger.info("Chat session selected", { sessionId: body.sessionId, messageCount: messages.length });
        return { messages, sessionName: this._activeChatSession.name };
      } catch (err) {
        this.logger.warn("Failed to select session", {
          error: err instanceof Error ? err.message : String(err)
        });
        return { messages: [], sessionName: "Session" };
      }
    });
    app.post("/session/resume", {
      preHandler: authHook
    }, async (req, _reply) => {
      const body = req.body;
      const pluginSession = this.connection.session;
      if (!body?.sessionId || !pluginSession) {
        return { status: "no-op" };
      }
      if (this._activeChatSession) {
        return { status: "already-active", sessionId: this._activeChatSession.sessionId };
      }
      const ctx = {
        fileKey: pluginSession.fileKey,
        fileName: pluginSession.fileName,
        userId: pluginSession.user?.id,
        userName: pluginSession.user?.name
      };
      if (this._memoryStore) {
        try {
          const sessions = await this._memoryStore.listSessions(ctx, 50);
          const found = sessions.find((s) => s.sessionId === body.sessionId);
          if (found) {
            this._activeChatSession = found;
            this.logger.info("Chat session resumed", { sessionId: found.sessionId, name: found.name });
            return { status: "resumed", sessionId: found.sessionId, name: found.name };
          }
        } catch {
        }
      }
      this._activeChatSession = {
        sessionId: body.sessionId,
        name: "Resumed Session",
        summary: "",
        fileKey: pluginSession.fileKey,
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
        messageCount: 0
      };
      this.logger.info("Chat session resumed (minimal)", { sessionId: body.sessionId });
      return { status: "resumed", sessionId: body.sessionId };
    });
    app.post("/session/delete", {
      preHandler: authHook
    }, async (req, _reply) => {
      const body = req.body;
      const pluginSession = this.connection.session;
      if (!body?.sessionId || !this._memoryStore || !pluginSession) {
        return { error: "Missing sessionId or not connected" };
      }
      const ctx = {
        fileKey: pluginSession.fileKey,
        fileName: pluginSession.fileName,
        userId: pluginSession.user?.id,
        userName: pluginSession.user?.name
      };
      try {
        const deleted = await this._memoryStore.forget(ctx, void 0, body.sessionId, "file");
        if (this._activeChatSession?.sessionId === body.sessionId) {
          this._activeChatSession = null;
        }
        this.logger.info("Chat session deleted", { sessionId: body.sessionId, deleted });
        return { status: "deleted", sessionId: body.sessionId, deleted };
      } catch (err) {
        this.logger.warn("Failed to delete session", {
          error: err instanceof Error ? err.message : String(err)
        });
        return { error: "Failed to delete session" };
      }
    });
  }
  // ─── Route Handlers ────────────────────────────────────────────────────
  handleHealth() {
    const queueStats = this.queue.getStats();
    const healthSummary = this.heartbeat.getHealthSummary();
    return {
      status: "ok",
      version: VERSION,
      uptime: Math.floor((Date.now() - this.startTime) / 1e3),
      connection: this.connection.getConnectionInfo(),
      queue: {
        ...healthSummary,
        pending: queueStats.pending,
        inFlight: queueStats.inFlight
      }
    };
  }
  handleConnect(req, reply) {
    const body = req.body;
    if (!body?.pluginId || !body?.fileKey || !body?.fileName) {
      reply.code(400);
      return {
        error: {
          category: "INVALID_PARAMS" /* INVALID_PARAMS */,
          message: "Missing required fields: pluginId, fileKey, fileName",
          retryable: false
        }
      };
    }
    const session = this.connection.connect(body);
    this.commentWatcher.start(body.fileKey);
    this.heartbeat.startPollMonitoring(
      this.config.polling.defaultInterval,
      () => {
        this.logger.warn("Plugin disconnected due to missed polls");
        this.connection.disconnect("missed polls");
        this.heartbeat.stopWsHeartbeat();
      }
    );
    return {
      sessionId: session.sessionId,
      authSecret: this.connection.secret,
      config: {
        pollingInterval: this.config.polling.defaultInterval,
        burstInterval: this.config.polling.burstInterval,
        idleInterval: this.config.polling.idleInterval,
        idleThreshold: this.config.polling.idleThreshold,
        preloadFonts: this.config.figma.preloadFonts
      }
    };
  }
  handleGetCommands(req, reply) {
    const pluginId = req.headers["x-plugin-id"];
    try {
      this.connection.validatePluginId(pluginId);
    } catch (err) {
      if (err instanceof RexError) {
        reply.code(err.category === "PLUGIN_NOT_RUNNING" /* PLUGIN_NOT_RUNNING */ ? 503 : 400);
        return err.toResponse();
      }
      throw err;
    }
    const pageIdHeader = req.headers["x-plugin-page"];
    if (pageIdHeader && this.connection.session) {
      this.connection.session.pageId = pageIdHeader;
    }
    this.heartbeat.recordPoll();
    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("keepalive") === "1") {
      reply.code(204);
      return void 0;
    }
    const pending = this.queue.getPending();
    if (pending.length === 0) {
      const chatResponses2 = this.drainChatResponses();
      if (this.isActive || chatResponses2.length > 0 || this.pendingChatCount > 0) {
        return { commands: [], activity: this.isActive, chatResponses: chatResponses2, pendingChat: this.pendingChatCount, sessionName: this._activeChatSession?.name ?? null };
      }
      reply.code(204);
      return void 0;
    }
    const commands = [];
    for (const entry of pending) {
      this.queue.markSent(entry.command.id);
      this.queue.markAcknowledged(entry.command.id);
      commands.push(entry.command);
    }
    this.pollingState.lastCommandTime = Date.now();
    const suggestedInterval = this.calculatePollingInterval();
    const chatResponses = this.drainChatResponses();
    const remainingStats = this.queue.getStats();
    return {
      commands,
      pollingInterval: suggestedInterval,
      activity: this.isActive,
      chatResponses,
      pendingChat: this.pendingChatCount,
      sessionName: this._activeChatSession?.name ?? null,
      queueDepth: remainingStats.pending + remainingStats.inFlight
    };
  }
  handlePostResults(req, reply) {
    const body = req.body;
    const results = Array.isArray(body) ? body : [body];
    for (const result of results) {
      if (!result?.id) {
        reply.code(400);
        return {
          error: {
            category: "INVALID_PARAMS" /* INVALID_PARAMS */,
            message: "Missing required field: id",
            retryable: false
          }
        };
      }
      this.queue.complete(result.id, result);
    }
    return { status: "ok", processed: results.length };
  }
  handleDisconnect(req, _reply) {
    const body = req.body;
    this.connection.disconnect(body?.reason ?? "plugin disconnect");
    this.heartbeat.stopWsHeartbeat();
    this.heartbeat.destroy();
    if (this.wsClient) {
      this.wsClient.close(1e3, "Plugin disconnected");
      this.wsClient = null;
    }
    return { status: "ok" };
  }
  // ─── WebSocket Handling ────────────────────────────────────────────────
  handleUpgrade(request, socket, head) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const token = request.headers["x-auth-token"] ?? url.searchParams.get("token") ?? void 0;
    try {
      this.connection.validateAuth(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const sessionId = request.headers["x-session-id"] ?? url.searchParams.get("sessionId") ?? void 0;
    if (!sessionId || !this.connection.session || this.connection.session.sessionId !== sessionId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.onWebSocketConnection(ws);
    });
  }
  onWebSocketConnection(ws) {
    if (this.wsClient) {
      this.wsClient.close(1e3, "Replaced by new connection");
    }
    this.wsClient = ws;
    const sessionId = this.connection.session?.sessionId ?? "unknown";
    this.connection.upgradeToWebSocket(sessionId);
    this.logger.info("WebSocket client connected", { sessionId });
    this.heartbeat.startWsHeartbeat(
      () => this.wsSendPing(),
      () => {
        this.logger.warn("WebSocket heartbeat failed, degrading to HTTP");
        this.connection.downgradeToPolling();
        this.heartbeat.recordReconnect();
        ws.close(1001, "Heartbeat timeout");
      }
    );
    const pending = this.queue.getPending();
    for (const entry of pending) {
      this.pushCommandViaWs(entry.command);
    }
    ws.on("message", (data) => {
      this.onWsMessage(data);
    });
    ws.on("close", (_code, _reason) => {
      this.logger.info("WebSocket client disconnected");
      this.heartbeat.stopWsHeartbeat();
      if (this.wsClient === ws) {
        this.wsClient = null;
        this.connection.downgradeToPolling();
      }
    });
    ws.on("error", (err) => {
      this.logger.error("WebSocket error", { error: err.message });
    });
  }
  onWsMessage(data) {
    this.heartbeat.recordWsMessage();
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.logger.warn("Invalid WebSocket message (not JSON)");
      return;
    }
    switch (msg.type) {
      case "pong":
        this.heartbeat.recordPong();
        break;
      case "ack":
        if (msg.id) {
          this.queue.markAcknowledged(msg.id);
        }
        break;
      case "result":
        if (msg.id && msg.payload) {
          const result = msg.payload;
          result.id = result.id ?? msg.id;
          this.queue.complete(result.id, result);
        }
        break;
      default:
        this.logger.warn("Unknown WebSocket message type", { type: msg.type });
    }
  }
  /** Send a command to the plugin via WebSocket. */
  pushCommandViaWs(command) {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) return;
    const stats = this.queue.getStats();
    const payload = {
      ...command,
      _queueDepth: stats.pending + stats.inFlight
    };
    const msg = {
      type: "command",
      id: command.id,
      payload,
      timestamp: Date.now()
    };
    this.wsClient.send(JSON.stringify(msg));
    this.queue.markSent(command.id);
    this.logger.debug("Command pushed via WebSocket", {
      commandId: command.id,
      type: command.type
    });
  }
  /** Send a ping message over WebSocket. */
  wsSendPing() {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) return;
    const msg = {
      type: "ping",
      timestamp: Date.now()
    };
    this.wsClient.send(JSON.stringify(msg));
  }
  // ─── Adaptive Polling ──────────────────────────────────────────────────
  /** Calculate the suggested polling interval based on queue activity. */
  calculatePollingInterval() {
    const { burstInterval, defaultInterval, idleInterval, idleThreshold } = this.config.polling;
    const queueStats = this.queue.getStats();
    if (queueStats.pending > 0 || queueStats.inFlight > 0) {
      return burstInterval;
    }
    const timeSinceLastCommand = Date.now() - this.pollingState.lastCommandTime;
    if (timeSinceLastCommand > idleThreshold) {
      return idleInterval;
    }
    return defaultInterval;
  }
};

// src/server/tool-router.ts
import { v4 as uuidv4 } from "uuid";
import { ZodError } from "zod";

// src/tools/schemas.ts
import { z } from "zod";
var nodeTypeEnum = z.enum([
  "FRAME",
  "RECTANGLE",
  "ELLIPSE",
  "TEXT",
  "LINE",
  "POLYGON",
  "STAR",
  "VECTOR",
  "SECTION",
  "COMPONENT",
  "COMPONENT_SET"
]);
var blendModeEnum = z.enum([
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY"
]);
var constraintValueEnum = z.enum([
  "min",
  "center",
  "max",
  "stretch",
  "scale"
]);
var resolvedTypeEnum = z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]);
var hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
var position = z.object({
  x: z.number(),
  y: z.number()
});
var size = z.object({
  width: z.number().positive(),
  height: z.number().positive().optional()
});
var sizeOptionalBoth = z.object({
  width: z.number().optional(),
  height: z.number().optional()
});
var paddingObject = z.object({
  top: z.number().min(0),
  right: z.number().min(0),
  bottom: z.number().min(0),
  left: z.number().min(0)
});
var padding = z.union([z.number().min(0), paddingObject]);
var cornerRadiusObject = z.object({
  topLeft: z.number().min(0),
  topRight: z.number().min(0),
  bottomRight: z.number().min(0),
  bottomLeft: z.number().min(0)
});
var cornerRadius = z.union([z.number().min(0), cornerRadiusObject]);
var gradientStop = z.object({
  position: z.number().min(0).max(1),
  color: hexColor
});
var solidFill = z.object({
  type: z.literal("solid"),
  color: hexColor,
  opacity: z.number().min(0).max(1).optional()
});
var linearGradientFill = z.object({
  type: z.literal("linear-gradient"),
  stops: z.array(gradientStop),
  angle: z.number().optional()
});
var radialGradientFill = z.object({
  type: z.literal("radial-gradient"),
  stops: z.array(gradientStop),
  center: z.object({
    x: z.number(),
    y: z.number()
  }).optional()
});
var imageFill = z.object({
  type: z.literal("image"),
  imageHash: z.string(),
  scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional()
});
var fill = z.discriminatedUnion("type", [
  solidFill,
  linearGradientFill,
  radialGradientFill,
  imageFill
]);
var stroke = fill;
var effectTypeMap = {
  "DROP_SHADOW": "drop-shadow",
  "INNER_SHADOW": "inner-shadow",
  "LAYER_BLUR": "layer-blur",
  "BACKGROUND_BLUR": "background-blur"
};
var normalizeEffectType = z.string().transform((v) => effectTypeMap[v] ?? v);
var dropShadowEffect = z.object({
  type: z.union([z.literal("drop-shadow"), z.literal("DROP_SHADOW")]).transform(() => "drop-shadow"),
  color: hexColor,
  offset: position,
  blur: z.number().min(0),
  radius: z.number().min(0).optional(),
  spread: z.number().optional(),
  visible: z.boolean().optional(),
  blendMode: z.string().optional()
});
var innerShadowEffect = z.object({
  type: z.union([z.literal("inner-shadow"), z.literal("INNER_SHADOW")]).transform(() => "inner-shadow"),
  color: hexColor,
  offset: position,
  blur: z.number().min(0),
  radius: z.number().min(0).optional(),
  spread: z.number().optional(),
  visible: z.boolean().optional(),
  blendMode: z.string().optional()
});
var layerBlurEffect = z.object({
  type: z.union([z.literal("layer-blur"), z.literal("LAYER_BLUR")]).transform(() => "layer-blur"),
  blur: z.number().min(0),
  visible: z.boolean().optional()
});
var backgroundBlurEffect = z.object({
  type: z.union([z.literal("background-blur"), z.literal("BACKGROUND_BLUR")]).transform(() => "background-blur"),
  blur: z.number().min(0),
  visible: z.boolean().optional()
});
var effect = z.union([
  dropShadowEffect,
  innerShadowEffect,
  layerBlurEffect,
  backgroundBlurEffect
]);
var autoLayoutParams = z.object({
  direction: z.enum(["horizontal", "vertical"]).optional(),
  wrap: z.boolean().optional(),
  spacing: z.union([z.number().min(0), z.literal("auto")]).optional(),
  padding: padding.optional(),
  primaryAxisAlign: z.enum(["min", "center", "max", "space-between"]).optional(),
  counterAxisAlign: z.enum(["min", "center", "max", "baseline"]).optional(),
  primaryAxisSizing: z.enum(["fixed", "hug"]).optional(),
  counterAxisSizing: z.enum(["fixed", "hug"]).optional(),
  strokesIncludedInLayout: z.boolean().optional(),
  itemReverseZIndex: z.boolean().optional()
});
var layoutChildParams = z.object({
  alignSelf: z.enum(["inherit", "stretch"]).optional(),
  grow: z.number().optional(),
  positioning: z.enum(["auto", "absolute"]).optional(),
  position: position.optional(),
  horizontalConstraint: constraintValueEnum.optional(),
  verticalConstraint: constraintValueEnum.optional()
});
var constraints = z.object({
  horizontal: constraintValueEnum.optional(),
  vertical: constraintValueEnum.optional()
});
var columnGrid = z.object({
  pattern: z.literal("columns"),
  count: z.number(),
  gutterSize: z.number(),
  alignment: z.enum(["min", "center", "max", "stretch"]),
  offset: z.number().optional(),
  sectionSize: z.number().optional(),
  color: hexColor.optional()
});
var rowGrid = z.object({
  pattern: z.literal("rows"),
  count: z.number(),
  gutterSize: z.number(),
  alignment: z.enum(["min", "center", "max", "stretch"]),
  offset: z.number().optional(),
  sectionSize: z.number().optional(),
  color: hexColor.optional()
});
var uniformGrid = z.object({
  pattern: z.literal("grid"),
  sectionSize: z.number(),
  color: hexColor.optional()
});
var layoutGrid = z.discriminatedUnion("pattern", [
  columnGrid,
  rowGrid,
  uniformGrid
]);
var lineHeightObject = z.object({
  value: z.number(),
  unit: z.enum(["percent", "pixels"])
});
var letterSpacingObject = z.object({
  value: z.number(),
  unit: z.enum(["percent", "pixels"])
});
var textStyle = z.object({
  fontFamily: z.string().optional(),
  fontWeight: z.number().min(100).max(900).optional(),
  fontSize: z.number().positive().optional(),
  lineHeight: z.union([z.number(), lineHeightObject]).optional(),
  letterSpacing: z.union([z.number(), letterSpacingObject]).optional(),
  color: hexColor.optional(),
  textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional(),
  textAlignVertical: z.enum(["TOP", "CENTER", "BOTTOM"]).optional(),
  textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional(),
  textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE"]).optional(),
  textAutoResize: z.enum(["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"]).optional(),
  maxLines: z.number().optional(),
  paragraphSpacing: z.number().optional()
});
var textStyleRange = z.object({
  start: z.number(),
  end: z.number(),
  style: textStyle
});
var getNodeSchema = z.object({
  nodeIds: z.union([z.string(), z.array(z.string()).min(1)]).transform(
    (v) => typeof v === "string" ? [v] : v
  ),
  depth: z.number().min(0).max(5).optional(),
  properties: z.array(z.string()).optional()
});
var getSelectionSchema = z.object({
  includeChildren: z.boolean().optional(),
  depth: z.number().optional()
});
var getPageSchema = z.object({
  pageId: z.string().optional(),
  depth: z.number().optional(),
  verbosity: z.enum(["summary", "standard", "full"]).optional()
});
var searchNodesSchema = z.object({
  query: z.string().optional(),
  type: nodeTypeEnum.optional(),
  withinId: z.string().optional(),
  hasAutoLayout: z.boolean().optional(),
  hasChildren: z.boolean().optional(),
  limit: z.number().optional()
});
var screenshotSchema = z.object({
  nodeId: z.string().optional(),
  format: z.enum(["png", "jpg", "svg"]).optional(),
  scale: z.union([z.number(), z.string().transform(Number)]).pipe(z.number().min(0.5).max(4)).optional(),
  maxDimension: z.number().min(100).max(4096).optional()
});
var getStylesSchema = z.object({
  types: z.array(z.enum(["fill", "text", "effect", "grid"])).optional()
});
var getVariablesSchema = z.object({
  collection: z.string().optional(),
  namePattern: z.string().optional(),
  resolvedType: resolvedTypeEnum.optional(),
  resolveAliases: z.boolean().optional()
});
var getComponentsSchema = z.object({
  query: z.string().optional(),
  includeVariants: z.boolean().optional(),
  limit: z.number().optional()
});
var baseCreateNodeFields = {
  type: nodeTypeEnum,
  parentId: z.string().optional(),
  name: z.string().optional(),
  position: position.optional(),
  size: size.optional(),
  fills: z.array(fill).optional(),
  strokes: z.array(stroke).optional(),
  strokeWeight: z.number().min(0).optional(),
  effects: z.array(effect).optional(),
  cornerRadius: cornerRadius.optional(),
  opacity: z.number().min(0).max(1).optional(),
  autoLayout: autoLayoutParams.optional(),
  layoutGrids: z.array(layoutGrid).optional(),
  constraints: constraints.optional(),
  text: z.string().optional(),
  textStyle: textStyle.optional(),
  layoutChild: layoutChildParams.optional()
};
var createNodeSchema = z.lazy(
  () => z.object({
    ...baseCreateNodeFields,
    children: z.array(createNodeSchema).optional()
  })
);
var updateNodeSchema = z.object({
  nodeId: z.string(),
  name: z.string().optional(),
  position: position.optional(),
  size: sizeOptionalBoth.optional(),
  fills: z.array(fill).optional(),
  strokes: z.array(stroke).optional(),
  strokeWeight: z.number().min(0).optional(),
  effects: z.array(effect).optional(),
  cornerRadius: cornerRadius.optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  blendMode: blendModeEnum.optional(),
  clipsContent: z.boolean().optional(),
  autoLayout: autoLayoutParams.optional(),
  layoutGrids: z.array(layoutGrid).optional(),
  constraints: constraints.optional(),
  layoutChild: layoutChildParams.optional()
});
var batchUpdateNodesSchema = z.object({
  updates: z.array(updateNodeSchema).min(1).max(50)
});
var deleteNodesSchema = z.object({
  nodeIds: z.array(z.string()).min(1).max(50)
});
var cloneNodeSchema = z.object({
  nodeId: z.string(),
  parentId: z.string().optional(),
  position: position.optional(),
  name: z.string().optional()
});
var reparentNodeSchema = z.object({
  nodeId: z.string(),
  parentId: z.string(),
  index: z.number().optional()
});
var reorderChildrenSchema = z.object({
  parentId: z.string(),
  childIds: z.array(z.string()).min(1)
});
var setTextSchema = z.object({
  nodeId: z.string(),
  text: z.string().optional(),
  style: textStyle.optional(),
  styleRanges: z.array(textStyleRange).optional()
});
var setFillsSchema = z.object({
  nodeId: z.string(),
  fills: z.array(fill)
});
var setStrokesSchema = z.object({
  nodeId: z.string(),
  strokes: z.array(stroke),
  strokeWeight: z.number().min(0).optional(),
  strokeAlign: z.enum(["INSIDE", "OUTSIDE", "CENTER"]).optional(),
  dashPattern: z.array(z.number()).optional(),
  strokeCap: z.enum(["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"]).optional(),
  strokeJoin: z.enum(["MITER", "BEVEL", "ROUND"]).optional()
});
var setEffectsSchema = z.object({
  nodeId: z.string(),
  effects: z.array(effect)
});
var setCornerRadiusSchema = z.object({
  nodeId: z.string(),
  radius: cornerRadius
});
var setAutoLayoutSchema = z.object({
  nodeId: z.string(),
  enabled: z.boolean().optional(),
  direction: z.enum(["horizontal", "vertical"]).optional(),
  wrap: z.boolean().optional(),
  spacing: z.union([z.number().min(0), z.literal("auto")]).optional(),
  padding: padding.optional(),
  primaryAxisAlign: z.enum(["min", "center", "max", "space-between"]).optional(),
  counterAxisAlign: z.enum(["min", "center", "max", "baseline"]).optional(),
  primaryAxisSizing: z.enum(["fixed", "hug"]).optional(),
  counterAxisSizing: z.enum(["fixed", "hug"]).optional(),
  strokesIncludedInLayout: z.boolean().optional(),
  itemReverseZIndex: z.boolean().optional()
});
var setLayoutChildSchema = z.object({
  nodeId: z.string(),
  alignSelf: z.enum(["inherit", "stretch"]).optional(),
  grow: z.number().optional(),
  positioning: z.enum(["auto", "absolute"]).optional(),
  position: position.optional(),
  horizontalConstraint: constraintValueEnum.optional(),
  verticalConstraint: constraintValueEnum.optional()
});
var layoutChildUpdate = z.object({
  nodeId: z.string(),
  alignSelf: z.enum(["inherit", "stretch"]).optional(),
  grow: z.number().optional(),
  positioning: z.enum(["auto", "absolute"]).optional()
});
var batchSetLayoutChildrenSchema = z.object({
  parentId: z.string(),
  children: z.array(layoutChildUpdate).min(1)
});
var setLayoutGridSchema = z.object({
  nodeId: z.string(),
  grids: z.array(layoutGrid)
});
var setConstraintsSchema = z.object({
  nodeId: z.string(),
  horizontal: constraintValueEnum.optional(),
  vertical: constraintValueEnum.optional()
});
var instantiateComponentSchema = z.object({
  componentKey: z.string().optional(),
  nodeId: z.string().optional(),
  parentId: z.string().optional(),
  position: position.optional(),
  variant: z.record(z.string(), z.string()).optional(),
  overrides: z.record(z.string(), z.union([z.string(), z.boolean()])).optional()
});
var setInstancePropertiesSchema = z.object({
  nodeId: z.string(),
  properties: z.record(z.string(), z.union([z.string(), z.boolean()])),
  resetOverrides: z.array(z.string()).optional()
});
var createComponentSchema = z.object({
  nodeId: z.string(),
  description: z.string().optional()
});
var createComponentSetSchema = z.object({
  componentIds: z.array(z.string()).min(1),
  name: z.string().optional()
});
var addComponentPropertySchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]),
  defaultValue: z.union([z.string(), z.boolean()])
});
var editComponentPropertySchema = z.object({
  nodeId: z.string(),
  propertyName: z.string(),
  name: z.string().optional(),
  defaultValue: z.union([z.string(), z.boolean()]).optional()
});
var deleteComponentPropertySchema = z.object({
  nodeId: z.string(),
  propertyName: z.string()
});
var setDescriptionSchema = z.object({
  nodeId: z.string(),
  description: z.string()
});
var createVariableCollectionSchema = z.object({
  name: z.string(),
  initialModeName: z.string().optional(),
  additionalModes: z.array(z.string()).optional()
});
var deleteVariableCollectionSchema = z.object({
  collectionId: z.string()
});
var variableDefinition = z.object({
  name: z.string(),
  resolvedType: resolvedTypeEnum,
  description: z.string().optional(),
  valuesByMode: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
});
var createVariablesSchema = z.object({
  collectionId: z.string(),
  variables: z.array(variableDefinition).min(1).max(100)
});
var variableUpdate = z.object({
  variableId: z.string(),
  modeId: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()])
});
var updateVariablesSchema = z.object({
  updates: z.array(variableUpdate).min(1).max(100)
});
var deleteVariableSchema = z.object({
  variableId: z.string()
});
var renameVariableSchema = z.object({
  variableId: z.string(),
  newName: z.string()
});
var addModeSchema = z.object({
  collectionId: z.string(),
  modeName: z.string()
});
var renameModeSchema = z.object({
  collectionId: z.string(),
  modeId: z.string(),
  newName: z.string()
});
var tokenDefinition = z.object({
  name: z.string(),
  resolvedType: resolvedTypeEnum,
  description: z.string().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
});
var setupDesignTokensSchema = z.object({
  collectionName: z.string(),
  modes: z.array(z.string()).min(1),
  tokens: z.array(tokenDefinition).min(1).max(100)
});
var createPageSchema = z.object({
  name: z.string(),
  index: z.number().optional()
});
var renamePageSchema = z.object({
  pageId: z.string(),
  name: z.string()
});
var deletePageSchema = z.object({
  pageId: z.string()
});
var setCurrentPageSchema = z.object({
  pageId: z.string()
});
var postCommentSchema = z.object({
  message: z.string(),
  nodeId: z.string().optional(),
  position: position.optional(),
  replyTo: z.string().optional()
});
var deleteCommentSchema = z.object({
  commentId: z.string()
});
var executeSchema = z.object({
  code: z.string(),
  timeout: z.number().max(3e4).optional()
});
var operation = z.object({
  tool: z.string(),
  params: z.record(z.string(), z.unknown())
});
var batchExecuteSchema = z.object({
  operations: z.array(operation).min(1).max(50),
  atomic: z.boolean().optional()
});
var waitForChatSchema = z.object({
  timeout: z.number().min(1e3).max(12e4).optional()
});
var sendChatResponseSchema = z.object({
  messageId: z.string(),
  message: z.string(),
  isError: z.boolean().optional(),
  sessionName: z.string().max(60).optional()
});
var sendChatChunkSchema = z.object({
  messageId: z.string(),
  delta: z.string(),
  done: z.boolean().optional()
});
var memoryScopeEnum = z.enum(["user", "team", "file", "page"]);
var memoryCategoryEnum = z.enum([
  "decision",
  "convention",
  "context",
  "rejection",
  "relationship",
  "preference",
  "correction"
]);
var noteSchema = z.object({
  content: z.string().describe("What to note \u2014 a design decision, convention, or context"),
  scope: memoryScopeEnum.optional().describe("Note scope: user (personal), team (shared), file, or page. Default: file"),
  category: memoryCategoryEnum.optional().describe("Note category. Default: convention"),
  tags: z.array(z.string()).optional().describe("Semantic tags for retrieval"),
  componentKey: z.string().optional().describe("Figma component key \u2014 stable reference for design system components")
});
var notesSchema = z.object({
  query: z.string().describe("What to look up \u2014 topic or keyword"),
  scope: memoryScopeEnum.optional().describe("Filter by scope"),
  category: memoryCategoryEnum.optional().describe("Filter by category"),
  componentKey: z.string().optional().describe("Filter by Figma component key"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results (default: 10)")
});
var removeNoteSchema = z.object({
  id: z.string().optional().describe("Specific note ID to delete"),
  query: z.string().optional().describe("Delete notes matching this query"),
  scope: memoryScopeEnum.optional().describe("Scope filter for query-based deletion")
});
var browseNotesSchema = z.object({
  scope: memoryScopeEnum.optional().describe("Filter by scope"),
  category: memoryCategoryEnum.optional().describe("Filter by category"),
  limit: z.number().int().min(1).max(100).optional().describe("Max results (default: 20)"),
  includeSuperseded: z.boolean().optional().describe("Include superseded notes (default: false)")
});
var cleanupNotesSchema = z.object({
  dryRun: z.boolean().optional().describe("Preview what would be removed (default: true)"),
  maxAgeDays: z.number().int().min(1).optional().describe("Remove notes older than N days with 0 access (default: 30)"),
  minConfidence: z.number().min(0).max(1).optional().describe("Remove notes below this confidence (default: 0.2)"),
  removeSuperseded: z.boolean().optional().describe("Remove superseded notes (default: true)")
});
var schemaRegistry = {
  // Read tools
  get_node: getNodeSchema,
  get_selection: getSelectionSchema,
  get_page: getPageSchema,
  search_nodes: searchNodesSchema,
  screenshot: screenshotSchema,
  get_styles: getStylesSchema,
  get_variables: getVariablesSchema,
  get_components: getComponentsSchema,
  // Write — Nodes
  create_node: createNodeSchema,
  update_node: updateNodeSchema,
  batch_update_nodes: batchUpdateNodesSchema,
  delete_nodes: deleteNodesSchema,
  clone_node: cloneNodeSchema,
  reparent_node: reparentNodeSchema,
  reorder_children: reorderChildrenSchema,
  // Write — Text
  set_text: setTextSchema,
  // Write — Visual
  set_fills: setFillsSchema,
  set_strokes: setStrokesSchema,
  set_effects: setEffectsSchema,
  set_corner_radius: setCornerRadiusSchema,
  // Write — Layout
  set_auto_layout: setAutoLayoutSchema,
  set_layout_child: setLayoutChildSchema,
  batch_set_layout_children: batchSetLayoutChildrenSchema,
  set_layout_grid: setLayoutGridSchema,
  set_constraints: setConstraintsSchema,
  // Write — Components
  instantiate_component: instantiateComponentSchema,
  set_instance_properties: setInstancePropertiesSchema,
  create_component: createComponentSchema,
  create_component_set: createComponentSetSchema,
  add_component_property: addComponentPropertySchema,
  edit_component_property: editComponentPropertySchema,
  delete_component_property: deleteComponentPropertySchema,
  set_description: setDescriptionSchema,
  // Write — Variables & Tokens
  create_variable_collection: createVariableCollectionSchema,
  delete_variable_collection: deleteVariableCollectionSchema,
  create_variables: createVariablesSchema,
  update_variables: updateVariablesSchema,
  delete_variable: deleteVariableSchema,
  rename_variable: renameVariableSchema,
  add_mode: addModeSchema,
  rename_mode: renameModeSchema,
  setup_design_tokens: setupDesignTokensSchema,
  // Write — Pages
  create_page: createPageSchema,
  rename_page: renamePageSchema,
  delete_page: deletePageSchema,
  set_current_page: setCurrentPageSchema,
  // Write — Comments
  post_comment: postCommentSchema,
  delete_comment: deleteCommentSchema,
  // Utility
  execute: executeSchema,
  batch_execute: batchExecuteSchema,
  // Chat
  wait_for_chat: waitForChatSchema,
  send_chat_response: sendChatResponseSchema,
  send_chat_chunk: sendChatChunkSchema,
  // Notes
  note: noteSchema,
  notes: notesSchema,
  remove_note: removeNoteSchema,
  browse_notes: browseNotesSchema,
  cleanup_notes: cleanupNotesSchema
};

// src/server/tool-router.ts
var TOOL_ROUTES = {
  // ── Read Tools ──────────────────────────────────────────────────────────
  get_node: { category: "plugin", commandType: "GET_NODE" /* GET_NODE */ },
  get_selection: { category: "plugin", commandType: "GET_SELECTION" /* GET_SELECTION */ },
  get_page: { category: "plugin", commandType: "GET_NODE" /* GET_NODE */ },
  // Uses plugin for live data
  search_nodes: { category: "plugin", commandType: "SEARCH_NODES" /* SEARCH_NODES */ },
  screenshot: { category: "plugin", commandType: "SCREENSHOT" /* SCREENSHOT */ },
  get_styles: { category: "plugin", commandType: "GET_STYLES" /* GET_STYLES */, restFallback: true },
  get_variables: { category: "plugin", commandType: "GET_VARIABLES" /* GET_VARIABLES */, restFallback: true },
  get_components: { category: "plugin", commandType: "GET_COMPONENTS" /* GET_COMPONENTS */, restFallback: true },
  // ── Write Tools: Nodes ──────────────────────────────────────────────────
  create_node: { category: "plugin", commandType: "CREATE_NODE" /* CREATE_NODE */ },
  update_node: { category: "plugin", commandType: "UPDATE_NODE" /* UPDATE_NODE */ },
  batch_update_nodes: { category: "plugin", commandType: "UPDATE_NODE" /* UPDATE_NODE */ },
  delete_nodes: { category: "plugin", commandType: "DELETE_NODES" /* DELETE_NODES */ },
  clone_node: { category: "plugin", commandType: "CLONE_NODE" /* CLONE_NODE */ },
  reparent_node: { category: "plugin", commandType: "REPARENT_NODE" /* REPARENT_NODE */ },
  reorder_children: { category: "plugin", commandType: "REORDER_CHILDREN" /* REORDER_CHILDREN */ },
  // ── Write Tools: Text ───────────────────────────────────────────────────
  set_text: { category: "plugin", commandType: "SET_TEXT" /* SET_TEXT */ },
  // ── Write Tools: Visual Properties ──────────────────────────────────────
  set_fills: { category: "plugin", commandType: "SET_FILLS" /* SET_FILLS */ },
  set_strokes: { category: "plugin", commandType: "SET_STROKES" /* SET_STROKES */ },
  set_effects: { category: "plugin", commandType: "SET_EFFECTS" /* SET_EFFECTS */ },
  set_corner_radius: { category: "plugin", commandType: "SET_CORNER_RADIUS" /* SET_CORNER_RADIUS */ },
  // ── Write Tools: Layout ─────────────────────────────────────────────────
  set_auto_layout: { category: "plugin", commandType: "SET_AUTO_LAYOUT" /* SET_AUTO_LAYOUT */ },
  set_layout_child: { category: "plugin", commandType: "SET_LAYOUT_CHILD" /* SET_LAYOUT_CHILD */ },
  batch_set_layout_children: { category: "plugin", commandType: "BATCH_SET_LAYOUT_CHILDREN" /* BATCH_SET_LAYOUT_CHILDREN */ },
  set_layout_grid: { category: "plugin", commandType: "SET_LAYOUT_GRID" /* SET_LAYOUT_GRID */ },
  set_constraints: { category: "plugin", commandType: "SET_CONSTRAINTS" /* SET_CONSTRAINTS */ },
  // ── Write Tools: Components ─────────────────────────────────────────────
  instantiate_component: { category: "plugin", commandType: "INSTANTIATE_COMPONENT" /* INSTANTIATE_COMPONENT */ },
  set_instance_properties: { category: "plugin", commandType: "SET_INSTANCE_PROPERTIES" /* SET_INSTANCE_PROPERTIES */ },
  create_component: { category: "plugin", commandType: "CREATE_COMPONENT" /* CREATE_COMPONENT */ },
  create_component_set: { category: "plugin", commandType: "CREATE_COMPONENT_SET" /* CREATE_COMPONENT_SET */ },
  add_component_property: { category: "plugin", commandType: "ADD_COMPONENT_PROPERTY" /* ADD_COMPONENT_PROPERTY */ },
  edit_component_property: { category: "plugin", commandType: "EDIT_COMPONENT_PROPERTY" /* EDIT_COMPONENT_PROPERTY */ },
  delete_component_property: { category: "plugin", commandType: "DELETE_COMPONENT_PROPERTY" /* DELETE_COMPONENT_PROPERTY */ },
  set_description: { category: "plugin", commandType: "SET_DESCRIPTION" /* SET_DESCRIPTION */ },
  // ── Write Tools: Variables & Tokens ─────────────────────────────────────
  create_variable_collection: { category: "plugin", commandType: "CREATE_VARIABLE_COLLECTION" /* CREATE_VARIABLE_COLLECTION */ },
  delete_variable_collection: { category: "plugin", commandType: "DELETE_VARIABLE_COLLECTION" /* DELETE_VARIABLE_COLLECTION */ },
  create_variables: { category: "plugin", commandType: "CREATE_VARIABLES" /* CREATE_VARIABLES */ },
  update_variables: { category: "plugin", commandType: "UPDATE_VARIABLES" /* UPDATE_VARIABLES */ },
  delete_variable: { category: "plugin", commandType: "DELETE_VARIABLE" /* DELETE_VARIABLE */ },
  rename_variable: { category: "plugin", commandType: "RENAME_VARIABLE" /* RENAME_VARIABLE */ },
  add_mode: { category: "plugin", commandType: "ADD_MODE" /* ADD_MODE */ },
  rename_mode: { category: "plugin", commandType: "RENAME_MODE" /* RENAME_MODE */ },
  setup_design_tokens: { category: "plugin", commandType: "SETUP_DESIGN_TOKENS" /* SETUP_DESIGN_TOKENS */ },
  // ── Write Tools: Pages ──────────────────────────────────────────────────
  create_page: { category: "plugin", commandType: "CREATE_PAGE" /* CREATE_PAGE */ },
  rename_page: { category: "plugin", commandType: "RENAME_PAGE" /* RENAME_PAGE */ },
  delete_page: { category: "plugin", commandType: "DELETE_PAGE" /* DELETE_PAGE */ },
  set_current_page: { category: "plugin", commandType: "SET_CURRENT_PAGE" /* SET_CURRENT_PAGE */ },
  // ── Write Tools: Comments ───────────────────────────────────────────────
  post_comment: { category: "rest" },
  delete_comment: { category: "rest" },
  // ── Utility Tools ───────────────────────────────────────────────────────
  execute: { category: "plugin", commandType: "EXECUTE" /* EXECUTE */ },
  get_status: { category: "local" },
  batch_execute: { category: "plugin", commandType: "EXECUTE" /* EXECUTE */ },
  // ── Chat Tools ───────────────────────────────────────────────────────────
  wait_for_chat: { category: "local" },
  send_chat_response: { category: "local" },
  send_chat_chunk: { category: "local" },
  // ── Note Tools ───────────────────────────────────────────────────────────
  note: { category: "local" },
  notes: { category: "local" },
  remove_note: { category: "local" },
  browse_notes: { category: "local" },
  cleanup_notes: { category: "local" }
};
async function handleGetStyles(params, context) {
  const { getFile } = await import("./rest-api-DCR76CZK.js");
  const { FigmaClient: FigmaClient2 } = await import("./rest-api-DCR76CZK.js");
  const client = new FigmaClient2({ config: context.config, logger: context.logger });
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin."
    });
  }
  const file = await getFile(client, fileKey, { depth: 0 });
  const styles = file.styles ?? {};
  const types = params["types"];
  const result = Object.entries(styles).filter(([_key, style]) => !types || types.includes(style.styleType?.toLowerCase() ?? "")).map(([key, style]) => ({
    key,
    name: style.name,
    type: style.styleType,
    description: style.description
  }));
  return { styles: result };
}
async function handleGetVariables(params, context) {
  const { getLocalVariables } = await import("./rest-api-DCR76CZK.js");
  const { FigmaClient: FigmaClient2 } = await import("./rest-api-DCR76CZK.js");
  const client = new FigmaClient2({ config: context.config, logger: context.logger });
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin."
    });
  }
  const response = await getLocalVariables(client, fileKey);
  const collections = Object.values(response.meta?.variableCollections ?? {});
  const variables = Object.values(response.meta?.variables ?? {});
  const collectionFilter = params["collection"];
  const namePattern = params["namePattern"];
  const resolvedType = params["resolvedType"];
  let filteredCollections = collections;
  if (collectionFilter) {
    filteredCollections = collections.filter(
      (c) => c.name.toLowerCase().includes(collectionFilter.toLowerCase())
    );
  }
  const collectionIds = new Set(filteredCollections.map((c) => c.id));
  let filteredVars = variables.filter((v) => collectionIds.has(v.variableCollectionId));
  if (namePattern) {
    const regex = new RegExp(namePattern, "i");
    filteredVars = filteredVars.filter((v) => regex.test(v.name));
  }
  if (resolvedType) {
    filteredVars = filteredVars.filter((v) => v.resolvedType === resolvedType);
  }
  return {
    collections: filteredCollections.map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes,
      variables: filteredVars.filter((v) => v.variableCollectionId === c.id).map((v) => ({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        description: v.description,
        valuesByMode: v.valuesByMode
      }))
    }))
  };
}
async function handleGetComponents(params, context) {
  const { getFileComponents, getFileComponentSets } = await import("./rest-api-DCR76CZK.js");
  const { FigmaClient: FigmaClient2 } = await import("./rest-api-DCR76CZK.js");
  const client = new FigmaClient2({ config: context.config, logger: context.logger });
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin."
    });
  }
  const query = params["query"];
  const includeVariants = params["includeVariants"];
  const limit = params["limit"] ?? 25;
  const [componentsRes, componentSetsRes] = await Promise.all([
    getFileComponents(client, fileKey),
    includeVariants ? getFileComponentSets(client, fileKey) : Promise.resolve(null)
  ]);
  let components = componentsRes.meta?.components ?? [];
  if (query) {
    const q = query.toLowerCase();
    components = components.filter((c) => c.name.toLowerCase().includes(q));
  }
  components = components.slice(0, limit);
  const result = {
    components: components.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      containingFrame: c.containing_frame
    }))
  };
  if (componentSetsRes) {
    result["componentSets"] = componentSetsRes.meta?.component_sets ?? [];
  }
  return result;
}
async function handlePostComment(params, context) {
  const { postComment } = await import("./rest-api-DCR76CZK.js");
  const { FigmaClient: FigmaClient2 } = await import("./rest-api-DCR76CZK.js");
  const client = new FigmaClient2({ config: context.config, logger: context.logger });
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin."
    });
  }
  const nodeId = params["nodeId"];
  const replyTo = params["replyTo"];
  const commentParams = {
    message: params["message"],
    ...nodeId ? { client_meta: { node_id: nodeId, node_offset: { x: 0, y: 0 } } } : {},
    ...replyTo ? { comment_id: replyTo } : {}
  };
  const response = await postComment(client, fileKey, commentParams);
  return response;
}
async function handleDeleteComment(params, context) {
  const { deleteComment } = await import("./rest-api-DCR76CZK.js");
  const { FigmaClient: FigmaClient2 } = await import("./rest-api-DCR76CZK.js");
  const client = new FigmaClient2({ config: context.config, logger: context.logger });
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const fileKey = connectionInfo.fileKey;
  if (!fileKey) {
    throw validationError("No file is currently open. Connect the Figma plugin first.", {
      suggestion: "Open a Figma file and run the Rex plugin."
    });
  }
  await deleteComment(client, fileKey, params["commentId"]);
  return { deleted: true, commentId: params["commentId"] };
}
var REST_HANDLERS = {
  get_styles: handleGetStyles,
  get_variables: handleGetVariables,
  get_components: handleGetComponents,
  post_comment: handlePostComment,
  delete_comment: handleDeleteComment
};
async function handleGetStatus(_params, context) {
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const queueStats = context.relay.queue.getStats();
  const healthMetrics = context.relay.heartbeat.getMetrics();
  const state = connectionInfo["state"];
  const transport = connectionInfo["transport"];
  const memoryStore = context.relay.memoryStore;
  const pendingChat = context.relay.pendingChatCount;
  const ch = context.relay.boundPort;
  const pluginConnected = state !== "WAITING";
  return {
    channel: ch,
    _displayToUser: pluginConnected ? null : `
## Rex \xB7 Channel ${ch}

Enter **${ch}** in the Rex plugin to connect.
`,
    state,
    transport: {
      http: true,
      websocket: transport === "websocket"
    },
    plugin: {
      connected: state !== "WAITING",
      fileKey: connectionInfo["fileKey"] ?? null,
      fileName: connectionInfo["fileName"] ?? null,
      lastHeartbeat: connectionInfo["lastHeartbeat"] ?? null
    },
    queue: {
      pending: queueStats.pending,
      inFlight: queueStats.inFlight,
      completed: healthMetrics.commands.success,
      failed: healthMetrics.commands.failed
    },
    memory: {
      enabled: !!memoryStore,
      connected: memoryStore?.isConnected ?? false,
      url: memoryStore?.url ?? null
    },
    chat: {
      pendingMessages: pendingChat,
      hasMessages: pendingChat > 0
    },
    session: {
      id: context.relay.activeChatSessionId,
      name: context.relay.activeChatSessionName,
      _hint: context.relay.activeChatSessionId ? "Active chat session. History is loaded as context." : "No active chat session."
    },
    uptime: Math.floor(healthMetrics.connection.uptime / 1e3)
  };
}
async function handleWaitForChat(params, context) {
  const timeout = params["timeout"] ?? 3e4;
  const msg = await context.relay.waitForChatMessage(timeout);
  if (!msg) {
    const pending2 = context.relay.pendingChatCount;
    return {
      status: "timeout",
      pendingMessages: pending2,
      message: "No chat message received within timeout period. Call wait_for_chat again to keep listening.",
      _hint: pending2 > 0 ? `There are ${pending2} queued message(s). Call wait_for_chat again immediately to retrieve them.` : "IMPORTANT: Call wait_for_chat again immediately to continue listening for messages."
    };
  }
  const pending = context.relay.pendingChatCount;
  const result = {
    status: "received",
    id: msg.id,
    message: msg.message,
    selection: msg.selection,
    timestamp: msg.timestamp,
    pendingMessages: pending,
    _hint: pending > 0 ? `${pending} more message(s) queued. Call wait_for_chat again immediately to retrieve the next one.` : "After processing this message and sending a response with send_chat_response, call wait_for_chat again to listen for the next message."
  };
  if (context.relay.activeChatSessionName === "New Session") {
    result._sessionHint = "This is a new unnamed session. When you respond with send_chat_response, include a sessionName parameter (2-5 words, no quotes) that describes the topic of this conversation.";
  }
  return result;
}
async function handleSendChatResponse(params, context) {
  const messageId = params["messageId"];
  const message = params["message"];
  const isError = params["isError"] ?? false;
  const sessionName = params["sessionName"];
  if (sessionName) {
    context.relay.updateChatSessionName(sessionName);
  }
  context.relay.sendChatResponse({
    id: messageId,
    message,
    timestamp: Date.now(),
    isError
  });
  return {
    status: "sent",
    messageId,
    _hint: "Response delivered. Call wait_for_chat now to listen for the next message from the plugin."
  };
}
async function handleSendChatChunk(params, context) {
  const messageId = params["messageId"];
  const delta = params["delta"];
  const done = params["done"] ?? false;
  context.relay.sendChatChunk({
    id: messageId,
    delta,
    done,
    timestamp: Date.now()
  });
  if (done) {
    return {
      status: "sent",
      messageId,
      _hint: "Final chunk delivered. Call wait_for_chat now to listen for the next message from the plugin."
    };
  }
  return { status: "chunk_sent", messageId };
}
async function getMemoryStore(context) {
  const store = context.relay.memoryStore;
  if (!store) return null;
  if (!store.isConnected) {
    await store.ensureConnected();
  }
  return store.isConnected ? store : null;
}
function getMemoryContext(context) {
  const connectionInfo = context.relay.connection.getConnectionInfo();
  const userInfo = connectionInfo["user"];
  const fileKey = connectionInfo["fileKey"];
  return {
    userId: userInfo?.id,
    userName: userInfo?.name,
    fileKey: fileKey !== "unknown" ? fileKey : void 0,
    fileName: connectionInfo["fileName"],
    pageId: connectionInfo["pageId"],
    pageName: connectionInfo["pageName"]
  };
}
function addEmptyDebug(response, store, memCtx, hint) {
  response._debug = {
    serviceUrl: store.url,
    contextUsed: memCtx,
    hint
  };
}
var CATEGORY_LABELS = {
  convention: "Convention",
  decision: "Decision",
  context: "Context",
  rejection: "Rejected",
  relationship: "Relationship",
  preference: "Preference",
  correction: "Correction"
};
function formatSurfacedCard(note) {
  const label = CATEGORY_LABELS[note.category] ?? note.category;
  const confTag = (note.confidence ?? 1) < 0.5 ? " (low confidence)" : "";
  const by = note.createdBy || "Rex";
  return `:::surfaced{category="${label}${confTag}" by="${by}"}
${note.content}
:::`;
}
function formatSavedCard(label, summary) {
  return `:::saved{category="${label}" by="Rex"}
${summary}
:::`;
}
var SURFACED_FORMAT_HINT = "When sending these notes to chat via send_chat_response/send_chat_chunk, use the _chatMarkdown field. Condense each card body to 1-3 sentences \u2014 keep exact values (hex, px, component names) but drop verbose explanations, **Why:**/**How to apply:** sections, timestamps, and tags. Preserve **bold** sparingly for the single most important value. Max 5 cards per response in relevance order. Add a brief intro line before cards and a closing line after. Add :::action lines ONLY when a note conflicts with the user's current request (max 3 short labels). If more notes exist than shown, mention how many remain.";
var SAVED_FORMAT_HINT = "When sending to chat via send_chat_response/send_chat_chunk, use the _chatMarkdown field. Condense the body to a short summary of what was saved. Never add actions to saved cards.";
async function handleNote(params, context) {
  const store = await getMemoryStore(context);
  if (!store) {
    return {
      _source: "rex-cloud",
      status: "disabled",
      message: "Note system is not available. Check that the memory service is reachable."
    };
  }
  const memCtx = getMemoryContext(context);
  const scope = params["scope"] ?? "file";
  if ((scope === "file" || scope === "page") && !memCtx.fileKey) {
    return {
      _source: "rex-cloud",
      status: "error",
      message: `Cannot store a ${scope}-scoped note without a connected Figma file. Connect the plugin first, or use scope: "team".`
    };
  }
  const tags = params["tags"] ?? [];
  if (memCtx.pageName && !tags.includes(`page:${memCtx.pageName}`)) {
    tags.push(`page:${memCtx.pageName}`);
  }
  const componentKey = params["componentKey"];
  if (componentKey) {
    memCtx.componentKey = componentKey;
  }
  const entry = await store.remember({
    scope,
    category: params["category"] ?? "convention",
    content: params["content"],
    tags,
    source: "explicit",
    context: memCtx
  });
  const savedLabel = "Saved to notes";
  const savedContent = params["content"];
  return {
    _source: "rex-cloud",
    status: "stored",
    id: entry._id,
    scope: entry.scope,
    category: entry.category,
    confidence: entry.confidence,
    _chatMarkdown: formatSavedCard(savedLabel, savedContent),
    _formatHint: SAVED_FORMAT_HINT
  };
}
async function handleNotes(params, context) {
  const store = await getMemoryStore(context);
  if (!store) {
    return { _source: "rex-cloud", status: "disabled", notes: [] };
  }
  const memCtx = getMemoryContext(context);
  const results = await store.recall({
    query: params["query"],
    scope: params["scope"],
    category: params["category"],
    componentKey: params["componentKey"],
    limit: params["limit"],
    context: memCtx
  });
  const notesData = results.map((m) => ({
    id: m._id,
    scope: m.scope,
    category: m.category,
    content: m.content,
    tags: m.tags,
    confidence: m.confidence,
    createdBy: m.createdBy?.name,
    createdAt: m.createdAt,
    accessCount: m.accessCount
  }));
  const response = {
    _source: "rex-cloud",
    notes: notesData,
    count: results.length
  };
  if (results.length === 0) {
    addEmptyDebug(response, store, memCtx, "Query returned 0 results. Check that the service has notes matching this context (fileKey, userId).");
  } else {
    response._chatMarkdown = notesData.map((n) => formatSurfacedCard({
      category: n.category,
      content: n.content,
      createdBy: n.createdBy,
      confidence: n.confidence
    })).join("\n\n");
    response._formatHint = SURFACED_FORMAT_HINT;
  }
  return response;
}
async function handleRemoveNote(params, context) {
  const store = await getMemoryStore(context);
  if (!store) {
    return { _source: "rex-cloud", status: "disabled" };
  }
  const memCtx = getMemoryContext(context);
  const deleted = await store.forget(
    memCtx,
    params["id"],
    params["query"],
    params["scope"]
  );
  return { _source: "rex-cloud", status: "deleted", count: deleted };
}
async function handleBrowseNotes(params, context) {
  const store = await getMemoryStore(context);
  if (!store) {
    return { _source: "rex-cloud", status: "disabled", notes: [] };
  }
  const memCtx = getMemoryContext(context);
  const results = await store.list(
    memCtx,
    params["scope"],
    params["category"],
    params["limit"],
    params["includeSuperseded"]
  );
  const notesData = results.map((m) => ({
    id: m._id,
    scope: m.scope,
    category: m.category,
    content: m.content,
    tags: m.tags,
    confidence: m.confidence,
    createdBy: m.createdBy?.name,
    createdAt: m.createdAt,
    accessCount: m.accessCount,
    supersededBy: m.supersededBy
  }));
  const response = {
    _source: "rex-cloud",
    notes: notesData,
    count: results.length
  };
  if (results.length === 0) {
    addEmptyDebug(response, store, memCtx, "No notes found. Check that the service has notes matching this context (fileKey, userId). Use scope: 'team' to query cross-file notes.");
  } else {
    response._chatMarkdown = notesData.map((n) => formatSurfacedCard({
      category: n.category,
      content: n.content,
      createdBy: n.createdBy,
      confidence: n.confidence
    })).join("\n\n");
    response._formatHint = SURFACED_FORMAT_HINT;
  }
  return response;
}
async function handleCleanupNotes(params, context) {
  const store = await getMemoryStore(context);
  if (!store) {
    return { _source: "rex-cloud", status: "disabled" };
  }
  const result = await store.cleanup({
    dryRun: params["dryRun"],
    maxAgeDays: params["maxAgeDays"],
    minConfidence: params["minConfidence"],
    removeSuperseded: params["removeSuperseded"]
  });
  return {
    _source: "rex-cloud",
    status: result.dryRun ? "preview" : "cleaned",
    ...result
  };
}
var LOCAL_HANDLERS = {
  get_status: handleGetStatus,
  wait_for_chat: handleWaitForChat,
  send_chat_response: handleSendChatResponse,
  send_chat_chunk: handleSendChatChunk,
  note: handleNote,
  notes: handleNotes,
  remove_note: handleRemoveNote,
  browse_notes: handleBrowseNotes,
  cleanup_notes: handleCleanupNotes
};
async function routeToolCall(toolName, args, relay, config, logger) {
  const route = TOOL_ROUTES[toolName];
  if (!route) {
    throw validationError(`Unknown tool: ${toolName}`, {
      suggestion: "Use get_status to check available tools, or check the tool name for typos."
    });
  }
  let validatedParams = args;
  if (toolName !== "get_status") {
    const schema = schemaRegistry[toolName];
    if (schema) {
      try {
        validatedParams = schema.parse(args);
      } catch (err) {
        if (err instanceof ZodError) {
          const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          throw validationError(`Invalid parameters for ${toolName}: ${issues}`, {
            category: "SCHEMA_VIOLATION" /* SCHEMA_VIOLATION */,
            suggestion: `Check the parameter types and required fields for ${toolName}.`
          });
        }
        throw err;
      }
    }
  }
  const context = {
    relay,
    config,
    logger: logger.child({ tool: toolName }),
    enqueueCommand: (type, payload) => enqueuePluginCommand(type, payload, relay, config)
  };
  if (toolName !== "wait_for_chat" && toolName !== "send_chat_chunk") {
    relay.signalActivity(true);
  }
  try {
    switch (route.category) {
      case "plugin": {
        if (route.restFallback && REST_HANDLERS[toolName]) {
          try {
            const result = await REST_HANDLERS[toolName](validatedParams, context);
            context.logger.debug(`${toolName} served via REST API`);
            return result;
          } catch (restErr) {
            context.logger.warn(
              `${toolName} REST fallback failed, routing to plugin: ${restErr.message}`
            );
          }
        }
        return await handlePluginTool(toolName, validatedParams, route, context);
      }
      case "rest": {
        const handler = REST_HANDLERS[toolName];
        if (!handler) {
          throw new RexError({
            category: "INTERNAL_ERROR" /* INTERNAL_ERROR */,
            message: `No REST handler registered for tool: ${toolName}`,
            retryable: false
          });
        }
        return await handler(validatedParams, context);
      }
      case "local": {
        const handler = LOCAL_HANDLERS[toolName];
        if (!handler) {
          throw new RexError({
            category: "INTERNAL_ERROR" /* INTERNAL_ERROR */,
            message: `No local handler registered for tool: ${toolName}`,
            retryable: false
          });
        }
        return await handler(validatedParams, context);
      }
      default:
        throw new RexError({
          category: "INTERNAL_ERROR" /* INTERNAL_ERROR */,
          message: `Unknown tool category for: ${toolName}`,
          retryable: false
        });
    }
  } finally {
    if (toolName !== "wait_for_chat" && toolName !== "send_chat_chunk") {
      relay.signalActivity(false);
    }
  }
}
async function handlePluginTool(toolName, params, route, context) {
  if (!route.commandType) {
    throw new RexError({
      category: "INTERNAL_ERROR" /* INTERNAL_ERROR */,
      message: `No command type mapped for plugin tool: ${toolName}`,
      retryable: false
    });
  }
  if (toolName === "batch_execute") {
    return handleBatchExecute(params, context);
  }
  const result = await context.enqueueCommand(route.commandType, params);
  if (result.status === "error") {
    throw new RexError({
      category: result.error?.category ?? "INTERNAL_ERROR" /* INTERNAL_ERROR */,
      message: result.error?.message ?? "Plugin command failed",
      retryable: result.error?.retryable ?? false,
      commandId: result.id,
      nodeId: result.error?.nodeId,
      figmaError: result.error?.figmaError,
      suggestion: result.error?.suggestion
    });
  }
  return result.result ?? {};
}
async function handleBatchExecute(params, context) {
  const operations = params["operations"];
  const atomic = params["atomic"] ?? true;
  const batchId = uuidv4();
  const results = [];
  const errors = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const route = TOOL_ROUTES[op.tool];
    if (!route || !route.commandType) {
      const err = { index: i, error: { message: `Unknown tool in batch: ${op.tool}` } };
      if (atomic) {
        return {
          status: "error",
          message: `Batch failed at operation ${i}: unknown tool "${op.tool}"`,
          completedResults: results,
          errors: [err]
        };
      }
      errors.push(err);
      results.push({ error: err.error });
      continue;
    }
    try {
      const command = buildCommand(route.commandType, op.params, context.config, batchId, i, operations.length);
      const result = await context.relay.sendCommand(command);
      if (result.status === "error") {
        const err = { index: i, error: result.error ?? { message: "Unknown error" } };
        if (atomic) {
          return {
            status: "error",
            message: `Batch failed at operation ${i}`,
            completedResults: results,
            errors: [err]
          };
        }
        errors.push(err);
        results.push({ error: result.error });
      } else {
        results.push(result.result ?? {});
      }
    } catch (caught) {
      const hErr = toRexError(caught);
      const err = { index: i, error: hErr.toResponse().error };
      if (atomic) {
        return {
          status: "error",
          message: `Batch failed at operation ${i}: ${hErr.message}`,
          completedResults: results,
          errors: [err]
        };
      }
      errors.push(err);
      results.push({ error: err.error });
    }
  }
  return {
    status: errors.length > 0 ? "partial" : "success",
    results,
    ...errors.length > 0 && { errors }
  };
}
function enqueuePluginCommand(type, payload, relay, config) {
  const command = buildCommand(type, payload, config);
  return relay.sendCommand(command);
}
function buildCommand(type, payload, config, batchId, batchSeq, batchTotal) {
  const ttl = type === "SCREENSHOT" /* SCREENSHOT */ ? config.commands.defaultTtl * 2 : config.commands.defaultTtl;
  const command = {
    id: uuidv4(),
    type,
    payload,
    timestamp: Date.now(),
    ttl
  };
  if (batchId !== void 0) {
    command.batchId = batchId;
    command.batchSeq = batchSeq;
    command.batchTotal = batchTotal;
    command.atomic = true;
  }
  return command;
}

// src/server/mcp-server.ts
var TOOL_DESCRIPTIONS = {
  // ── Read Tools ──────────────────────────────────────────────────────────
  get_node: "Get detailed data for one or more nodes by ID. Supports depth traversal and property filtering.",
  get_selection: "Get the currently selected nodes in Figma. Requires the plugin to be connected.",
  get_page: "Get page structure and metadata. Can return summary, standard, or full detail levels.",
  search_nodes: "Search for nodes by name, type, or properties. Supports scoping to a subtree.",
  screenshot: "Capture a screenshot of a node or the current page as PNG, JPG, or SVG. For large frames, use maxDimension (e.g. 1024) to auto-downscale and avoid timeout. Scale accepts 0.5-4.",
  get_styles: "Get all styles (fill, text, effect, grid) from the current file.",
  get_variables: "Get variables and collections from the current file. Supports filtering by collection, name pattern, and type.",
  get_components: "Get published components and component sets. Supports search and variant details.",
  // ── Write Tools: Nodes ──────────────────────────────────────────────────
  create_node: "Create a single node or a composite node tree with children, styles, auto-layout, and effects. Atomic: creates the full tree or nothing. NOTE: layoutSizingHorizontal/Vertical='FILL' can only be set AFTER the node is a child of an auto-layout frame \u2014 use update_node after reparenting if needed.",
  update_node: "Update one or more properties on an existing node. Batch-friendly: set any combination of properties in a single call.",
  batch_update_nodes: "Update multiple nodes in a single atomic operation. If any update fails, all are rolled back.",
  delete_nodes: "Delete one or more nodes by ID.",
  clone_node: "Duplicate a node, optionally to a different parent with a new position and name.",
  reparent_node: "Move a node to a different parent, optionally at a specific child index.",
  reorder_children: "Reorder children within a parent for z-index control. First ID = bottommost.",
  // ── Write Tools: Text ───────────────────────────────────────────────────
  set_text: "Set text content and optionally style it. Handles font loading automatically. Supports mixed styling via style ranges.",
  // ── Write Tools: Visual Properties ──────────────────────────────────────
  set_fills: "Set fill paints on a node. Supports solid, linear gradient, radial gradient, and image fills.",
  set_strokes: "Set strokes on a node with weight, alignment, dash pattern, cap, and join options.",
  set_effects: "Set effects (drop shadow, inner shadow, layer blur, background blur) on a node.",
  set_corner_radius: "Set corner radius on a node. Supports uniform or per-corner values.",
  // ── Write Tools: Layout ─────────────────────────────────────────────────
  set_auto_layout: "Configure auto-layout on a frame: direction, spacing, padding, alignment, sizing. Can also remove auto-layout. NOTE: counterAxisSizingMode only accepts FIXED or AUTO (not FILL). To get fill behavior, use layoutSizingHorizontal/Vertical='FILL' on the child via update_node.",
  set_layout_child: "Configure how a child behaves within its auto-layout parent: alignment, grow, positioning. NOTE: To make a child fill its parent's width/height, set layoutSizingHorizontal/Vertical='FILL' via update_node instead of counterAxisSizingMode='FILL'.",
  batch_set_layout_children: "Configure multiple children's layout behavior in one call within an auto-layout parent.",
  set_layout_grid: "Set layout grids (columns, rows, or uniform grid) on a frame.",
  set_constraints: "Set constraints for a node inside a non-auto-layout frame.",
  // ── Write Tools: Components ─────────────────────────────────────────────
  instantiate_component: "Create an instance of a component from the document or a library. Supports variant selection and property overrides.",
  set_instance_properties: "Update properties on a component instance. Can also reset overrides to defaults.",
  create_component: "Convert an existing frame to a component with an optional description.",
  create_component_set: "Combine multiple components into a component set (variant group).",
  add_component_property: "Add a property (boolean, text, instance swap, or variant) to a component or component set.",
  edit_component_property: "Modify an existing component property's name or default value.",
  delete_component_property: "Remove a property from a component or component set.",
  set_description: "Set a description on a component, component set, or style.",
  // ── Write Tools: Variables & Tokens ─────────────────────────────────────
  create_variable_collection: "Create a new variable collection with optional initial mode name and additional modes.",
  delete_variable_collection: "Delete a collection and all its variables.",
  create_variables: "Create one or more variables in a collection with type, description, and values by mode.",
  update_variables: "Update variable values for specific modes. Supports batch updates up to 100.",
  delete_variable: "Delete a single variable by ID.",
  rename_variable: "Rename a variable. Supports '/' for grouping.",
  add_mode: "Add a mode to a variable collection.",
  rename_mode: "Rename an existing mode in a variable collection.",
  setup_design_tokens: "Create a complete token system in one atomic operation: collection + modes + variables with values.",
  // ── Write Tools: Page & Document ────────────────────────────────────────
  create_page: "Create a new page in the document at an optional position.",
  rename_page: "Rename a page.",
  delete_page: "Delete a page and all its contents.",
  set_current_page: "Switch the active page in Figma.",
  // ── Write Tools: Comments ───────────────────────────────────────────────
  post_comment: "Post a comment on the file, optionally pinned to a node or position. Supports replies.",
  delete_comment: "Delete a comment by ID.",
  // ── Utility Tools ───────────────────────────────────────────────────────
  execute: "Run arbitrary JavaScript in Figma's plugin context. Escape hatch for operations not covered by dedicated tools. 10s timeout, no network access.",
  get_status: "Get Rex connection status including the channel number (port) the user needs to connect the Figma plugin. Also returns transport info, plugin state, queue stats, and uptime.",
  batch_execute: "Execute multiple independent operations in a single atomic call. More efficient than multiple individual tool calls.",
  // ── Chat Tools ──────────────────────────────────────────────────────────
  wait_for_chat: "Long-poll for a chat message from the Figma plugin. IMPORTANT: Before starting the listen loop, call get_status first. If the plugin is not connected, display the _displayToUser field EXACTLY as-is to the user \u2014 it contains the channel number they need. Then start the listen loop: call this tool, and after every response you send, call it again immediately. After timeout, call it again. Never stop unless the user explicitly asks.",
  send_chat_response: "Send a response message back to the Figma plugin chat interface. After calling this, you MUST call wait_for_chat again immediately to continue listening for the next message.",
  send_chat_chunk: "Send a streaming text chunk to the Figma plugin chat. Call multiple times with done:false for each chunk, then once with done:true for the final chunk. This creates a real-time typing effect in the plugin.",
  // ── Note Tools ───────────────────────────────────────────────────────────
  note: "Store design knowledge \u2014 triggered by 'note this', 'take note', 'remember this about the design'. Shared with the team. IMPORTANT: When the user asks to note, remember, store, or commit design knowledge, ALWAYS use this tool instead of file-based memory. Notes persist across sessions and are shared with all team members.",
  notes: "Query design knowledge \u2014 triggered by 'what do you know about', 'check your notes', 'recall'. Returns from cloud storage. Returns relevant notes from all scopes (user, team, file, page) ranked by confidence and recency.",
  remove_note: "Delete a specific note by ID or remove notes matching a search query.",
  browse_notes: "List all design knowledge \u2014 triggered by 'show me what you know', 'list your notes'. Filter by scope (user/team/file/page) and category (decision/convention/context/etc).",
  cleanup_notes: "Remove stale, low-confidence, and superseded notes. Run with dryRun:true first to preview what would be removed."
};
function zodSchemaToJsonSchema(schema) {
  return zodToJsonSchema(schema, { target: "jsonSchema7" });
}
function buildToolDefinitions() {
  const tools = [];
  for (const [name, schema] of Object.entries(schemaRegistry)) {
    const description = TOOL_DESCRIPTIONS[name];
    if (!description) {
      throw new Error(`Missing description for tool: ${name}`);
    }
    tools.push({
      name,
      description,
      inputSchema: zodSchemaToJsonSchema(schema)
    });
  }
  tools.push({
    name: "get_status",
    description: TOOL_DESCRIPTIONS["get_status"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  });
  return tools;
}
var RexMcpServer = class {
  server;
  relay;
  config;
  logger;
  toolDefinitions;
  constructor(config, logger) {
    this.config = config;
    this.logger = logger.child({ component: "mcp-server" });
    this.toolDefinitions = buildToolDefinitions();
    this.server = new Server(
      {
        name: "rex",
        version: "0.1.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );
    this.relay = new RelayServer(config, logger);
    this.registerHandlers();
  }
  /**
   * Start the MCP server on stdio transport and the embedded relay server.
   */
  async start() {
    await this.relay.start();
    const channel = this.relay.boundPort;
    this.logger.info("Relay server started", {
      host: this.config.relay.host,
      channel
    });
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info("MCP server listening on stdio");
  }
  /**
   * Gracefully shut down both servers.
   */
  async stop() {
    this.logger.info("Shutting down Rex");
    try {
      await this.server.close();
    } catch (err) {
      this.logger.error("Error closing MCP server", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    try {
      await this.relay.stop();
    } catch (err) {
      this.logger.error("Error closing relay server", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    this.logger.info("Rex shut down complete");
  }
  /**
   * Get the relay server instance (for direct access to command queue, etc.).
   */
  getRelay() {
    return this.relay;
  }
  // ─── Handler Registration ───────────────────────────────────────────────
  registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolDefinitions.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      };
    });
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      this.logger.debug("Tool call received", { tool: name });
      try {
        const result = await routeToolCall(
          name,
          args ?? {},
          this.relay,
          this.config,
          this.logger
        );
        const text = JSON.stringify(result, null, 2);
        const MAX_RESPONSE_CHARS = 2e5;
        if (text.length > MAX_RESPONSE_CHARS) {
          const truncated = truncateResponse(result, MAX_RESPONSE_CHARS);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(truncated, null, 2)
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text
            }
          ]
        };
      } catch (err) {
        const { toRexError: toRexError2 } = await import("./errors-ZJFJLQDD.js");
        const hErr = toRexError2(err);
        const errorResponse = hErr.toResponse();
        this.logger.error("Tool call failed", {
          tool: name,
          category: hErr.category,
          message: hErr.message
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }
          ],
          isError: true
        };
      }
    });
  }
};
function truncateResponse(result, maxChars) {
  const copy = JSON.parse(JSON.stringify(result));
  if (typeof copy === "object" && copy !== null) {
    stripChildrenRecursive(copy, 1);
    let text = JSON.stringify(copy, null, 2);
    if (text.length > maxChars) {
      stripChildrenRecursive(copy, 0);
      text = JSON.stringify(copy, null, 2);
    }
    if (text.length > maxChars) {
      return {
        _truncated: true,
        _message: `Response too large (${text.length} chars). Use get_node with specific nodeIds and depth:0 to inspect individual nodes.`,
        _originalKeys: Object.keys(copy)
      };
    }
    copy._truncated = true;
    copy._message = "Response was truncated to fit size limits. Use get_node with specific nodeIds for full detail.";
  }
  return copy;
}
function stripChildrenRecursive(obj, maxDepth, currentDepth = 0) {
  if (typeof obj !== "object" || obj === null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "object" && item !== null) {
        stripChildrenRecursive(
          item,
          maxDepth,
          currentDepth
        );
      }
    }
    return;
  }
  if (currentDepth >= maxDepth && "children" in obj) {
    const children = obj["children"];
    if (Array.isArray(children) && children.length > 0) {
      obj["_childCount"] = children.length;
      obj["children"] = children.slice(0, 5).map((c) => {
        if (typeof c === "object" && c !== null) {
          const summary = {
            nodeId: c["nodeId"],
            name: c["name"],
            type: c["type"]
          };
          if (c["children"]) {
            summary._childCount = c["children"].length;
          }
          return summary;
        }
        return c;
      });
      obj["_childrenTruncated"] = true;
    }
    return;
  }
  for (const value of Object.values(obj)) {
    if (typeof value === "object" && value !== null) {
      stripChildrenRecursive(
        value,
        maxDepth,
        currentDepth + 1
      );
    }
  }
}

// src/index.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });
function parseCliArgs() {
  const args = process.argv.slice(2);
  const result = {
    logLevel: "info"
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
        result.logLevel = args[++i];
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
        console.error("rex v0.1.0");
        process.exit(0);
        break;
      default:
        break;
    }
  }
  const envLogLevel = process.env["LOG_LEVEL"];
  if (envLogLevel && ["debug", "info", "warn", "error"].includes(envLogLevel)) {
    result.logLevel = envLogLevel;
  }
  return result;
}
function printUsage() {
  const usage = `
Rex \u2014 Figma MCP Server

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
  process.stderr.write(usage + "\n");
}
async function main() {
  const cliArgs = parseCliArgs();
  if (cliArgs.port) {
    process.env["RELAY_PORT"] = String(cliArgs.port);
  }
  const config = loadConfig(cliArgs.configPath);
  const logger = createLogger(cliArgs.logLevel, {
    service: "rex",
    version: "0.1.0"
  });
  logger.info("Starting Rex MCP server", {
    relayPort: config.relay.port,
    relayHost: config.relay.host,
    wsEnabled: config.websocket.enabled,
    logLevel: cliArgs.logLevel
  });
  const server = new RexMcpServer(config, logger);
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Received shutdown signal", { signal });
    try {
      await server.stop();
    } catch (err) {
      logger.error("Error during shutdown", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", {
      error: err.message,
      stack: err.stack
    });
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason)
    });
  });
  try {
    await server.start();
    const channel = server.getRelay().boundPort;
    process.stderr.write(`
`);
    process.stderr.write(`  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
`);
    process.stderr.write(`  \u2551                               \u2551
`);
    process.stderr.write(`  \u2551   REX \xB7 channel ${String(channel).padEnd(13)}\u2551
`);
    process.stderr.write(`  \u2551                               \u2551
`);
    process.stderr.write(`  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    process.stderr.write(`
`);
  } catch (err) {
    logger.error("Failed to start Rex", {
      error: err instanceof Error ? err.message : String(err)
    });
    process.exit(1);
  }
}
void main();
export {
  BlendMode,
  CommandStatus,
  CommandType,
  ConnectionState,
  ErrorCategory,
  NodeType,
  RexError,
  RexMcpServer,
  connectionError,
  createLogger,
  figmaApiError,
  internalError,
  loadConfig,
  validationError
};
//# sourceMappingURL=index.js.map