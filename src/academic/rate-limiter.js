/**
 * SourceRateLimiter: Per-source and per-domain rate limiting, concurrency semaphores,
 * and circuit breaking to prevent upstream rate limits (429) and protect external services.
 */

export class CircuitBreakerOpenError extends Error {
  constructor(sourceId, cooldownMs) {
    super(`Circuit breaker open for source "${sourceId}" (${cooldownMs}ms cooldown)`);
    this.name = "CircuitBreakerOpenError";
    this.sourceId = sourceId;
    this.cooldownMs = cooldownMs;
  }
}

const DEFAULT_SOURCE_PROFILES = {
  // PubMed: strictly rate-limited by NCBI (3 req/s without key, 10 req/s with key)
  pubmed: { concurrency: 3, minIntervalMs: 200 },
  pmc: { concurrency: 3, minIntervalMs: 200 },

  // Semantic Scholar: strict 429 penalties
  semantic_scholar: { concurrency: 2, minIntervalMs: 500 },

  // OpenAlex: polite pool ~10 req/s
  openalex: { concurrency: 6, minIntervalMs: 125 },

  // CrossRef: polite pool
  crossref: { concurrency: 8, minIntervalMs: 100 },

  // ArXiv: asks for reasonable politeness
  arxiv: { concurrency: 3, minIntervalMs: 350 },

  // Europe PMC
  europe_pmc: { concurrency: 5, minIntervalMs: 200 },

  // dblp throttles hard and reports it as an HTML page, not a 429 status.
  dblp: { concurrency: 2, minIntervalMs: 700 },

  // Preprints & clinical
  biorxiv: { concurrency: 3, minIntervalMs: 300 },
  medrxiv: { concurrency: 3, minIntervalMs: 300 },

  // api.biorxiv.org serves BOTH the biorxiv and medrxiv collections, and has no
  // search endpoint — callers page through a date window. Those page requests
  // get their own bucket for two reasons: one host deserves one budget however
  // many collections are being read, and scheduling them on the `biorxiv` /
  // `medrxiv` buckets would nest a request inside the slot the enclosing
  // search() call already holds, which deadlocks once every slot is taken.
  biorxiv_api: { concurrency: 2, minIntervalMs: 600 },
  clinicaltrials: { concurrency: 3, minIntervalMs: 300 },

  // Entity & Molecular Databases
  dailymed: { concurrency: 2, minIntervalMs: 300 },
  reactome: { concurrency: 2, minIntervalMs: 300 },
  chembl: { concurrency: 3, minIntervalMs: 250 },
  bindingdb: { concurrency: 2, minIntervalMs: 400 },
  zinc: { concurrency: 1, minIntervalMs: 800 },
  pubchem: { concurrency: 2, minIntervalMs: 350 },
  uniprot: { concurrency: 3, minIntervalMs: 250 },
  rcsb_pdb: { concurrency: 2, minIntervalMs: 350 },
  openfda: { concurrency: 3, minIntervalMs: 250 },

  // Vietnamese University / OJS Portals (protect university web servers from DDOS/overload)
  vjol: { concurrency: 2, minIntervalMs: 500 },
  vast: { concurrency: 2, minIntervalMs: 500 },
  jst_hust: { concurrency: 2, minIntervalMs: 500 },
  tapchi_yhoc_tphcm: { concurrency: 2, minIntervalMs: 500 },
  tapchi_nghiencuuyhoc: { concurrency: 2, minIntervalMs: 500 },
  vista_nasati: { concurrency: 2, minIntervalMs: 500 },
  vnu_js: { concurrency: 2, minIntervalMs: 500 },
  vnulib: { concurrency: 2, minIntervalMs: 500 },
  medpharmres: { concurrency: 2, minIntervalMs: 500 },

  // Regional portals
  thaijo: { concurrency: 2, minIntervalMs: 500 },
  philjol: { concurrency: 2, minIntervalMs: 500 },
  banglajol: { concurrency: 2, minIntervalMs: 500 },
  nepjol: { concurrency: 2, minIntervalMs: 500 },
  ajol: { concurrency: 2, minIntervalMs: 500 },

  // Default fallback for any unspecified source
  default: { concurrency: 4, minIntervalMs: 250 },
};

class SourceBucket {
  constructor(id, profile = {}) {
    this.id = id;
    this.concurrency = profile.concurrency || 4;
    this.minIntervalMs = profile.minIntervalMs || 250;
    this.active = 0;
    this.queue = [];
    this.lastExecTime = 0;

    // Circuit Breaker state
    this.circuitState = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.consecutiveFailures = 0;
    this.failureThreshold = 3;
    this.cooldownMs = 30000; // 30s cooldown when tripped
    this.cooldownTimer = null;
    this.lastFailureTime = 0;
    this.halfOpenProbeAt = 0; // when the current HALF_OPEN probe was let through

    // Metrics
    this.metrics = {
      totalExecuted: 0,
      totalThrottled: 0,
      totalErrors: 0,
      total429s: 0,
      totalAborts: 0,
      circuitTrips: 0,
    };
  }

  isCircuitOpen() {
    if (this.circuitState === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        // Cooldown passed -> HALF_OPEN, and THIS caller is the single probe.
        this.circuitState = "HALF_OPEN";
        this.halfOpenProbeAt = Date.now();
        return false;
      }
      return true;
    }

    // HALF_OPEN is supposed to test exactly one request, but nothing used to
    // enforce that: every queued caller sailed through and hammered a source
    // that had just been failing. Hold everyone else back until the probe has
    // reported. The timestamp (rather than a boolean) self-heals if the probe
    // is aborted before it ever executes and so never reports at all.
    if (this.circuitState === "HALF_OPEN") {
      if (this.halfOpenProbeAt && Date.now() - this.halfOpenProbeAt < this.cooldownMs) {
        return true;
      }
      this.halfOpenProbeAt = Date.now();
      return false;
    }

    return false;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.halfOpenProbeAt = 0;
    if (this.circuitState === "HALF_OPEN") {
      this.circuitState = "CLOSED";
      console.info(`[RateLimiter] Source "${this.id}" circuit recovered -> CLOSED`);
    }
  }

  recordFailure(error) {
    // A request *we* aborted — the orchestrator's per-source timeout, or a
    // caller that gave up — says nothing about whether the upstream is healthy.
    // Counting those tripped the breaker after three merely-slow responses and
    // blacked the source out for 30s, which is how the slower OJS portals ended
    // up contributing nothing to consecutive searches.
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      this.metrics.totalAborts++;
      this.halfOpenProbeAt = 0;
      return;
    }

    this.metrics.totalErrors++;
    this.halfOpenProbeAt = 0;
    const is429 = error?.status === 429 || error?.statusCode === 429 || /429|too many requests/i.test(error?.message || "");
    if (is429) {
      this.metrics.total429s++;
      this.consecutiveFailures += 2; // rate limits penalize faster
    } else {
      this.consecutiveFailures += 1;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitState = "OPEN";
      this.lastFailureTime = Date.now();
      this.metrics.circuitTrips++;
      console.warn(`[RateLimiter] Source "${this.id}" circuit tripped -> OPEN for ${this.cooldownMs}ms (failures: ${this.consecutiveFailures})`);
    }
  }

  drainNext() {
    if (this.active >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const timeSinceLast = now - this.lastExecTime;
    const waitMs = Math.max(0, this.minIntervalMs - timeSinceLast);

    if (waitMs > 0) {
      setTimeout(() => this.drainNext(), waitMs);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    if (item.signal?.aborted) {
      item.reject(new DOMException("Aborted before execution", "AbortError"));
      this.drainNext();
      return;
    }

    this.active++;
    this.lastExecTime = Date.now();

    Promise.resolve()
      .then(() => item.fn())
      .then((res) => {
        this.recordSuccess();
        this.metrics.totalExecuted++;
        item.resolve(res);
      })
      .catch((err) => {
        this.recordFailure(err);
        item.reject(err);
      })
      .finally(() => {
        this.active--;
        this.drainNext();
      });
  }

  enqueue(fn, signal) {
    if (this.isCircuitOpen()) {
      return Promise.reject(new CircuitBreakerOpenError(this.id, this.cooldownMs));
    }

    return new Promise((resolve, reject) => {
      const item = { fn, resolve, reject, signal };

      if (signal) {
        const onAbort = () => {
          const idx = this.queue.indexOf(item);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new DOMException("Aborted while queued", "AbortError"));
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      if (this.active >= this.concurrency) {
        this.metrics.totalThrottled++;
      }

      this.queue.push(item);
      this.drainNext();
    });
  }
}

export class SourceRateLimiter {
  constructor(customProfiles = {}) {
    this.profiles = { ...DEFAULT_SOURCE_PROFILES, ...customProfiles };
    this.buckets = new Map();
  }

  getBucket(sourceId) {
    let bucket = this.buckets.get(sourceId);
    if (!bucket) {
      const profile = this.profiles[sourceId] || this.profiles.default;
      bucket = new SourceBucket(sourceId, profile);
      this.buckets.set(sourceId, bucket);
    }
    return bucket;
  }

  /**
   * Schedule an async function through the source's rate limiter bucket.
   * @param {string} sourceId
   * @param {Function} fn
   * @param {AbortSignal} [signal]
   * @returns {Promise<any>}
   */
  async schedule(sourceId, fn, signal) {
    const bucket = this.getBucket(sourceId);
    return bucket.enqueue(fn, signal);
  }

  /**
   * Get current concurrency status and metrics across all sources.
   */
  getStats() {
    const stats = {};
    for (const [id, bucket] of this.buckets.entries()) {
      stats[id] = {
        active: bucket.active,
        queued: bucket.queue.length,
        concurrencyLimit: bucket.concurrency,
        circuitState: bucket.circuitState,
        metrics: { ...bucket.metrics },
      };
    }
    return stats;
  }
}

export const sourceRateLimiter = new SourceRateLimiter();
