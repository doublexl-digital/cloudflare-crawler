"""
Cloudflare Crawler - Configuration

This module handles configuration from environment variables and defaults.
"""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class CrawlerConfig:
    """Configuration for the crawler."""

    # API Configuration
    api_url: str
    api_token: str
    run_id: str

    # Crawling Settings
    batch_size: int = 100
    concurrent_requests: int = 16
    request_timeout: int = 30
    retry_count: int = 3
    retry_delay: float = 1.0

    # Rate Limiting
    download_delay: float = 0.5  # Seconds between requests to same domain
    randomize_delay: bool = True

    # Content Settings
    max_content_length: int = 10 * 1024 * 1024  # 10MB max
    allowed_content_types: tuple = ('text/html', 'application/xhtml+xml')

    # User Agent
    user_agent: str = 'CloudflareCrawler/1.0 (+https://github.com/your-repo)'

    # Logging
    log_level: str = 'INFO'

    @classmethod
    def from_env(cls) -> 'CrawlerConfig':
        """Create configuration from environment variables."""
        api_url = os.getenv('API_URL')
        api_token = os.getenv('API_TOKEN')
        run_id = os.getenv('RUN_ID', 'default')

        if not api_url:
            raise ValueError('API_URL environment variable is required')
        if not api_token:
            raise ValueError('API_TOKEN environment variable is required')

        return cls(
            api_url=api_url,
            api_token=api_token,
            run_id=run_id,
            batch_size=int(os.getenv('BATCH_SIZE', '100')),
            concurrent_requests=int(os.getenv('CONCURRENT_REQUESTS', '16')),
            request_timeout=int(os.getenv('REQUEST_TIMEOUT', '30')),
            retry_count=int(os.getenv('RETRY_COUNT', '3')),
            retry_delay=float(os.getenv('RETRY_DELAY', '1.0')),
            download_delay=float(os.getenv('DOWNLOAD_DELAY', '0.5')),
            randomize_delay=os.getenv('RANDOMIZE_DELAY', 'true').lower() == 'true',
            max_content_length=int(os.getenv('MAX_CONTENT_LENGTH', str(10 * 1024 * 1024))),
            user_agent=os.getenv('USER_AGENT', 'CloudflareCrawler/1.0'),
            log_level=os.getenv('LOG_LEVEL', 'INFO'),
        )


# Singleton instance
_config: Optional[CrawlerConfig] = None


def get_config() -> CrawlerConfig:
    """Get the configuration singleton."""
    global _config
    if _config is None:
        _config = CrawlerConfig.from_env()
    return _config
