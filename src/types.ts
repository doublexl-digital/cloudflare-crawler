/**
 * Comprehensive type definitions for the Cloudflare Crawler API
 *
 * This file defines all types used across the Worker, Durable Objects,
 * and serves as the contract for frontend integration.
 */

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Crawl configuration that can be customized per run.
 * All fields are optional with sensible defaults applied server-side.
 */
export interface CrawlConfig {
  /** Unique identifier for the configuration */
  id: string;

  /** Human-readable name for the configuration */
  name: string;

  /** Optional description */
  description?: string;

  /** Rate limiting configuration */
  rateLimiting: RateLimitConfig;

  /** Content filtering configuration */
  contentFiltering: ContentFilterConfig;

  /** Crawl behavior configuration */
  crawlBehavior: CrawlBehaviorConfig;

  /** Domain scope configuration */
  domainScope: DomainScopeConfig;

  /** Rendering configuration (for JavaScript-heavy sites) */
  rendering: RenderingConfig;

  /** Metadata */
  createdAt: number;
  updatedAt: number;
}

/**
 * Rate limiting configuration for controlling request frequency
 */
export interface RateLimitConfig {
  /** Minimum delay between requests to the same domain (ms) */
  minDomainDelayMs: number;

  /** Maximum backoff delay after errors (ms) */
  maxDomainDelayMs: number;

  /** Multiplier for exponential backoff on errors */
  errorBackoffMultiplier: number;

  /** Add random jitter to delays to prevent thundering herd (0-1) */
  jitterFactor: number;

  /** Maximum concurrent requests per crawler container */
  maxConcurrentRequests: number;

  /** Global rate limit across all domains (requests per minute, 0 = unlimited) */
  globalRateLimitPerMinute: number;
}

/**
 * Content filtering configuration
 */
export interface ContentFilterConfig {
  /** Maximum content size to download (bytes) */
  maxContentSizeBytes: number;

  /** Allowed content types (MIME types) */
  allowedContentTypes: string[];

  /** File extensions to exclude (e.g., ['.pdf', '.zip']) */
  excludedExtensions: string[];

  /** Skip binary files */
  skipBinaryFiles: boolean;

  /** Store raw HTML content in R2 */
  storeContent: boolean;

  /** Extract and store text-only version */
  extractText: boolean;
}

/**
 * Crawl behavior configuration
 */
export interface CrawlBehaviorConfig {
  /** Maximum depth to follow links from seed URLs */
  maxDepth: number;

  /** Maximum total URLs to queue per run */
  maxQueueSize: number;

  /** Maximum pages to fetch per run (0 = unlimited) */
  maxPagesPerRun: number;

  /** Batch size for work requests */
  defaultBatchSize: number;

  /** Request timeout in milliseconds */
  requestTimeoutMs: number;

  /** Number of retries for failed requests */
  retryCount: number;

  /** Respect robots.txt */
  respectRobotsTxt: boolean;

  /** Follow redirects */
  followRedirects: boolean;

  /** Maximum redirects to follow */
  maxRedirects: number;

  /** User agent string */
  userAgent: string;

  /** Custom headers to include */
  customHeaders: Record<string, string>;

  /** Follow links discovered on pages */
  followLinks: boolean;

  /** Only follow same-domain links */
  sameDomainOnly: boolean;
}

/**
 * Domain scope configuration
 */
export interface DomainScopeConfig {
  /** Allowed domains (empty = allow all from seeds) */
  allowedDomains: string[];

  /** Blocked domains (takes precedence over allowed) */
  blockedDomains: string[];

  /** URL patterns to include (regex) */
  includePatterns: string[];

  /** URL patterns to exclude (regex) */
  excludePatterns: string[];

  /** Include subdomains of allowed domains */
  includeSubdomains: boolean;
}

/**
 * Browser rendering configuration for JavaScript-heavy sites
 */
export interface RenderingConfig {
  /** Enable browser rendering (requires Cloudflare Browser Rendering) */
  enabled: boolean;

  /** Wait for page load event before extracting content */
  waitForLoad: boolean;

  /** Additional wait time after load (ms) */
  waitAfterLoadMs: number;

  /** Viewport width */
  viewportWidth: number;

  /** Viewport height */
  viewportHeight: number;

  /** Take screenshots */
  captureScreenshots: boolean;

  /** Screenshot format */
  screenshotFormat: 'png' | 'jpeg' | 'webp';

  /** Execute custom JavaScript before extraction */
  customScript?: string;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Omit<CrawlConfig, 'id' | 'name' | 'createdAt' | 'updatedAt'> = {
  description: '',
  rateLimiting: {
    minDomainDelayMs: 1000,
    maxDomainDelayMs: 60000,
    errorBackoffMultiplier: 2,
    jitterFactor: 0.1,
    maxConcurrentRequests: 16,
    globalRateLimitPerMinute: 0,
  },
  contentFiltering: {
    maxContentSizeBytes: 10 * 1024 * 1024, // 10MB
    allowedContentTypes: ['text/html', 'application/xhtml+xml'],
    excludedExtensions: ['.pdf', '.zip', '.tar', '.gz', '.rar', '.exe', '.dmg', '.iso'],
    skipBinaryFiles: true,
    storeContent: true,
    extractText: false,
  },
  crawlBehavior: {
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
  },
  domainScope: {
    allowedDomains: [],
    blockedDomains: [],
    includePatterns: [],
    excludePatterns: [],
    includeSubdomains: true,
  },
  rendering: {
    enabled: false,
    waitForLoad: true,
    waitAfterLoadMs: 0,
    viewportWidth: 1920,
    viewportHeight: 1080,
    captureScreenshots: false,
    screenshotFormat: 'png',
  },
};

// ============================================================================
// RUN TYPES
// ============================================================================

/**
 * Run status enumeration
 */
export type RunStatus =
  | 'pending'     // Created but not started
  | 'running'     // Actively crawling
  | 'paused'      // Temporarily paused
  | 'completed'   // Successfully finished
  | 'failed'      // Stopped due to errors
  | 'cancelled';  // Manually cancelled

/**
 * Crawl run instance
 */
export interface CrawlRun {
  /** Unique run identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Configuration ID to use (or 'default') */
  configId: string;

  /** Seed URLs to start crawling from */
  seedUrls: string[];

  /** Current status */
  status: RunStatus;

  /** Run statistics */
  stats: RunStats;

  /** Error message if failed */
  error?: string;

  /** Timestamps */
  createdAt: number;
  startedAt?: number;
  pausedAt?: number;
  completedAt?: number;

  /** Progress indicators */
  progress: RunProgress;
}

/**
 * Run statistics
 */
export interface RunStats {
  /** Total URLs added to queue */
  urlsQueued: number;

  /** Successfully fetched pages */
  urlsFetched: number;

  /** Failed page fetches */
  urlsFailed: number;

  /** Total bytes downloaded */
  bytesDownloaded: number;

  /** Unique domains discovered */
  domainsDiscovered: number;

  /** Current queue size */
  queueSize: number;

  /** Visited URL count */
  visitedCount: number;

  /** Average response time (ms) */
  avgResponseTimeMs: number;

  /** Pages per minute rate */
  pagesPerMinute: number;

  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Run progress indicators for UI
 */
export interface RunProgress {
  /** Progress percentage (0-100) */
  percentage: number;

  /** Estimated time remaining (seconds, -1 = unknown) */
  estimatedSecondsRemaining: number;

  /** Current crawl depth */
  currentDepth: number;

  /** Currently active domains */
  activeDomains: string[];

  /** Recent errors (last 10) */
  recentErrors: CrawlError[];
}

/**
 * Crawl error record
 */
export interface CrawlError {
  url: string;
  domain: string;
  statusCode?: number;
  message: string;
  timestamp: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Generic API response wrapper
 */
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: APIError;
  meta?: APIMeta;
}

/**
 * API error details
 */
export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * API metadata for pagination, etc.
 */
export interface APIMeta {
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
}

// --- Configuration Endpoints ---

export interface CreateConfigRequest {
  name: string;
  description?: string;
  rateLimiting?: Partial<RateLimitConfig>;
  contentFiltering?: Partial<ContentFilterConfig>;
  crawlBehavior?: Partial<CrawlBehaviorConfig>;
  domainScope?: Partial<DomainScopeConfig>;
  rendering?: Partial<RenderingConfig>;
}

export interface UpdateConfigRequest extends Partial<CreateConfigRequest> {
  id: string;
}

export interface ListConfigsRequest {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ListConfigsResponse {
  configs: CrawlConfig[];
  total: number;
}

// --- Run Endpoints ---

export interface CreateRunRequest {
  name: string;
  description?: string;
  configId?: string;           // Use existing config ID
  config?: CreateConfigRequest; // Or provide inline config
  seedUrls: string[];
  autoStart?: boolean;         // Start immediately after creation
}

export interface UpdateRunRequest {
  id: string;
  name?: string;
  description?: string;
}

export interface ListRunsRequest {
  limit?: number;
  offset?: number;
  status?: RunStatus | RunStatus[];
  search?: string;
  sortBy?: 'createdAt' | 'startedAt' | 'name' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface ListRunsResponse {
  runs: CrawlRun[];
  total: number;
}

export interface RunActionRequest {
  runId: string;
  action: 'start' | 'pause' | 'resume' | 'cancel';
}

export interface SeedUrlsRequest {
  runId: string;
  urls: string[];
  priority?: number;
}

// --- Work Request/Result (Container Communication) ---

export interface WorkRequest {
  runId: string;
  batchSize?: number;
  workerId?: string;
}

export interface WorkResponse {
  urls: WorkItem[];
  queueSize: number;
  config: WorkerConfig;
}

export interface WorkItem {
  url: string;
  depth: number;
  priority: number;
  retryCount: number;
}

/**
 * Subset of config sent to worker containers
 */
export interface WorkerConfig {
  requestTimeoutMs: number;
  respectRobotsTxt: boolean;
  userAgent: string;
  customHeaders: Record<string, string>;
  maxContentSizeBytes: number;
  allowedContentTypes: string[];
  followRedirects: boolean;
  maxRedirects: number;
  storeContent: boolean;
}

export interface ResultReport {
  runId: string;
  url: string;
  status: number;
  content?: string;
  contentHash?: string;
  contentSize?: number;
  discoveredUrls?: string[];
  error?: string;
  fetchedAt: number;
  responseTimeMs?: number;
  redirectChain?: string[];
}

// --- Stats & Pages ---

export interface StatsRequest {
  runId: string;
}

export interface StatsResponse {
  run: CrawlRun;
  stats: RunStats;
  progress: RunProgress;
  domainBreakdown: DomainStats[];
}

export interface DomainStats {
  domain: string;
  pagesCount: number;
  bytesDownloaded: number;
  errorCount: number;
  avgResponseTimeMs: number;
  lastFetchedAt: number;
}

export interface ListPagesRequest {
  runId?: string;
  domain?: string;
  status?: number | number[];
  limit?: number;
  offset?: number;
  sortBy?: 'fetchedAt' | 'url' | 'status' | 'contentSize';
  sortOrder?: 'asc' | 'desc';
}

export interface PageRecord {
  id: number;
  url: string;
  domain: string;
  status: number;
  contentHash?: string;
  contentSize: number;
  fetchedAt: number;
  error?: string;
  title?: string;
  links?: number;
}

export interface ListPagesResponse {
  pages: PageRecord[];
  total: number;
}

// --- Content Retrieval ---

export interface GetContentRequest {
  key: string;  // R2 key or content hash
}

export interface ContentResponse {
  content: string;
  contentType: string;
  url: string;
  fetchedAt: number;
  size: number;
}

// ============================================================================
// WEBHOOK TYPES (for real-time updates)
// ============================================================================

export type WebhookEventType =
  | 'run.created'
  | 'run.started'
  | 'run.paused'
  | 'run.resumed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'page.crawled'
  | 'error.occurred';

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: number;
  runId: string;
  data: Record<string, unknown>;
}

// ============================================================================
// ERROR CODES
// ============================================================================

export const ERROR_CODES = {
  // General
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Configuration
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_IN_USE: 'CONFIG_IN_USE',
  INVALID_CONFIG: 'INVALID_CONFIG',

  // Run
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  RUN_ALREADY_RUNNING: 'RUN_ALREADY_RUNNING',
  RUN_NOT_RUNNING: 'RUN_NOT_RUNNING',
  RUN_COMPLETED: 'RUN_COMPLETED',
  INVALID_RUN_STATE: 'INVALID_RUN_STATE',

  // Queue
  QUEUE_FULL: 'QUEUE_FULL',
  NO_WORK_AVAILABLE: 'NO_WORK_AVAILABLE',

  // Content
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
