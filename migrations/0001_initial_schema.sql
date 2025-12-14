-- Cloudflare Crawler D1 Schema
-- Run with: npx wrangler d1 execute crawl-db --file=./migrations/0001_initial_schema.sql

-- Crawl runs table - tracks individual crawl sessions
CREATE TABLE IF NOT EXISTS crawl_runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
    seed_urls TEXT NOT NULL, -- JSON array of starting URLs
    config TEXT, -- JSON configuration (rate limits, depth, etc.)
    total_urls INTEGER DEFAULT 0,
    crawled_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
);

-- Pages table - tracks individual page crawl status
CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, in_flight, completed, failed
    http_status INTEGER,
    content_hash TEXT, -- SHA-256 of content for deduplication
    content_type TEXT,
    content_length INTEGER,
    title TEXT,
    r2_key TEXT, -- Key in R2 bucket where content is stored
    depth INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    fetched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES crawl_runs(id),
    UNIQUE(run_id, normalized_url)
);

-- Links table - stores the link graph
CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    from_url TEXT NOT NULL,
    to_url TEXT NOT NULL,
    anchor_text TEXT,
    rel TEXT, -- nofollow, ugc, sponsored, etc.
    is_internal INTEGER DEFAULT 1, -- 1 if same domain, 0 if external
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES crawl_runs(id)
);

-- Errors table - detailed error logging
CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    url TEXT NOT NULL,
    error_type TEXT NOT NULL, -- network, parse, timeout, rate_limit, etc.
    error_message TEXT,
    http_status INTEGER,
    stack_trace TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES crawl_runs(id)
);

-- Domain stats table - per-domain statistics for rate limiting
CREATE TABLE IF NOT EXISTS domain_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    pages_crawled INTEGER DEFAULT 0,
    pages_failed INTEGER DEFAULT 0,
    last_request_at TEXT,
    avg_response_time_ms INTEGER,
    rate_limit_hits INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES crawl_runs(id),
    UNIQUE(run_id, domain)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pages_run_status ON pages(run_id, status);
CREATE INDEX IF NOT EXISTS idx_pages_run_domain ON pages(run_id, domain);
CREATE INDEX IF NOT EXISTS idx_pages_content_hash ON pages(content_hash);
CREATE INDEX IF NOT EXISTS idx_links_run_from ON links(run_id, from_url);
CREATE INDEX IF NOT EXISTS idx_links_run_to ON links(run_id, to_url);
CREATE INDEX IF NOT EXISTS idx_errors_run ON errors(run_id);
CREATE INDEX IF NOT EXISTS idx_domain_stats_run ON domain_stats(run_id, domain);

-- Views for common queries

-- View: Pending URLs ready to crawl
CREATE VIEW IF NOT EXISTS pending_urls AS
SELECT p.*, r.config
FROM pages p
JOIN crawl_runs r ON p.run_id = r.id
WHERE p.status = 'pending'
ORDER BY p.depth ASC, p.created_at ASC;

-- View: Run summary statistics
CREATE VIEW IF NOT EXISTS run_summary AS
SELECT
    r.id,
    r.name,
    r.status,
    r.created_at,
    r.started_at,
    r.completed_at,
    COUNT(DISTINCT p.id) as total_pages,
    SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) as completed_pages,
    SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed_pages,
    SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END) as pending_pages,
    COUNT(DISTINCT p.domain) as unique_domains,
    COUNT(DISTINCT l.id) as total_links
FROM crawl_runs r
LEFT JOIN pages p ON r.id = p.run_id
LEFT JOIN links l ON r.id = l.run_id
GROUP BY r.id;
