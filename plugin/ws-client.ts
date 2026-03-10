// ─── WebSocket Client ───────────────────────────────────────────────────────
// Optional fast-path transport. Auto-reconnects with exponential backoff.
// All WebSocket operations go through the UI iframe via figma.ui.postMessage.

import { Executor } from "./executor";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WSMessage {
  type: "command" | "result" | "ping" | "pong" | "ack";
  id: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

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

// ─── WSClient Class ─────────────────────────────────────────────────────────

export class WSClient {
  private baseUrl: string;
  private executor: Executor;
  private sessionId: string | null = null;
  private authToken: string | null = null;
  private _isConnected = false;
  private reconnecting = false;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private statusCallback: ((connected: boolean) => void) | null = null;

  // Exponential backoff: 500ms -> 1s -> 2s -> 4s -> 8s -> 15s
  private readonly backoffSchedule = [500, 1000, 2000, 4000, 8000, 15000];

  constructor(baseUrl: string, executor: Executor) {
    this.baseUrl = baseUrl;
    this.executor = executor;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  onStatusChange(callback: (connected: boolean) => void): void {
    this.statusCallback = callback;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Handle messages from the UI iframe related to WebSocket.
   * Must be called from the main message handler in code.ts.
   */
  handleUiMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "ws-open":
        this._isConnected = true;
        this.reconnecting = false;
        this.reconnectAttempt = 0;
        console.log("WebSocket connected");

        // Send identification
        this.send({
          type: "ack",
          id: "ws_init_" + Date.now(),
          payload: { sessionId: this.sessionId },
          timestamp: Date.now(),
        });

        this.notifyStatus(true);
        break;

      case "ws-message":
        this.handleMessage(msg.data as string);
        break;

      case "ws-close":
        console.log("WebSocket closed: " + msg.code + " " + msg.reason);
        this._isConnected = false;
        this.notifyStatus(false);
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
        break;

      case "ws-error":
        console.error("WebSocket error");
        // ws-close will follow
        break;
    }
  }

  connect(): void {
    if (this._isConnected || this.reconnecting) return;
    if (!this.sessionId) {
      console.warn("WSClient: No session ID set, skipping WebSocket connection");
      return;
    }

    this.shouldReconnect = true;
    this.attemptConnect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this._isConnected = false;

    figma.ui.postMessage({ type: "ws-disconnect" });

    this.notifyStatus(false);
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private attemptConnect(): void {
    var wsUrl = this.baseUrl
      .replace("http://", "ws://")
      .replace("https://", "wss://");

    // Browser WebSocket API can't set custom headers, so pass auth via query params
    var params = "?token=" + encodeURIComponent(this.authToken || "")
      + "&sessionId=" + encodeURIComponent(this.sessionId || "");

    figma.ui.postMessage({
      type: "ws-connect",
      url: wsUrl + "/ws" + params,
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    var index = Math.min(this.reconnectAttempt, this.backoffSchedule.length - 1);
    var delay = this.backoffSchedule[index];
    this.reconnectAttempt++;

    console.log("WebSocket reconnecting in " + delay + "ms (attempt " + this.reconnectAttempt + ")");

    setTimeout(() => {
      this.reconnecting = false;
      if (this.shouldReconnect) {
        this.attemptConnect();
      }
    }, delay);
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      var message = JSON.parse(data) as WSMessage;

      switch (message.type) {
        case "ping":
          this.send({
            type: "pong",
            id: message.id,
            timestamp: Date.now(),
          });
          break;

        case "command": {
          var payload = message.payload as Record<string, unknown>;

          // Check for activity signal (server telling us Claude is working)
          if (message.id === "activity-signal" && payload) {
            if (payload.activity === true) {
              figma.ui.postMessage({ type: "forging-start" });
            } else {
              figma.ui.postMessage({ type: "forging-stop" });
            }
            break;
          }

          // Check for chat response (server sending Claude's reply)
          if (message.id === "chat-response" && payload) {
            var chatResp = payload.chatResponse as Record<string, unknown>;
            if (chatResp) {
              figma.ui.postMessage({
                type: "chat-response",
                message: chatResp.message as string,
                id: chatResp.id as string,
                isError: (chatResp.isError as boolean) || false
              });
            }
            break;
          }

          // Check for chat streaming chunk
          if (message.id === "chat-chunk" && payload) {
            var chatChunk = payload.chatChunk as Record<string, unknown>;
            if (chatChunk) {
              figma.ui.postMessage({
                type: "chat-chunk",
                delta: chatChunk.delta as string,
                id: chatChunk.id as string,
                done: (chatChunk.done as boolean) || false
              });
            }
            break;
          }

          var command = payload as unknown as Command;

          // Send ack immediately
          this.send({
            type: "ack",
            id: message.id,
            timestamp: Date.now(),
          });

          // Execute and send result
          var result = await this.executor.executeCommand(command);

          this.send({
            type: "result",
            id: message.id,
            payload: result as unknown as Record<string, unknown>,
            timestamp: Date.now(),
          });
          break;
        }
      }
    } catch (e) {
      console.error("WebSocket message handling error:", e);
    }
  }

  private send(message: WSMessage): void {
    if (!this._isConnected) return;

    figma.ui.postMessage({
      type: "ws-send",
      data: JSON.stringify(message),
    });
  }

  private notifyStatus(connected: boolean): void {
    if (this.statusCallback) {
      this.statusCallback(connected);
    }
  }
}
