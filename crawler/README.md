# Cloudflare Crawler - Container

This directory contains the containerized crawler that works with the Cloudflare Worker control plane.

## Overview

The crawler:
1. Requests batches of URLs from the Worker API (`/api/request-work`)
2. Fetches pages using aiohttp with configurable concurrency
3. Extracts content, titles, and links using BeautifulSoup
4. Reports results back to the Worker API (`/api/report-result`)
5. Repeats until no more work is available

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A running Cloudflare Worker (use `npx wrangler dev` for local development)
- API token configured in the Worker

### Local Development

1. Start the Worker locally:
   ```bash
   cd .. && npx wrangler dev
   ```

2. Create a `.env` file:
   ```bash
   cat > .env << EOF
   API_URL=http://localhost:8787
   API_TOKEN=your-development-token
   RUN_ID=test-run-1
   BATCH_SIZE=10
   LOG_LEVEL=DEBUG
   EOF
   ```

3. Run the crawler:
   ```bash
   docker-compose up --build
   ```

### Production Deployment

#### Option 1: DigitalOcean Droplet

```bash
# SSH into your droplet
ssh root@your-droplet-ip

# Clone the repository
git clone https://github.com/your-repo/cloudflare-crawler.git
cd cloudflare-crawler/crawler

# Create production .env
cat > .env << EOF
API_URL=https://your-worker.workers.dev
API_TOKEN=your-production-token
RUN_ID=production-run
BATCH_SIZE=100
CONCURRENT_REQUESTS=16
LOG_LEVEL=INFO
EOF

# Run with multiple crawler instances
docker-compose up -d --scale crawler=5
```

#### Option 2: Cloudflare Containers (Experimental)

```bash
# Build and push to a registry
docker build -t your-registry/cloudflare-crawler:latest .
docker push your-registry/cloudflare-crawler:latest

# Deploy via Cloudflare Containers (when available)
# See: https://developers.cloudflare.com/containers/
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_URL` | Yes | - | Cloudflare Worker URL |
| `API_TOKEN` | Yes | - | Authentication token |
| `RUN_ID` | No | `default` | Crawl run identifier |
| `BATCH_SIZE` | No | `100` | URLs per batch request |
| `CONCURRENT_REQUESTS` | No | `16` | Parallel requests |
| `REQUEST_TIMEOUT` | No | `30` | Seconds before timeout |
| `DOWNLOAD_DELAY` | No | `0.5` | Seconds between domain requests |
| `RANDOMIZE_DELAY` | No | `true` | Add jitter to delays |
| `MAX_CONTENT_LENGTH` | No | `10485760` | Max page size (10MB) |
| `USER_AGENT` | No | `CloudflareCrawler/1.0` | HTTP User-Agent |
| `LOG_LEVEL` | No | `INFO` | Logging verbosity |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      spider.py                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│  │  request    │────▶│   crawl     │────▶│   report    │  │
│  │   work      │     │   urls      │     │   results   │  │
│  └─────────────┘     └─────────────┘     └─────────────┘  │
│         │                  │                    │          │
│         │                  │                    │          │
│         ▼                  ▼                    ▼          │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              aiohttp session                         │  │
│  │  • Concurrent requests                               │  │
│  │  • Automatic retries                                 │  │
│  │  • Timeout handling                                  │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Cloudflare Worker API
```

## Extending the Crawler

### Adding Playwright Support

For JavaScript-heavy sites, uncomment the Playwright dependencies in `requirements.txt` and `Dockerfile`, then modify `spider.py`:

```python
from playwright.async_api import async_playwright

async def crawl_url_with_js(self, url: str) -> CrawlResult:
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(url, wait_until='networkidle')
        html = await page.content()
        await browser.close()
        # ... rest of extraction
```

### Custom Extractors

Add custom data extraction by extending the `_extract_links` method:

```python
def _extract_metadata(self, soup: BeautifulSoup) -> dict:
    return {
        'description': soup.find('meta', {'name': 'description'})['content'] if soup.find('meta', {'name': 'description'}) else None,
        'keywords': soup.find('meta', {'name': 'keywords'})['content'] if soup.find('meta', {'name': 'keywords'}) else None,
        # Add more extractors...
    }
```

## Troubleshooting

### "No work available" immediately

- Ensure the Worker has seed URLs in the queue
- Check that `RUN_ID` matches the active crawl run
- Verify the API token is correct

### Connection refused

- For local development, ensure Wrangler is running
- Check that `API_URL` is correct
- Verify network connectivity between container and Worker

### Rate limiting errors

- Reduce `BATCH_SIZE` and `CONCURRENT_REQUESTS`
- Increase `DOWNLOAD_DELAY`
- Check target site's robots.txt

## Files

| File | Description |
|------|-------------|
| `Dockerfile` | Container build definition |
| `requirements.txt` | Python dependencies |
| `config.py` | Configuration management |
| `spider.py` | Main crawler logic |
| `docker-compose.yml` | Local orchestration |
