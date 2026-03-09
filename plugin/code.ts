// ─── Hephaestus Bridge — Plugin Entry Point ─────────────────────────────────
// Figma development plugin that acts as a thin relay between the
// Hephaestus MCP server and the Figma Plugin API.
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

function reportStatus(transport: TransportStatus): void {
  figma.ui.postMessage({
    type: "status",
    connected: transport !== "disconnected",
    transport: transport,
  });
}

async function main(): Promise<void> {
  // Show minimal UI — MUST be called before any postMessage
  figma.showUI(__html__, { visible: true, width: 340, height: 150 });

  // Initialize executor
  var executor = new Executor();

  // Create WS client (needs to handle UI messages)
  var ws = new WSClient(RELAY_URL, executor);

  // Set up the message bridge: UI iframe handles HTTP/WS, relays responses back
  setupHttpBridge();

  // Add WS message handling to the existing onmessage handler
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
    // Forward to existing handler (which handles http-response)
    if (existingHandler) {
      (existingHandler as (msg: unknown) => void)(msg);
    }
  };

  // Pre-load common fonts (non-blocking for startup)
  preloadFonts().catch(function(e) { console.warn("Font preload failed:", e); });

  // Start HTTP polling (always-on baseline)
  var poller = new Poller(RELAY_URL, executor);
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

main().catch(function(e) { console.error("Hephaestus init failed:", e); });
