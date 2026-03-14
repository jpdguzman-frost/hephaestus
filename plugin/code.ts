// ─── Rex Bridge — Plugin Entry Point ─────────────────────────────────
// Figma development plugin that acts as a thin relay between the
// Rex MCP server and the Figma Plugin API.
//
// IMPORTANT: The main thread (this file) has NO access to XMLHttpRequest,
// fetch, or WebSocket. All networking goes through the UI iframe via
// figma.ui.postMessage / figma.ui.onmessage.

import { Poller, setupHttpBridge, httpRequestRaw } from "./poller";
import { WSClient } from "./ws-client";
import { Executor } from "./executor";
import { preloadFonts } from "./fonts";

var PORT_RANGE_START = 7780;
var PORT_RANGE_END = 7789;

type TransportStatus = "websocket" | "http" | "disconnected";

// Module-scope poller reference so chat handler can access it
var pollerRef: Poller | null = null;

function reportStatus(transport: TransportStatus, port?: number): void {
  figma.ui.postMessage({
    type: "status",
    connected: transport !== "disconnected",
    transport: transport,
    port: port,
  });
}

/**
 * Scan ports 7780–7789 for a relay in WAITING state (no plugin connected).
 * Returns the base URL of the first free relay, or null if none found.
 */
async function discoverRelay(): Promise<string | null> {
  var results: Array<{ url: string; free: boolean } | null> = [];

  // Parallel health check on all ports
  var checks: Promise<{ url: string; free: boolean } | null>[] = [];
  for (var p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    checks.push(checkPort(p));
  }
  results = await Promise.all(checks);

  // Return first free relay (lowest port wins)
  for (var i = 0; i < results.length; i++) {
    if (results[i] && results[i]!.free) {
      return results[i]!.url;
    }
  }
  return null;
}

async function checkPort(port: number): Promise<{ url: string; free: boolean } | null> {
  var url = "http://localhost:" + port;
  try {
    var resp = await httpRequestRaw("GET", url + "/health", undefined, undefined, 2000);
    if (resp.status === 200 && resp.body) {
      var health = JSON.parse(resp.body);
      var state = health && health.connection && health.connection.state;
      return { url: url, free: state === "WAITING" };
    }
  } catch (e) {
    // Port not responding — skip
  }
  return null;
}

async function main(): Promise<void> {
  // Show minimal UI — MUST be called before any postMessage
  figma.showUI(__html__, { visible: true, width: 360, height: 215 });

  // Initialize executor
  var executor = new Executor();

  // Set up the message bridge FIRST — needed for httpRequestRaw in discovery
  setupHttpBridge();

  // Forward selection changes to UI
  figma.on("selectionchange", function() {
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

  // Discover a free relay in the port range
  var relayUrl = await discoverRelay();

  if (relayUrl) {
    await connectToRelayImpl(relayUrl, executor);
  } else {
    reportStatus("disconnected");

    // Retry discovery periodically
    var retryInterval = setInterval(async function() {
      var found = await discoverRelay();
      if (found) {
        clearInterval(retryInterval);
        await connectToRelayImpl(found, executor);
      }
    }, 3000);

    figma.on("close", function() {
      clearInterval(retryInterval);
    });
  }
}

async function connectToRelayImpl(relayUrl: string, executor: Executor): Promise<void> {
  var ws = new WSClient(relayUrl, executor);

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
    if (existingHandler) {
      (existingHandler as (msg: unknown) => void)(msg);
    }
  };

  // Extract port number for UI display
  var portMatch = relayUrl.match(/:(\d+)$/);
  var port = portMatch ? parseInt(portMatch[1], 10) : 7780;

  var poller = new Poller(relayUrl, executor);
  pollerRef = poller;
  var connected = await poller.connect();

  if (connected) {
    await poller.startPolling();
    reportStatus("http", port);

    var sessionId = poller.getSessionId();
    if (sessionId) ws.setSessionId(sessionId);
    var token = poller.getAuthToken();
    if (token) ws.setAuthToken(token);

    ws.onStatusChange(function(wsConnected) {
      reportStatus(wsConnected ? "websocket" : "http", port);
    });

    ws.connect();

    poller.setReconnectCallback(function() {
      var newSid = poller.getSessionId();
      if (newSid) ws.setSessionId(newSid);
      var newTok = poller.getAuthToken();
      if (newTok) ws.setAuthToken(newTok);
      ws.disconnect();
      ws.connect();
      reportStatus("http", port);
    });

    figma.on("close", function() {
      poller.disconnect();
      ws.disconnect();
    });
  } else {
    reportStatus("disconnected");

    var retryInterval = setInterval(async function() {
      var retryConnected = await poller.connect();
      if (retryConnected) {
        clearInterval(retryInterval);
        await poller.startPolling();
        reportStatus("http", port);

        var sid = poller.getSessionId();
        if (sid) ws.setSessionId(sid);
        var tok = poller.getAuthToken();
        if (tok) ws.setAuthToken(tok);

        ws.onStatusChange(function(wsConnected) {
          reportStatus(wsConnected ? "websocket" : "http", port);
        });

        ws.connect();

        poller.setReconnectCallback(function() {
          var newSid = poller.getSessionId();
          if (newSid) ws.setSessionId(newSid);
          var newTok = poller.getAuthToken();
          if (newTok) ws.setAuthToken(newTok);
          ws.disconnect();
          ws.connect();
          reportStatus("http", port);
        });

        figma.on("close", function() {
          poller.disconnect();
          ws.disconnect();
        });
      }
    }, 3000);

    figma.on("close", function() {
      clearInterval(retryInterval);
      poller.disconnect();
    });
  }
}

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

  // Use the poller's authenticated HTTP bridge (same path as /connect, /results)
  // Export a small thumbnail if there's a selection
  var thumbnailPromise: Promise<string | null>;
  if (sel.length > 0) {
    // Export the first selected node as a small PNG thumbnail
    var targetNode = sel[0];
    var exportSettings: ExportSettings = {
      format: "PNG" as const,
      constraint: { type: "WIDTH", value: 120 }
    };
    thumbnailPromise = targetNode.exportAsync(exportSettings).then(function(bytes) {
      // Convert Uint8Array to base64 manually (no btoa in plugin sandbox)
      var binary = "";
      for (var b = 0; b < bytes.length; b++) {
        binary += String.fromCharCode(bytes[b]);
      }
      // Use figma.base64Encode if available, otherwise manual encoding
      var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      var result = "";
      for (var bi = 0; bi < binary.length; bi += 3) {
        var a1 = binary.charCodeAt(bi);
        var a2 = bi + 1 < binary.length ? binary.charCodeAt(bi + 1) : 0;
        var a3 = bi + 2 < binary.length ? binary.charCodeAt(bi + 2) : 0;
        result += base64Chars[a1 >> 2];
        result += base64Chars[((a1 & 3) << 4) | (a2 >> 4)];
        result += bi + 1 < binary.length ? base64Chars[((a2 & 15) << 2) | (a3 >> 6)] : "=";
        result += bi + 2 < binary.length ? base64Chars[a3 & 63] : "=";
      }
      return "data:image/png;base64," + result;
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

    // Wait for thumbnail then confirm to UI with selection context
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

main().catch(function(e) { console.error("Rex init failed:", e); });
