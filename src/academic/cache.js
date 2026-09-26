/**
 * High-Concurrency Multi-Tier Academic Cache with SingleFlight Request Coalescing.
 * - L1: In-Memory LRU Cache with TTL (5,000 entries max)
 * - SingleFlight: In-flight request deduplication prevents duplicate upstream queries
 * - Detailed hit/miss/coalesce metrics
 */

class AcademicCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxEntries=5000] Maximum entries in cache
   * @param {number} [options.defaultTtlMs=3600000] Default TTL in milliseconds (1 hour)
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 5000;
    this.defaultTtlMs = options.defaultTtlMs || 3600 * 1000;
    this.cache = new Map();
    this.inFlight = new Map();

    // Telemetry
    this.metrics = {
      hits: 0,
      misses: 0,
      coalesced: 0,
      evictions: 0,
      sets: 0,
    };
  }

  /**
   * Normalize an arbitrary object or value for deterministic cache keys.
   */
  normalizeVal(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === "string") return val.trim().toLowerCase();
    if (Array.isArray(val)) {
      return [...new Set(val.map(v => typeof v === "string" ? v.trim().toLowerCase() : v))].sort();
    }
    if (typeof val === "object") {
      const sorted = {};
      for (const k of Object.keys(val).sort()) {
        const n = this.normalizeVal(val[k]);
        if (n !== null && n !== undefined && n !== "") {
          sorted[k] = n;
        }
      }
      return sorted;
    }
    return val;
  }

  /**
   * Generate normalized cache key from tool name and arguments.
   * @param {string} prefix
   * @param {Object} params
   * @returns {string}
   */
  makeKey(prefix, params) {
    const normalized = this.normalizeVal(params || {});
    return `${prefix}:${JSON.stringify(normalized)}`;
  }

  /**
   * Get an item from cache. Returns null if expired or missing.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU order (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  /**
   * Set an item in cache with optional custom TTL.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs]
   */
  set(key, value, ttlMs) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first in Map iteration)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.metrics.evictions++;
      }
    }

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
    this.metrics.sets++;
  }

  /**
   * SingleFlight: Execute an async function, coalescing multiple concurrent
   * callers for the same key into a single in-flight Promise.
   * @param {string} key
   * @param {Function} fn
   * @returns {Promise<any>}
   */
  async singleFlight(key, fn) {
    if (this.inFlight.has(key)) {
      this.metrics.coalesced++;
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Cache-Aside with SingleFlight:
   * 1. If key in cache -> return cached immediately (0ms).
   * 2. If already in flight -> await existing promise (no duplicate work).
   * 3. Else execute fn(), save result to cache, return.
   * @param {string} key
   * @param {number} ttlMs
   * @param {Function} fn
   * @returns {Promise<{ data: any, fromCache: boolean, coalesced: boolean }>}
   */
  async cachedOrExecute(key, ttlMs, fn) {
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) {
      this.metrics.hits++;
      return { data: cached, fromCache: true, coalesced: false };
    }

    this.metrics.misses++;
    const wasInFlight = this.inFlight.has(key);
    const data = await this.singleFlight(key, fn);

    // Save to cache on successful completion
    if (data && (!Array.isArray(data) || data.length > 0)) {
      this.set(key, data, ttlMs);
    }

    return { data, fromCache: false, coalesced: wasInFlight };
  }

  /**
   * Clear all cache entries.
   */
  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * Cache statistics.
   */
  stats() {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      inFlightCount: this.inFlight.size,
      ...this.metrics,
      hitRatio: (this.metrics.hits + this.metrics.misses > 0)
        ? (this.metrics.hits / (this.metrics.hits + this.metrics.misses)).toFixed(4)
        : "0.0000",
    };
  }
}

export const academicCache = new AcademicCache({ maxEntries: 5000, defaultTtlMs: 2 * 3600 * 1000 });

export const TTL = {
  SEARCH: 3600 * 1000, // 1 hour
  PAPER: 24 * 3600 * 1000, // 24 hours
  CITE: 12 * 3600 * 1000, // 12 hours
  SIMILAR: 12 * 3600 * 1000, // 12 hours — S2 recommendations move slowly
  EVIDENCE: 24 * 3600 * 1000,
};

/**
 * Build a cache key. `params` MUST be a single object holding every argument
 * that changes the result.
 *
 * Callers used to pass the arguments positionally (`cacheKey("x", a, b, c)`),
 * which silently dropped everything past `params` and made unrelated requests
 * share one entry — a search for PubMed came back with the arXiv result. Extra
 * positional arguments are now a hard error so that never goes unnoticed again.
 */
export function cacheKey(prefix, params, ...extra) {
  if (extra.length > 0) {
    throw new TypeError(
      `cacheKey("${prefix}", ...): pass ONE object of cache-relevant arguments, ` +
      `not ${extra.length + 2} positional ones. Everything past the object is ignored.`
    );
  }
  return academicCache.makeKey(prefix, params);
}

export function cacheGet(key) {
  return academicCache.get(key);
}

export function cacheSet(key, value, ttlMs) {
  return academicCache.set(key, value, ttlMs);
}

export async function singleFlight(key, fn) {
  return academicCache.singleFlight(key, fn);
}

export async function cachedOrExecute(key, ttlMs, fn) {
  return academicCache.cachedOrExecute(key, ttlMs, fn);
}

export function cacheStats() {
  return academicCache.stats();
}
