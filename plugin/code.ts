// ─── Rex Bridge — Plugin Entry Point ─────────────────────────────────
// Figma development plugin that acts as a thin relay between the
// Rex MCP server and the Figma Plugin API.
//
// IMPORTANT: The main thread (this file) has NO access to XMLHttpRequest,
// fetch, or WebSocket. All networking goes through the UI iframe via
// figma.ui.postMessage / figma.ui.onmessage.

import { Poller, setupHttpBridge, httpRequestRaw } from "./poller";
import { WSClient } from "./ws-client";
import { Executor, uint8ArrayToBase64 } from "./executor";
import { preloadFonts } from "./fonts";

type TransportStatus = "websocket" | "http" | "disconnected";

// Module-scope references
var pollerRef: Poller | null = null;
var wsRef: WSClient | null = null;
var currentChannel: number | null = null;
var executorRef: Executor | null = null;
var currentSessionId: string | null = null;
var currentSessionName: string | null = null;

function reportStatus(transport: TransportStatus, channel?: number): void {
  figma.ui.postMessage({
    type: "status",
    connected: transport !== "disconnected",
    transport: transport,
    port: channel,
  });
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Show UI — starts on channel input screen (defined in ui.html defaults)
  figma.showUI(__html__, { visible: true, width: 360, height: 286 });

  // Initialize executor
  executorRef = new Executor();

  // Set up the message bridge FIRST — needed for HTTP requests
  setupHttpBridge();

  // Forward selection changes to UI (only when connected)
  figma.on("selectionchange", function() {
    if (!pollerRef) return;
    var sel = figma.currentPage.selection;
    var items: Array<{ id: string; name: string; type: string }> = [];
    for (var i = 0; i < sel.length; i++) {
      items.push({ id: sel[i].id, name: sel[i].name, type: sel[i].type });
    }
    figma.ui.postMessage({
      type: "selection-changed",
      count: items.length,
      items: items.slice(0, 3)
    });
  });

  // Pre-load common fonts (non-blocking for startup)
  preloadFonts().catch(function(e) { console.warn("Font preload failed:", e); });

  // Check for last used channel
  var lastChannel: number | null = null;
  try {
    lastChannel = await figma.clientStorage.getAsync("rex-channel") as number | null;
  } catch (e) { /* ignore */ }

  // Show channel input screen
  figma.ui.postMessage({
    type: "channel-screen",
    lastChannel: lastChannel,
  });
}

// ─── Channel Connection ────────────────────────────────────────────────

async function handleChannelSubmit(channel: number): Promise<void> {
  var url = "http://localhost:" + channel;

  try {
    // Health check
    var resp = await httpRequestRaw("GET", url + "/health", undefined, undefined, 3000);

    if (resp.status === 0 || !resp.body) {
      figma.ui.postMessage({
        type: "channel-error",
        message: "Couldn't find a session on channel " + channel + ". Is Claude running?",
      });
      return;
    }

    var health = JSON.parse(resp.body);
    var state = health && health.connection && health.connection.state;

    // Allow connection if relay is waiting, or if a previous plugin session
    // left the relay in a stale state (POLLING/DEGRADED). A new plugin
    // session should always be able to take over.
    // Only block if we can't reach the server at all (handled above).

    // Success — save channel and connect
    currentChannel = channel;
    try {
      await figma.clientStorage.setAsync("rex-channel", channel);
    } catch (e) { /* non-critical */ }

    await connectToRelay(url, channel);
  } catch (e) {
    figma.ui.postMessage({
      type: "channel-error",
      message: "Something went wrong trying to reach channel " + channel + ". Try again?",
    });
  }
}

async function handleChannelReconnect(): Promise<void> {
  if (!currentChannel) return;
  await handleChannelSubmit(currentChannel);
}

function handleChannelChange(): void {
  // Clean up existing connection
  if (wsRef) {
    wsRef.disconnect();
    wsRef = null;
  }
  if (pollerRef) {
    pollerRef.disconnect();
    pollerRef = null;
  }
  currentChannel = null;

  // Resize back to channel input
  figma.ui.resize(360, 286);

  // Show channel input screen
  figma.clientStorage.getAsync("rex-channel").then(function(lastChannel) {
    figma.ui.postMessage({
      type: "channel-screen",
      lastChannel: lastChannel as number | null,
    });
  }).catch(function() {
    figma.ui.postMessage({
      type: "channel-screen",
      lastChannel: null,
    });
  });
}

// ─── Relay Connection ──────────────────────────────────────────────────

async function connectToRelay(relayUrl: string, channel: number): Promise<void> {
  // Clean up previous WS client if reconnecting
  if (wsRef) {
    wsRef.disconnect();
  }
  var executor = executorRef!;
  var ws = new WSClient(relayUrl, executor);
  wsRef = ws;

  // Add WS, chat, and resize message handling
  var existingHandler = figma.ui.onmessage;
  figma.ui.onmessage = function(msg: unknown) {
    var message = msg as Record<string, unknown>;
    if (message && (
      message.type === "ws-open" ||
      message.type === "ws-message" ||
      message.type === "ws-close" ||
      message.type === "ws-error"
    )) {
      ws.handleUiMessage(message);
      return;
    }
    if (message && message.type === "chat-send") {
      handleChatSend(message as { type: string; id: string; message: string });
      return;
    }
    if (message && message.type === "resize") {
      figma.ui.resize(message.width as number, message.height as number);
      return;
    }
    if (message && message.type === "fetch-sessions") {
      fetchAndSendSessions(poller);
      return;
    }
    if (message && message.type === "session-create") {
      handleSessionCreate();
      return;
    }
    if (message && message.type === "session-select") {
      handleSessionSelect(message.sessionId as string);
      return;
    }
    if (message && message.type === "cache-chat-history") {
      var fileKey = figma.fileKey || "unknown";
      // Save per-session if a session is active, otherwise use flat key
      var cacheKey = currentSessionId
        ? "rex-session-messages-" + fileKey + "-" + currentSessionId
        : "rex-chat-history-" + fileKey;
      figma.clientStorage.setAsync(cacheKey, message.messages).catch(function() {});
      return;
    }
    if (message && message.type === "navigate-to-node") {
      var nodeId = message.nodeId as string;
      if (nodeId) {
        var node = figma.getNodeById(nodeId);
        if (node && "type" in node && node.type !== "DOCUMENT" && node.type !== "PAGE") {
          figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
          figma.currentPage.selection = [node as SceneNode];
        }
      }
      return;
    }
    // Fall through to previous handler (which handles channel-submit, channel-reconnect, channel-change)
    if (existingHandler) {
      (existingHandler as (msg: unknown) => void)(msg);
    }
  };

  var poller = new Poller(relayUrl, executor);
  pollerRef = poller;
  var connected = await poller.connect();

  if (connected) {
    await poller.startPolling();
    figma.ui.postMessage({ type: "channel-connected", channel: channel });
    reportStatus("http", channel);

    // Status screen shows automatically via showConnectedUI.
    // Session picker is triggered when user clicks "Talk Now".

    var sessionId = poller.getSessionId();
    if (sessionId) ws.setSessionId(sessionId);
    var token = poller.getAuthToken();
    if (token) ws.setAuthToken(token);

    ws.onStatusChange(function(wsConnected) {
      reportStatus(wsConnected ? "websocket" : "http", channel);
    });

    // When WS drops, switch poller to burst-rate HTTP polling
    ws.onDegraded = function() {
      poller.setHighPriorityMode(true);
    };

    // When WS reconnects, resume adaptive polling
    ws.onReconnected = function() {
      poller.setHighPriorityMode(false);
    };

    ws.connect();

    poller.setReconnectCallback(function() {
      var newSid = poller.getSessionId();
      if (newSid) ws.setSessionId(newSid);
      var newTok = poller.getAuthToken();
      if (newTok) ws.setAuthToken(newTok);
      ws.disconnect();
      ws.connect();
      reportStatus("http", channel);
    });

    poller.setDisconnectCallback(function() {
      figma.ui.postMessage({
        type: "channel-disconnected",
        channel: channel,
      });
    });

    figma.on("close", function() {
      poller.disconnect();
      ws.disconnect();
    });
  } else {
    // Connection handshake failed — show error, go back to channel screen
    figma.ui.resize(360, 286);
    figma.ui.postMessage({
      type: "channel-error",
      message: "Connected to channel " + channel + " but the handshake failed. Try again?",
    });
  }
}

// ─── Session Picker ───────────────────────────────────────────────────

async function fetchAndSendSessions(poller: Poller): Promise<void> {
  try {
    var resp = await poller.getAuthenticated("/sessions");
    if (resp.status >= 200 && resp.status < 300 && resp.body) {
      var data = JSON.parse(resp.body);
      figma.ui.postMessage({ type: "session-list", sessions: data.sessions || [] });
    } else {
      figma.ui.postMessage({ type: "session-list", sessions: [] });
    }
  } catch (e) {
    console.warn("Failed to load sessions:", e);
    figma.ui.postMessage({ type: "session-list", sessions: [] });
  }
}

async function handleSessionCreate(): Promise<void> {
  if (!pollerRef) return;
  try {
    var resp = await pollerRef.postAuthenticated("/session/create", {});
    if (resp.status >= 200 && resp.status < 300 && resp.body) {
      var data = JSON.parse(resp.body);
      var session = data.session;
      if (session) {
        currentSessionId = session.sessionId;
        currentSessionName = session.name;
        figma.ui.postMessage({ type: "session-created", session: session });
      }
    }
  } catch (e) {
    console.warn("Failed to create session:", e);
  }
}

async function handleSessionSelect(sessionId: string): Promise<void> {
  if (!pollerRef) return;

  // Immediately tell UI to show loading and switch to chat
  figma.ui.postMessage({ type: "session-loading" });

  var fileKey = figma.fileKey || "unknown";
  var cacheKey = "rex-session-messages-" + fileKey + "-" + sessionId;

  // Phase 1: Instant render from local cache
  try {
    var cached = await figma.clientStorage.getAsync(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      currentSessionId = sessionId;
      currentSessionName = "Session";
      figma.ui.postMessage({
        type: "session-selected",
        messages: cached,
        sessionName: currentSessionName,
        source: "cache",
      });
    }
  } catch (e) { /* ignore */ }

  // Phase 2: Fetch remote (authoritative, replaces cache render)
  try {
    var resp = await pollerRef.postAuthenticated("/session/select", { sessionId: sessionId });
    if (resp.status >= 200 && resp.status < 300 && resp.body) {
      var data = JSON.parse(resp.body);
      currentSessionId = sessionId;
      currentSessionName = data.sessionName || "Session";
      var messages = data.messages || [];
      figma.ui.postMessage({
        type: "session-selected",
        messages: messages,
        sessionName: currentSessionName,
        source: "remote",
      });
      // Update local cache
      try {
        await figma.clientStorage.setAsync(cacheKey, messages.slice(-50));
      } catch (e) { /* non-critical */ }
    }
  } catch (e) {
    console.warn("Failed to select session:", e);
  }
}

// ─── Chat History ─────────────────────────────────────────────────────

async function loadChatHistory(poller: Poller): Promise<void> {
  var fileKey = figma.fileKey || "unknown";
  var cacheKey = "rex-chat-history-" + fileKey;

  // Phase 1: Load local cache for instant rendering
  try {
    var cached = await figma.clientStorage.getAsync(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      figma.ui.postMessage({ type: "chat-history", messages: cached, source: "cache" });
    }
  } catch (e) { /* ignore */ }

  // Phase 2: Fetch remote history (non-blocking, replaces cache)
  try {
    var resp = await poller.getAuthenticated("/chat/history");
    if (resp.status >= 200 && resp.status < 300 && resp.body) {
      var data = JSON.parse(resp.body);
      if (data.messages && data.messages.length > 0) {
        figma.ui.postMessage({ type: "chat-history", messages: data.messages, source: "remote" });
        // Update local cache with remote data
        try {
          await figma.clientStorage.setAsync(cacheKey, data.messages.slice(-20));
        } catch (e) { /* non-critical */ }
      }
    }
  } catch (e) {
    console.warn("Failed to load remote chat history:", e);
  }
}

// ─── Chat ──────────────────────────────────────────────────────────────

function handleChatSend(msg: { type: string; id: string; message: string }): void {
  if (!pollerRef) {
    console.warn("Chat send failed: not connected");
    return;
  }

  // Capture current selection context
  var selection: Array<{ id: string; name: string; type: string }> = [];
  var sel = figma.currentPage.selection;
  for (var i = 0; i < sel.length; i++) {
    selection.push({
      id: sel[i].id,
      name: sel[i].name,
      type: sel[i].type
    });
  }

  // Export a small thumbnail if there's a selection
  var thumbnailPromise: Promise<string | null>;
  if (sel.length > 0) {
    var targetNode = sel[0];
    var exportSettings: ExportSettings = {
      format: "PNG" as const,
      constraint: { type: "WIDTH", value: 120 }
    };
    thumbnailPromise = targetNode.exportAsync(exportSettings).then(function(bytes) {
      return "data:image/png;base64," + uint8ArrayToBase64(bytes);
    }).catch(function() { return null; });
  } else {
    thumbnailPromise = Promise.resolve(null);
  }

  pollerRef.postAuthenticated("/chat/send", {
    id: msg.id,
    message: msg.message,
    selection: selection
  }).then(function(resp) {
    if (resp.status < 200 || resp.status >= 300) {
      console.warn("Chat send failed: " + resp.status + " " + resp.body);
      figma.ui.postMessage({
        type: "chat-send-error",
        id: msg.id,
        error: "Failed to send message (status " + resp.status + ")"
      });
      return;
    }

    thumbnailPromise.then(function(thumbnail) {
      figma.ui.postMessage({
        type: "chat-sent-confirmation",
        id: msg.id,
        selectionCount: selection.length,
        selectionSummary: selection.slice(0, 3).map(function(s) { return s.name; }),
        selectionIds: selection.slice(0, 3).map(function(s) { return s.id; }),
        thumbnail: thumbnail
      });
    });
  });
}

// ─── Init ──────────────────────────────────────────────────────────────

// Wire up channel messages before main() runs (needed since main shows UI first)
figma.ui.onmessage = function(msg: unknown) {
  var message = msg as Record<string, unknown>;
  if (message && message.type === "channel-submit") {
    handleChannelSubmit(message.channel as number);
    return;
  }
  if (message && message.type === "channel-reconnect") {
    handleChannelReconnect();
    return;
  }
  if (message && message.type === "channel-change") {
    handleChannelChange();
    return;
  }
};

main().catch(function(e) { console.error("Rex init failed:", e); });
