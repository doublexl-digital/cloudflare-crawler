/*
 * Cloudflare Worker entry point
 *
 * This Worker provides:
 *  1. Configuration management API for crawl settings
 *  2. Run lifecycle management (create, start, pause, resume, cancel)
 *  3. Work distribution for crawler containers
 *  4. Content storage in R2 and metadata in D1
 */

import { CrawlController } from './crawlController';
import type {
  CrawlConfig,
  CreateConfigRequest,
  UpdateConfigRequest,
  CreateRunRequest,
  ListRunsRequest,
  ListPagesRequest,
  APIResponse,
  APIError,
  DEFAULT_CONFIG,
  ERROR_CODES,
} from './types';

// ============================================================================
// Environment Interface
// ============================================================================

export interface Env {
  CRAWL_CONTROLLER: DurableObjectNamespace;
  CRAWL_BUCKET: R2Bucket;
  CRAWL_DB: D1Database;
  VISITED_KV?: KVNamespace;
  API_TOKEN?: string;
  ENVIRONMENT?: string;
}

// Re-export the Durable Object class
export { CrawlController };

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG_VALUES = {
  rateLimiting: {
    minDomainDelayMs: 1000,
    maxDomainDelayMs: 60000,
    errorBackoffMultiplier: 2,
    jitterFactor: 0.1,
    maxConcurrentRequests: 16,
    globalRateLimitPerMinute: 0,
  },
  contentFiltering: {
    maxContentSizeBytes: 10 * 1024 * 1024,
    allowedContentTypes: ['text/html', 'application/xhtml+xml'],
    excludedExtensions: ['.pdf', '.zip', '.tar', '.gz', '.rar', '.exe', '.dmg', '.iso'],
    skipBinaryFiles: true,
    storeContent: true,
    extractText: false,
  },
  crawlBehavior: {
    maxDepth: 10,
    maxQueueSize: 100000,
    maxPagesPerRun: 0,
    defaultBatchSize: 10,
    requestTimeoutMs: 30000,
    retryCount: 3,
    respectRobotsTxt: true,
    followRedirects: true,
    maxRedirects: 5,
    userAgent: 'CloudflareCrawler/1.0 (+https://github.com/cloudflare-crawler)',
    customHeaders: {},
    followLinks: true,
    sameDomainOnly: true,
  },
  domainScope: {
    allowedDomains: [],
    blockedDomains: [],
    includePatterns: [],
    excludePatterns: [],
    includeSubdomains: true,
  },
  rendering: {
    enabled: false,
    waitForLoad: true,
    waitAfterLoadMs: 0,
    viewportWidth: 1920,
    viewportHeight: 1080,
    captureScreenshots: false,
    screenshotFormat: 'png' as const,
  },
};

// ============================================================================
// Response Helpers
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse<T>(data: APIResponse<T>, status = 200): Response {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

function successResponse<T>(data: T, meta?: APIResponse<T>['meta']): Response {
  return jsonResponse({ success: true, data, meta });
}

function errorResponse(code: string, message: string, status = 400, details?: Record<string, unknown>): Response {
  return jsonResponse({ success: false, error: { code, message, details } }, status);
}

// ============================================================================
// Main Worker
// ============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Optional: API token authentication
    if (env.API_TOKEN) {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.replace('Bearer ', '');
      if (token !== env.API_TOKEN) {
        return errorResponse('UNAUTHORIZED', 'Invalid or missing API token', 401);
      }
    }

    try {
      // ========================================
      // Health & Info
      // ========================================
      if (path === '/health' && method === 'GET') {
        return successResponse({
          status: 'ok',
          timestamp: Date.now(),
          version: '2.0.0',
          environment: env.ENVIRONMENT || 'production',
        });
      }

      if (path === '/api/info' && method === 'GET') {
        return successResponse({
          name: 'Cloudflare Crawler API',
          version: '2.0.0',
          capabilities: {
            configurations: true,
            runs: true,
            browserRendering: false,
            queues: false,
          },
          limits: {
            maxQueueSize: 100000,
            maxBatchSize: 100,
            maxContentSize: 10 * 1024 * 1024,
            maxDepth: 50,
          },
        });
      }

      // ========================================
      // Configuration API
      // ========================================

      // List configurations
      if (path === '/api/configs' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const search = url.searchParams.get('search') || '';

        let query = 'SELECT * FROM configurations';
        const params: any[] = [];

        if (search) {
          query += ' WHERE name LIKE ? OR description LIKE ?';
          params.push(`%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.CRAWL_DB.prepare(query).bind(...params).all();

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM configurations';
        if (search) {
          countQuery += ' WHERE name LIKE ? OR description LIKE ?';
        }
        const countResult = await env.CRAWL_DB.prepare(countQuery)
          .bind(...(search ? [`%${search}%`, `%${search}%`] : []))
          .first<{ total: number }>();

        const configs = result.results.map(parseConfigFromDB);

        return successResponse(
          { configs },
          { total: countResult?.total || 0, offset, limit, hasMore: offset + configs.length < (countResult?.total || 0) }
        );
      }

      // Get single configuration
      if (path.match(/^\/api\/configs\/[\w-]+$/) && method === 'GET') {
        const configId = path.split('/').pop()!;
        const result = await env.CRAWL_DB.prepare('SELECT * FROM configurations WHERE id = ?')
          .bind(configId)
          .first();

        if (!result) {
          return errorResponse('CONFIG_NOT_FOUND', `Configuration '${configId}' not found`, 404);
        }

        return successResponse(parseConfigFromDB(result));
      }

      // Create configuration
      if (path === '/api/configs' && method === 'POST') {
        const body = await request.json() as CreateConfigRequest;

        if (!body.name) {
          return errorResponse('INVALID_REQUEST', 'Configuration name is required');
        }

        const configId = generateId();
        const now = Date.now();
        const config = buildConfig(configId, body, now);

        await env.CRAWL_DB.prepare(
          `INSERT INTO configurations (id, name, description, rate_limiting, content_filtering, crawl_behavior, domain_scope, rendering, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            config.id,
            config.name,
            config.description || null,
            JSON.stringify(config.rateLimiting),
            JSON.stringify(config.contentFiltering),
            JSON.stringify(config.crawlBehavior),
            JSON.stringify(config.domainScope),
            JSON.stringify(config.rendering),
            now,
            now
          )
          .run();

        return successResponse(config);
      }

      // Update configuration
      if (path.match(/^\/api\/configs\/[\w-]+$/) && (method === 'PUT' || method === 'PATCH')) {
        const configId = path.split('/').pop()!;
        const body = await request.json() as Partial<CreateConfigRequest>;

        // Get existing config
        const existing = await env.CRAWL_DB.prepare('SELECT * FROM configurations WHERE id = ?')
          .bind(configId)
          .first();

        if (!existing) {
          return errorResponse('CONFIG_NOT_FOUND', `Configuration '${configId}' not found`, 404);
        }

        const existingConfig = parseConfigFromDB(existing);
        const now = Date.now();

        // Merge updates
        const updated: CrawlConfig = {
          ...existingConfig,
          name: body.name || existingConfig.name,
          description: body.description ?? existingConfig.description,
          rateLimiting: { ...existingConfig.rateLimiting, ...body.rateLimiting },
          contentFiltering: { ...existingConfig.contentFiltering, ...body.contentFiltering },
          crawlBehavior: { ...existingConfig.crawlBehavior, ...body.crawlBehavior },
          domainScope: { ...existingConfig.domainScope, ...body.domainScope },
          rendering: { ...existingConfig.rendering, ...body.rendering },
          updatedAt: now,
        };

        await env.CRAWL_DB.prepare(
          `UPDATE configurations SET
           name = ?, description = ?, rate_limiting = ?, content_filtering = ?,
           crawl_behavior = ?, domain_scope = ?, rendering = ?, updated_at = ?
           WHERE id = ?`
        )
          .bind(
            updated.name,
            updated.description || null,
            JSON.stringify(updated.rateLimiting),
            JSON.stringify(updated.contentFiltering),
            JSON.stringify(updated.crawlBehavior),
            JSON.stringify(updated.domainScope),
            JSON.stringify(updated.rendering),
            now,
            configId
          )
          .run();

        return successResponse(updated);
      }

      // Delete configuration
      if (path.match(/^\/api\/configs\/[\w-]+$/) && method === 'DELETE') {
        const configId = path.split('/').pop()!;

        if (configId === 'default') {
          return errorResponse('INVALID_REQUEST', 'Cannot delete the default configuration');
        }

        // Check if in use by any runs
        const inUse = await env.CRAWL_DB.prepare(
          'SELECT COUNT(*) as count FROM runs WHERE config_id = ? AND status IN (?, ?, ?)'
        )
          .bind(configId, 'pending', 'running', 'paused')
          .first<{ count: number }>();

        if (inUse && inUse.count > 0) {
          return errorResponse('CONFIG_IN_USE', 'Configuration is in use by active runs', 409);
        }

        await env.CRAWL_DB.prepare('DELETE FROM configurations WHERE id = ?').bind(configId).run();

        return successResponse({ deleted: true });
      }

      // ========================================
      // Runs API
      // ========================================

      // List runs
      if (path === '/api/runs' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const status = url.searchParams.get('status');
        const search = url.searchParams.get('search');
        const sortBy = url.searchParams.get('sortBy') || 'created_at';
        const sortOrder = url.searchParams.get('sortOrder') || 'desc';

        let query = 'SELECT * FROM runs WHERE 1=1';
        const params: any[] = [];

        if (status) {
          const statuses = status.split(',');
          query += ` AND status IN (${statuses.map(() => '?').join(',')})`;
          params.push(...statuses);
        }

        if (search) {
          query += ' AND (name LIKE ? OR id LIKE ?)';
          params.push(`%${search}%`, `%${search}%`);
        }

        const validSortColumns: Record<string, string> = {
          createdAt: 'created_at',
          startedAt: 'started_at',
          name: 'name',
          status: 'status',
        };
        const sortColumn = validSortColumns[sortBy] || 'created_at';
        query += ` ORDER BY ${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const result = await env.CRAWL_DB.prepare(query).bind(...params).all();

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM runs WHERE 1=1';
        const countParams: any[] = [];
        if (status) {
          const statuses = status.split(',');
          countQuery += ` AND status IN (${statuses.map(() => '?').join(',')})`;
          countParams.push(...statuses);
        }
        if (search) {
          countQuery += ' AND (name LIKE ? OR id LIKE ?)';
          countParams.push(`%${search}%`, `%${search}%`);
        }
        const countResult = await env.CRAWL_DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();

        return successResponse(
          { runs: result.results },
          { total: countResult?.total || 0, offset, limit, hasMore: offset + result.results.length < (countResult?.total || 0) }
        );
      }

      // Create run
      if (path === '/api/runs' && method === 'POST') {
        const body = await request.json() as CreateRunRequest;

        if (!body.name) {
          return errorResponse('INVALID_REQUEST', 'Run name is required');
        }

        if (!body.seedUrls || body.seedUrls.length === 0) {
          return errorResponse('INVALID_REQUEST', 'At least one seed URL is required');
        }

        const runId = generateId();
        const now = Date.now();

        // Get or create configuration
        let configId = body.configId || 'default';
        let config: CrawlConfig | null = null;

        if (body.config) {
          // Create inline configuration
          configId = generateId();
          config = buildConfig(configId, body.config, now);

          await env.CRAWL_DB.prepare(
            `INSERT INTO configurations (id, name, description, rate_limiting, content_filtering, crawl_behavior, domain_scope, rendering, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              config.id,
              config.name,
              config.description || null,
              JSON.stringify(config.rateLimiting),
              JSON.stringify(config.contentFiltering),
              JSON.stringify(config.crawlBehavior),
              JSON.stringify(config.domainScope),
              JSON.stringify(config.rendering),
              now,
              now
            )
            .run();
        } else {
          // Load existing configuration
          const configResult = await env.CRAWL_DB.prepare('SELECT * FROM configurations WHERE id = ?')
            .bind(configId)
            .first();

          if (configResult) {
            config = parseConfigFromDB(configResult);
          }
        }

        // Create run record
        await env.CRAWL_DB.prepare(
          `INSERT INTO runs (id, name, description, config_id, seed_urls, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(runId, body.name, body.description || null, configId, JSON.stringify(body.seedUrls), 'pending', now)
          .run();

        // Initialize Durable Object with configuration and seed URLs
        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);

        // Configure DO
        if (config) {
          await doObj.fetch(new Request('http://internal/internal/configure', {
            method: 'POST',
            body: JSON.stringify({ config }),
          }));
        }

        // Seed URLs
        await doObj.fetch(new Request('http://internal/internal/seed', {
          method: 'POST',
          body: JSON.stringify({ urls: body.seedUrls }),
        }));

        // Auto-start if requested
        if (body.autoStart) {
          await doObj.fetch(new Request('http://internal/internal/start', { method: 'POST' }));

          await env.CRAWL_DB.prepare('UPDATE runs SET status = ?, started_at = ? WHERE id = ?')
            .bind('running', now, runId)
            .run();
        }

        return successResponse({
          id: runId,
          name: body.name,
          description: body.description,
          configId,
          seedUrls: body.seedUrls,
          status: body.autoStart ? 'running' : 'pending',
          createdAt: now,
          startedAt: body.autoStart ? now : null,
        });
      }

      // Get run details
      if (path.match(/^\/api\/runs\/[\w-]+$/) && method === 'GET') {
        const runId = path.split('/').pop()!;

        const run = await env.CRAWL_DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();

        if (!run) {
          return errorResponse('RUN_NOT_FOUND', `Run '${runId}' not found`, 404);
        }

        // Get real-time stats from DO
        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        const statsRes = await doObj.fetch(new Request('http://internal/internal/stats', { method: 'GET' }));
        const statsData = await statsRes.json() as any;

        return successResponse({
          ...run,
          seedUrls: JSON.parse((run as any).seed_urls || '[]'),
          realTimeStats: statsData.stats,
          progress: statsData.progress,
          domainBreakdown: statsData.domainBreakdown,
        });
      }

      // Run actions (start, pause, resume, cancel)
      if (path.match(/^\/api\/runs\/[\w-]+\/(start|pause|resume|cancel)$/) && method === 'POST') {
        const parts = path.split('/');
        const runId = parts[parts.length - 2];
        const action = parts[parts.length - 1];

        const run = await env.CRAWL_DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();

        if (!run) {
          return errorResponse('RUN_NOT_FOUND', `Run '${runId}' not found`, 404);
        }

        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        const res = await doObj.fetch(new Request(`http://internal/internal/${action}`, { method: 'POST' }));
        const data = await res.json() as any;

        if (!data.success) {
          return errorResponse(data.error?.code || 'INVALID_RUN_STATE', data.error?.message || 'Action failed', 400);
        }

        // Update D1 status
        const now = Date.now();
        const statusMap: Record<string, string> = {
          start: 'running',
          pause: 'paused',
          resume: 'running',
          cancel: 'cancelled',
        };
        const newStatus = statusMap[action];

        let updateQuery = 'UPDATE runs SET status = ?';
        const updateParams: any[] = [newStatus];

        if (action === 'start') {
          updateQuery += ', started_at = ?';
          updateParams.push(now);
        } else if (action === 'pause') {
          updateQuery += ', paused_at = ?';
          updateParams.push(now);
        } else if (action === 'cancel' || action === 'complete') {
          updateQuery += ', completed_at = ?';
          updateParams.push(now);
        }

        updateQuery += ' WHERE id = ?';
        updateParams.push(runId);

        await env.CRAWL_DB.prepare(updateQuery).bind(...updateParams).run();

        return successResponse({ status: newStatus });
      }

      // Add seed URLs to existing run
      if (path.match(/^\/api\/runs\/[\w-]+\/seed$/) && method === 'POST') {
        const runId = path.split('/')[3];
        const body = await request.json() as { urls: string[]; priority?: number };

        if (!body.urls || body.urls.length === 0) {
          return errorResponse('INVALID_REQUEST', 'URLs are required');
        }

        const run = await env.CRAWL_DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();

        if (!run) {
          return errorResponse('RUN_NOT_FOUND', `Run '${runId}' not found`, 404);
        }

        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        const res = await doObj.fetch(new Request('http://internal/internal/seed', {
          method: 'POST',
          body: JSON.stringify({ urls: body.urls, priority: body.priority || 0 }),
        }));
        const data = await res.json() as any;

        return successResponse(data);
      }

      // Reset run (clear all state)
      if (path.match(/^\/api\/runs\/[\w-]+\/reset$/) && method === 'POST') {
        const runId = path.split('/')[3];

        const run = await env.CRAWL_DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();

        if (!run) {
          return errorResponse('RUN_NOT_FOUND', `Run '${runId}' not found`, 404);
        }

        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        await doObj.fetch(new Request('http://internal/internal/reset', { method: 'POST' }));

        // Reset D1 stats
        await env.CRAWL_DB.prepare(
          `UPDATE runs SET status = 'pending', urls_queued = 0, urls_fetched = 0, urls_failed = 0,
           bytes_downloaded = 0, started_at = NULL, completed_at = NULL, paused_at = NULL WHERE id = ?`
        )
          .bind(runId)
          .run();

        return successResponse({ reset: true });
      }

      // Delete run
      if (path.match(/^\/api\/runs\/[\w-]+$/) && method === 'DELETE') {
        const runId = path.split('/').pop()!;

        const run = await env.CRAWL_DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();

        if (!run) {
          return errorResponse('RUN_NOT_FOUND', `Run '${runId}' not found`, 404);
        }

        // Cancel if running
        if ((run as any).status === 'running') {
          const doId = env.CRAWL_CONTROLLER.idFromName(runId);
          const doObj = env.CRAWL_CONTROLLER.get(doId);
          await doObj.fetch(new Request('http://internal/internal/cancel', { method: 'POST' }));
        }

        // Delete from D1
        await env.CRAWL_DB.batch([
          env.CRAWL_DB.prepare('DELETE FROM runs WHERE id = ?').bind(runId),
          env.CRAWL_DB.prepare('DELETE FROM pages WHERE run_id = ?').bind(runId),
          env.CRAWL_DB.prepare('DELETE FROM crawl_errors WHERE run_id = ?').bind(runId),
        ]);

        return successResponse({ deleted: true });
      }

      // ========================================
      // Container Communication (backward compatible)
      // ========================================

      // Container requests work
      if (path === '/api/request-work' && method === 'POST') {
        const payload = await request.json() as { runId: string; batchSize?: number };
        const runId = payload.runId || 'default';

        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        const res = await doObj.fetch(new Request('http://internal/internal/request-work', {
          method: 'POST',
          body: JSON.stringify(payload),
        }));
        const data = await res.json();

        return Response.json(data, { headers: CORS_HEADERS });
      }

      // Container reports result
      if (path === '/api/report-result' && method === 'POST') {
        const payload = await request.json() as any;
        const runId = payload.runId || 'default';

        // Store content in R2 if provided
        if (payload.content && env.CRAWL_BUCKET) {
          const contentHash = await hashContent(payload.content);
          const key = buildR2Key(runId, payload.url, contentHash);
          await env.CRAWL_BUCKET.put(key, payload.content, {
            httpMetadata: { contentType: 'text/html' },
            customMetadata: { url: payload.url, fetchedAt: String(Date.now()) },
          });
          payload.contentHash = contentHash;
          payload.contentSize = payload.content.length;
          delete payload.content;
        }

        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        const res = await doObj.fetch(new Request('http://internal/internal/report-result', {
          method: 'POST',
          body: JSON.stringify(payload),
        }));
        const data = await res.json();

        // Update run stats in D1 periodically (every 100 pages)
        try {
          const stats = await doObj.fetch(new Request('http://internal/internal/stats', { method: 'GET' }));
          const statsData = await stats.json() as any;
          if (statsData.stats && statsData.stats.urlsFetched % 100 === 0) {
            await env.CRAWL_DB.prepare(
              `UPDATE runs SET urls_queued = ?, urls_fetched = ?, urls_failed = ?, bytes_downloaded = ?,
               domains_discovered = ?, avg_response_time_ms = ? WHERE id = ?`
            )
              .bind(
                statsData.stats.urlsQueued,
                statsData.stats.urlsFetched,
                statsData.stats.urlsFailed,
                statsData.stats.bytesDownloaded,
                statsData.stats.domainsDiscovered,
                Math.round(statsData.stats.avgResponseTimeMs),
                runId
              )
              .run();
          }
        } catch {
          // Ignore stats update errors
        }

        return Response.json(data, { headers: CORS_HEADERS });
      }

      // ========================================
      // Stats & Pages (backward compatible + enhanced)
      // ========================================

      // Get stats
      if (path === '/api/stats' && method === 'GET') {
        const runId = url.searchParams.get('runId') || 'default';

        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        const res = await doObj.fetch(new Request('http://internal/internal/stats', { method: 'GET' }));
        const data = await res.json();

        return Response.json(data, { headers: CORS_HEADERS });
      }

      // List pages
      if (path === '/api/pages' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const domain = url.searchParams.get('domain');
        const runId = url.searchParams.get('runId');
        const status = url.searchParams.get('status');
        const sortBy = url.searchParams.get('sortBy') || 'fetched_at';
        const sortOrder = url.searchParams.get('sortOrder') || 'desc';

        let query = 'SELECT * FROM pages WHERE 1=1';
        const params: any[] = [];

        if (domain) {
          query += ' AND domain = ?';
          params.push(domain);
        }

        if (runId) {
          query += ' AND run_id = ?';
          params.push(runId);
        }

        if (status) {
          const statuses = status.split(',').map(s => parseInt(s));
          query += ` AND status IN (${statuses.map(() => '?').join(',')})`;
          params.push(...statuses);
        }

        const validSortColumns: Record<string, string> = {
          fetchedAt: 'fetched_at',
          url: 'url',
          status: 'status',
          contentSize: 'content_size',
        };
        const sortColumn = validSortColumns[sortBy] || 'fetched_at';
        query += ` ORDER BY ${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const result = await env.CRAWL_DB.prepare(query).bind(...params).all();

        return successResponse({ pages: result.results }, { limit, offset });
      }

      // Get content from R2
      if (path.startsWith('/api/content/') && method === 'GET') {
        const key = decodeURIComponent(path.replace('/api/content/', ''));
        const object = await env.CRAWL_BUCKET.get(key);

        if (!object) {
          return errorResponse('CONTENT_NOT_FOUND', 'Content not found', 404);
        }

        return new Response(object.body, {
          headers: {
            ...CORS_HEADERS,
            'Content-Type': object.httpMetadata?.contentType || 'text/html',
          },
        });
      }

      // ========================================
      // Errors API
      // ========================================

      if (path === '/api/errors' && method === 'GET') {
        const runId = url.searchParams.get('runId');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = 'SELECT * FROM crawl_errors WHERE 1=1';
        const params: any[] = [];

        if (runId) {
          query += ' AND run_id = ?';
          params.push(runId);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.CRAWL_DB.prepare(query).bind(...params).all();

        return successResponse({ errors: result.results }, { limit, offset });
      }

      // ========================================
      // Legacy seed endpoint (backward compatible)
      // ========================================

      if (path === '/api/seed' && method === 'POST') {
        const payload = await request.json() as { runId?: string; urls: string[] };
        const runId = payload.runId || 'default';

        const doId = env.CRAWL_CONTROLLER.idFromName(runId);
        const doObj = env.CRAWL_CONTROLLER.get(doId);
        const res = await doObj.fetch(new Request('http://internal/internal/seed', {
          method: 'POST',
          body: JSON.stringify({ urls: payload.urls }),
        }));
        const data = await res.json();

        return Response.json(data, { headers: CORS_HEADERS });
      }

      return errorResponse('NOT_FOUND', `Endpoint ${method} ${path} not found`, 404);
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('INTERNAL_ERROR', `Internal error: ${error}`, 500);
    }
  },

  /**
   * Scheduled event to trigger crawl maintenance
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Get all running runs
    const runs = await env.CRAWL_DB.prepare(
      "SELECT id FROM runs WHERE status IN ('running', 'paused')"
    ).all();

    for (const run of runs.results) {
      const runId = (run as any).id;
      const doId = env.CRAWL_CONTROLLER.idFromName(runId);
      const doObj = env.CRAWL_CONTROLLER.get(doId);
      await doObj.fetch(new Request('http://internal/internal/on-cron', { method: 'POST' }));
    }
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildR2Key(runId: string, url: string, contentHash: string): string {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const pathHash = contentHash.substring(0, 16);
    return `${runId}/${domain}/${pathHash}.html`;
  } catch {
    return `${runId}/unknown/${contentHash.substring(0, 16)}.html`;
  }
}

function parseConfigFromDB(row: any): CrawlConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    rateLimiting: JSON.parse(row.rate_limiting || '{}'),
    contentFiltering: JSON.parse(row.content_filtering || '{}'),
    crawlBehavior: JSON.parse(row.crawl_behavior || '{}'),
    domainScope: JSON.parse(row.domain_scope || '{}'),
    rendering: JSON.parse(row.rendering || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildConfig(id: string, request: CreateConfigRequest, now: number): CrawlConfig {
  return {
    id,
    name: request.name,
    description: request.description,
    rateLimiting: { ...DEFAULT_CONFIG_VALUES.rateLimiting, ...request.rateLimiting },
    contentFiltering: { ...DEFAULT_CONFIG_VALUES.contentFiltering, ...request.contentFiltering },
    crawlBehavior: { ...DEFAULT_CONFIG_VALUES.crawlBehavior, ...request.crawlBehavior },
    domainScope: { ...DEFAULT_CONFIG_VALUES.domainScope, ...request.domainScope },
    rendering: { ...DEFAULT_CONFIG_VALUES.rendering, ...request.rendering },
    createdAt: now,
    updatedAt: now,
  };
}
