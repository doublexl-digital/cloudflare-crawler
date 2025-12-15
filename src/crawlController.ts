/*
 * Durable Object implementation for the Crawl Controller
 *
 * This object maintains crawl state (pending/visited URLs, per-domain rate limits,
 * run statistics) and provides an API for the Worker and crawler containers.
 */

import { normaliseUrl, getDomain, simpleHash } from './utils';

/** Represents a URL in the queue with metadata */
interface QueuedUrl {
  url: string;
  domain: string;
  depth: number;
  addedAt: number;
  priority: number;
}

/** Per-domain rate limit tracking */
interface DomainState {
  lastFetchTime: number;
  requestCount: number;
  errorCount: number;
  backoffUntil: number;
}

/** Run statistics */
interface RunStats {
  urlsQueued: number;
  urlsFetched: number;
  urlsFailed: number;
  bytesDownloaded: number;
  startedAt: number;
  lastActivityAt: number;
}

/** Request payload for work requests */
interface WorkRequest {
  runId: string;
  batchSize?: number;
  workerId?: string;
}

/** Result payload from crawlers */
interface CrawlResult {
  runId: string;
  url: string;
  status: number;
  contentHash?: string;
  contentSize?: number;
  discoveredUrls?: string[];
  error?: string;
  fetchedAt: number;
}

/** Configuration constants */
const DEFAULT_BATCH_SIZE = 10;
const MIN_DOMAIN_DELAY_MS = 1000; // Minimum 1 second between requests to same domain
const MAX_DOMAIN_DELAY_MS = 60000; // Maximum backoff of 60 seconds
const ERROR_BACKOFF_MULTIPLIER = 2;
const MAX_QUEUE_SIZE = 100000;
const MAX_DEPTH = 10;

export class CrawlController {
  state: DurableObjectState;
  env: any;

  // In-memory caches (hydrated from storage on first request)
  private pendingQueue: QueuedUrl[] = [];
  private visitedUrls: Set<string> = new Set();
  private domainStates: Map<string, DomainState> = new Map();
  private runStats: RunStats | null = null;
  private initialized = false;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  /** Initialize state from durable storage */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load persisted state
    const [queue, visited, domains, stats] = await Promise.all([
      this.state.storage.get<QueuedUrl[]>('pendingQueue'),
      this.state.storage.get<string[]>('visitedUrls'),
      this.state.storage.get<[string, DomainState][]>('domainStates'),
      this.state.storage.get<RunStats>('runStats'),
    ]);

    this.pendingQueue = queue || [];
    this.visitedUrls = new Set(visited || []);
    this.domainStates = new Map(domains || []);
    this.runStats = stats || {
      urlsQueued: 0,
      urlsFetched: 0,
      urlsFailed: 0,
      bytesDownloaded: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.initialized = true;
  }

  /** Persist current state to durable storage */
  private async persist(): Promise<void> {
    await this.state.storage.put({
      pendingQueue: this.pendingQueue,
      visitedUrls: Array.from(this.visitedUrls),
      domainStates: Array.from(this.domainStates.entries()),
      runStats: this.runStats,
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialize();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/internal/request-work' && request.method === 'POST') {
        return this.handleRequestWork(await request.json());
      }
      if (path === '/internal/report-result' && request.method === 'POST') {
        return this.handleReportResult(await request.json());
      }
      if (path === '/internal/on-cron' && request.method === 'POST') {
        return this.handleCron();
      }
      if (path === '/internal/seed' && request.method === 'POST') {
        return this.handleSeed(await request.json());
      }
      if (path === '/internal/stats' && request.method === 'GET') {
        return this.handleStats();
      }
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('CrawlController error:', error);
      return new Response('Internal error', { status: 500 });
    }
  }

  /**
   * Seed the crawler with initial URLs
   */
  async handleSeed(payload: { urls: string[]; depth?: number }): Promise<Response> {
    const { urls, depth = 0 } = payload;
    let added = 0;

    for (const rawUrl of urls) {
      const url = normaliseUrl(rawUrl);
      const domain = getDomain(url);
      if (!domain) continue;

      const urlHash = String(simpleHash(url));
      if (this.visitedUrls.has(urlHash)) continue;
      if (this.pendingQueue.length >= MAX_QUEUE_SIZE) break;

      this.pendingQueue.push({
        url,
        domain,
        depth,
        addedAt: Date.now(),
        priority: 0,
      });
      added++;
    }

    if (this.runStats) {
      this.runStats.urlsQueued += added;
      this.runStats.lastActivityAt = Date.now();
    }

    await this.persist();
    return Response.json({ added, queueSize: this.pendingQueue.length });
  }

  /**
   * Handle a container requesting work. Pops a batch of pending URLs
   * from the queue respecting per-domain rate limits.
   */
  async handleRequestWork(payload: WorkRequest): Promise<Response> {
    const batchSize = payload.batchSize || DEFAULT_BATCH_SIZE;
    const now = Date.now();
    const batch: string[] = [];
    const domainsInBatch = new Set<string>();

    // Sort queue by priority (higher first), then by addedAt (older first)
    this.pendingQueue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.addedAt - b.addedAt;
    });

    // Collect eligible URLs respecting rate limits
    const remainingQueue: QueuedUrl[] = [];

    for (const item of this.pendingQueue) {
      if (batch.length >= batchSize) {
        remainingQueue.push(item);
        continue;
      }

      // Check domain rate limit
      const domainState = this.domainStates.get(item.domain);
      if (domainState) {
        // Skip if in backoff period
        if (domainState.backoffUntil > now) {
          remainingQueue.push(item);
          continue;
        }
        // Skip if recently fetched
        if (now - domainState.lastFetchTime < MIN_DOMAIN_DELAY_MS) {
          remainingQueue.push(item);
          continue;
        }
      }

      // Only one URL per domain per batch to spread load
      if (domainsInBatch.has(item.domain)) {
        remainingQueue.push(item);
        continue;
      }

      // Add to batch
      batch.push(item.url);
      domainsInBatch.add(item.domain);

      // Mark as visited (optimistically)
      const urlHash = String(simpleHash(item.url));
      this.visitedUrls.add(urlHash);

      // Update domain state
      if (!this.domainStates.has(item.domain)) {
        this.domainStates.set(item.domain, {
          lastFetchTime: now,
          requestCount: 0,
          errorCount: 0,
          backoffUntil: 0,
        });
      }
      const state = this.domainStates.get(item.domain)!;
      state.lastFetchTime = now;
      state.requestCount++;
    }

    this.pendingQueue = remainingQueue;

    if (this.runStats) {
      this.runStats.lastActivityAt = now;
    }

    await this.persist();
    return Response.json({ urls: batch, queueSize: this.pendingQueue.length });
  }

  /**
   * Handle a container reporting a result. Updates visit status,
   * persists content to R2/D1 and enqueues discovered links.
   */
  async handleReportResult(payload: CrawlResult): Promise<Response> {
    const { url, status, discoveredUrls, error, contentSize, contentHash } = payload;
    const domain = getDomain(url);
    const now = Date.now();

    if (domain) {
      const domainState = this.domainStates.get(domain);
      if (domainState) {
        if (error || (status && status >= 400)) {
          // Increase backoff on errors
          domainState.errorCount++;
          const backoffTime = Math.min(
            MIN_DOMAIN_DELAY_MS * Math.pow(ERROR_BACKOFF_MULTIPLIER, domainState.errorCount),
            MAX_DOMAIN_DELAY_MS
          );
          domainState.backoffUntil = now + backoffTime;

          if (this.runStats) {
            this.runStats.urlsFailed++;
          }
        } else {
          // Reset error count on success
          domainState.errorCount = 0;
          domainState.backoffUntil = 0;

          if (this.runStats) {
            this.runStats.urlsFetched++;
            if (contentSize) {
              this.runStats.bytesDownloaded += contentSize;
            }
          }
        }
      }
    }

    // Enqueue discovered URLs
    if (discoveredUrls && discoveredUrls.length > 0) {
      const parentDepth = 0; // TODO: track depth properly
      let added = 0;

      for (const rawUrl of discoveredUrls) {
        if (this.pendingQueue.length >= MAX_QUEUE_SIZE) break;

        const newUrl = normaliseUrl(rawUrl);
        const newDomain = getDomain(newUrl);
        if (!newDomain) continue;

        const urlHash = String(simpleHash(newUrl));
        if (this.visitedUrls.has(urlHash)) continue;

        // Check if already in queue
        const alreadyQueued = this.pendingQueue.some(q => q.url === newUrl);
        if (alreadyQueued) continue;

        const newDepth = parentDepth + 1;
        if (newDepth > MAX_DEPTH) continue;

        this.pendingQueue.push({
          url: newUrl,
          domain: newDomain,
          depth: newDepth,
          addedAt: now,
          priority: -newDepth, // Lower priority for deeper pages
        });
        added++;
      }

      if (this.runStats) {
        this.runStats.urlsQueued += added;
      }
    }

    if (this.runStats) {
      this.runStats.lastActivityAt = now;
    }

    await this.persist();

    // Store metadata in D1 if available
    try {
      if (this.env.CRAWL_DB) {
        await this.env.CRAWL_DB.prepare(
          `INSERT OR REPLACE INTO pages (url, domain, status, content_hash, content_size, fetched_at, error)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(url, domain, status, contentHash || null, contentSize || 0, now, error || null)
          .run();
      }
    } catch (e) {
      console.error('D1 insert error:', e);
    }

    return Response.json({ ok: true });
  }

  /**
   * Handle cron triggers. Perform maintenance tasks.
   */
  async handleCron(): Promise<Response> {
    const now = Date.now();

    // Clear old backoffs
    for (const [domain, state] of this.domainStates) {
      if (state.backoffUntil > 0 && state.backoffUntil < now) {
        state.backoffUntil = 0;
      }
    }

    // Prune domains with no recent activity (older than 1 hour)
    const pruneThreshold = now - 3600000;
    for (const [domain, state] of this.domainStates) {
      if (state.lastFetchTime < pruneThreshold && state.requestCount === 0) {
        this.domainStates.delete(domain);
      }
    }

    if (this.runStats) {
      this.runStats.lastActivityAt = now;
    }

    await this.persist();
    return Response.json({ ok: true, queueSize: this.pendingQueue.length });
  }

  /**
   * Return current run statistics
   */
  async handleStats(): Promise<Response> {
    return Response.json({
      stats: this.runStats,
      queueSize: this.pendingQueue.length,
      visitedCount: this.visitedUrls.size,
      domainsTracked: this.domainStates.size,
    });
  }
}

// Export for Durable Object binding
export { CrawlController as default };
