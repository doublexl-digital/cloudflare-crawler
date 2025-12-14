# Cloudflare Crawler - Container Image
#
# This Dockerfile creates a containerized crawler using Scrapy and optionally Playwright
# for JavaScript-heavy sites.
#
# Build: docker build -t cloudflare-crawler .
# Run:   docker run -e API_URL=https://your-worker.workers.dev -e API_TOKEN=xxx cloudflare-crawler

FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

# Install system dependencies for Scrapy and Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    libssl-dev \
    libxml2-dev \
    libxslt1-dev \
    zlib1g-dev \
    # Playwright dependencies (uncomment if using Playwright)
    # libnss3 \
    # libnspr4 \
    # libatk1.0-0 \
    # libatk-bridge2.0-0 \
    # libcups2 \
    # libdrm2 \
    # libdbus-1-3 \
    # libxkbcommon0 \
    # libxcomposite1 \
    # libxdamage1 \
    # libxfixes3 \
    # libxrandr2 \
    # libgbm1 \
    # libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (uncomment if using Playwright)
# RUN playwright install chromium
# RUN playwright install-deps chromium

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd -m -u 1000 crawler && chown -R crawler:crawler /app
USER crawler

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8080/health')" || exit 1

# Run the spider
CMD ["python", "spider.py"]
