// ─── Memory Store ────────────────────────────────────────────────────────────
// MongoDB-backed persistent memory for Rex.

import { MongoClient } from 'mongodb';

export class Store {
  constructor(uri, dbName) {
    this.uri = uri;
    this.dbName = dbName;
    this.client = null;
    this.db = null;
    this.memories = null;
  }

  async connect() {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.memories = this.db.collection('memories');

    // Indexes
    await this.memories.createIndex({ scope: 1, confidence: -1 }, { background: true });
    await this.memories.createIndex({ fileKey: 1, scope: 1, confidence: -1 }, { background: true });
    await this.memories.createIndex({ userId: 1, scope: 1 }, { background: true });
    await this.memories.createIndex({ tags: 1 }, { background: true });
    await this.memories.createIndex({ createdAt: 1 }, { background: true });
    await this.memories.createIndex({ supersededBy: 1 }, { background: true, sparse: true });
    await this.memories.createIndex({ componentKey: 1 }, { background: true, sparse: true });

    // Text index for content search
    try {
      await this.memories.createIndex({ content: 'text', tags: 'text' }, { background: true, name: 'content_text' });
    } catch {
      // May already exist
    }

    console.log('MongoDB connected:', this.dbName);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // ─── Create ─────────────────────────────────────────────────────────────────

  async remember(input) {
    const now = new Date();
    const { scope, category, content, tags, source, context } = input;

    // Check for similar existing memory to supersede
    const existing = await this.findSimilar(content, scope, context);

    if (existing) {
      await this.memories.updateOne(
        { _id: existing._id },
        { $set: { supersededBy: 'pending', confidence: 0, updatedAt: now } }
      );
    }

    const confidenceMap = { corrected: 1.0, inferred: 0.6, explicit: 0.9 };

    const resolvedScope = scope || 'file';
    const entry = {
      _id: generateId(),
      scope: resolvedScope,
      category: category || 'convention',
      content,
      tags: tags || [],
      source: source || 'explicit',
      createdBy: { id: context.userId || 'unknown', name: context.userName || 'Unknown' },
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      confidence: confidenceMap[source || 'explicit'] || 0.9,
      accessCount: 0,
    };

    // Scope keys — only include when relevant
    if (resolvedScope === 'user' && context.userId) entry.userId = context.userId;
    if ((resolvedScope === 'file' || resolvedScope === 'page') && context.fileKey) {
      entry.fileKey = context.fileKey;
      if (context.fileName) entry.fileName = context.fileName;
    }
    if (context.componentKey) entry.componentKey = context.componentKey;
    if (existing) entry.relatedTo = [existing._id];

    await this.memories.insertOne(entry);

    if (existing) {
      await this.memories.updateOne(
        { _id: existing._id },
        { $set: { supersededBy: entry._id } }
      );
    }

    return entry;
  }

  // ─── Recall (text search) ───────────────────────────────────────────────────

  async recall(input) {
    const { query, scope, category, context, limit, includeSuperseded } = input;

    const filter = { confidence: { $gt: 0.1 } };

    if (scope) {
      filter.scope = scope;
      applyScopeKey(filter, scope, context);
    } else {
      filter.$or = buildScopeFilter(context);
    }

    if (category) filter.category = category;
    if (!includeSuperseded) filter.supersededBy = { $exists: false };

    const max = limit || 10;
    let cursor;

    if (query) {
      filter.$text = { $search: query };
      cursor = this.memories
        .find(filter, { projection: { score: { $meta: 'textScore' } } })
        .sort({ score: { $meta: 'textScore' }, confidence: -1 })
        .limit(max);
    } else {
      cursor = this.memories
        .find(filter)
        .sort({ confidence: -1, lastAccessedAt: -1 })
        .limit(max);
    }

    const results = await cursor.toArray();

    // Update access timestamps
    if (results.length > 0) {
      const ids = results.map(r => r._id);
      await this.memories.updateMany(
        { _id: { $in: ids } },
        { $set: { lastAccessedAt: new Date() }, $inc: { accessCount: 1 } }
      );
    }

    return results;
  }

  // ─── List ───────────────────────────────────────────────────────────────────

  async list(input) {
    const { scope, category, context, limit, includeSuperseded } = input;

    const filter = {};

    if (scope) {
      filter.scope = scope;
      if (context) applyScopeKey(filter, scope, context);
    } else if (context && (context.userId || context.fileKey)) {
      // Only apply scope filter when context has keys to filter by
      filter.$or = buildScopeFilter(context);
    }
    // If no context keys, return all scopes (dashboard/admin use case)

    if (category) filter.category = category;
    if (!includeSuperseded) filter.supersededBy = { $exists: false };

    return this.memories
      .find(filter)
      .sort({ scope: 1, category: 1, confidence: -1 })
      .limit(limit || 20)
      .toArray();
  }

  // ─── Load for Session ───────────────────────────────────────────────────────

  async loadForSession(context, maxEntries) {
    const limit = maxEntries || 30;

    const filter = {
      supersededBy: { $exists: false },
      confidence: { $gt: 0.3 },
      $or: buildScopeFilter(context),
    };

    const results = await this.memories
      .find(filter)
      .sort({ confidence: -1, lastAccessedAt: -1 })
      .limit(limit)
      .toArray();

    if (results.length > 0) {
      const ids = results.map(r => r._id);
      await this.memories.updateMany(
        { _id: { $in: ids } },
        { $set: { lastAccessedAt: new Date() }, $inc: { accessCount: 1 } }
      );

      // Confidence boost
      for (const entry of results) {
        const newConf = Math.min(1.0, entry.confidence + 0.02);
        if (newConf !== entry.confidence) {
          await this.memories.updateOne(
            { _id: entry._id },
            { $set: { confidence: newConf } }
          );
        }
      }
    }

    return results;
  }

  // ─── Get / Update / Delete ──────────────────────────────────────────────────

  async getById(id) {
    return this.memories.findOne({ _id: id });
  }

  async update(id, updates) {
    const allowed = ['content', 'tags', 'category', 'confidence', 'scope'];
    const $set = { updatedAt: new Date() };
    for (const key of allowed) {
      if (updates[key] !== undefined) $set[key] = updates[key];
    }
    await this.memories.updateOne({ _id: id }, { $set });
    return this.memories.findOne({ _id: id });
  }

  async deleteById(id) {
    const result = await this.memories.deleteOne({ _id: id });
    return result.deletedCount;
  }

  // ─── Forget (query-based delete) ────────────────────────────────────────────

  async forget(input) {
    const { id, query, scope, context } = input;

    if (id) {
      const result = await this.memories.deleteOne({ _id: id });
      return result.deletedCount;
    }

    if (query) {
      const filter = { $text: { $search: query } };
      if (scope) {
        filter.scope = scope;
        applyScopeKey(filter, scope, context);
      }
      const result = await this.memories.deleteMany(filter);
      return result.deletedCount;
    }

    return 0;
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  async cleanup(options) {
    const { dryRun, maxAgeDays, minConfidence, removeSuperseded } = options;
    const cutoff = new Date(Date.now() - (maxAgeDays || 30) * 86400000);
    const minConf = minConfidence ?? 0.2;

    const staleFilter = { createdAt: { $lt: cutoff }, accessCount: 0 };
    const lowConfFilter = { confidence: { $lt: minConf }, supersededBy: { $exists: false } };
    const supersededFilter = { supersededBy: { $exists: true } };

    const staleCount = await this.memories.countDocuments(staleFilter);
    const lowConfidenceCount = await this.memories.countDocuments(lowConfFilter);
    const supersededCount = removeSuperseded !== false
      ? await this.memories.countDocuments(supersededFilter) : 0;

    let totalRemoved = 0;
    if (!dryRun) {
      const r1 = await this.memories.deleteMany(staleFilter);
      const r2 = await this.memories.deleteMany(lowConfFilter);
      totalRemoved = r1.deletedCount + r2.deletedCount;
      if (removeSuperseded !== false) {
        const r3 = await this.memories.deleteMany(supersededFilter);
        totalRemoved += r3.deletedCount;
      }
    }

    return { staleCount, lowConfidenceCount, supersededCount, totalRemoved, dryRun: !!dryRun };
  }

  // ─── Decay ──────────────────────────────────────────────────────────────────

  async applyDecay() {
    const result = await this.memories.updateMany(
      { confidence: { $gt: 0.1 }, supersededBy: { $exists: false } },
      [{
        $set: {
          confidence: {
            $max: [0.1, {
              $subtract: ['$confidence', {
                $multiply: [0.01, { $divide: [{ $subtract: [new Date(), '$lastAccessedAt'] }, 86400000] }]
              }]
            }]
          },
          updatedAt: new Date(),
        }
      }]
    );
    return result.modifiedCount;
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  async stats() {
    const pipeline = [
      { $match: { supersededBy: { $exists: false } } },
      {
        $group: {
          _id: { scope: '$scope', category: '$category' },
          count: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
        }
      }
    ];

    const groups = await this.memories.aggregate(pipeline).toArray();

    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const byScope = {};
    const byCategory = {};

    for (const g of groups) {
      const { scope, category } = g._id;
      byScope[scope] = (byScope[scope] || 0) + g.count;
      byCategory[category] = (byCategory[category] || 0) + g.count;
    }

    const avgConfidence = total > 0
      ? groups.reduce((sum, g) => sum + g.avgConfidence * g.count, 0) / total
      : 0;

    return { total, byScope, byCategory, avgConfidence: Math.round(avgConfidence * 100) / 100 };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  async findSimilar(content, scope, context) {
    try {
      const filter = {
        scope,
        supersededBy: { $exists: false },
        $text: { $search: content },
      };
      applyScopeKey(filter, scope, context);

      const results = await this.memories
        .find(filter, { projection: { score: { $meta: 'textScore' } } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(1)
        .toArray();

      if (results[0] && results[0].score > 2.0) return results[0];
    } catch {
      // Text search may fail on empty collection
    }
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildScopeFilter(context) {
  const conditions = [{ scope: 'team' }];
  if (context.userId) conditions.push({ scope: 'user', userId: context.userId });
  if (context.fileKey) {
    conditions.push({ scope: 'file', fileKey: context.fileKey });
    if (context.pageId) {
      conditions.push({ scope: 'page', fileKey: context.fileKey, pageId: context.pageId });
    }
  }
  return conditions;
}

function applyScopeKey(filter, scope, context) {
  if (scope === 'user' && context.userId) filter.userId = context.userId;
  if (scope === 'file' && context.fileKey) filter.fileKey = context.fileKey;
  if (scope === 'page') {
    if (context.fileKey) filter.fileKey = context.fileKey;
    if (context.pageId) filter.pageId = context.pageId;
  }
}

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'mem_';
  for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
