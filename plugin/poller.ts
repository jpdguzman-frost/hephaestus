// ─── HTTP Polling Engine ────────────────────────────────────────────────────
// Polls the relay server for commands, executes them, and posts results.
// All HTTP requests go through the UI iframe via figma.ui.postMessage.

import { Executor } from "./executor";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Command {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  ttl: number;
  idempotencyKey?: string;
  atomic?: boolean;
  batchId?: string;
  batchSeq?: number;
  batchTotal?: number;
}

interface ConnectResponse {
  sessionId: string;
  config?: {
    pollingInterval?: number;
    burstInterval?: number;
    idleInterval?: number;
    idleThreshold?: number;
  };
}

interface HttpResponse {
  status: number;
  body: string | null;
  error?: string;
}

// ─── HTTP Bridge ─────────────────────────────────────────────────────────────
// Sends HTTP requests through the UI iframe since the main thread has no XHR/fetch.

let requestCounter = 0;
const pendingRequests = new Map<string, (resp: HttpResponse) => void>();

// Must be called from code.ts to wire up the response handler
export function setupHttpBridge(): void {
  figma.ui.onmessage = createMessageHandler(figma.ui.onmessage);
}

function createMessageHandler(
  existingHandler?: ((msg: unknown, props?: { origin: string }) => void) | null
): (msg: unknown, props?: { origin: string }) => void {
  return (msg: unknown, props?: { origin: string }) => {
    const message = msg as Record<string, unknown>;
    if (message && message.type === "http-response") {
      const requestId = message.requestId as string;
      const resolver = pendingRequests.get(requestId);
      if (resolver) {
        pendingRequests.delete(requestId);
        resolver({
          status: message.status as number,
          body: message.body as string | null,
          error: message.error as string | undefined,
        });
      }
      return;
    }

    // Forward to existing handler if any
    if (existingHandler) {
      existingHandler(msg, props);
    }
  };
}

function httpRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>, timeout?: number): Promise<HttpResponse> {
  return new Promise((resolve) => {
    const requestId = `req_${++requestCounter}_${Date.now()}`;

    pendingRequests.set(requestId, resolve);

    // Timeout safety
    const timer = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve({ status: 0, body: null, error: "Timeout" });
      }
    }, (timeout || 10000) + 2000);

    pendingRequests.set(requestId, (resp) => {
      clearTimeout(timer);
      resolve(resp);
    });

    figma.ui.postMessage({
      type: "http-request",
      requestId,
      method,
      url,
      body: body ? JSON.stringify(body) : undefined,
      headers,
      timeout: timeout || 10000,
    });
  });
}

// ─── Poller Class ───────────────────────────────────────────────────────────

export class Poller {
  private baseUrl: string;
  private executor: Executor;
  private sessionId: string | null = null;
  private pluginId: string;
  private authToken: string | null = null;
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  // Adaptive polling intervals
  private burstInterval = 100;
  private defaultInterval = 300;
  private idleInterval = 500;
  private idleThreshold = 10000;
  private lastCommandTime = 0;

  // Chat listening state tracking
  private lastChatListening = false;

  // Connection health tracking
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 5;
  private reconnecting = false;
  private onReconnect: (() => void) | null = null;

  constructor(baseUrl: string, executor: Executor) {
    this.baseUrl = baseUrl;
    this.executor = executor;
    this.pluginId = "heph_" + generateId();
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getPluginId(): string {
    return this.pluginId;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  /** Send an authenticated POST request through the HTTP bridge. */
  async postAuthenticated(path: string, body: unknown): Promise<HttpResponse> {
    return httpRequest("POST", this.baseUrl + path, body, this.getHeaders(), 5000);
  }

  async connect(): Promise<boolean> {
    try {
      // Step 1: Health check
      const healthResp = await httpRequest("GET", this.baseUrl + "/health", undefined, undefined, 5000);
      if (healthResp.status === 0 || !healthResp.body) {
        console.warn("Relay server not reachable");
        return false;
      }

      // Step 2: Connect (no auth needed — handshake returns the auth token)
      const connectPayload = {
        pluginId: this.pluginId,
        fileKey: figma.fileKey || "unknown",
        fileName: (figma.root && figma.root.name) ? figma.root.name : "Unknown File",
        capabilities: {
          maxConcurrent: 1,
          supportedTypes: this.executor.getSupportedTypes(),
          pluginVersion: "0.1.0",
        },
      };

      const connectResp = await httpRequest(
        "POST",
        this.baseUrl + "/connect",
        connectPayload,
        { "X-Plugin-Id": this.pluginId },
        5000
      );

      if (connectResp.status === 0 || !connectResp.body) {
        console.warn("Failed to connect to relay server");
        return false;
      }

      const connectData = JSON.parse(connectResp.body) as ConnectResponse;
      this.sessionId = connectData.sessionId;
      this.authToken = (connectData as Record<string, unknown>).authSecret as string || null;

      // Apply server-provided config
      if (connectData.config) {
        if (connectData.config.pollingInterval) this.defaultInterval = connectData.config.pollingInterval;
        if (connectData.config.burstInterval) this.burstInterval = connectData.config.burstInterval;
        if (connectData.config.idleInterval) this.idleInterval = connectData.config.idleInterval;
        if (connectData.config.idleThreshold) this.idleThreshold = connectData.config.idleThreshold;
      }

      console.log("Connected to relay server. Session: " + this.sessionId);
      return true;
    } catch (e) {
      console.error("Connection handshake failed:", e);
      return false;
    }
  }

  /**
   * Set a callback that fires when the poller auto-reconnects after connection loss.
   */
  setReconnectCallback(cb: () => void): void {
    this.onReconnect = cb;
  }

  async startPolling(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    this.consecutiveErrors = 0;
    this.poll();
  }

  async disconnect(): Promise<void> {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.sessionId) {
      try {
        await httpRequest(
          "POST",
          this.baseUrl + "/disconnect",
          { sessionId: this.sessionId, reason: "plugin_closed" },
          this.getHeaders(),
          3000
        );
      } catch {
        // Best effort disconnect
      }
    }
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.polling) return;

    var nextInterval = this.getAdaptiveInterval();

    try {
      const resp = await httpRequest("GET", this.baseUrl + "/commands", undefined, this.getHeaders(), 5000);

      if (resp.status === 401 || resp.status === 403) {
        // Auth failed — need to reconnect
        console.warn("Auth rejected (status " + resp.status + "), reconnecting...");
        this.consecutiveErrors++;
        await this.attemptReconnect();
        nextInterval = this.defaultInterval;
      } else if (resp.status >= 200 && resp.status < 300 && resp.body) {
        // Success — reset error counter
        this.consecutiveErrors = 0;

        const data = JSON.parse(resp.body);
        const commands = data.commands as Command[] | undefined;

        // Handle activity signal from server (Claude is working)
        if (data.activity === true) {
          figma.ui.postMessage({ type: "forging-start" });
        } else if (data.activity === false) {
          figma.ui.postMessage({ type: "forging-stop" });
        }

        // Forward chat listening state to UI (only on change)
        var chatListeningNow = data.chatListening === true;
        if (chatListeningNow !== this.lastChatListening) {
          this.lastChatListening = chatListeningNow;
          figma.ui.postMessage({ type: chatListeningNow ? "chat-available" : "chat-unavailable" });
        }

        // Forward chat responses to UI
        var chatResponses = data.chatResponses as Array<{ id: string; message: string }> | undefined;
        if (chatResponses && chatResponses.length > 0) {
          for (var j = 0; j < chatResponses.length; j++) {
            figma.ui.postMessage({
              type: "chat-response",
              message: chatResponses[j].message,
              id: chatResponses[j].id
            });
          }
        }

        if (commands && commands.length > 0) {
          this.lastCommandTime = Date.now();
          nextInterval = this.burstInterval;

          // Execute commands sequentially
          const results = await this.executor.executeCommands(commands);

          // Post results back (with retry on failure)
          for (var i = 0; i < results.length; i++) {
            var posted = false;
            for (var attempt = 0; attempt < 2 && !posted; attempt++) {
              try {
                var postResp = await httpRequest("POST", this.baseUrl + "/results", results[i], this.getHeaders(), 10000);
                if (postResp.status >= 200 && postResp.status < 300) {
                  posted = true;
                } else if (postResp.status === 401) {
                  // Auth expired during execution — reconnect and retry
                  await this.attemptReconnect();
                }
              } catch (e) {
                console.error("Failed to post result (attempt " + (attempt + 1) + "):", e);
              }
            }
          }
        }
      } else if (resp.status >= 200 && resp.status < 300 && !resp.body) {
        // 204 No Content — nothing happening, reset chat listening if needed
        this.consecutiveErrors = 0;
        if (this.lastChatListening) {
          this.lastChatListening = false;
          figma.ui.postMessage({ type: "chat-unavailable" });
        }
      } else if (resp.status === 503) {
        // Session lost (server disconnected us, e.g., missed polls during command execution)
        console.warn("Session lost (503), reconnecting immediately...");
        this.consecutiveErrors++;
        await this.attemptReconnect();
        nextInterval = this.defaultInterval;
      } else if (resp.status >= 400) {
        // Other server error — try reconnecting after a few failures
        this.consecutiveErrors++;
        console.warn("Server error " + resp.status + " (attempt " + this.consecutiveErrors + "/" + this.maxConsecutiveErrors + ")");

        if (this.consecutiveErrors >= 3) {
          console.warn("Repeated server errors, attempting reconnect...");
          await this.attemptReconnect();
        }
        nextInterval = this.defaultInterval;
      } else if (resp.status === 0) {
        // Network error — server unreachable
        this.consecutiveErrors++;
        console.warn("Server unreachable (attempt " + this.consecutiveErrors + "/" + this.maxConsecutiveErrors + ")");

        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
          console.warn("Too many errors, attempting reconnect...");
          await this.attemptReconnect();
        }
        nextInterval = Math.min(this.defaultInterval * this.consecutiveErrors, 3000);
      }
    } catch (e) {
      console.error("Poll error:", e);
      this.consecutiveErrors++;
      nextInterval = Math.min(this.defaultInterval * this.consecutiveErrors, 3000);

      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        await this.attemptReconnect();
      }
    }

    if (this.polling) {
      this.pollTimer = setTimeout(() => { this.poll(); }, nextInterval);
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    console.log("Attempting reconnect...");
    figma.ui.postMessage({ type: "status", connected: false, transport: null });

    try {
      var success = await this.connect();
      if (success) {
        console.log("Reconnected successfully. Session: " + this.sessionId);
        this.consecutiveErrors = 0;
        if (this.onReconnect) {
          this.onReconnect();
        }
      } else {
        console.warn("Reconnect failed, will retry on next poll");
      }
    } catch (e) {
      console.error("Reconnect error:", e);
    } finally {
      this.reconnecting = false;
    }
  }

  private getAdaptiveInterval(): number {
    const timeSinceLastCommand = Date.now() - this.lastCommandTime;
    if (this.lastCommandTime > 0 && timeSinceLastCommand < 1000) {
      return this.burstInterval;
    }
    if (timeSinceLastCommand > this.idleThreshold) {
      return this.idleInterval;
    }
    return this.defaultInterval;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "X-Plugin-Id": this.pluginId,
      "X-Plugin-File": figma.fileKey || "unknown",
    };
    if (this.sessionId) {
      headers["X-Session-Id"] = this.sessionId;
    }
    if (this.authToken) {
      headers["X-Auth-Token"] = this.authToken;
    }
    return headers;
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

function generateId(): string {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var result = "";
  for (var i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
