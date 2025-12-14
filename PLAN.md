# Cloudflare Crawler - Implementation Plan

## Executive Summary

This repository contains the **scaffolding** for a distributed web crawling platform built on Cloudflare's edge infrastructure. The architecture separates the **control plane** (Cloudflare Workers + Durable Objects) from the **execution plane** (containerized crawlers), enabling scalable crawls of ~100k pages per run.

### Current State: ~5% Complete

| Component | Status | Description |
|-----------|--------|-------------|
| Project Structure | ✅ Complete | Clean separation of concerns |
| Type Definitions | ✅ Complete | TypeScript interfaces defined |
| API Routing | ✅ Complete | HTTP endpoints configured |
| Utility Functions | ✅ Complete | URL normalization, domain extraction |
| Queue Management | ❌ Stub | Returns empty batches |
| Result Processing | ❌ Stub | No-op implementation |
| Rate Limiting | ❌ Not Started | No per-domain limits |
| Deduplication | ❌ Not Started | No bloom filter/visited tracking |
| D1 Schema | ❌ Not Started | No database tables |
| Crawler Containers | ❌ Not Started | No Dockerfile or spider code |
| Authentication | ❌ Not Started | API endpoints are open |
| Testing | ❌ Not Started | No test suite |

---

## Architecture Deep Dive

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONTROL PLANE (Cloudflare)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌───────────────────────────────────────────────────┐ │
│  │   Scheduler  │    │              Durable Object                        │ │
│  │   (Worker)   │◄──►│           (CrawlController)                        │ │
│  │              │    │                                                    │ │
│  │ • Cron Jobs  │    │ • pendingQueue: URL[]                             │ │
│  │ • HTTP API   │    │ • visitedSet: Set<hash>                           │ │
│  │ • Routing    │    │ • domainRateLimits: Map<domain, config>           │ │
│  └──────────────┘    │ • runStats: { crawled, errors, discovered }       │ │
│         │            └───────────────────────────────────────────────────┘ │
│         │                           │                                       │
└─────────┼───────────────────────────┼───────────────────────────────────────┘
          │                           │
          │  /api/request-work        │
          │  /api/report-result       │
          ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXECUTION PLANE (Containers)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Crawler #1  │  │  Crawler #2  │  │  Crawler #3  │  │  Crawler #N  │   │
│  │   (Scrapy)   │  │   (Scrapy)   │  │ (Playwright) │  │   (Custom)   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                             │
│  Hosted on: DigitalOcean Droplets / Cloudflare Containers / Any Cloud      │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          │ Store raw HTML, screenshots, artifacts
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STORAGE LAYER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │   Cloudflare R2 │  │  Cloudflare D1  │  │  External PostgreSQL        │ │
│  │                 │  │                 │  │  (Neon / DigitalOcean)      │ │
│  │ • Raw HTML      │  │ • Crawl runs    │  │                             │ │
│  │ • Screenshots   │  │ • Page metadata │  │ • Full-text search          │ │
│  │ • JSON extracts │  │ • Link graph    │  │ • Advanced analytics        │ │
│  │ • Artifacts     │  │ • Error logs    │  │ • Cross-run aggregation     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Request Lifecycle

```
1. INIT: Seed URLs → Durable Object pendingQueue
2. PULL: Container calls POST /api/request-work { runId, batchSize }
3. POP:  Durable Object returns batch of URLs, marks them in-flight
4. CRAWL: Container fetches pages, extracts content + links
5. PUSH: Container calls POST /api/report-result { runId, url, content, links, status }
6. UPDATE: Durable Object stores result, enqueues new links, updates stats
7. REPEAT: Steps 2-6 until pendingQueue empty
8. COMPLETE: Run marked complete, stats finalized
```

---

## Phased Implementation Plan

### Phase 1: Core Infrastructure (Foundation)

**Goal**: Working queue system and basic persistence

#### 1.1 D1 Database Schema
Create `schema.sql` with tables for:
- `crawl_runs` - Run metadata and configuration
- `pages` - URL status, content hash, timestamps
- `links` - Link graph (from_url → to_url)
- `errors` - Error tracking for debugging

#### 1.2 Durable Object Queue Implementation
Implement in `crawlController.ts`:
- In-memory `pendingQueue` with D1 backup
- `visitedSet` using bloom filter for memory efficiency
- `handleRequestWork()` - Pop batch with domain-aware scheduling
- `handleReportResult()` - Process results, enqueue new URLs

#### 1.3 R2 Storage Integration
- Define key structure: `{runId}/{domain}/{urlHash}.html`
- Implement content upload in `handleReportResult()`
- Add content deduplication via hash comparison

**Deliverables**:
- [ ] `migrations/0001_initial_schema.sql`
- [ ] Updated `crawlController.ts` with queue logic
- [ ] R2 integration for raw content storage

---

### Phase 2: Crawler Containers (Execution)

**Goal**: Working crawler that communicates with control plane

#### 2.1 Dockerfile
Create a containerized crawler with:
- Python 3.11 base image
- Scrapy + scrapy-playwright (optional)
- Custom spider framework

#### 2.2 Spider Implementation
Python spider that:
- Polls `/api/request-work` for URLs
- Fetches pages with configurable user agents
- Extracts content, links, and metadata
- Reports results to `/api/report-result`
- Handles errors gracefully

#### 2.3 Container Orchestration
- Docker Compose for local development
- DigitalOcean deployment scripts
- Environment variable configuration

**Deliverables**:
- [ ] `crawler/Dockerfile`
- [ ] `crawler/requirements.txt`
- [ ] `crawler/spider.py`
- [ ] `crawler/docker-compose.yml`
- [ ] `crawler/README.md` with deployment instructions

---

### Phase 3: Rate Limiting & Deduplication (Politeness)

**Goal**: Respectful crawling that doesn't overwhelm targets

#### 3.1 Per-Domain Rate Limiting
- Configurable delay between requests per domain
- Respect robots.txt (optional but recommended)
- Backoff on 429/503 responses

#### 3.2 URL Deduplication
- Bloom filter for memory-efficient visited tracking
- URL normalization before hashing
- Handle URL variants (www vs non-www, trailing slashes)

#### 3.3 Priority Queue
- Prioritize certain URLs over others
- Depth-based priority (BFS vs DFS)
- Domain rotation for fair scheduling

**Deliverables**:
- [ ] `src/rateLimit.ts` - Rate limiting utilities
- [ ] `src/bloomFilter.ts` - Bloom filter implementation
- [ ] Updated queue logic with priorities

---

### Phase 4: Authentication & Security (Production Ready)

**Goal**: Secure API endpoints and protect resources

#### 4.1 API Authentication
- Bearer token authentication for crawler containers
- Token rotation support
- Rate limiting on API endpoints

#### 4.2 Input Validation
- Validate all incoming payloads
- Sanitize URLs before processing
- Prevent SSRF attacks

#### 4.3 Secrets Management
- Use `wrangler secret` for sensitive values
- Document required secrets
- Environment-specific configuration

**Deliverables**:
- [ ] `src/auth.ts` - Authentication middleware
- [ ] Updated API handlers with auth checks
- [ ] Security documentation

---

### Phase 5: Monitoring & Observability (Operations)

**Goal**: Visibility into crawl progress and health

#### 5.1 Logging
- Structured logging to Cloudflare Logs
- Error tracking with context
- Request tracing

#### 5.2 Metrics
- Crawl progress (URLs/second, errors/minute)
- Queue depth over time
- Domain distribution

#### 5.3 Dashboard (Optional)
- Cloudflare Pages app for visualization
- Real-time stats display
- Run history and comparison

**Deliverables**:
- [ ] Logging implementation
- [ ] Metrics collection
- [ ] Dashboard (if desired)

---

### Phase 6: External Integrations (Advanced)

**Goal**: Extended capabilities for analytics

#### 6.1 External PostgreSQL
- Neon or DigitalOcean managed Postgres
- Full-text search capabilities
- Cross-run analytics

#### 6.2 Export Pipelines
- Export crawl data to various formats
- S3-compatible storage integration
- Webhook notifications

**Deliverables**:
- [ ] PostgreSQL integration code
- [ ] Export utilities
- [ ] Integration documentation

---

## File Structure After Implementation

```
cloudflare-crawler/
├── README.md                    # Updated with full usage guide
├── PLAN.md                      # This file
├── TODO.md                      # Original todo list (can be archived)
├── LICENSE                      # MIT License
├── package.json                 # Node dependencies
├── tsconfig.json                # TypeScript config
├── wrangler.toml                # Cloudflare deployment config
│
├── migrations/                  # D1 database migrations
│   └── 0001_initial_schema.sql  # Initial schema
│
├── src/                         # Worker source code
│   ├── index.ts                 # Worker entry point
│   ├── crawlController.ts       # Durable Object
│   ├── bindings.d.ts            # Type definitions
│   ├── utils.ts                 # Shared utilities
│   ├── queue.ts                 # Queue management (NEW)
│   ├── rateLimit.ts             # Rate limiting (NEW)
│   ├── bloomFilter.ts           # Bloom filter (NEW)
│   ├── auth.ts                  # Authentication (NEW)
│   └── storage.ts               # R2/D1 helpers (NEW)
│
├── crawler/                     # Container crawler (NEW)
│   ├── Dockerfile               # Container build
│   ├── requirements.txt         # Python dependencies
│   ├── spider.py                # Main spider logic
│   ├── config.py                # Configuration
│   └── docker-compose.yml       # Local orchestration
│
└── tests/                       # Test suite (NEW)
    ├── unit/                    # Unit tests
    └── integration/             # Integration tests
```

---

## Cloudflare Resource Requirements

### Required Resources

| Resource | Purpose | Estimated Usage |
|----------|---------|-----------------|
| **Workers** | API & Scheduler | ~1M requests/month free tier |
| **Durable Objects** | State management | Per-request pricing |
| **R2 Storage** | Raw content | ~10GB for 100k pages |
| **D1 Database** | Metadata | ~100MB for 100k pages |

### Setup Commands

```bash
# Create D1 database
npx wrangler d1 create crawl-db

# Create R2 bucket
npx wrangler r2 bucket create crawl-content

# Create KV namespace (optional)
npx wrangler kv:namespace create VISITED_KV

# Set secrets
npx wrangler secret put API_TOKEN

# Deploy
npx wrangler deploy
```

---

## Estimated Effort

| Phase | Complexity | Estimated Effort |
|-------|------------|------------------|
| Phase 1: Core Infrastructure | Medium | 20-30 hours |
| Phase 2: Crawler Containers | Medium | 15-20 hours |
| Phase 3: Rate Limiting | Medium | 10-15 hours |
| Phase 4: Authentication | Low-Medium | 8-12 hours |
| Phase 5: Monitoring | Medium | 10-15 hours |
| Phase 6: External Integrations | High | 15-25 hours |

**Total estimated effort**: 78-117 hours for full implementation

---

## Immediate Next Steps

1. **Create D1 Schema** (`migrations/0001_initial_schema.sql`)
2. **Implement Queue Logic** in `crawlController.ts`
3. **Build Crawler Container** with basic spider
4. **Test End-to-End Flow** locally with `wrangler dev`

---

## Configuration Placeholders

The following values need to be configured before deployment:

### wrangler.toml
```toml
account_id = "<YOUR_CLOUDFLARE_ACCOUNT_ID>"
zone_id = "<YOUR_ZONE_ID>"  # Optional, for custom domains
```

### Secrets (via wrangler secret put)
```
API_TOKEN          # Authentication token for crawlers
POSTGRES_URL       # Optional: External Postgres connection string
```

### Environment Variables
```
DEFAULT_BATCH_SIZE=100      # URLs per batch
DEFAULT_RATE_LIMIT=2        # Seconds between domain requests
MAX_DEPTH=5                 # Maximum crawl depth
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Durable Object state loss | Periodic backup to D1 |
| Rate limit violations | Conservative defaults + monitoring |
| Memory exhaustion | Bloom filter + pagination |
| Container failures | Auto-restart + dead letter queue |
| API abuse | Authentication + rate limiting |

---

*Document created: $(date)*
*Last updated: Phase 1 planning complete*
