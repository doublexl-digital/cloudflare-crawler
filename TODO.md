# Project To‑Do List

This file collects outstanding tasks, ideas and improvements for the crawler platform.  Feel free to add or check off items as work progresses.

## Setup

- [ ] **Fill out `wrangler.toml`:**
  - Insert your Cloudflare account ID and project name.
  - Define bindings for your R2 bucket, D1 database and Durable Object.
- [ ] **Configure secrets:** Use `wrangler secret put` to provide any API keys, tokens or environment variables needed by the Worker (e.g. authentication tokens for containers).
- [ ] **Provision databases:** Create a D1 database instance for crawl metadata and consider provisioning an external Postgres database (Neon or DigitalOcean) for more advanced analytics.

## Worker and Durable Object

- [ ] **Implement the scheduler logic** in `src/index.ts`:
  - Register a cron trigger (e.g. every minute) to request a batch of URLs from the Durable Object and dispatch them to the crawler fleet.
  - Expose an HTTP API endpoint for containers to request work and report results.
- [ ] **Implement the Durable Object** in `src/crawlController.ts`:
  - Maintain persistent state including a queue of pending URLs, a set of visited URLs (use a bloom filter or D1), per‑domain rate limits and run metadata.
  - Provide methods to pop a batch of URLs, push new URLs, and update status.
- [ ] **Add type definitions** in `src/bindings.d.ts` for R2 bucket, D1 database and Durable Object bindings.
- [ ] **Write helper functions** in `src/utils.ts` for URL normalisation, domain extraction, rate limiting and deduplication.

## Containers (Scrapy / Playwright)

- [ ] **Create a container image** (e.g. `Dockerfile`) that installs Scrapy and optionally Scrapy‑Playwright.
- [ ] **Write a Scrapy spider** that:
  - Requests a batch of URLs from the Worker API.
  - Fetches each page (with or without headless browser depending on site).
  - Extracts content, links and other signals.
  - Posts new URLs and metadata back to the Worker API.
- [ ] **Implement error handling** and retry logic within the spider.
- [ ] **Add Playwright integration** for JavaScript‑heavy sites (optional initially).
- [ ] **Support running on DigitalOcean** via `docker run` or `docker-compose`, and optionally on Cloudflare Containers.

## Storage & Persistence

- [ ] **Store raw content** to R2: define key structure (e.g. `runId/domain/path/…`).
- [ ] **Persist metadata** to D1: create tables for pages (`url`, `status`, `hash`, `fetched_at`, etc.), links (`from_url`, `to_url`) and runs.
- [ ] **Synchronise visited sets**: maintain visited URL hashes either in memory (small runs) or in D1/R2 for durability.
- [ ] **Evaluate Bloom filter** vs. exact sets for deduplication.

## External Integrations (Future)

- [ ] **External Postgres**: Connect to Neon or DigitalOcean Postgres for analytics or full‑text search beyond D1’s capabilities.
- [ ] **Dashboard:** Build a small dashboard (perhaps using a Cloudflare Pages app) to view crawl stats and run progress.
- [ ] **Authentication & Security:** Protect the Worker API endpoints so only authorised containers can pull work and push results.

## Testing

- [ ] Write unit tests for `src/utils.ts` functions.
- [ ] Create integration tests that spin up a local Worker, Durable Object, and a dummy crawler that fetches pages from a test server.
- [ ] Use the `wrangler` preview service to simulate cron triggers and API calls.

## Documentation

- [ ] Extend the README with detailed usage instructions, including how to deploy containers and how to run a crawl.
- [ ] Provide examples of how to integrate a custom spider and where to configure rate limits.
