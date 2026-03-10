/**
 * Base HTTP client for the Figma REST API.
 *
 * Uses native fetch (Node.js 20+), the Personal Access Token from config,
 * rate limiting, typed error handling, and optional response caching.
 */

import { type Config, loadConfig } from "../shared/config.js";
import { RexError, internalError, validationError } from "../shared/errors.js";
import { type Logger, createLogger } from "../shared/logger.js";
import { ErrorCategory } from "../shared/types.js";

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
}

/**
 * Simple in-memory TTL cache for GET responses.
 * Bounded by max entries; oldest entries evicted on overflow.
 */
class ResponseCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries = 200, defaultTtlMs = 30_000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    // Evict oldest if at capacity
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

/**
 * Token-bucket rate limiter that respects Figma API limits.
 * Figma's REST API rate limit is roughly 30 req/min for most endpoints.
 * We default to a conservative 25 req/min with burst capacity.
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;

  constructor(maxRequestsPerMinute = 25) {
    this.maxTokens = maxRequestsPerMinute;
    this.tokens = maxRequestsPerMinute;
    this.lastRefill = Date.now();
    this.refillRatePerMs = maxRequestsPerMinute / 60_000;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }

  /**
   * Wait until a token is available, then consume it.
   * Returns a promise that resolves when the request can proceed.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Calculate wait time for next token
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= 1;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Options for individual requests. */
export interface RequestOptions {
  /** Query parameters appended to the URL. */
  params?: Record<string, string | number | boolean | string[]>;
  /** Override the default cache TTL (ms). Set to 0 to skip caching. */
  cacheTtlMs?: number;
  /** HTTP method override (default: GET). */
  method?: "GET" | "POST" | "DELETE";
  /** JSON body for POST/PUT requests. */
  body?: unknown;
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
}

/** Options for constructing a FigmaClient. */
export interface FigmaClientOptions {
  /** Override the loaded config. */
  config?: Config;
  /** Custom logger instance. */
  logger?: Logger;
  /** Base URL for the Figma API (default: https://api.figma.com/v1). */
  baseUrl?: string;
  /** Max requests per minute for rate limiting (default: 25). */
  maxRequestsPerMinute?: number;
  /** Enable response caching (default: true). */
  cacheEnabled?: boolean;
  /** Default cache TTL in ms (default: 30000). */
  cacheTtlMs?: number;
  /** Max cache entries (default: 200). */
  cacheMaxEntries?: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Figma REST API HTTP client.
 *
 * Handles authentication, rate limiting, caching, and error mapping.
 * All endpoint modules (files, components, etc.) use this client.
 */
export class FigmaClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly rateLimiter: RateLimiter;
  private readonly cache: ResponseCache | null;
  private readonly logger: Logger;

  constructor(options: FigmaClientOptions = {}) {
    const config = options.config ?? loadConfig();
    this.logger = (options.logger ?? createLogger()).child({ module: "figma-rest-api" });
    this.baseUrl = (options.baseUrl ?? "https://api.figma.com/v1").replace(/\/+$/, "");

    const token = config.figma.personalAccessToken;
    if (!token) {
      throw validationError(
        "FIGMA_PAT is required for REST API access. Set it via the FIGMA_PAT environment variable or in rex.config.json.",
        { suggestion: "Set the FIGMA_PAT environment variable to your Figma Personal Access Token." },
      );
    }
    this.token = token;

    this.rateLimiter = new RateLimiter(options.maxRequestsPerMinute ?? 25);

    if (options.cacheEnabled !== false) {
      this.cache = new ResponseCache(
        options.cacheMaxEntries ?? 200,
        options.cacheTtlMs ?? 30_000,
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
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = this.buildUrl(path, options.params);
    const cacheKey = method === "GET" ? url : null;

    // Check cache for GET requests
    if (cacheKey && this.cache && options.cacheTtlMs !== 0) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) {
        this.logger.debug("Cache hit", { path, method });
        return cached;
      }
    }

    // Rate limit
    await this.rateLimiter.acquire();

    // Build headers
    const headers: Record<string, string> = {
      "X-Figma-Token": this.token,
      "Accept": "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    this.logger.debug("Figma API request", { method, path });

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (err) {
      throw new RexError({
        category: ErrorCategory.CONNECTION_LOST,
        message: `Figma API request failed: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
        suggestion: "Check your network connection and try again.",
        cause: err,
      });
    }

    // Handle error responses
    if (!response.ok) {
      await this.handleErrorResponse(response, path, method);
    }

    // Parse JSON (handle empty responses from DELETE/POST returning 204)
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }

    let data: T;
    try {
      data = (await response.json()) as T;
    } catch (err) {
      throw internalError(`Failed to parse Figma API response for ${method} ${path}`, { cause: err });
    }

    // Cache successful GET responses
    if (cacheKey && this.cache) {
      this.cache.set(cacheKey, data, options.cacheTtlMs);
    }

    return data;
  }

  /**
   * Convenience: GET request.
   */
  async get<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  /**
   * Convenience: POST request.
   */
  async post<T>(path: string, body: unknown, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body, cacheTtlMs: 0 });
  }

  /**
   * Convenience: DELETE request.
   */
  async delete<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE", cacheTtlMs: 0 });
  }

  /**
   * Clear the response cache (all entries or for a specific path pattern).
   */
  clearCache(): void {
    this.cache?.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[]>): string {
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

  private async handleErrorResponse(response: Response, path: string, method: string): Promise<never> {
    let errorBody: { err?: string; message?: string; status?: number } | null = null;
    try {
      errorBody = (await response.json()) as { err?: string; message?: string; status?: number };
    } catch {
      // Body may not be JSON
    }

    const message = errorBody?.err ?? errorBody?.message ?? response.statusText;
    const status = response.status;

    this.logger.error("Figma API error", { method, path, status, message });

    if (status === 401 || status === 403) {
      throw new RexError({
        category: ErrorCategory.INVALID_PARAMS,
        message: `Figma API authentication failed (${status}): ${message}`,
        retryable: false,
        suggestion: "Check that your FIGMA_PAT is valid and has the required scopes.",
      });
    }

    if (status === 404) {
      throw new RexError({
        category: ErrorCategory.NODE_NOT_FOUND,
        message: `Figma API resource not found: ${method} ${path} — ${message}`,
        retryable: false,
        suggestion: "Verify the file key and node IDs are correct.",
      });
    }

    if (status === 429) {
      throw new RexError({
        category: ErrorCategory.CONNECTION_LOST,
        message: `Figma API rate limit exceeded: ${message}`,
        retryable: true,
        suggestion: "Wait a moment and try again. The rate limiter will back off automatically.",
      });
    }

    if (status >= 500) {
      throw new RexError({
        category: ErrorCategory.CONNECTION_LOST,
        message: `Figma API server error (${status}): ${message}`,
        retryable: true,
        suggestion: "This is a Figma server issue. Try again shortly.",
      });
    }

    throw new RexError({
      category: ErrorCategory.INVALID_OPERATION,
      message: `Figma API error (${status}): ${message}`,
      retryable: false,
      figmaError: message,
    });
  }
}
