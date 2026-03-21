import {
  RexError,
  internalError,
  validationError
} from "./chunk-ZSHX4C3A.js";

// src/shared/config.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
var PaddingArraySchema = z.array(z.number().int().positive()).min(1).max(6);
var RelayConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7780),
  host: z.string().default("127.0.0.1"),
  portRangeStart: z.number().int().min(1024).max(65535).default(7780),
  portRangeEnd: z.number().int().min(1024).max(65535).default(7789)
});
var PollingConfigSchema = z.object({
  defaultInterval: z.number().int().positive().default(300),
  burstInterval: z.number().int().positive().default(100),
  idleInterval: z.number().int().positive().default(500),
  idleThreshold: z.number().int().positive().default(1e4)
});
var WebSocketConfigSchema = z.object({
  enabled: z.boolean().default(true),
  heartbeatInterval: z.number().int().positive().default(5e3),
  heartbeatTimeout: z.number().int().positive().default(3e3),
  reconnectBackoff: PaddingArraySchema.default([500, 1e3, 2e3, 4e3, 8e3, 15e3])
});
var CommandsConfigSchema = z.object({
  defaultTtl: z.number().int().positive().default(6e4),
  maxRetries: z.number().int().min(0).default(1),
  maxConcurrent: z.number().int().positive().default(10),
  maxPerSecond: z.number().int().positive().default(100)
});
var FigmaConfigSchema = z.object({
  personalAccessToken: z.string().optional(),
  preloadFonts: z.array(z.string()).default(["Inter", "Plus Jakarta Sans"])
});
var ConfigSchema = z.object({
  relay: RelayConfigSchema.default({}),
  polling: PollingConfigSchema.default({}),
  websocket: WebSocketConfigSchema.default({}),
  commands: CommandsConfigSchema.default({}),
  figma: FigmaConfigSchema.default({})
});
function loadConfig(configPath) {
  const filePath = configPath ?? resolve(process.cwd(), "rex.config.json");
  let fileConfig = {};
  try {
    const raw = readFileSync(filePath, "utf-8");
    fileConfig = JSON.parse(raw);
  } catch {
  }
  const envOverrides = getEnvironmentOverrides();
  const merged = deepMerge(fileConfig, envOverrides);
  return ConfigSchema.parse(merged);
}
function getEnvironmentOverrides() {
  const overrides = {};
  const figmaPat = process.env["FIGMA_PAT"];
  if (figmaPat) {
    overrides["figma"] = { personalAccessToken: figmaPat };
  }
  const relayPort = process.env["RELAY_PORT"];
  if (relayPort) {
    const port = parseInt(relayPort, 10);
    if (!isNaN(port)) {
      overrides["relay"] = { ...overrides["relay"], port };
    }
  }
  const relayHost = process.env["RELAY_HOST"];
  if (relayHost) {
    overrides["relay"] = { ...overrides["relay"], host: relayHost };
  }
  const logLevel = process.env["LOG_LEVEL"];
  if (logLevel) {
    overrides["logLevel"] = logLevel;
  }
  const wsEnabled = process.env["WS_ENABLED"];
  if (wsEnabled !== void 0) {
    overrides["websocket"] = {
      ...overrides["websocket"],
      enabled: wsEnabled === "true" || wsEnabled === "1"
    };
  }
  return overrides;
}
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (sourceVal !== null && typeof sourceVal === "object" && !Array.isArray(sourceVal) && targetVal !== null && typeof targetVal === "object" && !Array.isArray(targetVal)) {
      result[key] = deepMerge(
        targetVal,
        sourceVal
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

// src/shared/logger.ts
var LOG_LEVEL_ORDER = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
function createLogger(minLevel = "info", baseFields = {}) {
  const minOrder = LOG_LEVEL_ORDER[minLevel];
  function write(level, message, fields) {
    if (LOG_LEVEL_ORDER[level] < minOrder) return;
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      ...baseFields,
      ...fields
    };
    process.stderr.write(JSON.stringify(entry) + "\n");
  }
  return {
    debug(message, fields) {
      write("debug", message, fields);
    },
    info(message, fields) {
      write("info", message, fields);
    },
    warn(message, fields) {
      write("warn", message, fields);
    },
    error(message, fields) {
      write("error", message, fields);
    },
    child(childFields) {
      return createLogger(minLevel, { ...baseFields, ...childFields });
    }
  };
}

// src/rest-api/client.ts
var ResponseCache = class {
  store = /* @__PURE__ */ new Map();
  maxEntries;
  defaultTtlMs;
  constructor(maxEntries = 200, defaultTtlMs = 3e4) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return void 0;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return void 0;
    }
    return entry.data;
  }
  set(key, data, ttlMs) {
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== void 0) {
        this.store.delete(firstKey);
      }
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs)
    });
  }
  invalidate(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
};
var RateLimiter = class {
  tokens;
  lastRefill;
  maxTokens;
  refillRatePerMs;
  constructor(maxRequestsPerMinute = 25) {
    this.maxTokens = maxRequestsPerMinute;
    this.tokens = maxRequestsPerMinute;
    this.lastRefill = Date.now();
    this.refillRatePerMs = maxRequestsPerMinute / 6e4;
  }
  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }
  /**
   * Wait until a token is available, then consume it.
   * Returns a promise that resolves when the request can proceed.
   */
  async acquire() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
    await new Promise((resolve2) => setTimeout(resolve2, waitMs));
    this.refill();
    this.tokens -= 1;
  }
};
var FigmaClient = class {
  baseUrl;
  token;
  rateLimiter;
  cache;
  logger;
  constructor(options = {}) {
    const config = options.config ?? loadConfig();
    this.logger = (options.logger ?? createLogger()).child({ module: "figma-rest-api" });
    this.baseUrl = (options.baseUrl ?? "https://api.figma.com/v1").replace(/\/+$/, "");
    const token = config.figma.personalAccessToken;
    if (!token) {
      throw validationError(
        "FIGMA_PAT is required for REST API access. Set it via the FIGMA_PAT environment variable or in rex.config.json.",
        { suggestion: "Set the FIGMA_PAT environment variable to your Figma Personal Access Token." }
      );
    }
    this.token = token;
    this.rateLimiter = new RateLimiter(options.maxRequestsPerMinute ?? 25);
    if (options.cacheEnabled !== false) {
      this.cache = new ResponseCache(
        options.cacheMaxEntries ?? 200,
        options.cacheTtlMs ?? 3e4
      );
    } else {
      this.cache = null;
    }
  }
  /**
   * Make an authenticated request to the Figma REST API.
   *
   * @param path  - API path (e.g., "/files/abc123")
   * @param options - Request options
   * @returns Parsed JSON response
   */
  async request(path, options = {}) {
    const method = options.method ?? "GET";
    const url = this.buildUrl(path, options.params);
    const cacheKey = method === "GET" ? url : null;
    if (cacheKey && this.cache && options.cacheTtlMs !== 0) {
      const cached = this.cache.get(cacheKey);
      if (cached !== void 0) {
        this.logger.debug("Cache hit", { path, method });
        return cached;
      }
    }
    await this.rateLimiter.acquire();
    const headers = {
      "X-Figma-Token": this.token,
      "Accept": "application/json"
    };
    if (options.body !== void 0) {
      headers["Content-Type"] = "application/json";
    }
    this.logger.debug("Figma API request", { method, path });
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== void 0 ? JSON.stringify(options.body) : void 0,
        signal: options.signal
      });
    } catch (err) {
      throw new RexError({
        category: "CONNECTION_LOST" /* CONNECTION_LOST */,
        message: `Figma API request failed: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
        suggestion: "Check your network connection and try again.",
        cause: err
      });
    }
    if (!response.ok) {
      await this.handleErrorResponse(response, path, method);
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return void 0;
    }
    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw internalError(`Failed to parse Figma API response for ${method} ${path}`, { cause: err });
    }
    if (cacheKey && this.cache) {
      this.cache.set(cacheKey, data, options.cacheTtlMs);
    }
    return data;
  }
  /**
   * Convenience: GET request.
   */
  async get(path, options = {}) {
    return this.request(path, { ...options, method: "GET" });
  }
  /**
   * Convenience: POST request.
   */
  async post(path, body, options = {}) {
    return this.request(path, { ...options, method: "POST", body, cacheTtlMs: 0 });
  }
  /**
   * Convenience: DELETE request.
   */
  async delete(path, options = {}) {
    return this.request(path, { ...options, method: "DELETE", cacheTtlMs: 0 });
  }
  /**
   * Clear the response cache (all entries or for a specific path pattern).
   */
  clearCache() {
    this.cache?.clear();
  }
  // ─── Private ──────────────────────────────────────────────────────────────
  buildUrl(path, params) {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          url.searchParams.set(key, value.join(","));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }
  async handleErrorResponse(response, path, method) {
    let errorBody = null;
    try {
      errorBody = await response.json();
    } catch {
    }
    const message = errorBody?.err ?? errorBody?.message ?? response.statusText;
    const status = response.status;
    this.logger.error("Figma API error", { method, path, status, message });
    if (status === 401 || status === 403) {
      throw new RexError({
        category: "INVALID_PARAMS" /* INVALID_PARAMS */,
        message: `Figma API authentication failed (${status}): ${message}`,
        retryable: false,
        suggestion: "Check that your FIGMA_PAT is valid and has the required scopes."
      });
    }
    if (status === 404) {
      throw new RexError({
        category: "NODE_NOT_FOUND" /* NODE_NOT_FOUND */,
        message: `Figma API resource not found: ${method} ${path} \u2014 ${message}`,
        retryable: false,
        suggestion: "Verify the file key and node IDs are correct."
      });
    }
    if (status === 429) {
      throw new RexError({
        category: "CONNECTION_LOST" /* CONNECTION_LOST */,
        message: `Figma API rate limit exceeded: ${message}`,
        retryable: true,
        suggestion: "Wait a moment and try again. The rate limiter will back off automatically."
      });
    }
    if (status >= 500) {
      throw new RexError({
        category: "CONNECTION_LOST" /* CONNECTION_LOST */,
        message: `Figma API server error (${status}): ${message}`,
        retryable: true,
        suggestion: "This is a Figma server issue. Try again shortly."
      });
    }
    throw new RexError({
      category: "INVALID_OPERATION" /* INVALID_OPERATION */,
      message: `Figma API error (${status}): ${message}`,
      retryable: false,
      figmaError: message
    });
  }
};

// src/rest-api/comments.ts
async function getComments(client, fileKey) {
  return client.get(`/files/${fileKey}/comments`, {
    // Comments change frequently; use a short cache TTL
    cacheTtlMs: 5e3
  });
}
async function postComment(client, fileKey, params) {
  return client.post(`/files/${fileKey}/comments`, params);
}
async function deleteComment(client, fileKey, commentId) {
  await client.delete(`/files/${fileKey}/comments/${commentId}`);
}

export {
  loadConfig,
  createLogger,
  FigmaClient,
  getComments,
  postComment,
  deleteComment
};
//# sourceMappingURL=chunk-PRDKVBQ5.js.map