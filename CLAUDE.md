# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Distributed web crawling platform using **Cloudflare Workers** (control plane) and **containerized crawlers** (execution plane). Designed for ~100k pages per run with R2 storage and D1 metadata persistence.

## Architecture

```
Control Plane (Cloudflare)          Execution Plane (Containers)
┌──────────────────────────┐        ┌──────────────────────────┐
│ Worker (src/index.ts)    │◄──────►│ Spider (crawler/spider.py)│
│ - HTTP API routing       │        │ - aiohttp + BeautifulSoup │
│ - R2 content storage     │        │ - Pulls work batches      │
├──────────────────────────┤        │ - Reports results         │
│ Durable Object           │        └──────────────────────────┘
│ (src/crawlController.ts) │
│ - URL queue + visited set│        Storage Layer
│ - Per-domain rate limits │        ┌──────────────────────────┐
│ - Run statistics         │        │ R2: Raw HTML content     │
└──────────────────────────┘        │ D1: Page metadata/links  │
                                    └──────────────────────────┘
```

**Request flow**: Container calls `/api/request-work` → DO pops URLs from queue → Container fetches pages → Container calls `/api/report-result` → DO enqueues discovered links, Worker stores content to R2.

## Development Commands

```bash
# Install and build
npm install
npm run build          # Compiles TypeScript to dist/

# Local development
npm run dev            # Runs wrangler dev (local Worker + DO)

# Deploy to Cloudflare
npm run deploy         # wrangler deploy

# D1 database operations
wrangler d1 execute <db-name> --file=./schema.sql

# Secrets management
wrangler secret put API_TOKEN
```

## Crawler Container

```bash
cd crawler

# Local development
docker-compose up --build

# Production (scale crawlers)
docker-compose up -d --scale crawler=5

# Environment variables
API_URL=https://your-worker.workers.dev
API_TOKEN=your-token
RUN_ID=crawl-run-id
BATCH_SIZE=100
CONCURRENT_REQUESTS=16
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Worker entry point, API routing, R2 integration |
| `src/crawlController.ts` | Durable Object: queue, rate limits, stats |
| `src/utils.ts` | URL normalization, hashing, link extraction |
| `crawler/spider.py` | Python crawler using aiohttp/BeautifulSoup |
| `wrangler.toml` | Cloudflare bindings (R2, D1, DO, KV) |

## API Endpoints

All endpoints require `Authorization: Bearer <API_TOKEN>` header when `API_TOKEN` secret is configured.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/seed` | POST | Add initial URLs: `{urls: string[], runId?: string}` |
| `/api/request-work` | POST | Get batch: `{runId: string, batchSize?: number}` |
| `/api/report-result` | POST | Submit result with discovered URLs |
| `/api/stats` | GET | Crawl statistics for a run |
| `/api/pages` | GET | List crawled pages from D1 |
| `/api/content/{key}` | GET | Retrieve raw HTML from R2 |

## Cloudflare Bindings (wrangler.toml)

- `CRAWL_CONTROLLER`: Durable Object namespace for CrawlController
- `CRAWL_BUCKET`: R2 bucket for raw content (`{runId}/{domain}/{hash}.html`)
- `CRAWL_DB`: D1 database for metadata
- `VISITED_KV`: Optional KV namespace

## Implementation Notes

- **Rate limiting**: Minimum 1s between requests to same domain, exponential backoff on errors (2x multiplier, max 60s)
- **Deduplication**: Simple 32-bit hash of normalized URLs stored in Set (consider Bloom filter for large scale)
- **Queue priority**: Higher priority first, then oldest first; one URL per domain per batch
- **Max depth**: 10 levels; max queue size: 100,000 URLs
- **R2 key structure**: `{runId}/{domain}/{contentHash.substring(0,16)}.html`
