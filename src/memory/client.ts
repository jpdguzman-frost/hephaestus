// ─── Memory Service HTTP Client ──────────────────────────────────────────────
// Replaces direct MongoDB access — calls the rex-memory-service REST API.

import type {
  MemoryEntry,
  MemoryScope,
  MemoryCategory,
  MemorySource,
  MemoryContext,
} from "./types.js";
import type { Logger } from "../shared/logger.js";

interface CreateMemoryInput {
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  tags?: string[];
  source?: MemorySource;
  context: MemoryContext;
}

interface QueryMemoryInput {
  query?: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  context: MemoryContext;
  limit?: number;
  includeSuperseded?: boolean;
}

interface CleanupOptions {
  dryRun?: boolean;
  maxAgeDays?: number;
  minConfidence?: number;
  removeSuperseded?: boolean;
}

interface CleanupResult {
  staleCount: number;
  lowConfidenceCount: number;
  supersededCount: number;
  totalRemoved: number;
  dryRun: boolean;
}

export class MemoryServiceClient {
  private baseUrl: string;
  private logger: Logger;
  private _connected = false;
  private _connecting: Promise<void> | null = null;

  constructor(baseUrl: string, logger: Logger) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.logger = logger.child({ component: "memory-client" });
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get url(): string {
    return this.baseUrl;
  }

  async connect(): Promise<void> {
    try {
      const resp = await fetch(this.baseUrl + "/api/health");
      if (resp.ok) {
        this._connected = true;
        this.logger.info("Memory service connected", { url: this.baseUrl });
      } else {
        this.logger.warn("Memory service health check failed", {
          status: resp.status,
        });
      }
    } catch (err) {
      this.logger.warn("Memory service unreachable", {
        url: this.baseUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Ensure the client is connected, retrying if the initial connect failed.
   * Called lazily before each memory operation.
   */
  async ensureConnected(): Promise<boolean> {
    if (this._connected) return true;

    // Avoid concurrent reconnect attempts
    if (this._connecting) {
      await this._connecting;
      return this._connected;
    }

    this._connecting = this.connect();
    try {
      await this._connecting;
    } finally {
      this._connecting = null;
    }
    return this._connected;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  async remember(input: CreateMemoryInput): Promise<MemoryEntry> {
    const resp = await this.post("/api/memories", input);
    return normalizeEntry(resp.memory as Record<string, unknown>);
  }

  async recall(input: QueryMemoryInput): Promise<MemoryEntry[]> {
    const resp = await this.post("/api/memories/recall", input);
    return normalizeEntries(resp.memories as Record<string, unknown>[]);
  }

  async forget(
    context: MemoryContext,
    id?: string,
    query?: string,
    scope?: MemoryScope,
  ): Promise<number> {
    const resp = await this.post("/api/memories/forget", {
      id,
      query,
      scope,
      context,
    });
    return (resp.deleted as number) ?? 0;
  }

  async list(
    context: MemoryContext,
    scope?: MemoryScope,
    category?: MemoryCategory,
    limit?: number,
    includeSuperseded?: boolean,
  ): Promise<MemoryEntry[]> {
    const resp = await this.post("/api/memories/list", {
      context,
      scope,
      category,
      limit,
      includeSuperseded,
    });
    return normalizeEntries(resp.memories as Record<string, unknown>[]);
  }

  async loadForSession(
    context: MemoryContext,
    maxEntries?: number,
  ): Promise<MemoryEntry[]> {
    const resp = await this.post("/api/memories/session", {
      context,
      maxEntries,
    });
    return normalizeEntries(resp.memories as Record<string, unknown>[]);
  }

  async cleanup(
    options?: CleanupOptions,
  ): Promise<CleanupResult> {
    return this.post("/api/memories/cleanup", {
      ...options,
    }) as unknown as Promise<CleanupResult>;
  }

  async applyDecay(): Promise<number> {
    const resp = await this.post("/api/memories/decay", {});
    return (resp.modified as number) ?? 0;
  }

  // ─── HTTP Helpers ──────────────────────────────────────────────────────────

  private async post(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const url = this.baseUrl + path;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Memory service ${resp.status}: ${text}`);
      }
      return (await resp.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.error("Memory service request failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

// ─── Response Normalization ────────────────────────────────────────────────
// The memory service returns `id` but MemoryEntry expects `_id`.

function normalizeEntry(raw: Record<string, unknown>): MemoryEntry {
  if (raw.id && !raw._id) {
    raw._id = raw.id;
  }
  return raw as unknown as MemoryEntry;
}

function normalizeEntries(raw: Record<string, unknown>[] | undefined): MemoryEntry[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(normalizeEntry);
}
