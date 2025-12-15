/*
 * Durable Object implementation for the Crawl Controller
 *
 * This object maintains crawl state (pending/visited URLs, per-domain rate limits,
 * run statistics) and provides an API for the Worker and crawler containers.
 *
 * Enhanced to support dynamic configuration from the API.
 */

import { normaliseUrl, getDomain, simpleHash } from './utils';
import type {
  CrawlConfig,
  RateLimitConfig,
  CrawlBehaviorConfig,
  DomainScopeConfig,
  RunStats,
  RunProgress,
  CrawlError,
  WorkItem,
  WorkerConfig,
  ResultReport,
  DEFAULT_CONFIG,
} from './types';

// ============================================================================
// Internal Types
// ============================================================================

/** Represents a URL in the queue with metadata */
interface QueuedUrl {
  url: string;
  domain: string;
  depth: number;
  addedAt: number;
  priority: number;
  retryCount: number;
}

/** Per-domain rate limit tracking */
interface DomainState {
  lastFetchTime: number;
  requestCount: number;
  errorCount: number;
  successCount: number;
  backoffUntil: number;
  totalResponseTimeMs: number;
  bytesDownloaded: number;
}

/** Run state stored in DO */
interface RunState {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  config: CrawlConfig | null;
  stats: RunStats;
  progress: RunProgress;
  error?: string;
  startedAt?: number;
  pausedAt?: number;
  completedAt?: number;
}

/** Request payload for work requests */
interface WorkRequest {
  runId: string;
  batchSize?: number;
  workerId?: string;
}

/** Internal request payload for configuration updates */
interface ConfigUpdateRequest {
  config: CrawlConfig;
}

// ============================================================================
// Default Configuration (used when no config is provided)
// ============================================================================

const DEFAULT_RATE_LIMITING: RateLimitConfig = {
  minDomainDelayMs: 1000,
  maxDomainDelayMs: 60000,
  errorBackoffMultiplier: 2,
  jitterFactor: 0.1,
  maxConcurrentRequests: 16,
  globalRateLimitPerMinute: 0,
};

const DEFAULT_CRAWL_BEHAVIOR: CrawlBehaviorConfig = {
  maxDepth: 10,
  maxQueueSize: 100000,
  maxPagesPerRun: 0,
  defaultBatchSize: 10,
  requestTimeoutMs: 30000,
  retryCount: 3,
  respectRobotsTxt: true,
  followRedirects: true,
  maxRedirects: 5,
  userAgent: 'CloudflareCrawler/1.0 (+https://github.com/cloudflare-crawler)',
  customHeaders: {},
  followLinks: true,
  sameDomainOnly: true,
};

const DEFAULT_DOMAIN_SCOPE: DomainScopeConfig = {
  allowedDomains: [],
  blockedDomains: [],
  includePatterns: [],
  excludePatterns: [],
  includeSubdomains: true,
};

// ============================================================================
// CrawlController Durable Object
// ============================================================================

export class CrawlController {
  state: DurableObjectState;
  env: any;

  // In-memory caches (hydrated from storage on first request)
  private pendingQueue: QueuedUrl[] = [];
  private visitedUrls: Set<string> = new Set();
  private domainStates: Map<string, DomainState> = new Map();
  private runState: RunState | null = null;
  private recentErrors: CrawlError[] = [];
  private initialized = false;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  // --------------------------------------------------------------------------
  // Configuration Getters (with defaults)
  // --------------------------------------------------------------------------

  private get rateLimiting(): RateLimitConfig {
    return this.runState?.config?.rateLimiting || DEFAULT_RATE_LIMITING;
  }

  private get crawlBehavior(): CrawlBehaviorConfig {
    return this.runState?.config?.crawlBehavior || DEFAULT_CRAWL_BEHAVIOR;
  }

  private get domainScope(): DomainScopeConfig {
    return this.runState?.config?.domainScope || DEFAULT_DOMAIN_SCOPE;
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  /** Initialize state from durable storage */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load persisted state
    const [queue, visited, domains, runState, errors] = await Promise.all([
      this.state.storage.get<QueuedUrl[]>('pendingQueue'),
      this.state.storage.get<string[]>('visitedUrls'),
      this.state.storage.get<[string, DomainState][]>('domainStates'),
      this.state.storage.get<RunState>('runState'),
      this.state.storage.get<CrawlError[]>('recentErrors'),
    ]);

    this.pendingQueue = queue || [];
    this.visitedUrls = new Set(visited || []);
    this.domainStates = new Map(domains || []);
    this.recentErrors = errors || [];
    this.runState = runState || this.createDefaultRunState();

    this.initialized = true;
  }

  private createDefaultRunState(): RunState {
    return {
      id: 'default',
      status: 'pending',
      config: null,
      stats: {
        urlsQueued: 0,
        urlsFetched: 0,
        urlsFailed: 0,
        bytesDownloaded: 0,
        domainsDiscovered: 0,
        queueSize: 0,
        visitedCount: 0,
        avgResponseTimeMs: 0,
        pagesPerMinute: 0,
        lastActivityAt: Date.now(),
      },
      progress: {
        percentage: 0,
        estimatedSecondsRemaining: -1,
        currentDepth: 0,
        activeDomains: [],
        recentErrors: [],
      },
    };
  }

  /** Persist current state to durable storage */
  private async persist(): Promise<void> {
    await this.state.storage.put({
      pendingQueue: this.pendingQueue,
      visitedUrls: Array.from(this.visitedUrls),
      domainStates: Array.from(this.domainStates.entries()),
      runState: this.runState,
      recentErrors: this.recentErrors.slice(-50), // Keep last 50 errors
    });
  }

  // --------------------------------------------------------------------------
  // Request Handler
  // --------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    await this.initialize();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Work management endpoints
      if (path === '/internal/request-work' && request.method === 'POST') {
        return this.handleRequestWork(await request.json());
      }
      if (path === '/internal/report-result' && request.method === 'POST') {
        return this.handleReportResult(await request.json());
      }

      // Seed and configuration
      if (path === '/internal/seed' && request.method === 'POST') {
        return this.handleSeed(await request.json());
      }
      if (path === '/internal/configure' && request.method === 'POST') {
        return this.handleConfigure(await request.json());
      }

      // Run lifecycle
      if (path === '/internal/start' && request.method === 'POST') {
        return this.handleStart();
      }
      if (path === '/internal/pause' && request.method === 'POST') {
        return this.handlePause();
      }
      if (path === '/internal/resume' && request.method === 'POST') {
        return this.handleResume();
      }
      if (path === '/internal/cancel' && request.method === 'POST') {
        return this.handleCancel();
      }
      if (path === '/internal/reset' && request.method === 'POST') {
        return this.handleReset();
      }

      // Status and stats
      if (path === '/internal/stats' && request.method === 'GET') {
        return this.handleStats();
      }
      if (path === '/internal/status' && request.method === 'GET') {
        return this.handleStatus();
      }

      // Maintenance
      if (path === '/internal/on-cron' && request.method === 'POST') {
        return this.handleCron();
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('CrawlController error:', error);
      return Response.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: String(error) } },
        { status: 500 }
      );
    }
  }

  // --------------------------------------------------------------------------
  // Configuration Handler
  // --------------------------------------------------------------------------

  async handleConfigure(payload: ConfigUpdateRequest): Promise<Response> {
    if (!this.runState) {
      this.runState = this.createDefaultRunState();
    }

    this.runState.config = payload.config;
    this.runState.id = payload.config.id || this.runState.id;

    await this.persist();
    return Response.json({ success: true, configId: payload.config.id });
  }

  // --------------------------------------------------------------------------
  // Seed Handler
  // --------------------------------------------------------------------------

  async handleSeed(payload: { urls: string[]; depth?: number; priority?: number }): Promise<Response> {
    const { urls, depth = 0, priority = 0 } = payload;
    const maxQueueSize = this.crawlBehavior.maxQueueSize;
    let added = 0;
    const rejected: string[] = [];

    for (const rawUrl of urls) {
      const url = normaliseUrl(rawUrl);
      const domain = getDomain(url);
      if (!domain) {
        rejected.push(rawUrl);
        continue;
      }

      // Check domain scope
      if (!this.isAllowedDomain(domain)) {
        rejected.push(rawUrl);
        continue;
      }

      const urlHash = String(simpleHash(url));
      if (this.visitedUrls.has(urlHash)) continue;
      if (this.pendingQueue.length >= maxQueueSize) break;

      // Check if already in queue
      const alreadyQueued = this.pendingQueue.some(q => q.url === url);
      if (alreadyQueued) continue;

      this.pendingQueue.push({
        url,
        domain,
        depth,
        addedAt: Date.now(),
        priority,
        retryCount: 0,
      });

      // Track new domain
      if (!this.domainStates.has(domain)) {
        this.domainStates.set(domain, {
          lastFetchTime: 0,
          requestCount: 0,
          errorCount: 0,
          successCount: 0,
          backoffUntil: 0,
          totalResponseTimeMs: 0,
          bytesDownloaded: 0,
        });
      }

      added++;
    }

    if (this.runState) {
      this.runState.stats.urlsQueued += added;
      this.runState.stats.queueSize = this.pendingQueue.length;
      this.runState.stats.domainsDiscovered = this.domainStates.size;
      this.runState.stats.lastActivityAt = Date.now();
    }

    await this.persist();
    return Response.json({
      success: true,
      added,
      rejected: rejected.length,
      queueSize: this.pendingQueue.length,
    });
  }

  // --------------------------------------------------------------------------
  // Domain Scope Validation
  // --------------------------------------------------------------------------

  private isAllowedDomain(domain: string): boolean {
    const scope = this.domainScope;

    // Check blocked domains first
    if (scope.blockedDomains.length > 0) {
      if (scope.blockedDomains.some(d => domain === d || domain.endsWith('.' + d))) {
        return false;
      }
    }

    // If allowed domains specified, check against them
    if (scope.allowedDomains.length > 0) {
      const isAllowed = scope.allowedDomains.some(d => {
        if (domain === d) return true;
        if (scope.includeSubdomains && domain.endsWith('.' + d)) return true;
        return false;
      });
      if (!isAllowed) return false;
    }

    // Check exclude patterns
    if (scope.excludePatterns.length > 0) {
      for (const pattern of scope.excludePatterns) {
        try {
          if (new RegExp(pattern).test(domain)) return false;
        } catch {
          // Invalid regex, skip
        }
      }
    }

    return true;
  }

  private isAllowedUrl(url: string): boolean {
    const scope = this.domainScope;

    // Check exclude patterns
    if (scope.excludePatterns.length > 0) {
      for (const pattern of scope.excludePatterns) {
        try {
          if (new RegExp(pattern).test(url)) return false;
        } catch {
          // Invalid regex, skip
        }
      }
    }

    // Check include patterns (if specified, URL must match at least one)
    if (scope.includePatterns.length > 0) {
      let matches = false;
      for (const pattern of scope.includePatterns) {
        try {
          if (new RegExp(pattern).test(url)) {
            matches = true;
            break;
          }
        } catch {
          // Invalid regex, skip
        }
      }
      if (!matches) return false;
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // Run Lifecycle Handlers
  // --------------------------------------------------------------------------

  async handleStart(): Promise<Response> {
    if (!this.runState) {
      this.runState = this.createDefaultRunState();
    }

    if (this.runState.status === 'running') {
      return Response.json(
        { success: false, error: { code: 'RUN_ALREADY_RUNNING', message: 'Run is already active' } },
        { status: 400 }
      );
    }

    if (this.runState.status === 'completed' || this.runState.status === 'cancelled') {
      return Response.json(
        { success: false, error: { code: 'RUN_COMPLETED', message: 'Run has already finished' } },
        { status: 400 }
      );
    }

    this.runState.status = 'running';
    this.runState.startedAt = Date.now();
    this.runState.stats.lastActivityAt = Date.now();

    await this.persist();
    return Response.json({ success: true, status: this.runState.status });
  }

  async handlePause(): Promise<Response> {
    if (!this.runState || this.runState.status !== 'running') {
      return Response.json(
        { success: false, error: { code: 'RUN_NOT_RUNNING', message: 'Run is not active' } },
        { status: 400 }
      );
    }

    this.runState.status = 'paused';
    this.runState.pausedAt = Date.now();

    await this.persist();
    return Response.json({ success: true, status: this.runState.status });
  }

  async handleResume(): Promise<Response> {
    if (!this.runState || this.runState.status !== 'paused') {
      return Response.json(
        { success: false, error: { code: 'INVALID_RUN_STATE', message: 'Run is not paused' } },
        { status: 400 }
      );
    }

    this.runState.status = 'running';
    this.runState.pausedAt = undefined;
    this.runState.stats.lastActivityAt = Date.now();

    await this.persist();
    return Response.json({ success: true, status: this.runState.status });
  }

  async handleCancel(): Promise<Response> {
    if (!this.runState) {
      return Response.json(
        { success: false, error: { code: 'RUN_NOT_FOUND', message: 'No run found' } },
        { status: 404 }
      );
    }

    this.runState.status = 'cancelled';
    this.runState.completedAt = Date.now();

    await this.persist();
    return Response.json({ success: true, status: this.runState.status });
  }

  async handleReset(): Promise<Response> {
    // Clear all state
    this.pendingQueue = [];
    this.visitedUrls = new Set();
    this.domainStates = new Map();
    this.recentErrors = [];
    this.runState = this.createDefaultRunState();

    await this.persist();
    return Response.json({ success: true, message: 'Run state reset' });
  }

  // --------------------------------------------------------------------------
  // Work Request Handler
  // --------------------------------------------------------------------------

  async handleRequestWork(payload: WorkRequest): Promise<Response> {
    // Check if run is active
    if (!this.runState || this.runState.status !== 'running') {
      return Response.json({
        success: true,
        urls: [],
        queueSize: this.pendingQueue.length,
        config: this.buildWorkerConfig(),
        message: 'Run is not active',
      });
    }

    // Check max pages limit
    const maxPages = this.crawlBehavior.maxPagesPerRun;
    if (maxPages > 0 && this.runState.stats.urlsFetched >= maxPages) {
      this.runState.status = 'completed';
      this.runState.completedAt = Date.now();
      await this.persist();
      return Response.json({
        success: true,
        urls: [],
        queueSize: 0,
        config: this.buildWorkerConfig(),
        message: 'Max pages reached',
      });
    }

    const batchSize = Math.min(
      payload.batchSize || this.crawlBehavior.defaultBatchSize,
      100 // Hard limit
    );
    const now = Date.now();
    const batch: WorkItem[] = [];
    const domainsInBatch = new Set<string>();
    const minDelay = this.rateLimiting.minDomainDelayMs;

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
        if (now - domainState.lastFetchTime < minDelay) {
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
      batch.push({
        url: item.url,
        depth: item.depth,
        priority: item.priority,
        retryCount: item.retryCount,
      });
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
          successCount: 0,
          backoffUntil: 0,
          totalResponseTimeMs: 0,
          bytesDownloaded: 0,
        });
      }
      const state = this.domainStates.get(item.domain)!;
      state.lastFetchTime = now;
      state.requestCount++;
    }

    this.pendingQueue = remainingQueue;

    // Update run state
    if (this.runState) {
      this.runState.stats.queueSize = this.pendingQueue.length;
      this.runState.stats.visitedCount = this.visitedUrls.size;
      this.runState.stats.lastActivityAt = now;
      this.runState.progress.activeDomains = Array.from(domainsInBatch);

      // Check if queue is empty and we're done
      if (this.pendingQueue.length === 0 && batch.length === 0) {
        this.runState.status = 'completed';
        this.runState.completedAt = now;
      }
    }

    await this.persist();
    return Response.json({
      success: true,
      urls: batch,
      queueSize: this.pendingQueue.length,
      config: this.buildWorkerConfig(),
    });
  }

  private buildWorkerConfig(): WorkerConfig {
    return {
      requestTimeoutMs: this.crawlBehavior.requestTimeoutMs,
      respectRobotsTxt: this.crawlBehavior.respectRobotsTxt,
      userAgent: this.crawlBehavior.userAgent,
      customHeaders: this.crawlBehavior.customHeaders,
      maxContentSizeBytes: this.runState?.config?.contentFiltering?.maxContentSizeBytes || 10 * 1024 * 1024,
      allowedContentTypes: this.runState?.config?.contentFiltering?.allowedContentTypes || ['text/html'],
      followRedirects: this.crawlBehavior.followRedirects,
      maxRedirects: this.crawlBehavior.maxRedirects,
      storeContent: this.runState?.config?.contentFiltering?.storeContent ?? true,
    };
  }

  // --------------------------------------------------------------------------
  // Result Report Handler
  // --------------------------------------------------------------------------

  async handleReportResult(payload: ResultReport): Promise<Response> {
    const { url, status, discoveredUrls, error, contentSize, contentHash, responseTimeMs } = payload;
    const domain = getDomain(url);
    const now = Date.now();

    if (domain) {
      const domainState = this.domainStates.get(domain);
      if (domainState) {
        if (error || (status && status >= 400)) {
          // Increase backoff on errors
          domainState.errorCount++;
          const backoffTime = Math.min(
            this.rateLimiting.minDomainDelayMs *
              Math.pow(this.rateLimiting.errorBackoffMultiplier, domainState.errorCount),
            this.rateLimiting.maxDomainDelayMs
          );
          domainState.backoffUntil = now + backoffTime;

          if (this.runState) {
            this.runState.stats.urlsFailed++;

            // Track error
            const crawlError: CrawlError = {
              url,
              domain,
              statusCode: status,
              message: error || `HTTP ${status}`,
              timestamp: now,
            };
            this.recentErrors.push(crawlError);
            if (this.recentErrors.length > 50) {
              this.recentErrors = this.recentErrors.slice(-50);
            }
            this.runState.progress.recentErrors = this.recentErrors.slice(-10);
          }
        } else {
          // Reset error count on success
          domainState.errorCount = 0;
          domainState.backoffUntil = 0;
          domainState.successCount++;

          if (responseTimeMs) {
            domainState.totalResponseTimeMs += responseTimeMs;
          }
          if (contentSize) {
            domainState.bytesDownloaded += contentSize;
          }

          if (this.runState) {
            this.runState.stats.urlsFetched++;
            if (contentSize) {
              this.runState.stats.bytesDownloaded += contentSize;
            }

            // Update average response time
            if (responseTimeMs) {
              const totalFetched = this.runState.stats.urlsFetched;
              const currentAvg = this.runState.stats.avgResponseTimeMs;
              this.runState.stats.avgResponseTimeMs =
                (currentAvg * (totalFetched - 1) + responseTimeMs) / totalFetched;
            }

            // Calculate pages per minute
            if (this.runState.startedAt) {
              const elapsedMinutes = (now - this.runState.startedAt) / 60000;
              if (elapsedMinutes > 0) {
                this.runState.stats.pagesPerMinute = this.runState.stats.urlsFetched / elapsedMinutes;
              }
            }
          }
        }
      }
    }

    // Enqueue discovered URLs (if configured to follow links)
    if (discoveredUrls && discoveredUrls.length > 0 && this.crawlBehavior.followLinks) {
      const parentDepth = 0; // TODO: track depth from work item
      let added = 0;

      for (const rawUrl of discoveredUrls) {
        if (this.pendingQueue.length >= this.crawlBehavior.maxQueueSize) break;

        const newUrl = normaliseUrl(rawUrl);
        const newDomain = getDomain(newUrl);
        if (!newDomain) continue;

        // Check same domain restriction
        if (this.crawlBehavior.sameDomainOnly && domain && newDomain !== domain) {
          continue;
        }

        // Check domain scope
        if (!this.isAllowedDomain(newDomain)) continue;
        if (!this.isAllowedUrl(newUrl)) continue;

        const urlHash = String(simpleHash(newUrl));
        if (this.visitedUrls.has(urlHash)) continue;

        // Check if already in queue
        const alreadyQueued = this.pendingQueue.some(q => q.url === newUrl);
        if (alreadyQueued) continue;

        const newDepth = parentDepth + 1;
        if (newDepth > this.crawlBehavior.maxDepth) continue;

        this.pendingQueue.push({
          url: newUrl,
          domain: newDomain,
          depth: newDepth,
          addedAt: now,
          priority: -newDepth, // Lower priority for deeper pages
          retryCount: 0,
        });

        // Track new domain
        if (!this.domainStates.has(newDomain)) {
          this.domainStates.set(newDomain, {
            lastFetchTime: 0,
            requestCount: 0,
            errorCount: 0,
            successCount: 0,
            backoffUntil: 0,
            totalResponseTimeMs: 0,
            bytesDownloaded: 0,
          });
        }

        added++;
      }

      if (this.runState) {
        this.runState.stats.urlsQueued += added;
        this.runState.stats.domainsDiscovered = this.domainStates.size;
        this.runState.progress.currentDepth = Math.max(
          this.runState.progress.currentDepth,
          parentDepth + 1
        );
      }
    }

    // Update run stats
    if (this.runState) {
      this.runState.stats.queueSize = this.pendingQueue.length;
      this.runState.stats.visitedCount = this.visitedUrls.size;
      this.runState.stats.lastActivityAt = now;

      // Calculate progress
      const total = this.runState.stats.urlsQueued;
      const processed = this.runState.stats.urlsFetched + this.runState.stats.urlsFailed;
      if (total > 0) {
        this.runState.progress.percentage = Math.round((processed / total) * 100);

        // Estimate time remaining
        if (this.runState.stats.pagesPerMinute > 0) {
          const remaining = this.pendingQueue.length;
          this.runState.progress.estimatedSecondsRemaining =
            Math.round((remaining / this.runState.stats.pagesPerMinute) * 60);
        }
      }
    }

    await this.persist();

    // Store metadata in D1 if available
    try {
      if (this.env.CRAWL_DB) {
        await this.env.CRAWL_DB.prepare(
          `INSERT OR REPLACE INTO pages
           (url, domain, status, content_hash, content_size, fetched_at, error, response_time_ms, run_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            url,
            domain,
            status,
            contentHash || null,
            contentSize || 0,
            now,
            error || null,
            responseTimeMs || null,
            this.runState?.id || 'default'
          )
          .run();
      }
    } catch (e) {
      console.error('D1 insert error:', e);
    }

    return Response.json({ success: true });
  }

  // --------------------------------------------------------------------------
  // Stats and Status Handlers
  // --------------------------------------------------------------------------

  async handleStats(): Promise<Response> {
    // Build domain breakdown
    const domainBreakdown = Array.from(this.domainStates.entries())
      .map(([domain, state]) => ({
        domain,
        pagesCount: state.successCount + state.errorCount,
        bytesDownloaded: state.bytesDownloaded,
        errorCount: state.errorCount,
        avgResponseTimeMs:
          state.successCount > 0 ? Math.round(state.totalResponseTimeMs / state.successCount) : 0,
        lastFetchedAt: state.lastFetchTime,
      }))
      .sort((a, b) => b.pagesCount - a.pagesCount)
      .slice(0, 50); // Top 50 domains

    return Response.json({
      success: true,
      run: {
        id: this.runState?.id,
        status: this.runState?.status,
        startedAt: this.runState?.startedAt,
        completedAt: this.runState?.completedAt,
      },
      stats: this.runState?.stats || {},
      progress: this.runState?.progress || {},
      domainBreakdown,
    });
  }

  async handleStatus(): Promise<Response> {
    return Response.json({
      success: true,
      status: this.runState?.status || 'pending',
      queueSize: this.pendingQueue.length,
      visitedCount: this.visitedUrls.size,
      domainsTracked: this.domainStates.size,
      config: this.runState?.config ? { id: this.runState.config.id, name: this.runState.config.name } : null,
    });
  }

  // --------------------------------------------------------------------------
  // Cron Handler
  // --------------------------------------------------------------------------

  async handleCron(): Promise<Response> {
    const now = Date.now();

    // Clear old backoffs
    for (const [, state] of this.domainStates) {
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

    // Check for stalled runs (no activity for 30 minutes)
    if (
      this.runState &&
      this.runState.status === 'running' &&
      this.runState.stats.lastActivityAt < now - 1800000
    ) {
      // Mark as failed if no containers are working
      if (this.pendingQueue.length > 0) {
        this.runState.error = 'Run stalled - no activity for 30 minutes';
        // Don't automatically fail - just log
        console.warn(`Run ${this.runState.id} appears stalled`);
      }
    }

    if (this.runState) {
      this.runState.stats.lastActivityAt = now;
    }

    await this.persist();
    return Response.json({ success: true, queueSize: this.pendingQueue.length });
  }
}

// Export for Durable Object binding
export { CrawlController as default };
