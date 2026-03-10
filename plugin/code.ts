// ─── Rex Bridge — Plugin Entry Point ─────────────────────────────────
// Figma development plugin that acts as a thin relay between the
// Rex MCP server and the Figma Plugin API.
//
// IMPORTANT: The main thread (this file) has NO access to XMLHttpRequest,
// fetch, or WebSocket. All networking goes through the UI iframe via
// figma.ui.postMessage / figma.ui.onmessage.

import { Poller, setupHttpBridge } from "./poller";
import { WSClient } from "./ws-client";
import { Executor } from "./executor";
import { preloadFonts } from "./fonts";

var RELAY_URL = "http://localhost:7780";

type TransportStatus = "websocket" | "http" | "disconnected";

// Module-scope poller reference so chat handler can access it
var pollerRef: Poller | null = null;

function reportStatus(transport: TransportStatus): void {
  figma.ui.postMessage({
    type: "status",
    connected: transport !== "disconnected",
    transport: transport,
  });
}

async function main(): Promise<void> {
  // Show minimal UI — MUST be called before any postMessage
  figma.showUI(__html__, { visible: true, width: 360, height: 215 });

  // Initialize executor
  var executor = new Executor();

  // Create WS client (needs to handle UI messages)
  var ws = new WSClient(RELAY_URL, executor);

  // Set up the message bridge: UI iframe handles HTTP/WS, relays responses back
  setupHttpBridge();

  // Add WS, chat, and resize message handling to the existing onmessage handler
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
    // Forward to existing handler (which handles http-response)
    if (existingHandler) {
      (existingHandler as (msg: unknown) => void)(msg);
    }
  };

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

  // Start HTTP polling (always-on baseline)
  var poller = new Poller(RELAY_URL, executor);
  pollerRef = poller;
  var connected = await poller.connect();

  if (connected) {
    await poller.startPolling();
    reportStatus("http");

    // Attempt WebSocket upgrade (optional fast path)
    var sessionId = poller.getSessionId();
    if (sessionId) {
      ws.setSessionId(sessionId);
    }
    var token = poller.getAuthToken();
    if (token) {
      ws.setAuthToken(token);
    }

    ws.onStatusChange(function(wsConnected) {
      reportStatus(wsConnected ? "websocket" : "http");
    });

    ws.connect();

    // Auto-reconnect: when poller reconnects, re-upgrade WebSocket
    poller.setReconnectCallback(function() {
      var newSid = poller.getSessionId();
      if (newSid) ws.setSessionId(newSid);
      var newTok = poller.getAuthToken();
      if (newTok) ws.setAuthToken(newTok);
      ws.disconnect();
      ws.connect();
      reportStatus("http");
    });

    figma.on("close", function() {
      poller.disconnect();
      ws.disconnect();
    });
  } else {
    reportStatus("disconnected");

    // Retry connection periodically
    var retryInterval = setInterval(async function() {
      var retryConnected = await poller.connect();
      if (retryConnected) {
        clearInterval(retryInterval);
        await poller.startPolling();
        reportStatus("http");

        var sid = poller.getSessionId();
        if (sid) {
          ws.setSessionId(sid);
        }
        var tok = poller.getAuthToken();
        if (tok) {
          ws.setAuthToken(tok);
        }

        ws.onStatusChange(function(wsConnected) {
          reportStatus(wsConnected ? "websocket" : "http");
        });

        ws.connect();

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
