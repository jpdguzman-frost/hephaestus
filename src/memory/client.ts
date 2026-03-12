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

  constructor(baseUrl: string, logger: Logger) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.logger = logger.child({ component: "memory-client" });
  }

  get isConnected(): boolean {
    return this._connected;
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

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  async remember(input: CreateMemoryInput): Promise<MemoryEntry> {
    const resp = await this.post("/api/memories", input);
    return resp.memory as MemoryEntry;
  }

  async recall(input: QueryMemoryInput): Promise<MemoryEntry[]> {
    const resp = await this.post("/api/memories/recall", input);
    return (resp.memories as MemoryEntry[]) ?? [];
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
    return (resp.memories as MemoryEntry[]) ?? [];
  }

  async loadForSession(
    context: MemoryContext,
    maxEntries?: number,
  ): Promise<MemoryEntry[]> {
    const resp = await this.post("/api/memories/session", {
      context,
      maxEntries,
    });
    return (resp.memories as MemoryEntry[]) ?? [];
  }

  async cleanup(
    teamId: string,
    options?: CleanupOptions,
  ): Promise<CleanupResult> {
    return this.post("/api/memories/cleanup", {
      teamId,
      ...options,
    }) as unknown as Promise<CleanupResult>;
  }

  async applyDecay(teamId: string): Promise<number> {
    const resp = await this.post("/api/memories/decay", { teamId });
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
