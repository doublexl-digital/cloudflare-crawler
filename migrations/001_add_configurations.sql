-- Migration: Add configurations table and enhance runs table
-- Run this migration with: wrangler d1 execute <database-name> --file=./migrations/001_add_configurations.sql

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

-- Add new columns to runs table for enhanced tracking
ALTER TABLE runs ADD COLUMN config_id TEXT REFERENCES configurations(id);
ALTER TABLE runs ADD COLUMN description TEXT;
ALTER TABLE runs ADD COLUMN paused_at INTEGER;
ALTER TABLE runs ADD COLUMN avg_response_time_ms INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN domains_discovered INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN current_depth INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN last_error TEXT;

-- Index for config lookups
CREATE INDEX IF NOT EXISTS idx_runs_config_id ON runs(config_id);

-- Add run_id to pages table for filtering
ALTER TABLE pages ADD COLUMN run_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pages_run_id ON pages(run_id);

-- Add response time tracking to pages
ALTER TABLE pages ADD COLUMN response_time_ms INTEGER;
ALTER TABLE pages ADD COLUMN title TEXT;
ALTER TABLE pages ADD COLUMN links_count INTEGER DEFAULT 0;

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
