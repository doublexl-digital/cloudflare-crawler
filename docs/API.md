# Cloudflare Crawler API Documentation

**Version:** 2.0.0
**Base URL:** `https://your-worker.workers.dev`

This document provides comprehensive API documentation for frontend integration with the Cloudflare Crawler backend.

## Table of Contents

1. [Authentication](#authentication)
2. [Response Format](#response-format)
3. [Error Handling](#error-handling)
4. [Endpoints](#endpoints)
   - [Health & Info](#health--info)
   - [Configurations](#configurations)
   - [Runs](#runs)
   - [Pages & Content](#pages--content)
   - [Errors](#errors)
5. [WebSocket Events](#websocket-events)
6. [Frontend Integration Guide](#frontend-integration-guide)

---

## Authentication

All API requests require a Bearer token when `API_TOKEN` is configured:

```http
Authorization: Bearer <your-api-token>
```

**CORS:** The API supports cross-origin requests with the following headers:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`

---

## Response Format

All responses follow a consistent JSON structure:

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "total": 100,
    "offset": 0,
    "limit": 50,
    "hasMore": true
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { ... }
  }
}
```

---

## Error Handling

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_REQUEST` | 400 | Missing or invalid request parameters |
| `UNAUTHORIZED` | 401 | Invalid or missing API token |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFIG_NOT_FOUND` | 404 | Configuration not found |
| `CONFIG_IN_USE` | 409 | Configuration is in use by active runs |
| `RUN_NOT_FOUND` | 404 | Run not found |
| `RUN_ALREADY_RUNNING` | 400 | Run is already active |
| `RUN_NOT_RUNNING` | 400 | Run is not active |
| `RUN_COMPLETED` | 400 | Run has already finished |
| `INVALID_RUN_STATE` | 400 | Invalid state transition |
| `CONTENT_NOT_FOUND` | 404 | Content not found in R2 |
| `INTERNAL_ERROR` | 500 | Internal server error |

---

## Endpoints

### Health & Info

#### GET /health

Health check endpoint.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": 1702656000000,
    "version": "2.0.0",
    "environment": "production"
  }
}
```

#### GET /api/info

Get API capabilities and limits.

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "Cloudflare Crawler API",
    "version": "2.0.0",
    "capabilities": {
      "configurations": true,
      "runs": true,
      "browserRendering": false,
      "queues": false
    },
    "limits": {
      "maxQueueSize": 100000,
      "maxBatchSize": 100,
      "maxContentSize": 10485760,
      "maxDepth": 50
    }
  }
}
```

---

### Configurations

Configurations define crawl behavior and can be reused across multiple runs.

#### GET /api/configs

List all configurations.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max items to return |
| `offset` | number | 0 | Pagination offset |
| `search` | string | - | Search by name/description |

**Response:**
```json
{
  "success": true,
  "data": {
    "configs": [
      {
        "id": "default",
        "name": "Default Configuration",
        "description": "Standard crawl configuration",
        "rateLimiting": { ... },
        "contentFiltering": { ... },
        "crawlBehavior": { ... },
        "domainScope": { ... },
        "rendering": { ... },
        "createdAt": 1702656000000,
        "updatedAt": 1702656000000
      }
    ]
  },
  "meta": {
    "total": 5,
    "offset": 0,
    "limit": 50,
    "hasMore": false
  }
}
```

#### GET /api/configs/:id

Get a specific configuration.

**Response:** Single configuration object.

#### POST /api/configs

Create a new configuration.

**Request Body:**
```json
{
  "name": "Aggressive Crawl",
  "description": "Fast crawling with minimal delays",
  "rateLimiting": {
    "minDomainDelayMs": 500,
    "maxConcurrentRequests": 32
  },
  "crawlBehavior": {
    "maxDepth": 5,
    "defaultBatchSize": 50
  },
  "domainScope": {
    "allowedDomains": ["example.com"],
    "includeSubdomains": true
  }
}
```

**Configuration Options:**

<details>
<summary><strong>rateLimiting</strong> - Rate limiting settings</summary>

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `minDomainDelayMs` | number | 1000 | Minimum delay between requests to same domain (ms) |
| `maxDomainDelayMs` | number | 60000 | Maximum backoff delay after errors (ms) |
| `errorBackoffMultiplier` | number | 2 | Multiplier for exponential backoff |
| `jitterFactor` | number | 0.1 | Random jitter factor (0-1) |
| `maxConcurrentRequests` | number | 16 | Max concurrent requests per container |
| `globalRateLimitPerMinute` | number | 0 | Global rate limit (0 = unlimited) |

</details>

<details>
<summary><strong>contentFiltering</strong> - Content filtering settings</summary>

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxContentSizeBytes` | number | 10485760 | Maximum content size (10MB) |
| `allowedContentTypes` | string[] | ["text/html", "application/xhtml+xml"] | Allowed MIME types |
| `excludedExtensions` | string[] | [".pdf", ".zip", ...] | File extensions to exclude |
| `skipBinaryFiles` | boolean | true | Skip binary files |
| `storeContent` | boolean | true | Store raw HTML in R2 |
| `extractText` | boolean | false | Extract text-only version |

</details>

<details>
<summary><strong>crawlBehavior</strong> - Crawl behavior settings</summary>

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxDepth` | number | 10 | Maximum link depth from seeds |
| `maxQueueSize` | number | 100000 | Maximum URLs in queue |
| `maxPagesPerRun` | number | 0 | Max pages per run (0 = unlimited) |
| `defaultBatchSize` | number | 10 | Batch size for work requests |
| `requestTimeoutMs` | number | 30000 | Request timeout (ms) |
| `retryCount` | number | 3 | Number of retries |
| `respectRobotsTxt` | boolean | true | Respect robots.txt |
| `followRedirects` | boolean | true | Follow HTTP redirects |
| `maxRedirects` | number | 5 | Maximum redirects to follow |
| `userAgent` | string | "CloudflareCrawler/1.0" | User agent string |
| `customHeaders` | object | {} | Custom HTTP headers |
| `followLinks` | boolean | true | Follow discovered links |
| `sameDomainOnly` | boolean | true | Only follow same-domain links |

</details>

<details>
<summary><strong>domainScope</strong> - Domain scope settings</summary>

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowedDomains` | string[] | [] | Allowed domains (empty = all) |
| `blockedDomains` | string[] | [] | Blocked domains |
| `includePatterns` | string[] | [] | URL patterns to include (regex) |
| `excludePatterns` | string[] | [] | URL patterns to exclude (regex) |
| `includeSubdomains` | boolean | true | Include subdomains of allowed |

</details>

<details>
<summary><strong>rendering</strong> - Browser rendering settings</summary>

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | false | Enable browser rendering |
| `waitForLoad` | boolean | true | Wait for page load |
| `waitAfterLoadMs` | number | 0 | Additional wait time (ms) |
| `viewportWidth` | number | 1920 | Viewport width |
| `viewportHeight` | number | 1080 | Viewport height |
| `captureScreenshots` | boolean | false | Capture screenshots |
| `screenshotFormat` | string | "png" | Screenshot format |

</details>

#### PUT/PATCH /api/configs/:id

Update a configuration. Supports partial updates.

#### DELETE /api/configs/:id

Delete a configuration. Cannot delete if in use by active runs.

---

### Runs

Runs represent individual crawl sessions with their own state and statistics.

#### GET /api/runs

List all runs.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max items to return |
| `offset` | number | 0 | Pagination offset |
| `status` | string | - | Filter by status (comma-separated) |
| `search` | string | - | Search by name/ID |
| `sortBy` | string | createdAt | Sort field (createdAt, startedAt, name, status) |
| `sortOrder` | string | desc | Sort order (asc, desc) |

**Run Statuses:**
- `pending` - Created but not started
- `running` - Actively crawling
- `paused` - Temporarily paused
- `completed` - Successfully finished
- `failed` - Stopped due to errors
- `cancelled` - Manually cancelled

**Response:**
```json
{
  "success": true,
  "data": {
    "runs": [
      {
        "id": "lxyz123-abc456",
        "name": "Example.com Full Crawl",
        "description": "Complete site crawl",
        "config_id": "default",
        "seed_urls": "[\"https://example.com\"]",
        "status": "running",
        "urls_queued": 1500,
        "urls_fetched": 750,
        "urls_failed": 5,
        "bytes_downloaded": 15728640,
        "started_at": 1702656000000,
        "created_at": 1702655000000
      }
    ]
  },
  "meta": {
    "total": 10,
    "offset": 0,
    "limit": 50,
    "hasMore": false
  }
}
```

#### POST /api/runs

Create a new crawl run.

**Request Body:**
```json
{
  "name": "Example.com Crawl",
  "description": "Full site crawl",
  "configId": "default",
  "seedUrls": [
    "https://example.com",
    "https://example.com/products"
  ],
  "autoStart": true
}
```

Or with inline configuration:
```json
{
  "name": "Custom Crawl",
  "seedUrls": ["https://example.com"],
  "config": {
    "name": "Inline Config",
    "crawlBehavior": {
      "maxDepth": 3
    }
  },
  "autoStart": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Run name |
| `description` | string | No | Run description |
| `configId` | string | No | Existing config ID (default: "default") |
| `config` | object | No | Inline configuration |
| `seedUrls` | string[] | Yes | Initial URLs to crawl |
| `autoStart` | boolean | No | Start immediately (default: false) |

#### GET /api/runs/:id

Get run details with real-time statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "lxyz123-abc456",
    "name": "Example.com Crawl",
    "status": "running",
    "seedUrls": ["https://example.com"],
    "realTimeStats": {
      "urlsQueued": 1500,
      "urlsFetched": 750,
      "urlsFailed": 5,
      "bytesDownloaded": 15728640,
      "domainsDiscovered": 1,
      "queueSize": 745,
      "visitedCount": 755,
      "avgResponseTimeMs": 234,
      "pagesPerMinute": 45.2,
      "lastActivityAt": 1702657000000
    },
    "progress": {
      "percentage": 50,
      "estimatedSecondsRemaining": 990,
      "currentDepth": 3,
      "activeDomains": ["example.com"],
      "recentErrors": []
    },
    "domainBreakdown": [
      {
        "domain": "example.com",
        "pagesCount": 750,
        "bytesDownloaded": 15728640,
        "errorCount": 5,
        "avgResponseTimeMs": 234,
        "lastFetchedAt": 1702657000000
      }
    ]
  }
}
```

#### POST /api/runs/:id/start

Start a pending run.

#### POST /api/runs/:id/pause

Pause a running crawl.

#### POST /api/runs/:id/resume

Resume a paused crawl.

#### POST /api/runs/:id/cancel

Cancel a running or paused crawl.

#### POST /api/runs/:id/seed

Add additional seed URLs to an existing run.

**Request Body:**
```json
{
  "urls": ["https://example.com/new-section"],
  "priority": 10
}
```

#### POST /api/runs/:id/reset

Reset run state (clear queue, visited URLs, statistics).

#### DELETE /api/runs/:id

Delete a run and all associated data.

---

### Pages & Content

#### GET /api/pages

List crawled pages.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max items to return |
| `offset` | number | 0 | Pagination offset |
| `runId` | string | - | Filter by run ID |
| `domain` | string | - | Filter by domain |
| `status` | string | - | Filter by HTTP status (comma-separated) |
| `sortBy` | string | fetchedAt | Sort field |
| `sortOrder` | string | desc | Sort order |

**Response:**
```json
{
  "success": true,
  "data": {
    "pages": [
      {
        "id": 1,
        "url": "https://example.com/page",
        "domain": "example.com",
        "status": 200,
        "content_hash": "abc123...",
        "content_size": 15234,
        "fetched_at": 1702657000000,
        "response_time_ms": 234,
        "run_id": "lxyz123-abc456"
      }
    ]
  },
  "meta": {
    "limit": 50,
    "offset": 0
  }
}
```

#### GET /api/content/:key

Retrieve raw HTML content from R2.

**URL Parameters:**
- `key` - R2 key (format: `{runId}/{domain}/{hash}.html`)

**Response:** Raw HTML content with `Content-Type: text/html`

#### GET /api/stats

Get crawl statistics.

**Query Parameters:**
- `runId` - Run ID (default: "default")

**Response:**
```json
{
  "success": true,
  "run": {
    "id": "lxyz123-abc456",
    "status": "running",
    "startedAt": 1702656000000
  },
  "stats": { ... },
  "progress": { ... },
  "domainBreakdown": [ ... ]
}
```

---

### Errors

#### GET /api/errors

List crawl errors.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `runId` | string | - | Filter by run ID |
| `limit` | number | 50 | Max items to return |
| `offset` | number | 0 | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": {
    "errors": [
      {
        "id": 1,
        "run_id": "lxyz123-abc456",
        "url": "https://example.com/404",
        "domain": "example.com",
        "status_code": 404,
        "message": "Not Found",
        "created_at": 1702657000000
      }
    ]
  }
}
```

---

## Frontend Integration Guide

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Application                     │
├─────────────────────────────────────────────────────────────┤
│  Components                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ ConfigEditor │ │  RunManager  │ │    StatsDisplay      │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  State Management (React Query / Zustand / Redux)           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ • configs[]  • runs[]  • selectedRunId  • pollInterval  ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│  API Client                                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ crawlerApi.ts - Typed API client with error handling    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### TypeScript API Client Example

```typescript
// api/crawlerApi.ts
import type {
  APIResponse,
  CrawlConfig,
  CrawlRun,
  CreateConfigRequest,
  CreateRunRequest,
} from '../types';

const API_BASE = 'https://your-worker.workers.dev';
const API_TOKEN = 'your-token';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_TOKEN}`,
      ...options.headers,
    },
  });

  const data: APIResponse<T> = await response.json();

  if (!data.success) {
    throw new Error(data.error?.message || 'API request failed');
  }

  return data.data!;
}

export const crawlerApi = {
  // Configurations
  listConfigs: (params?: { limit?: number; offset?: number; search?: string }) =>
    request<{ configs: CrawlConfig[] }>(`/api/configs?${new URLSearchParams(params as any)}`),

  getConfig: (id: string) =>
    request<CrawlConfig>(`/api/configs/${id}`),

  createConfig: (config: CreateConfigRequest) =>
    request<CrawlConfig>('/api/configs', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  updateConfig: (id: string, updates: Partial<CreateConfigRequest>) =>
    request<CrawlConfig>(`/api/configs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  deleteConfig: (id: string) =>
    request<{ deleted: boolean }>(`/api/configs/${id}`, { method: 'DELETE' }),

  // Runs
  listRuns: (params?: { status?: string; limit?: number }) =>
    request<{ runs: CrawlRun[] }>(`/api/runs?${new URLSearchParams(params as any)}`),

  createRun: (run: CreateRunRequest) =>
    request<CrawlRun>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(run),
    }),

  getRun: (id: string) =>
    request<CrawlRun>(`/api/runs/${id}`),

  startRun: (id: string) =>
    request<{ status: string }>(`/api/runs/${id}/start`, { method: 'POST' }),

  pauseRun: (id: string) =>
    request<{ status: string }>(`/api/runs/${id}/pause`, { method: 'POST' }),

  resumeRun: (id: string) =>
    request<{ status: string }>(`/api/runs/${id}/resume`, { method: 'POST' }),

  cancelRun: (id: string) =>
    request<{ status: string }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
};
```

### Real-time Polling Example

```typescript
// hooks/useRunStats.ts
import { useQuery } from '@tanstack/react-query';
import { crawlerApi } from '../api/crawlerApi';

export function useRunStats(runId: string, enabled = true) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => crawlerApi.getRun(runId),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 2s when running, 10s when paused, stop when done
      if (status === 'running') return 2000;
      if (status === 'paused') return 10000;
      return false;
    },
  });
}
```

### Form Validation Schema (Zod)

```typescript
import { z } from 'zod';

export const createRunSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  configId: z.string().optional(),
  seedUrls: z.array(z.string().url('Invalid URL')).min(1, 'At least one URL is required'),
  autoStart: z.boolean().default(false),
});

export const rateLimitSchema = z.object({
  minDomainDelayMs: z.number().min(100).max(60000),
  maxDomainDelayMs: z.number().min(1000).max(300000),
  errorBackoffMultiplier: z.number().min(1).max(10),
  jitterFactor: z.number().min(0).max(1),
  maxConcurrentRequests: z.number().min(1).max(100),
  globalRateLimitPerMinute: z.number().min(0).max(10000),
});
```

### UI Component Suggestions

1. **Configuration Editor**
   - Accordion/tabs for each configuration section
   - Preset buttons (Aggressive, Standard, Polite)
   - Real-time validation with helpful error messages
   - Preview of effective settings

2. **Run Dashboard**
   - Progress bar with ETA
   - Live stats counters (animated numbers)
   - Domain breakdown chart
   - Error log with expandable details
   - Action buttons (Start/Pause/Resume/Cancel)

3. **Pages Browser**
   - Filterable table with virtual scrolling
   - Status code badges (color-coded)
   - Quick content preview modal
   - Export to CSV/JSON

---

## Migration Notes

### Breaking Changes from v1

1. All responses now wrapped in `{ success: true, data: ... }` format
2. Configuration is now stored in D1 and applied per-run
3. Stats endpoint returns enhanced metrics

### Backward Compatibility

The following v1 endpoints remain functional:
- `POST /api/seed`
- `POST /api/request-work`
- `POST /api/report-result`
- `GET /api/stats`
- `GET /api/pages`
- `GET /api/content/:key`

---

## Rate Limits

| Operation | Limit |
|-----------|-------|
| API requests | 1000/minute per IP |
| Configuration creates | 100/hour |
| Run creates | 50/hour |
| Seed URLs per request | 1000 |

---

## Support

For issues and feature requests, visit:
https://github.com/cloudflare-crawler/issues
