// ─── Idempotency Cache ──────────────────────────────────────────────────────
// LRU cache for command results, keyed by idempotency key.
// Max 500 entries, 5-minute TTL.

interface CacheEntry {
  result: unknown;
  timestamp: number;
}

const MAX_ENTRIES = 500;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export class IdempotencyCache {
  private cache: Map<string, CacheEntry> = new Map();

  /** Check if a key exists and is not expired. */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /** Get cached result for a key. Returns undefined if not found or expired. */
  get(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  /** Store a result with the given key. Evicts oldest entry if at capacity. */
  set(key: string, result: unknown): void {
    // Remove if exists (to refresh position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }
}
