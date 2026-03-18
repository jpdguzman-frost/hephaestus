// ─── HTTP Polling Engine ────────────────────────────────────────────────────
// Polls the relay server for commands, executes them, and posts results.
// All HTTP requests go through the UI iframe via figma.ui.postMessage.

import { Executor, READ_COMMANDS } from "./executor";
import { postChatResponseDeduped } from "./ws-client";

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

/** Exposed for port discovery in code.ts — avoids duplicating the HTTP bridge. */
export { httpRequest as httpRequestRaw };

function httpRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>, timeout?: number): Promise<HttpResponse> {
  return new Promise((resolve) => {
    const requestId = `req_${++requestCounter}_${Date.now()}`;

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

  // Chat availability state tracking
  private chatAvailableEmitted = false;

  // High-priority polling mode (burst rate when WS drops)
  private highPriority = false;

  // Connection health tracking
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 5;
  private reconnecting = false;
  private onReconnect: (() => void) | null = null;
  private onDisconnect: (() => void) | null = null;

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
      // Include user identity from figma.currentUser (requires 'currentuser' permission)
      var currentUser = figma.currentUser;
      var currentPage = figma.currentPage;
      const connectPayload = {
        pluginId: this.pluginId,
        fileKey: figma.fileKey || "unknown",
        fileName: (figma.root && figma.root.name) ? figma.root.name : "Unknown File",
        pageId: currentPage ? currentPage.id : undefined,
        pageName: currentPage ? currentPage.name : undefined,
        user: currentUser ? {
          id: currentUser.id,
          name: currentUser.name,
          photoUrl: currentUser.photoUrl,
        } : undefined,
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

      // Validate auth token — refuse to proceed without one
      const authSecret = (connectData as Record<string, unknown>).authSecret as string | undefined;
      if (!authSecret) {
        console.warn("Server did not provide auth token");
        return false;
      }
      this.authToken = authSecret;

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

  /**
   * Set a callback that fires when reconnect fails (connection lost).
   */
  setDisconnectCallback(cb: () => void): void {
    this.onDisconnect = cb;
  }

  async startPolling(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    this.consecutiveErrors = 0;
    this.poll();
  }

  /**
   * Switch to high-priority burst-rate polling (100ms).
   * Used when WebSocket drops to ensure commands are picked up via HTTP.
   */
  setHighPriorityMode(enabled: boolean): void {
    this.highPriority = enabled;
    if (enabled) {
      console.log("Poller: high-priority mode ON (WS degraded, polling at burst rate)");
      this.forceImmediatePoll();
    } else {
      console.log("Poller: high-priority mode OFF (WS restored)");
    }
  }

  /**
   * Force an immediate poll cycle, bypassing any pending timer.
   */
  forceImmediatePoll(): void {
    if (!this.polling) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.poll();
  }

  async disconnect(): Promise<void> {
    this.polling = false;
    this.chatAvailableEmitted = false;
    figma.ui.postMessage({ type: "chat-unavailable" });
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

        // Report queue depth to UI — include commands about to be executed locally
        var serverQueueRemainder = (data.queueDepth as number) || 0;
        var localCommandCount = (commands && commands.length) ? commands.length : 0;
        figma.ui.postMessage({ type: "queue-update", count: serverQueueRemainder + localCommandCount });

        // Chat is always available when connected — messages queue server-side
        if (!this.chatAvailableEmitted) {
          this.chatAvailableEmitted = true;
          figma.ui.postMessage({ type: "chat-available" });
        }

        // Forward chat responses/chunks to UI
        var chatResponses = data.chatResponses as Array<{ id: string; message: string; isError?: boolean; _isChunk?: boolean; _done?: boolean }> | undefined;
        if (chatResponses && chatResponses.length > 0) {
          for (var j = 0; j < chatResponses.length; j++) {
            var cr = chatResponses[j];
            if (cr._isChunk) {
              // Forward chunks directly — they have their own UI-level dedup
              figma.ui.postMessage({
                type: "chat-chunk",
                id: cr.id,
                delta: cr.message,
                done: cr._done || false,
              });
            } else {
              // Final responses go through transport-level dedup
              postChatResponseDeduped(cr.id, cr.message, cr.isError);
            }
          }
        }

        if (commands && commands.length > 0) {
          this.lastCommandTime = Date.now();
          nextInterval = this.burstInterval;

          // Server-reported queue depth (commands still pending on server beyond this batch)
          var serverQueueDepth = (data.queueDepth as number) || 0;

          // Keep-alive poll during execution so server doesn't think we disconnected
          var keepAliveTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
            httpRequest("GET", this.baseUrl + "/commands?keepalive=1", undefined, this.getHeaders(), 5000)
              .catch(function() { /* best-effort keep-alive */ });
          }, 4000);

          try {
            // Partition commands into consecutive read/write groups
            // Reads within a group execute in parallel; writes execute sequentially
            var groups = partitionReadWriteGroups(commands);
            var completedCount = 0;

            for (var gi = 0; gi < groups.length; gi++) {
              var group = groups[gi];

              if (group.isRead && group.cmds.length > 1) {
                // Parallel read execution (up to 5 concurrent)
                var readQueue = group.cmds.slice();
                while (readQueue.length > 0) {
                  var batch = readQueue.splice(0, 5);

                  // Report progress for the batch
                  for (var bi = 0; bi < batch.length; bi++) {
                    figma.ui.postMessage({
                      type: "forging-progress",
                      commandType: batch[bi].type,
                      current: completedCount + bi + 1,
                      batchTotal: commands.length,
                      queueDepth: (commands.length - completedCount) + serverQueueDepth,
                      parallel: true
                    });
                  }

                  var readResults = await Promise.all(
                    batch.map(function(cmd) { return this.executor.executeCommand(cmd); }.bind(this))
                  );

                  // Post all results
                  for (var ri = 0; ri < readResults.length; ri++) {
                    await this.postResult(readResults[ri] as unknown as Record<string, unknown>);
                  }
                  completedCount += batch.length;
                }
              } else {
                // Sequential execution for writes (or single reads)
                for (var si = 0; si < group.cmds.length; si++) {
                  var cmd = group.cmds[si];
                  // Include current command in count (so even a single command shows "1 on queue")
                  var remaining = (commands.length - completedCount) + serverQueueDepth;

                  figma.ui.postMessage({
                    type: "forging-progress",
                    commandType: cmd.type,
                    current: completedCount + 1,
                    batchTotal: commands.length,
                    queueDepth: remaining
                  });

                  var cmdResult = await this.executor.executeCommand(cmd);
                  await this.postResult(cmdResult as unknown as Record<string, unknown>);
                  completedCount++;
                }
              }
            }
          } finally {
            if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
          }
        }
      } else if (resp.status >= 200 && resp.status < 300 && !resp.body) {
        // 204 No Content — nothing happening, chat stays available (messages queue server-side)
        this.consecutiveErrors = 0;
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

  /** Post a command result back to the relay server with retry logic. */
  private async postResult(resultPayload: Record<string, unknown>): Promise<void> {
    var posted = false;
    for (var attempt = 0; attempt < 3 && !posted; attempt++) {
      try {
        var postResp = await httpRequest("POST", this.baseUrl + "/results", resultPayload, this.getHeaders(), 15000);
        if (postResp.status >= 200 && postResp.status < 300) {
          posted = true;
        } else if (postResp.status === 401) {
          await this.attemptReconnect();
        } else if (postResp.status === 413) {
          console.warn("Result too large (413), truncating and retrying");
          resultPayload = truncateResult(resultPayload);
        } else {
          console.warn("Failed to post result: status " + postResp.status);
        }
      } catch (e) {
        console.error("Failed to post result (attempt " + (attempt + 1) + "):", e);
      }
    }
    if (!posted) {
      console.error("Giving up posting result for command " + resultPayload.id + " after 3 attempts");
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    console.log("Attempting reconnect...");

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
        figma.ui.postMessage({ type: "status", connected: false, transport: null });
        if (this.onDisconnect) {
          this.onDisconnect();
        }
      }
    } catch (e) {
      console.error("Reconnect error:", e);
      figma.ui.postMessage({ type: "status", connected: false, transport: null });
    } finally {
      this.reconnecting = false;
    }
  }

  private getAdaptiveInterval(): number {
    // High-priority mode overrides adaptive interval — burst rate during WS degradation
    if (this.highPriority) return this.burstInterval;

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
      "X-Plugin-Page": figma.currentPage ? figma.currentPage.id : "",
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

/**
 * Partition commands into consecutive groups of reads vs writes.
 * Read groups can be executed in parallel; write groups must be sequential.
 */
function partitionReadWriteGroups(commands: Command[]): { isRead: boolean; cmds: Command[] }[] {
  if (commands.length === 0) return [];

  var groups: { isRead: boolean; cmds: Command[] }[] = [];
  var currentIsRead = READ_COMMANDS.has(commands[0].type);
  var currentCmds: Command[] = [commands[0]];

  for (var i = 1; i < commands.length; i++) {
    var isRead = READ_COMMANDS.has(commands[i].type);
    if (isRead !== currentIsRead) {
      groups.push({ isRead: currentIsRead, cmds: currentCmds });
      currentCmds = [];
      currentIsRead = isRead;
    }
    currentCmds.push(commands[i]);
  }
  groups.push({ isRead: currentIsRead, cmds: currentCmds });

  return groups;
}

/**
 * Truncate an oversized command result so it can be posted.
 * Strips children, large data fields, and adds a truncation notice.
 */
function truncateResult(result: Record<string, unknown>): Record<string, unknown> {
  var truncated = { id: result.id, status: result.status, duration: result.duration, timestamp: result.timestamp, batchId: result.batchId, batchSeq: result.batchSeq } as Record<string, unknown>;

  if (result.error) {
    truncated.error = result.error;
    return truncated;
  }

  var inner = result.result as Record<string, unknown> | undefined;
  if (!inner) return truncated;

  // Strip large fields: base64 data, deep children
  var cleaned = {} as Record<string, unknown>;
  for (var key in inner) {
    if (!inner.hasOwnProperty(key)) continue;
    var val = inner[key];

    // Truncate base64 screenshot data
    if (key === "data" && typeof val === "string" && val.length > 50000) {
      cleaned[key] = val.slice(0, 50000);
      cleaned["_truncated"] = true;
      cleaned["_originalSize"] = val.length;
      continue;
    }

    // Strip deep children arrays
    if (key === "children" && Array.isArray(val) && JSON.stringify(val).length > 100000) {
      cleaned[key] = (val as unknown[]).slice(0, 5).map(function(child) {
        if (child && typeof child === "object" && "children" in (child as Record<string, unknown>)) {
          var shallow = Object.assign({}, child as Record<string, unknown>);
          delete shallow.children;
          shallow._childrenTruncated = true;
          return shallow;
        }
        return child;
      });
      cleaned["_childrenTruncated"] = true;
      continue;
    }

    cleaned[key] = val;
  }

  truncated.result = cleaned;
  return truncated;
}
