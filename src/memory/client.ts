// ─── Memory Service HTTP Client ──────────────────────────────────────────────
// Replaces direct MongoDB access — calls the rex-memory-service REST API.

import type {
  MemoryEntry,
  MemoryScope,
  MemoryCategory,
  MemorySource,
  MemoryContext,
  ChatHistoryEntry,
  ChatSession,
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

  // ─── Chat History ─────────────────────────────────────────────────────────

  /**
   * Persist a chat message to the memory service. Fire-and-forget — caller
   * should not await this and should catch errors.
   */
  async saveChatMessage(entry: ChatHistoryEntry, context: MemoryContext): Promise<void> {
    const connected = await this.ensureConnected();
    if (!connected) return;

    const truncatedMessage = entry.message.length > 2000
      ? entry.message.slice(0, 2000)
      : entry.message;

    await this.remember({
      scope: "file",
      category: "context",
      content: JSON.stringify({ ...entry, message: truncatedMessage }),
      tags: ["chat-history", entry.role],
      source: "explicit",
      context,
    });
  }

  /**
   * Retrieve chat history for a file, sorted by timestamp ascending.
   */
  async getChatHistory(context: MemoryContext, limit: number = 20): Promise<ChatHistoryEntry[]> {
    const connected = await this.ensureConnected();
    if (!connected) return [];

    const entries = await this.recall({
      query: "chat-history",
      scope: "file",
      category: "context",
      context,
      limit: limit * 2, // Over-fetch to account for non-chat entries
    });

    const chatEntries: ChatHistoryEntry[] = [];
    for (const entry of entries) {
      if (!entry.tags?.includes("chat-history")) continue;
      try {
        const parsed = JSON.parse(entry.content) as ChatHistoryEntry;
        chatEntries.push(parsed);
      } catch {
        // Skip malformed entries
      }
    }

    chatEntries.sort((a, b) => a.timestamp - b.timestamp);
    return chatEntries.slice(-limit);
  }

  // ─── Chat Sessions ──────────────────────────────────────────────────────────

  /** Create a new chat session. */
  async createSession(session: ChatSession, context: MemoryContext): Promise<void> {
    const connected = await this.ensureConnected();
    if (!connected) return;

    await this.remember({
      scope: "file",
      category: "context",
      content: JSON.stringify(session),
      tags: ["chat-session", session.sessionId],
      source: "explicit",
      context,
    });
  }

  /** List recent chat sessions for the current file, sorted by lastMessageAt descending. */
  async listSessions(context: MemoryContext, limit: number = 20): Promise<ChatSession[]> {
    const connected = await this.ensureConnected();
    if (!connected) return [];

    // Use list and filter by chat-session tag client-side
    const entries = await this.list(context, "file", "context", limit * 5);

    // Deduplicate by sessionId — pick the entry with the latest lastMessageAt
    const sessionMap = new Map<string, ChatSession>();
    for (const entry of entries) {
      if (!entry.tags?.includes("chat-session")) continue;
      try {
        const parsed = JSON.parse(entry.content) as ChatSession;
        const existing = sessionMap.get(parsed.sessionId);
        if (!existing || parsed.lastMessageAt > existing.lastMessageAt) {
          sessionMap.set(parsed.sessionId, parsed);
        }
      } catch {
        // Skip malformed entries
      }
    }

    const sessions = Array.from(sessionMap.values());
    sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return sessions.slice(0, limit);
  }

  /** Update a session's metadata (name, summary, messageCount, lastMessageAt). */
  async updateSession(session: ChatSession, context: MemoryContext): Promise<void> {
    const connected = await this.ensureConnected();
    if (!connected) return;

    // Just store an updated entry — don't use forget() as it would also
    // delete chat-message entries that contain the sessionId in their content.
    // When listing sessions, we deduplicate by sessionId and pick the latest.
    await this.remember({
      scope: "file",
      category: "context",
      content: JSON.stringify(session),
      tags: ["chat-session", session.sessionId],
      source: "explicit",
      context,
    });
  }

  /** Get messages for a specific session, sorted by timestamp ascending. */
  async getSessionMessages(sessionId: string, context: MemoryContext, limit: number = 50): Promise<ChatHistoryEntry[]> {
    const connected = await this.ensureConnected();
    if (!connected) return [];

    // Use list with a generous limit and filter by sessionId tag client-side
    // (recall uses text search which may not reliably match sessionId in tags)
    const entries = await this.list(context, "file", "context", limit * 3);

    const messages: ChatHistoryEntry[] = [];
    for (const entry of entries) {
      if (!entry.tags?.includes("chat-message") || !entry.tags?.includes(sessionId)) continue;
      try {
        const parsed = JSON.parse(entry.content) as ChatHistoryEntry;
        messages.push(parsed);
      } catch {
        // Skip malformed entries
      }
    }

    messages.sort((a, b) => a.timestamp - b.timestamp);
    return messages.slice(-limit);
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
