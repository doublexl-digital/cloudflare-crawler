# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Distributed web crawling platform using **Cloudflare Workers** (control plane) and **containerized crawlers** (execution plane). Designed for ~100k pages per run with R2 storage and D1 metadata persistence.

**API Version:** 2.0.0 - Full configuration and run management support.

## Architecture

```
Control Plane (Cloudflare)          Execution Plane (Containers)
┌──────────────────────────┐        ┌──────────────────────────┐
│ Worker (src/index.ts)    │◄──────►│ Spider (crawler/spider.py)│
│ - HTTP API routing       │        │ - aiohttp + BeautifulSoup │
│ - Config & Run mgmt      │        │ - Pulls work batches      │
│ - R2 content storage     │        │ - Reports results         │
├──────────────────────────┤        └──────────────────────────┘
│ Durable Object           │
│ (src/crawlController.ts) │        Storage Layer
│ - URL queue + visited set│        ┌──────────────────────────┐
│ - Per-domain rate limits │        │ R2: Raw HTML content     │
│ - Run lifecycle          │        │ D1: Configs, runs, pages │
│ - Dynamic configuration  │        └──────────────────────────┘
└──────────────────────────┘
```

**Request flow**:
1. Frontend creates run via `/api/runs` with configuration
2. DO receives config and seeds URLs
3. Container calls `/api/request-work` → DO pops URLs respecting rate limits
4. Container fetches pages → calls `/api/report-result`
5. DO enqueues discovered links, Worker stores content to R2

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
wrangler d1 execute <db-name> --file=./migrations/001_add_configurations.sql

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
| `src/index.ts` | Worker entry point, all API routing (configs, runs, pages) |
| `src/crawlController.ts` | Durable Object: queue, rate limits, run lifecycle |
| `src/types.ts` | Comprehensive TypeScript types for API |
| `src/utils.ts` | URL normalization, hashing, link extraction |
| `schema.sql` | D1 database schema v2.0 |
| `docs/API.md` | Complete API documentation |
| `docs/FRONTEND_REQUIREMENTS.md` | Frontend UI specifications |
| `crawler/spider.py` | Python crawler using aiohttp/BeautifulSoup |
| `wrangler.toml` | Cloudflare bindings (R2, D1, DO, KV) |

## API Endpoints (v2.0)

All endpoints require `Authorization: Bearer <API_TOKEN>` header when configured.

### Configuration Management
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/configs` | GET | List configurations |
| `/api/configs` | POST | Create configuration |
| `/api/configs/:id` | GET | Get configuration |
| `/api/configs/:id` | PUT/PATCH | Update configuration |
| `/api/configs/:id` | DELETE | Delete configuration |

### Run Management
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/runs` | GET | List runs (filterable) |
| `/api/runs` | POST | Create run with config & seeds |
| `/api/runs/:id` | GET | Get run with real-time stats |
| `/api/runs/:id/start` | POST | Start pending run |
| `/api/runs/:id/pause` | POST | Pause running crawl |
| `/api/runs/:id/resume` | POST | Resume paused crawl |
| `/api/runs/:id/cancel` | POST | Cancel run |
| `/api/runs/:id/seed` | POST | Add more URLs to run |
| `/api/runs/:id/reset` | POST | Reset run state |
| `/api/runs/:id` | DELETE | Delete run and data |

### Container Communication (backward compatible)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/request-work` | POST | Get batch of URLs |
| `/api/report-result` | POST | Submit crawl result |
| `/api/seed` | POST | Seed URLs (legacy) |

### Data Access
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/stats` | GET | Crawl statistics |
| `/api/pages` | GET | List crawled pages |
| `/api/content/:key` | GET | Get raw HTML from R2 |
| `/api/errors` | GET | List crawl errors |

## Configuration Options

Configurations are JSON objects with these sections:

- **rateLimiting**: minDomainDelayMs, maxDomainDelayMs, maxConcurrentRequests
- **contentFiltering**: maxContentSizeBytes, allowedContentTypes, storeContent
- **crawlBehavior**: maxDepth, maxQueueSize, userAgent, respectRobotsTxt
- **domainScope**: allowedDomains, blockedDomains, includePatterns
- **rendering**: enabled, captureScreenshots (requires Browser Rendering)

See `src/types.ts` for complete type definitions.

## Cloudflare Bindings (wrangler.toml)

- `CRAWL_CONTROLLER`: Durable Object namespace
- `CRAWL_BUCKET`: R2 bucket for raw content
- `CRAWL_DB`: D1 database for metadata
- `VISITED_KV`: Optional KV namespace

## Implementation Notes

- **Rate limiting**: Configurable via configuration (default: 1s min delay, 60s max backoff)
- **Deduplication**: 32-bit hash of normalized URLs in DO memory
- **Queue priority**: Higher priority first, then oldest first; one URL per domain per batch
- **Max limits**: Depth and queue size configurable per-run
- **R2 key structure**: `{runId}/{domain}/{contentHash.substring(0,16)}.html`
- **Run lifecycle**: pending → running → (paused) → completed/failed/cancelled
