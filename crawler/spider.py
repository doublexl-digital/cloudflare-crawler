#!/usr/bin/env python3
"""
Cloudflare Crawler - Main Spider

This spider:
1. Requests a batch of URLs from the Cloudflare Worker API
2. Fetches each page with configurable settings
3. Extracts content, links, and metadata
4. Reports results back to the Worker API
5. Repeats until no more work available

Usage:
    API_URL=https://your-worker.workers.dev API_TOKEN=xxx python spider.py
"""

import asyncio
import hashlib
import logging
import sys
import time
from dataclasses import dataclass
from typing import List, Optional, Set
from urllib.parse import urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup

from config import CrawlerConfig, get_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


@dataclass
class CrawlResult:
    """Result of crawling a single URL."""
    url: str
    success: bool
    http_status: Optional[int] = None
    content_type: Optional[str] = None
    content_length: Optional[int] = None
    content_hash: Optional[str] = None
    title: Optional[str] = None
    html: Optional[str] = None
    links: List[str] = None
    error_message: Optional[str] = None
    fetch_time_ms: int = 0

    def __post_init__(self):
        if self.links is None:
            self.links = []


class CloudflareCrawler:
    """Main crawler class that coordinates with Cloudflare Worker."""

    def __init__(self, config: CrawlerConfig):
        self.config = config
        self.session: Optional[aiohttp.ClientSession] = None
        self.stats = {
            'pages_crawled': 0,
            'pages_failed': 0,
            'links_discovered': 0,
            'bytes_downloaded': 0,
        }

    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.request_timeout),
            headers={
                'User-Agent': self.config.user_agent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()

    async def request_work(self) -> List[str]:
        """Request a batch of URLs from the Worker API."""
        url = f"{self.config.api_url}/api/request-work"
        payload = {
            'runId': self.config.run_id,
            'batchSize': self.config.batch_size,
        }
        headers = {
            'Authorization': f'Bearer {self.config.api_token}',
            'Content-Type': 'application/json',
        }

        try:
            async with self.session.post(url, json=payload, headers=headers) as resp:
                if resp.status != 200:
                    logger.error(f"Failed to request work: HTTP {resp.status}")
                    return []
                data = await resp.json()
                return data.get('urls', [])
        except Exception as e:
            logger.error(f"Error requesting work: {e}")
            return []

    async def report_result(self, result: CrawlResult) -> bool:
        """Report a crawl result back to the Worker API."""
        url = f"{self.config.api_url}/api/report-result"
        payload = {
            'runId': self.config.run_id,
            'url': result.url,
            'status': result.http_status or 0,
            'contentHash': result.content_hash,
            'contentSize': result.content_length,
            'discoveredUrls': result.links,
            'error': result.error_message,
            'fetchedAt': int(time.time() * 1000),
        }
        # Include HTML content for R2 storage (Worker handles upload)
        if result.html and result.success:
            payload['content'] = result.html
        headers = {
            'Authorization': f'Bearer {self.config.api_token}',
            'Content-Type': 'application/json',
        }

        try:
            async with self.session.post(url, json=payload, headers=headers) as resp:
                if resp.status != 200:
                    logger.warning(f"Failed to report result for {result.url}: HTTP {resp.status}")
                    return False
                return True
        except Exception as e:
            logger.error(f"Error reporting result: {e}")
            return False

    async def crawl_url(self, url: str) -> CrawlResult:
        """Crawl a single URL and extract content/links."""
        start_time = time.time()

        try:
            async with self.session.get(url, allow_redirects=True) as resp:
                fetch_time_ms = int((time.time() - start_time) * 1000)

                # Check content type
                content_type = resp.headers.get('Content-Type', '')
                if not any(ct in content_type for ct in self.config.allowed_content_types):
                    return CrawlResult(
                        url=url,
                        success=False,
                        http_status=resp.status,
                        content_type=content_type,
                        error_message=f"Skipped: unsupported content type {content_type}",
                        fetch_time_ms=fetch_time_ms,
                    )

                # Check content length
                content_length = int(resp.headers.get('Content-Length', 0))
                if content_length > self.config.max_content_length:
                    return CrawlResult(
                        url=url,
                        success=False,
                        http_status=resp.status,
                        content_type=content_type,
                        content_length=content_length,
                        error_message=f"Skipped: content too large ({content_length} bytes)",
                        fetch_time_ms=fetch_time_ms,
                    )

                # Read and parse HTML
                html = await resp.text()
                content_hash = hashlib.sha256(html.encode()).hexdigest()

                # Extract title and links
                soup = BeautifulSoup(html, 'lxml')
                title = soup.title.string if soup.title else None

                # Extract links
                links = self._extract_links(url, soup)

                self.stats['pages_crawled'] += 1
                self.stats['bytes_downloaded'] += len(html)
                self.stats['links_discovered'] += len(links)

                return CrawlResult(
                    url=url,
                    success=True,
                    http_status=resp.status,
                    content_type=content_type,
                    content_length=len(html),
                    content_hash=content_hash,
                    title=title,
                    html=html,
                    links=links,
                    fetch_time_ms=fetch_time_ms,
                )

        except asyncio.TimeoutError:
            self.stats['pages_failed'] += 1
            return CrawlResult(
                url=url,
                success=False,
                error_message="Request timed out",
                fetch_time_ms=int((time.time() - start_time) * 1000),
            )
        except Exception as e:
            self.stats['pages_failed'] += 1
            return CrawlResult(
                url=url,
                success=False,
                error_message=str(e),
                fetch_time_ms=int((time.time() - start_time) * 1000),
            )

    def _extract_links(self, base_url: str, soup: BeautifulSoup) -> List[str]:
        """Extract and normalize links from HTML."""
        links: Set[str] = set()
        base_domain = urlparse(base_url).netloc

        for anchor in soup.find_all('a', href=True):
            href = anchor['href']

            # Skip non-http links
            if href.startswith(('javascript:', 'mailto:', 'tel:', '#')):
                continue

            # Resolve relative URLs
            absolute_url = urljoin(base_url, href)

            # Parse and validate
            parsed = urlparse(absolute_url)
            if parsed.scheme not in ('http', 'https'):
                continue

            # Normalize: remove fragment, lowercase domain
            normalized = f"{parsed.scheme}://{parsed.netloc.lower()}{parsed.path}"
            if parsed.query:
                normalized += f"?{parsed.query}"

            links.add(normalized)

        return list(links)

    async def run(self):
        """Main crawl loop."""
        logger.info(f"Starting crawler for run: {self.config.run_id}")
        logger.info(f"API URL: {self.config.api_url}")
        logger.info(f"Batch size: {self.config.batch_size}")

        empty_batches = 0
        max_empty_batches = 3  # Stop after 3 consecutive empty batches

        while empty_batches < max_empty_batches:
            # Request work
            urls = await self.request_work()

            if not urls:
                empty_batches += 1
                logger.info(f"No work available (attempt {empty_batches}/{max_empty_batches})")
                await asyncio.sleep(5)  # Wait before retrying
                continue

            empty_batches = 0  # Reset counter
            logger.info(f"Received {len(urls)} URLs to crawl")

            # Crawl URLs concurrently
            tasks = [self.crawl_url(url) for url in urls]
            results = await asyncio.gather(*tasks)

            # Report results
            for result in results:
                await self.report_result(result)

                # Rate limiting between reports
                if self.config.download_delay > 0:
                    await asyncio.sleep(self.config.download_delay)

            logger.info(f"Stats: crawled={self.stats['pages_crawled']}, "
                       f"failed={self.stats['pages_failed']}, "
                       f"links={self.stats['links_discovered']}")

        logger.info("Crawler finished - no more work available")
        logger.info(f"Final stats: {self.stats}")


async def main():
    """Entry point."""
    try:
        config = get_config()
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        sys.exit(1)

    async with CloudflareCrawler(config) as crawler:
        await crawler.run()


if __name__ == '__main__':
    asyncio.run(main())
