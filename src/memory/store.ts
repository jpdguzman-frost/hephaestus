// ─── Memory Store ────────────────────────────────────────────────────────────
// MongoDB-backed persistent memory for Rex.

import type { Collection, Db, MongoClient as MongoClientType } from "mongodb";
import type {
  MemoryConfig,
  MemoryEntry,
  MemoryScope,
  MemoryCategory,
  MemorySource,
  MemoryUser,
  MemoryContext,
} from "./types.js";
import type { Logger } from "../shared/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

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
  componentKey?: string;
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

// ─── Memory Store Class ─────────────────────────────────────────────────────

export class MemoryStore {
  private client: MongoClientType | null = null;
  private db: Db | null = null;
  private memories: Collection<MemoryEntry> | null = null;
  private config: MemoryConfig;
  private logger: Logger;

  constructor(config: MemoryConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: "memory-store" });
  }

  /** Connect to MongoDB and set up indexes. */
  async connect(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info("Memory system disabled");
      return;
    }

    try {
      // Dynamic import — mongodb is an optional dependency
      const { MongoClient } = await import("mongodb");
      this.client = new MongoClient(this.config.mongoUri);
      await this.client.connect();

      this.db = this.client.db(this.config.dbName);
      this.memories = this.db.collection<MemoryEntry>("memories");

      // Create indexes
      await this.memories.createIndex(
        { scope: 1, confidence: -1 },
        { background: true },
      );
      await this.memories.createIndex(
        { fileKey: 1, scope: 1, confidence: -1 },
        { background: true },
      );
      await this.memories.createIndex(
        { userId: 1, scope: 1 },
        { background: true },
      );
      await this.memories.createIndex({ tags: 1 }, { background: true });
      await this.memories.createIndex(
        { componentKey: 1 },
        { background: true, sparse: true },
      );
      await this.memories.createIndex({ createdAt: 1 }, { background: true });
      await this.memories.createIndex(
        { supersededBy: 1 },
        { background: true, sparse: true },
      );

      // Text index for content search
      await this.memories
        .createIndex(
          { content: "text", tags: "text" },
          { background: true, name: "content_text" },
        )
        .catch(() => {
          // Text index may already exist with different options — safe to ignore
        });

      this.logger.info("Memory store connected", {
        uri: this.config.mongoUri.replace(/\/\/.*@/, "//<redacted>@"),
        db: this.config.dbName,
      });
    } catch (err) {
      this.logger.error("Failed to connect memory store", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Memory is optional — don't crash the server
      this.client = null;
      this.db = null;
      this.memories = null;
    }
  }

  /** Disconnect from MongoDB. */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.memories = null;
      this.logger.info("Memory store disconnected");
    }
  }

  /** Whether the memory store is connected and usable. */
  get isConnected(): boolean {
    return this.memories !== null;
  }

  // ─── CRUD Operations ───────────────────────────────────────────────────────

  /** Store a new memory. Checks for conflicts and supersedes if needed. */
  async remember(input: CreateMemoryInput): Promise<MemoryEntry> {
    this.ensureConnected();

    const now = new Date();
    const user: MemoryUser = {
      id: input.context.userId ?? "unknown",
      name: input.context.userName ?? "Unknown",
    };

    // Check for existing similar memories to supersede
    const existing = await this.findSimilar(
      input.content,
      input.scope,
      input.context,
    );
    if (existing) {
      // Supersede the old memory
      await this.memories!.updateOne(
        { _id: existing._id },
        {
          $set: {
            supersededBy: "pending", // Will be updated below
            confidence: 0,
            updatedAt: now,
          },
        },
      );
    }

    // Build entry with only populated fields — avoid storing nulls in MongoDB
    const entry: Record<string, unknown> = {
      _id: generateId(),
      scope: input.scope,
      category: input.category,
      content: input.content,
      tags: input.tags ?? [],
      source: input.source ?? "explicit",
      createdBy: user,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      confidence: input.source === "corrected" ? 1.0 : input.source === "inferred" ? 0.6 : 0.9,
      accessCount: 0,
    };

    // Scope keys — only include when relevant
    if (input.scope === "user" && input.context.userId) {
      entry.userId = input.context.userId;
    }
    if ((input.scope === "file" || input.scope === "page") && input.context.fileKey) {
      entry.fileKey = input.context.fileKey;
      if (input.context.fileName) entry.fileName = input.context.fileName;
    }
    if (input.context.componentKey) {
      entry.componentKey = input.context.componentKey;
    }
    if (existing) {
      entry.relatedTo = [existing._id];
    }

    await this.memories!.insertOne(entry as any);

    // Update supersedure link
    if (existing) {
      await this.memories!.updateOne(
        { _id: existing._id },
        { $set: { supersededBy: entry._id as string } },
      );
    }

    this.logger.debug("Memory stored", {
      id: entry._id as string,
      scope: entry.scope as string,
      category: entry.category as string,
    });

    return entry as unknown as MemoryEntry;
  }

  /** Query memories relevant to a topic. */
  async recall(input: QueryMemoryInput): Promise<MemoryEntry[]> {
    this.ensureConnected();

    const filter: Record<string, unknown> = {};

    // Scope filter
    if (input.scope) {
      filter["scope"] = input.scope;
    }

    // Category filter
    if (input.category) {
      filter["category"] = input.category;
    }

    // Exclude superseded unless requested
    if (!input.includeSuperseded) {
      filter["supersededBy"] = { $exists: false };
    }

    // Scope-specific filters — include memories from broader scopes too
    if (!input.scope) {
      // No scope filter: include team + file + page + user memories visible to this context
      filter["$or"] = buildScopeFilter(input.context);
    } else {
      applyScopeKey(filter, input.scope, input.context);
    }

    // Component key filter
    if (input.componentKey) {
      filter["componentKey"] = input.componentKey;
    }

    // Confidence threshold
    filter["confidence"] = { $gt: 0.1 };

    const limit = input.limit ?? 10;

    let cursor;
    if (input.query) {
      // Text search with relevance scoring
      filter["$text"] = { $search: input.query };
      cursor = this.memories!.find(filter as any, {
        projection: { score: { $meta: "textScore" } },
      })
        .sort({ score: { $meta: "textScore" }, confidence: -1 } as any)
        .limit(limit);
    } else {
      cursor = this.memories!.find(filter as any)
        .sort({ confidence: -1, lastAccessedAt: -1 })
        .limit(limit);
    }

    const results = await cursor.toArray();

    // Update access timestamps
    if (results.length > 0) {
      const ids = results.map((r) => r._id);
      await this.memories!.updateMany(
        { _id: { $in: ids } } as any,
        {
          $set: { lastAccessedAt: new Date() },
          $inc: { accessCount: 1 },
        },
      );
    }

    return results;
  }

  /** Delete a specific memory or memories matching a query. */
  async forget(
    context: MemoryContext,
    id?: string,
    query?: string,
    scope?: MemoryScope,
  ): Promise<number> {
    this.ensureConnected();

    if (id) {
      const result = await this.memories!.deleteOne({
        _id: id,
      } as any);
      return result.deletedCount;
    }

    if (query) {
      const filter: Record<string, unknown> = {
        $text: { $search: query },
      };
      if (scope) {
        filter["scope"] = scope;
        applyScopeKey(filter, scope, context);
      }
      const result = await this.memories!.deleteMany(filter as any);
      return result.deletedCount;
    }

    return 0;
  }

  /** List memories with optional filters. */
  async list(
    context: MemoryContext,
    scope?: MemoryScope,
    category?: MemoryCategory,
    limit?: number,
    includeSuperseded?: boolean,
  ): Promise<MemoryEntry[]> {
    this.ensureConnected();

    const filter: Record<string, unknown> = {};

    if (scope) {
      filter["scope"] = scope;
      applyScopeKey(filter, scope, context);
    } else {
      filter["$or"] = buildScopeFilter(context);
    }

    if (category) {
      filter["category"] = category;
    }

    if (!includeSuperseded) {
      filter["supersededBy"] = { $exists: false };
    }

    return this.memories!.find(filter as any)
      .sort({ scope: 1, category: 1, confidence: -1 })
      .limit(limit ?? 20)
      .toArray();
  }

  /** Load memories for a session (called on plugin connect). */
  async loadForSession(context: MemoryContext, maxEntries?: number): Promise<MemoryEntry[]> {
    this.ensureConnected();

    const limit = maxEntries ?? this.config.maxMemoriesPerSession;

    const filter: Record<string, unknown> = {
      supersededBy: { $exists: false },
      confidence: { $gt: 0.3 },
      $or: buildScopeFilter(context),
    };

    const results = await this.memories!.find(filter as any)
      .sort({ confidence: -1, lastAccessedAt: -1 })
      .limit(limit)
      .toArray();

    // Bulk update access timestamps
    if (results.length > 0) {
      const ids = results.map((r) => r._id);
      await this.memories!.updateMany(
        { _id: { $in: ids } } as any,
        {
          $set: { lastAccessedAt: new Date() },
          $inc: { accessCount: 1 },
        },
      );

      // Apply confidence boost (+0.02 per access, cap at 1.0)
      for (const entry of results) {
        const newConfidence = Math.min(1.0, entry.confidence + 0.02);
        if (newConfidence !== entry.confidence) {
          await this.memories!.updateOne(
            { _id: entry._id } as any,
            { $set: { confidence: newConfidence } },
          );
        }
      }
    }

    this.logger.debug("Loaded memories for session", {
      count: results.length,
      fileKey: context.fileKey,
    });

    return results;
  }

  /** Clean up stale, low-confidence, and superseded memories. */
  async cleanup(
    options?: CleanupOptions,
  ): Promise<CleanupResult> {
    this.ensureConnected();

    const dryRun = options?.dryRun ?? true;
    const maxAgeDays = options?.maxAgeDays ?? 30;
    const minConfidence = options?.minConfidence ?? 0.2;
    const removeSuperseded = options?.removeSuperseded ?? true;

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);

    // 1. Stale: old + never accessed
    const staleFilter = {
      createdAt: { $lt: cutoffDate },
      accessCount: 0,
    };
    const staleCount = await this.memories!.countDocuments(staleFilter as any);

    // 2. Low confidence
    const lowConfFilter = {
      confidence: { $lt: minConfidence },
      supersededBy: { $exists: false },
    };
    const lowConfidenceCount = await this.memories!.countDocuments(
      lowConfFilter as any,
    );

    // 3. Superseded
    let supersededCount = 0;
    if (removeSuperseded) {
      const supersededFilter = {
        supersededBy: { $exists: true },
      };
      supersededCount = await this.memories!.countDocuments(
        supersededFilter as any,
      );
    }

    // Execute deletions if not dry run
    let totalRemoved = 0;
    if (!dryRun) {
      const r1 = await this.memories!.deleteMany(staleFilter as any);
      const r2 = await this.memories!.deleteMany(lowConfFilter as any);
      totalRemoved = r1.deletedCount + r2.deletedCount;

      if (removeSuperseded) {
        const r3 = await this.memories!.deleteMany({
          supersededBy: { $exists: true },
        } as any);
        totalRemoved += r3.deletedCount;
      }

      this.logger.info("Memory cleanup completed", { totalRemoved });
    }

    return {
      staleCount,
      lowConfidenceCount,
      supersededCount,
      totalRemoved: dryRun ? 0 : totalRemoved,
      dryRun,
    };
  }

  /** Apply confidence decay to all memories (call periodically). */
  async applyDecay(): Promise<number> {
    this.ensureConnected();

    // Decay all memories by -0.01 per day since last update, floor at 0.1
    const result = await this.memories!.updateMany(
      {
        confidence: { $gt: 0.1 },
        supersededBy: { $exists: false },
      } as any,
      [
        {
          $set: {
            confidence: {
              $max: [
                0.1,
                {
                  $subtract: [
                    "$confidence",
                    {
                      $multiply: [
                        0.01,
                        {
                          $divide: [
                            { $subtract: [new Date(), "$lastAccessedAt"] },
                            86400000, // ms per day
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            updatedAt: new Date(),
          },
        },
      ],
    );

    return result.modifiedCount;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.memories) {
      throw new Error(
        "Memory store not connected. Set REX_MEMORY_ENABLED=true and ensure MongoDB is accessible.",
      );
    }
  }

  /** Find an existing memory with similar content in the same scope. */
  private async findSimilar(
    content: string,
    scope: MemoryScope,
    context: MemoryContext,
  ): Promise<MemoryEntry | null> {
    try {
      const filter: Record<string, unknown> = {
        scope,
        supersededBy: { $exists: false },
        $text: { $search: content },
      };
      applyScopeKey(filter, scope, context);

      const results = await this.memories!.find(filter as any, {
        projection: { score: { $meta: "textScore" } },
      })
        .sort({ score: { $meta: "textScore" } } as any)
        .limit(1)
        .toArray();

      // Only consider it similar if text score is high enough
      const result = results[0];
      if (result && (result as any).score > 2.0) {
        return result;
      }
    } catch {
      // Text search may fail on empty collection — safe to ignore
    }

    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an $or filter that includes all scopes visible to the given context. */
function buildScopeFilter(context: MemoryContext): Record<string, unknown>[] {
  const conditions: Record<string, unknown>[] = [
    { scope: "team" }, // Team memories always visible
  ];

  if (context.userId) {
    conditions.push({ scope: "user", userId: context.userId });
  }

  if (context.fileKey) {
    conditions.push({ scope: "file", fileKey: context.fileKey });

    if (context.pageId) {
      conditions.push({
        scope: "page",
        fileKey: context.fileKey,
        pageId: context.pageId,
      });
    }
  }

  return conditions;
}

/** Apply scope-specific key filters to a query. */
function applyScopeKey(
  filter: Record<string, unknown>,
  scope: MemoryScope,
  context: MemoryContext,
): void {
  switch (scope) {
    case "user":
      if (context.userId) filter["userId"] = context.userId;
      break;
    case "file":
      if (context.fileKey) filter["fileKey"] = context.fileKey;
      break;
    case "page":
      if (context.fileKey) filter["fileKey"] = context.fileKey;
      if (context.pageId) filter["pageId"] = context.pageId;
      break;
    // "team" needs no extra key — team scope is global
  }
}

/** Generate a short unique ID. */
function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "mem_";
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
