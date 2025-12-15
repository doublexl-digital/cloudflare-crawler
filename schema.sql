-- D1 Database Schema for Cloudflare Crawler
-- Run this migration with: wrangler d1 execute <database-name> --file=./schema.sql

-- Pages table: stores metadata about each crawled page
CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    status INTEGER,
    content_hash TEXT,
    content_size INTEGER DEFAULT 0,
    fetched_at INTEGER NOT NULL,
    error TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for domain lookups
CREATE INDEX IF NOT EXISTS idx_pages_domain ON pages(domain);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);

-- Index for fetched_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_pages_fetched_at ON pages(fetched_at);

-- Links table: stores discovered links between pages
CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_url TEXT NOT NULL,
    to_url TEXT NOT NULL,
    discovered_at INTEGER NOT NULL,
    UNIQUE(from_url, to_url)
);

-- Index for from_url lookups (outbound links)
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_url);

-- Index for to_url lookups (inbound links)
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_url);

-- Runs table: stores metadata about each crawl run
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    name TEXT,
    seed_urls TEXT,  -- JSON array of seed URLs
    status TEXT DEFAULT 'pending',  -- pending, running, paused, completed, failed
    urls_queued INTEGER DEFAULT 0,
    urls_fetched INTEGER DEFAULT 0,
    urls_failed INTEGER DEFAULT 0,
    bytes_downloaded INTEGER DEFAULT 0,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- Domains table: track per-domain statistics
CREATE TABLE IF NOT EXISTS domains (
    domain TEXT PRIMARY KEY,
    pages_count INTEGER DEFAULT 0,
    last_fetched_at INTEGER,
    avg_response_time INTEGER,
    error_rate REAL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
