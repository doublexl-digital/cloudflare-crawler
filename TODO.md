# Project To-Do List

This file collects outstanding tasks, ideas and improvements for the crawler platform. Feel free to add or check off items as work progresses.

## Setup

- [x] **Fill out `wrangler.toml`:**
  - Insert your Cloudflare account ID and project name.
  - Define bindings for your R2 bucket, D1 database and Durable Object.
- [ ] **Configure secrets:** Use `wrangler secret put API_TOKEN` to provide the API token for authentication.
- [ ] **Provision databases:** Run `wrangler d1 execute <database-name> --file=./schema.sql` to create the D1 tables.

## Worker and Durable Object

- [x] **Implement the scheduler logic** in `src/index.ts`:
  - Register a cron trigger (daily at midnight) to perform maintenance tasks.
  - Expose HTTP API endpoints for containers to request work and report results.
  - Added endpoints: `/api/request-work`, `/api/report-result`, `/api/seed`, `/api/stats`, `/api/pages`, `/api/content/*`
- [x] **Implement the Durable Object** in `src/crawlController.ts`:
  - Maintain persistent state including a queue of pending URLs, a set of visited URLs, per-domain rate limits and run statistics.
  - Provide methods to pop a batch of URLs, push new URLs, seed initial URLs, and update status.
  - Exponential backoff on errors, domain rate limiting, priority queue.
- [x] **Add type definitions** in `src/bindings.d.ts` for R2 bucket, D1 database and Durable Object bindings.
- [x] **Write helper functions** in `src/utils.ts` for URL normalisation, domain extraction, rate limiting, link extraction and deduplication.

## Containers (Scrapy / Playwright)

- [x] **Create a container image** (`crawler/Dockerfile`) that installs dependencies for async crawling.
- [x] **Write a crawler spider** (`crawler/spider.py`) that:
  - Requests a batch of URLs from the Worker API.
  - Fetches each page asynchronously with aiohttp.
  - Extracts content, links and other signals with BeautifulSoup.
  - Posts new URLs and content back to the Worker API for R2 storage.
- [x] **Implement error handling** and retry logic within the spider.
- [ ] **Add Playwright integration** for JavaScript-heavy sites (optional - uncomment in requirements.txt and Dockerfile).
- [x] **Support running on DigitalOcean** via `docker run` or `docker-compose`.

## Storage & Persistence

- [x] **Store raw content** to R2: key structure is `{runId}/{domain}/{contentHash}.html`.
- [x] **Persist metadata** to D1: created tables for pages, links, runs and domains in `schema.sql`.
- [x] **Synchronise visited sets**: visited URL hashes stored in Durable Object state.
- [ ] **Evaluate Bloom filter** vs. exact sets for large-scale deduplication.

## External Integrations (Future)

- [ ] **External Postgres**: Connect to Neon or DigitalOcean Postgres for analytics or full-text search beyond D1's capabilities.
- [ ] **Dashboard:** Build a small dashboard (perhaps using a Cloudflare Pages app) to view crawl stats and run progress.
- [x] **Authentication & Security:** API endpoints protected with Bearer token authentication when `API_TOKEN` secret is configured.

## Testing

- [ ] Write unit tests for `src/utils.ts` functions.
- [ ] Create integration tests that spin up a local Worker, Durable Object, and a dummy crawler that fetches pages from a test server.
- [ ] Use the `wrangler dev` service to test API calls locally.

## Documentation

- [ ] Extend the README with detailed usage instructions, including how to deploy containers and how to run a crawl.
- [ ] Provide examples of how to integrate a custom spider and where to configure rate limits.

---

## Quick Start

1. **Deploy the D1 schema:**
   ```bash
   wrangler d1 execute <database-name> --file=./schema.sql
   ```

2. **Set the API token (optional but recommended):**
   ```bash
   wrangler secret put API_TOKEN
   ```

3. **Deploy the Worker:**
   ```bash
   npm run deploy
   ```

4. **Seed URLs to crawl:**
   ```bash
   curl -X POST https://your-worker.workers.dev/api/seed \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -d '{"urls": ["https://example.com"]}'
   ```

5. **Run the crawler container:**
   ```bash
   cd crawler
   docker build -t cloudflare-crawler .
   docker run -e API_URL=https://your-worker.workers.dev -e API_TOKEN=YOUR_TOKEN cloudflare-crawler
   ```

6. **Check crawl stats:**
   ```bash
   curl https://your-worker.workers.dev/api/stats \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```
