import type { Logger } from "../shared/logger.js";
import type { WebSocketConfig } from "../shared/config.js";
import type { ConnectionManager } from "./connection.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Health metrics tracked by the heartbeat monitor. */
export interface HealthMetrics {
  commands: {
    total: number;
    success: number;
    failed: number;
    timeout: number;
    retried: number;
  };
  latency: {
    /** Running average latency in ms. */
    avg: number;
    /** 95th percentile latency in ms. */
    p95: number;
    /** All recorded latencies (bounded circular buffer). */
    samples: number[];
  };
  connection: {
    uptime: number;
    reconnects: number;
  };
  transport: {
    httpPolls: number;
    wsMessages: number;
  };
}

// ─── Heartbeat Monitor ─────────────────────────────────────────────────────

/** Maximum number of latency samples to keep for percentile calculation. */
const MAX_LATENCY_SAMPLES = 1000;

/** Number of consecutive missed HTTP polls before declaring disconnected. */
const MAX_MISSED_POLLS = 10;

/** Number of consecutive missed WebSocket pongs before declaring dead. */
const MAX_MISSED_PONGS = 2;

export class HeartbeatMonitor {
  private readonly logger: Logger;
  private readonly wsConfig: WebSocketConfig;
  private readonly connection: ConnectionManager;

  // Poll tracking
  private lastPollTime = 0;
  private missedPolls = 0;
  private pollCheckTimer: ReturnType<typeof setInterval> | null = null;

  // WebSocket pong tracking
  private awaitingPong = false;
  private missedPongs = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingSender: (() => void) | null = null;
  private heartbeatPaused = false;

  // Metrics
  private readonly metrics: HealthMetrics = {
    commands: {
      total: 0,
      success: 0,
      failed: 0,
      timeout: 0,
      retried: 0,
    },
    latency: {
      avg: 0,
      p95: 0,
      samples: [],
    },
    connection: {
      uptime: 0,
      reconnects: 0,
    },
    transport: {
      httpPolls: 0,
      wsMessages: 0,
    },
  };

  // Callbacks
  private onPollTimeout: (() => void) | null = null;
  private onPongTimeout: (() => void) | null = null;

  constructor(
    connection: ConnectionManager,
    wsConfig: WebSocketConfig,
    logger: Logger,
  ) {
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
  startPollMonitoring(
    _expectedInterval: number,
    onTimeout: () => void,
  ): void {
    // Stop any existing poll monitoring first (prevents duplicate timers on reconnect)
    if (this.pollCheckTimer) {
      clearInterval(this.pollCheckTimer);
      this.pollCheckTimer = null;
    }

    this.onPollTimeout = onTimeout;
    this.lastPollTime = Date.now();
    this.missedPolls = 0;

    // Check for missed polls — use a generous window since the plugin
    // can't poll while it's executing commands (single-threaded).
    // Check every 5s, tolerate up to 10s gap per check (100s total before disconnect).
    const checkInterval = 5000;
    this.pollCheckTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastPollTime;
      if (elapsed > 10000) {
        this.missedPolls++;
        this.logger.warn("Missed poll detected", {
          missedPolls: this.missedPolls,
          maxMissed: MAX_MISSED_POLLS,
          elapsed,
        });

        if (this.missedPolls >= MAX_MISSED_POLLS) {
          this.logger.error("Plugin disconnected: too many missed polls", {
            missedPolls: this.missedPolls,
          });
          this.onPollTimeout?.();
        }
      } else {
        this.missedPolls = 0;
      }
    }, checkInterval);
  }

  /** Record that a poll was received. Resets missed poll counter. */
  recordPoll(): void {
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
  startWsHeartbeat(
    sendPing: () => void,
    onTimeout: () => void,
  ): void {
    this.pingSender = sendPing;
    this.onPongTimeout = onTimeout;
    this.missedPongs = 0;
    this.awaitingPong = false;

    // Send ping at the configured interval
    this.pingTimer = setInterval(() => {
      // Skip pings while plugin is executing a command
      if (this.heartbeatPaused) return;

      if (this.awaitingPong) {
        this.missedPongs++;
        this.logger.warn("Missed WebSocket pong", {
          missedPongs: this.missedPongs,
          maxMissed: MAX_MISSED_PONGS,
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

      // Set a timeout for the pong response
      this.pongTimeout = setTimeout(() => {
        // This timeout fires if pong is not received in time
        // The next ping interval check will handle the missed pong count
      }, this.wsConfig.heartbeatTimeout);
    }, this.wsConfig.heartbeatInterval);
  }

  /** Record that a pong was received. Resets missed pong counter. */
  recordPong(): void {
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
  pauseWsHeartbeat(): void {
    this.heartbeatPaused = true;
  }

  /**
   * Resume WS heartbeat pings after command execution completes.
   * Resets missed pong counter since the pause was intentional.
   */
  resumeWsHeartbeat(): void {
    this.heartbeatPaused = false;
    this.missedPongs = 0;
    this.awaitingPong = false;
  }

  /** Record a WebSocket message. */
  recordWsMessage(): void {
    this.metrics.transport.wsMessages++;
  }

  /** Stop WebSocket heartbeat monitoring. */
  stopWsHeartbeat(): void {
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
  recordCommandTotal(): void {
    this.metrics.commands.total++;
  }

  /** Record a successful command with its latency. */
  recordCommandSuccess(latencyMs: number): void {
    this.metrics.commands.success++;
    this.addLatencySample(latencyMs);
  }

  /** Record a failed command. */
  recordCommandFailed(): void {
    this.metrics.commands.failed++;
  }

  /** Record a timed-out command. */
  recordCommandTimeout(): void {
    this.metrics.commands.timeout++;
  }

  /** Record a retried command. */
  recordCommandRetried(): void {
    this.metrics.commands.retried++;
  }

  /** Record a WebSocket reconnection. */
  recordReconnect(): void {
    this.metrics.connection.reconnects++;
  }

  /** Add a latency sample and recalculate stats. */
  private addLatencySample(ms: number): void {
    const samples = this.metrics.latency.samples;
    samples.push(ms);

    // Keep bounded
    if (samples.length > MAX_LATENCY_SAMPLES) {
      samples.shift();
    }

    // Recalculate avg
    const sum = samples.reduce((a, b) => a + b, 0);
    this.metrics.latency.avg = Math.round(sum / samples.length);

    // Recalculate p95
    const sorted = [...samples].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    this.metrics.latency.p95 = sorted[p95Index] ?? 0;
  }

  /** Get current health metrics snapshot. */
  getMetrics(): HealthMetrics {
    // Update connection uptime
    if (this.connection.session) {
      this.metrics.connection.uptime = Date.now() - this.connection.session.connectedAt;
    }
    return { ...this.metrics };
  }

  /** Get a summary suitable for the /health endpoint. */
  getHealthSummary(): Record<string, unknown> {
    const m = this.getMetrics();
    return {
      pending: 0, // Will be filled by server from queue stats
      inFlight: 0,
      completedTotal: m.commands.success,
      failedTotal: m.commands.failed,
      timeoutTotal: m.commands.timeout,
      averageLatency: m.latency.avg,
      p95Latency: m.latency.p95,
    };
  }

  /** Clean up all timers. */
  destroy(): void {
    this.stopWsHeartbeat();
    if (this.pollCheckTimer) {
      clearInterval(this.pollCheckTimer);
      this.pollCheckTimer = null;
    }
  }
}
