-- D1 Database Schema for Cloudflare Crawler v2.0
-- Run this migration with: wrangler d1 execute <database-name> --file=./schema.sql
--
-- This schema supports:
-- - Reusable crawl configurations
-- - Multiple concurrent crawl runs
-- - Detailed page metadata and error tracking
-- - Webhook notifications

-- ============================================================================
-- CONFIGURATIONS TABLE
-- ============================================================================

-- Configurations table: stores reusable crawl configurations
CREATE TABLE IF NOT EXISTS configurations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,

    -- Rate limiting settings (JSON)
    rate_limiting TEXT NOT NULL DEFAULT '{}',

    -- Content filtering settings (JSON)
    content_filtering TEXT NOT NULL DEFAULT '{}',

    -- Crawl behavior settings (JSON)
    crawl_behavior TEXT NOT NULL DEFAULT '{}',

    -- Domain scope settings (JSON)
    domain_scope TEXT NOT NULL DEFAULT '{}',

    -- Rendering settings (JSON)
    rendering TEXT NOT NULL DEFAULT '{}',

    -- Metadata
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for name search
CREATE INDEX IF NOT EXISTS idx_configurations_name ON configurations(name);

-- Index for updated_at for sorting
CREATE INDEX IF NOT EXISTS idx_configurations_updated_at ON configurations(updated_at);

-- Insert default configuration
INSERT OR IGNORE INTO configurations (
    id,
    name,
    description,
    rate_limiting,
    content_filtering,
    crawl_behavior,
    domain_scope,
    rendering
) VALUES (
    'default',
    'Default Configuration',
    'Standard crawl configuration with balanced settings',
    '{"minDomainDelayMs":1000,"maxDomainDelayMs":60000,"errorBackoffMultiplier":2,"jitterFactor":0.1,"maxConcurrentRequests":16,"globalRateLimitPerMinute":0}',
    '{"maxContentSizeBytes":10485760,"allowedContentTypes":["text/html","application/xhtml+xml"],"excludedExtensions":[".pdf",".zip",".tar",".gz"],"skipBinaryFiles":true,"storeContent":true,"extractText":false}',
    '{"maxDepth":10,"maxQueueSize":100000,"maxPagesPerRun":0,"defaultBatchSize":10,"requestTimeoutMs":30000,"retryCount":3,"respectRobotsTxt":true,"followRedirects":true,"maxRedirects":5,"userAgent":"CloudflareCrawler/1.0","customHeaders":{},"followLinks":true,"sameDomainOnly":true}',
    '{"allowedDomains":[],"blockedDomains":[],"includePatterns":[],"excludePatterns":[],"includeSubdomains":true}',
    '{"enabled":false,"waitForLoad":true,"waitAfterLoadMs":0,"viewportWidth":1920,"viewportHeight":1080,"captureScreenshots":false,"screenshotFormat":"png"}'
);

-- ============================================================================
-- RUNS TABLE
-- ============================================================================

-- Runs table: stores metadata about each crawl run
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    config_id TEXT REFERENCES configurations(id),
    seed_urls TEXT,  -- JSON array of seed URLs
    status TEXT DEFAULT 'pending',  -- pending, running, paused, completed, failed, cancelled

    -- Statistics
    urls_queued INTEGER DEFAULT 0,
    urls_fetched INTEGER DEFAULT 0,
    urls_failed INTEGER DEFAULT 0,
    bytes_downloaded INTEGER DEFAULT 0,
    domains_discovered INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER DEFAULT 0,
    current_depth INTEGER DEFAULT 0,

    -- Error tracking
    last_error TEXT,

    -- Timestamps
    started_at INTEGER,
    paused_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- Index for config lookups
CREATE INDEX IF NOT EXISTS idx_runs_config_id ON runs(config_id);

-- Index for created_at for sorting
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);

-- ============================================================================
-- PAGES TABLE
-- ============================================================================

-- Pages table: stores metadata about each crawled page
CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    run_id TEXT,
    status INTEGER,
    content_hash TEXT,
    content_size INTEGER DEFAULT 0,
    response_time_ms INTEGER,
    title TEXT,
    links_count INTEGER DEFAULT 0,
    fetched_at INTEGER NOT NULL,
    error TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),

    UNIQUE(url, run_id)
);

-- Index for domain lookups
CREATE INDEX IF NOT EXISTS idx_pages_domain ON pages(domain);

-- Index for run lookups
CREATE INDEX IF NOT EXISTS idx_pages_run_id ON pages(run_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);

-- Index for fetched_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_pages_fetched_at ON pages(fetched_at);

-- ============================================================================
-- LINKS TABLE
-- ============================================================================

-- Links table: stores discovered links between pages
CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_url TEXT NOT NULL,
    to_url TEXT NOT NULL,
    run_id TEXT,
    discovered_at INTEGER NOT NULL,

    UNIQUE(from_url, to_url, run_id)
);

-- Index for from_url lookups (outbound links)
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_url);

-- Index for to_url lookups (inbound links)
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_url);

-- Index for run lookups
CREATE INDEX IF NOT EXISTS idx_links_run_id ON links(run_id);

-- ============================================================================
-- DOMAINS TABLE
-- ============================================================================

-- Domains table: track per-domain statistics
CREATE TABLE IF NOT EXISTS domains (
    domain TEXT PRIMARY KEY,
    run_id TEXT,
    pages_count INTEGER DEFAULT 0,
    last_fetched_at INTEGER,
    avg_response_time INTEGER,
    error_rate REAL DEFAULT 0,
    bytes_downloaded INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- ============================================================================
-- ERRORS TABLE
-- ============================================================================

-- Crawl errors table for detailed error tracking
CREATE TABLE IF NOT EXISTS crawl_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    url TEXT NOT NULL,
    domain TEXT,
    status_code INTEGER,
    message TEXT NOT NULL,
    stack_trace TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for run-based error queries
CREATE INDEX IF NOT EXISTS idx_crawl_errors_run_id ON crawl_errors(run_id);

-- Index for recent errors
CREATE INDEX IF NOT EXISTS idx_crawl_errors_created_at ON crawl_errors(created_at);

-- ============================================================================
-- WEBHOOKS TABLE
-- ============================================================================

-- Webhooks table for real-time notifications
CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    secret TEXT,
    events TEXT NOT NULL DEFAULT '[]',  -- JSON array of event types
    is_active INTEGER DEFAULT 1,
    last_triggered_at INTEGER,
    failure_count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for active webhooks
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active);
