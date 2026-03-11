import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { Command, CommandResult } from "../shared/types.js";
import { ErrorCategory } from "../shared/types.js";
import { RexError } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { Config } from "../shared/config.js";
import { CommandQueue } from "./command-queue.js";
import { ConnectionManager } from "./connection.js";
import type { ConnectPayload } from "./connection.js";
import { HeartbeatMonitor } from "./heartbeat.js";
import { CommentWatcher } from "./comment-watcher.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** WebSocket message envelope. */
interface WsMessage {
  type: "command" | "result" | "ack" | "ping" | "pong";
  id?: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

/** Adaptive polling state. */
interface PollingState {
  lastCommandTime: number;
}

// ─── Relay Server ───────────────────────────────────────────────────────────

const VERSION = "0.1.0";

export class RelayServer {
  private readonly config: Config;
  private readonly logger: Logger;
  readonly queue: CommandQueue;
  readonly connection: ConnectionManager;
  readonly heartbeat: HeartbeatMonitor;

  private fastify: FastifyInstance | null = null;
  private wss: WebSocketServer | null = null;
  private wsClient: WebSocket | null = null;
  private startTime: number = 0;
  private pollingState: PollingState = { lastCommandTime: 0 };

  // Chat message queue (plugin → MCP server)
  private chatInbox: Array<{ id: string; message: string; selection: unknown[]; timestamp: number }> = [];
  private chatWaiters: Array<{ resolve: (msg: { id: string; message: string; selection: unknown[]; timestamp: number }) => void; timer: ReturnType<typeof setTimeout> }> = [];

  // Chat response queue (MCP server → plugin)
  private chatOutbox: Array<{ id: string; message: string; timestamp: number; isError?: boolean; _isChunk?: boolean; _done?: boolean }> = [];

  // Comment watcher for @rex mentions
  private readonly commentWatcher: CommentWatcher;

  constructor(config: Config, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: "relay-server" });
    this.queue = new CommandQueue(config.commands, this.logger);
    this.connection = new ConnectionManager(this.logger);
    this.heartbeat = new HeartbeatMonitor(
      this.connection,
      config.websocket,
      this.logger,
    );

    // Create comment watcher — injects @rex mentions into chat inbox
    this.commentWatcher = new CommentWatcher(config, this.logger, (msg) => {
      this.enqueueChatMessage(msg);
    });

    this.wireQueueEvents();
  }

  /** Wire command queue events to heartbeat metrics. */
  private wireQueueEvents(): void {
    this.queue.on("enqueued", () => {
      this.heartbeat.recordCommandTotal();
    });
    this.queue.on("completed", (_id: string, result: CommandResult) => {
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
  async start(): Promise<void> {
    this.startTime = Date.now();

    const { host, port } = this.config.relay;

    // Create Fastify instance with a custom HTTP server so we can intercept
    // upgrade requests for WebSocket before Fastify processes them.
    this.fastify = Fastify({
      logger: false, // We use our own logger
      bodyLimit: 10 * 1024 * 1024, // 10MB — screenshots and deep node trees can be large
    });

    // CORS: Figma plugin UI iframe has origin "null", must allow cross-origin
    this.fastify.addHook("onRequest", async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, X-Plugin-Id, X-Plugin-File, X-Session-Id, X-Auth-Token");

      if (request.method === "OPTIONS") {
        reply.status(204).send();
      }
    });

    this.registerRoutes(this.fastify);

    // Start Fastify
    await this.fastify.listen({ host, port });

    // Set up WebSocket server on the same HTTP server
    if (this.config.websocket.enabled) {
      const httpServer = this.fastify.server;
      this.wss = new WebSocketServer({ noServer: true });

      httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        this.handleUpgrade(request, socket, head);
      });

      this.logger.info("WebSocket server ready on upgrade path /ws");
    }

    this.logger.info("Relay server started", { host, port });
  }

  /**
   * Stop the relay server gracefully.
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping relay server");

    // Close WebSocket
    if (this.wsClient) {
      this.wsClient.close(1001, "Server shutting down");
      this.wsClient = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Clean up chat waiters
    for (const waiter of this.chatWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null as unknown as { id: string; message: string; selection: unknown[]; timestamp: number });
    }
    this.chatWaiters = [];
    this.chatInbox = [];
    this.chatOutbox = [];
    if (this.chatListeningGraceTimer) {
      clearTimeout(this.chatListeningGraceTimer);
      this.chatListeningGraceTimer = null;
    }
    this._chatListening = false;

    // Clean up components
    this.commentWatcher.stop();
    this.heartbeat.destroy();
    this.queue.destroy();

    // Close Fastify
    if (this.fastify) {
      await this.fastify.close();
      this.fastify = null;
    }

    this.logger.info("Relay server stopped");
  }

  // ─── Activity Signal ──────────────────────────────────────────────────

  /** Track active tool count for nested/parallel tool calls. */
  private activeToolCount = 0;

  /**
   * Signal that a tool is starting or finishing.
   * Pushes a lightweight notification to the plugin so the forging
   * animation shows while Claude is working — before commands even arrive.
   */
  signalActivity(active: boolean): void {
    if (active) {
      this.activeToolCount++;
    } else {
      this.activeToolCount = Math.max(0, this.activeToolCount - 1);
    }

    const shouldForge = this.activeToolCount > 0;

    // Push via WebSocket if connected (instant delivery)
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      const msg: WsMessage = {
        type: "command",
        id: "activity-signal",
        payload: { activity: shouldForge } as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      };
      this.wsClient.send(JSON.stringify(msg));
    }

    // Also store for HTTP polling pickup
    this._activityState = shouldForge;
  }

  /** Current activity state for HTTP polling responses. */
  private _activityState = false;

  /** Whether any tools are currently active (for polling responses). */
  get isActive(): boolean {
    return this._activityState;
  }

  /** Whether wait_for_chat is actively listening (for plugin to show/hide chat button). */
  private _chatListening = false;
  private chatListeningGraceTimer: ReturnType<typeof setTimeout> | null = null;

  get chatListening(): boolean {
    return this._chatListening;
  }

  private setChatListening(listening: boolean): void {
    // Clear any pending grace timer
    if (this.chatListeningGraceTimer) {
      clearTimeout(this.chatListeningGraceTimer);
      this.chatListeningGraceTimer = null;
    }

    if (this._chatListening === listening) return;
    this._chatListening = listening;

    // Push via WebSocket if connected
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      const msg: WsMessage = {
        type: "command",
        id: "chat-listening",
        payload: { listening } as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      };
      this.wsClient.send(JSON.stringify(msg));
    }
  }

  /**
   * Schedule chatListening = false after a grace period.
   * Cancelled if wait_for_chat is called again before it fires.
   */
  private scheduleChatListeningTimeout(): void {
    if (this.chatListeningGraceTimer) {
      clearTimeout(this.chatListeningGraceTimer);
    }
    this.chatListeningGraceTimer = setTimeout(() => {
      this.chatListeningGraceTimer = null;
      // If Claude is still working on tools, reschedule — it will call wait_for_chat when done
      if (this.chatWaiters.length === 0 && this.activeToolCount > 0) {
        this.scheduleChatListeningTimeout();
        return;
      }
      // If no waiters registered in the grace period, stop listening
      if (this.chatWaiters.length === 0) {
        this.setChatListening(false);
      }
    }, 5000);
  }

  // ─── Chat Infrastructure ──────────────────────────────────────────────

  /**
   * Called by the plugin to send a chat message.
   * If an MCP tool is long-polling (via wait_for_chat), resolve it immediately.
   */
  enqueueChatMessage(msg: { id: string; message: string; selection: unknown[]; timestamp: number }): void {
    // If there's a waiter, resolve immediately
    const waiter = this.chatWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
      // If no more waiters, start grace timer — Claude should call wait_for_chat again soon
      if (this.chatWaiters.length === 0) {
        this.scheduleChatListeningTimeout();
      }
      return;
    }
    // Otherwise queue it
    this.chatInbox.push(msg);
  }

  /**
   * Called by the MCP tool `wait_for_chat` to long-poll for a message.
   * Returns immediately if there's a queued message, otherwise waits up to timeoutMs.
   */
  waitForChatMessage(timeoutMs: number): Promise<{ id: string; message: string; selection: unknown[]; timestamp: number } | null> {
    // Check inbox first
    const queued = this.chatInbox.shift();
    if (queued) {
      // Still listening — signal stays true
      this.setChatListening(true);
      return Promise.resolve(queued);
    }

    // Signal that we're listening
    this.setChatListening(true);

    // Long-poll
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter
        const idx = this.chatWaiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this.chatWaiters.splice(idx, 1);
        // If no more waiters, start grace timer — Claude should re-call wait_for_chat soon
        if (this.chatWaiters.length === 0) {
          this.scheduleChatListeningTimeout();
        }
        resolve(null);
      }, timeoutMs);

      this.chatWaiters.push({ resolve, timer });
    });
  }

  /**
   * Called by the MCP tool `send_chat_response` to push a response back to the plugin.
   * Delivers via WebSocket if connected, otherwise queues for HTTP polling.
   */
  sendChatResponse(response: { id: string; message: string; timestamp: number; isError?: boolean }): void {
    // ALWAYS queue for HTTP polling — this is the reliable baseline.
    // WebSocket is an optional fast path but can silently fail.
    this.chatOutbox.push(response);

    // Also push via WebSocket for instant delivery (best-effort)
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      try {
        const msg: WsMessage = {
          type: "command",
          id: "chat-response",
          payload: { chatResponse: response } as unknown as Record<string, unknown>,
          timestamp: Date.now(),
        };
        this.wsClient.send(JSON.stringify(msg));
      } catch {
        // WS send failed — HTTP polling will deliver it
      }
    }
  }

  /**
   * Called by the MCP tool `send_chat_chunk` to push a streaming chunk to the plugin.
   * Delivers via WebSocket if connected, otherwise queues for HTTP polling.
   */
  sendChatChunk(chunk: { id: string; delta: string; done: boolean; timestamp: number }): void {
    // ALWAYS queue for HTTP polling — reliable baseline
    this.chatOutbox.push({ id: chunk.id, message: chunk.delta, timestamp: chunk.timestamp, _isChunk: true, _done: chunk.done } as typeof this.chatOutbox[number]);

    // Also push via WebSocket for instant delivery (best-effort)
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      try {
        const msg: WsMessage = {
          type: "command",
          id: "chat-chunk",
          payload: { chatChunk: chunk } as unknown as Record<string, unknown>,
          timestamp: Date.now(),
        };
        this.wsClient.send(JSON.stringify(msg));
      } catch {
        // WS send failed — HTTP polling will deliver it
      }
    }
  }

  /**
   * Get and drain pending chat responses for the plugin (called during HTTP polling).
   */
  drainChatResponses(): Array<{ id: string; message: string; timestamp: number; isError?: boolean; _isChunk?: boolean; _done?: boolean }> {
    const responses = [...this.chatOutbox];
    this.chatOutbox = [];
    return responses;
  }

  /**
   * Send a command to the plugin.
   * Uses WebSocket if connected, otherwise queues for HTTP polling.
   */
  sendCommand(command: Command): Promise<CommandResult> {
    const promise = this.queue.enqueue(command);

    // If WebSocket is active, push immediately
    if (this.connection.isWebSocketActive && this.wsClient?.readyState === WebSocket.OPEN) {
      this.pushCommandViaWs(command);
    }

    return promise;
  }

  // ─── Route Registration ────────────────────────────────────────────────

  private registerRoutes(app: FastifyInstance): void {
    // Health endpoint — no auth required
    app.get("/health", async (_req: FastifyRequest, _reply: FastifyReply) => {
      return this.handleHealth();
    });

    // Auth middleware for plugin endpoints
    const authHook = async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = req.headers["x-auth-token"] as string | undefined;
        this.connection.validateAuth(token);
      } catch (err) {
        if (err instanceof RexError) {
          reply.code(401).send(err.toResponse());
        } else {
          reply.code(401).send({ error: { message: "Unauthorized" } });
        }
        // Halt request processing by returning the reply
        return reply;
      }
    };

    // POST /connect — plugin handshake (no auth required — returns the auth token)
    app.post("/connect", async (req: FastifyRequest, reply: FastifyReply) => {
      return this.handleConnect(req, reply);
    });

    // GET /commands — plugin polls for pending commands
    app.get("/commands", {
      preHandler: authHook,
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      return this.handleGetCommands(req, reply);
    });

    // POST /results — plugin posts command results
    app.post("/results", {
      preHandler: authHook,
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      return this.handlePostResults(req, reply);
    });

    // POST /disconnect — clean plugin disconnect
    app.post("/disconnect", {
      preHandler: authHook,
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      return this.handleDisconnect(req, reply);
    });

    // POST /chat/send — plugin sends a chat message
    app.post("/chat/send", {
      preHandler: authHook,
    }, async (req: FastifyRequest, _reply: FastifyReply) => {
      const body = req.body as { id: string; message: string; selection?: unknown[] };
      if (!body?.message) {
        return { error: "Missing message field" };
      }
      const chatMsg = {
        id: body.id || `chat_${Date.now()}`,
        message: body.message,
        selection: body.selection || [],
        timestamp: Date.now(),
      };
      this.enqueueChatMessage(chatMsg);
      this.logger.info("Chat message received from plugin", { id: chatMsg.id });
      return { status: "ok", id: chatMsg.id };
    });

    // GET /chat/responses — plugin polls for chat responses
    app.get("/chat/responses", {
      preHandler: authHook,
    }, async (_req: FastifyRequest, reply: FastifyReply) => {
      const responses = this.drainChatResponses();
      if (responses.length === 0) {
        reply.code(204);
        return undefined;
      }
      return { responses };
    });
  }

  // ─── Route Handlers ────────────────────────────────────────────────────

  private handleHealth(): Record<string, unknown> {
    const queueStats = this.queue.getStats();
    const healthSummary = this.heartbeat.getHealthSummary();

    return {
      status: "ok",
      version: VERSION,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      connection: this.connection.getConnectionInfo(),
      queue: {
        ...healthSummary,
        pending: queueStats.pending,
        inFlight: queueStats.inFlight,
      },
    };
  }

  private handleConnect(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Record<string, unknown> {
    const body = req.body as ConnectPayload;

    if (!body?.pluginId || !body?.fileKey || !body?.fileName) {
      reply.code(400);
      return {
        error: {
          category: ErrorCategory.INVALID_PARAMS,
          message: "Missing required fields: pluginId, fileKey, fileName",
          retryable: false,
        },
      };
    }

    const session = this.connection.connect(body);

    // Start comment watcher for @rex mentions
    this.commentWatcher.start(body.fileKey);

    // Start poll monitoring
    this.heartbeat.startPollMonitoring(
      this.config.polling.defaultInterval,
      () => {
        this.logger.warn("Plugin disconnected due to missed polls");
        this.connection.disconnect("missed polls");
        this.heartbeat.stopWsHeartbeat();
      },
    );

    return {
      sessionId: session.sessionId,
      authSecret: this.connection.secret,
      config: {
        pollingInterval: this.config.polling.defaultInterval,
        burstInterval: this.config.polling.burstInterval,
        idleInterval: this.config.polling.idleInterval,
        idleThreshold: this.config.polling.idleThreshold,
        preloadFonts: this.config.figma.preloadFonts,
      },
    };
  }

  private handleGetCommands(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Record<string, unknown> | undefined {
    const pluginId = req.headers["x-plugin-id"] as string | undefined;

    try {
      this.connection.validatePluginId(pluginId);
    } catch (err) {
      if (err instanceof RexError) {
        reply.code(err.category === ErrorCategory.PLUGIN_NOT_RUNNING ? 503 : 400);
        return err.toResponse() as unknown as Record<string, unknown>;
      }
      throw err;
    }

    // Record the poll
    this.heartbeat.recordPoll();

    // Keep-alive polls only record liveness — don't drain queues or return data
    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("keepalive") === "1") {
      reply.code(204);
      return undefined;
    }

    // Get pending commands
    const pending = this.queue.getPending();

    if (pending.length === 0) {
      // Include any pending chat responses
      const chatResponses = this.drainChatResponses();

      // Even with no commands, signal activity state so the plugin
      // can show forging animation when Claude is working
      if (this.isActive || chatResponses.length > 0 || this.chatListening) {
        return { commands: [], activity: this.isActive, chatResponses, chatListening: this.chatListening };
      }
      reply.code(204);
      return undefined;
    }

    // Mark commands as SENT and build the response
    const commands: Command[] = [];
    for (const entry of pending) {
      this.queue.markSent(entry.command.id);
      // For HTTP polling, mark as acknowledged implicitly (plugin received it)
      this.queue.markAcknowledged(entry.command.id);
      commands.push(entry.command);
    }

    // Track last command time for adaptive polling
    this.pollingState.lastCommandTime = Date.now();

    // Calculate suggested polling interval
    const suggestedInterval = this.calculatePollingInterval();

    // Include any pending chat responses
    const chatResponses = this.drainChatResponses();

    // Include remaining queue depth so the plugin can show progress
    const remainingStats = this.queue.getStats();

    return {
      commands,
      pollingInterval: suggestedInterval,
      activity: this.isActive,
      chatResponses,
      chatListening: this.chatListening,
      queueDepth: remainingStats.pending + remainingStats.inFlight,
    };
  }

  private handlePostResults(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Record<string, unknown> {
    const body = req.body as CommandResult | CommandResult[];

    // Support both single result and array of results
    const results = Array.isArray(body) ? body : [body];

    for (const result of results) {
      if (!result?.id) {
        reply.code(400);
        return {
          error: {
            category: ErrorCategory.INVALID_PARAMS,
            message: "Missing required field: id",
            retryable: false,
          },
        };
      }

      this.queue.complete(result.id, result);
    }

    return { status: "ok", processed: results.length };
  }

  private handleDisconnect(
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Record<string, unknown> {
    const body = req.body as { sessionId?: string; reason?: string } | null;

    this.connection.disconnect(body?.reason ?? "plugin disconnect");
    this.heartbeat.stopWsHeartbeat();
    this.heartbeat.destroy();

    // Close WebSocket if active
    if (this.wsClient) {
      this.wsClient.close(1000, "Plugin disconnected");
      this.wsClient = null;
    }

    return { status: "ok" };
  }

  // ─── WebSocket Handling ────────────────────────────────────────────────

  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    // Only handle /ws path
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    // Validate auth token (headers or query params — browser WS API can't set headers)
    const token = (request.headers["x-auth-token"] as string | undefined)
      ?? url.searchParams.get("token")
      ?? undefined;
    try {
      this.connection.validateAuth(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Validate session (headers or query params)
    const sessionId = (request.headers["x-session-id"] as string | undefined)
      ?? url.searchParams.get("sessionId")
      ?? undefined;
    if (!sessionId || !this.connection.session || this.connection.session.sessionId !== sessionId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Perform the upgrade
    this.wss!.handleUpgrade(request, socket, head, (ws) => {
      this.onWebSocketConnection(ws);
    });
  }

  private onWebSocketConnection(ws: WebSocket): void {
    // Close any existing WS client
    if (this.wsClient) {
      this.wsClient.close(1000, "Replaced by new connection");
    }

    this.wsClient = ws;
    const sessionId = this.connection.session?.sessionId ?? "unknown";
    this.connection.upgradeToWebSocket(sessionId);

    this.logger.info("WebSocket client connected", { sessionId });

    // Start heartbeat
    this.heartbeat.startWsHeartbeat(
      () => this.wsSendPing(),
      () => {
        this.logger.warn("WebSocket heartbeat failed, degrading to HTTP");
        this.connection.downgradeToPolling();
        this.heartbeat.recordReconnect();
        ws.close(1001, "Heartbeat timeout");
      },
    );

    // Send any pending commands immediately
    const pending = this.queue.getPending();
    for (const entry of pending) {
      this.pushCommandViaWs(entry.command);
    }

    ws.on("message", (data: Buffer) => {
      this.onWsMessage(data);
    });

    ws.on("close", (_code: number, _reason: Buffer) => {
      this.logger.info("WebSocket client disconnected");
      this.heartbeat.stopWsHeartbeat();

      if (this.wsClient === ws) {
        this.wsClient = null;
        this.connection.downgradeToPolling();
      }
    });

    ws.on("error", (err: Error) => {
      this.logger.error("WebSocket error", { error: err.message });
    });
  }

  private onWsMessage(data: Buffer): void {
    this.heartbeat.recordWsMessage();

    let msg: WsMessage;
    try {
      msg = JSON.parse(data.toString()) as WsMessage;
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
          const result = msg.payload as unknown as CommandResult;
          // Ensure the result has the command ID
          result.id = result.id ?? msg.id;
          this.queue.complete(result.id, result);
        }
        break;

      default:
        this.logger.warn("Unknown WebSocket message type", { type: msg.type });
    }
  }

  /** Send a command to the plugin via WebSocket. */
  private pushCommandViaWs(command: Command): void {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) return;

    // Include queue depth so the plugin can show progress
    const stats = this.queue.getStats();
    const payload = {
      ...(command as unknown as Record<string, unknown>),
      _queueDepth: stats.pending + stats.inFlight,
    };

    const msg: WsMessage = {
      type: "command",
      id: command.id,
      payload,
      timestamp: Date.now(),
    };

    this.wsClient.send(JSON.stringify(msg));
    this.queue.markSent(command.id);

    this.logger.debug("Command pushed via WebSocket", {
      commandId: command.id,
      type: command.type,
    });
  }

  /** Send a ping message over WebSocket. */
  private wsSendPing(): void {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) return;

    const msg: WsMessage = {
      type: "ping",
      timestamp: Date.now(),
    };

    this.wsClient.send(JSON.stringify(msg));
  }

  // ─── Adaptive Polling ──────────────────────────────────────────────────

  /** Calculate the suggested polling interval based on queue activity. */
  private calculatePollingInterval(): number {
    const { burstInterval, defaultInterval, idleInterval, idleThreshold } = this.config.polling;
    const queueStats = this.queue.getStats();

    // Burst mode: commands are pending
    if (queueStats.pending > 0 || queueStats.inFlight > 0) {
      return burstInterval;
    }

    // Idle mode: no commands for a while
    const timeSinceLastCommand = Date.now() - this.pollingState.lastCommandTime;
    if (timeSinceLastCommand > idleThreshold) {
      return idleInterval;
    }

    // Default
    return defaultInterval;
  }
}
