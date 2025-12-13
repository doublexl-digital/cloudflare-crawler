# Cloudflare Crawler Platform

This repository contains the scaffolding for a distributed crawling platform that uses **Cloudflare Workers** and **Durable Objects** for orchestration, and containerised crawlers (e.g. Scrapy, Playwright) for the heavy lifting.  It is designed to crawl up to ~100 k pages per run, persist results to Cloudflare R2 and D1, and optionally integrate with an external PostgreSQL database (Neon or DigitalOcean) for analytics.

## Architecture Overview

The high‑level architecture follows the **best** implementation pattern described during earlier discussions:

```
┌─────────────────────────┐
│ Cloudflare Worker       │   – Schedules crawls and provides an HTTP API
├─────────────────────────┤
│ Durable Object          │   – Maintains the crawl queue and state
└──────────┬──────────────┘
           │                        
           ▼
┌─────────────────────────┐
│ Crawl Fleet             │   – One or more containers running Scrapy or Playwright
│  • DigitalOcean         │     by default, with optional Cloudflare Containers
│  • Cloudflare Containers│     for experimental edge execution
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Storage                 │   – R2 for raw content, D1 for metadata, optional Postgres
└─────────────────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| **Scheduler (Worker)** | Cloudflare Worker with a cron trigger that initiates crawl runs, dispatches batches and enforces global rate limits. |
| **Crawl Controller (Durable Object)** | A durable object that stores pending and visited URLs, per-domain rate limits and run statistics.  It provides atomic queue operations and ensures strong consistency. |
| **Crawler Fleet** | Containerised crawlers (e.g. Scrapy or Scrapy‑Playwright) that pull work from the Durable Object via an API, fetch pages, extract content and links, and push new URLs back.  These containers run on DigitalOcean or Cloudflare Containers. |
| **Storage** | Cloudflare R2 stores raw HTML, JSON and other page artefacts.  Cloudflare D1 holds crawl metadata such as URL statuses, content hashes and timestamps.  An external Postgres database (Neon or DigitalOcean) can be added later for advanced analytics. |

## Repository Layout

```
crawler/
├── README.md         – this file
├── TODO.md           – remaining tasks and suggestions
├── wrangler.toml      – configuration for Cloudflare deployment
├── package.json      – Node package manifest with Wrangler and TypeScript dependencies
├── tsconfig.json     – TypeScript configuration
└── src
    ├── index.ts      – entry point for the Worker (schedules and API)
    ├── crawlController.ts – Durable Object implementation
    ├── bindings.d.ts – Type definitions for R2, D1 and Durable Object bindings
    └── utils.ts      – shared helper functions
```

## Getting Started

1. Install dependencies and build the project:
   ```bash
   npm install
   npm run build
   ```

2. Deploy locally using Wrangler:
   ```bash
   npx wrangler dev
   ```

3. Configure Cloudflare secrets and environment variables as described in [`wrangler.toml`](wrangler.toml).  At a minimum you will need your account ID and R2 bucket/D1 database bindings.

4. Provision your Durable Object namespace using Wrangler:
   ```bash
   npx wrangler d1 create my_crawl_db
   npx wrangler kv:namespace create CRAWLER_KV
   npx wrangler DO:namespace create CRAWL_CONTROLLER
   ```

## Deployment

To deploy to your Cloudflare account, run:

```bash
npx wrangler deploy
```

This will push the Worker script and Durable Object to Cloudflare.  Containers must be deployed separately (e.g. to DigitalOcean or Cloudflare Containers).  See [`TODO.md`](TODO.md) for guidance on container images and orchestration.

## License

This project is released under the MIT License.  See `LICENSE` for details.
