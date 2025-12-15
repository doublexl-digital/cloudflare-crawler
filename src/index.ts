/*
 * Cloudflare Worker entry point
 *
 * This Worker provides two primary responsibilities:
 *  1. Cron-driven scheduling: on each scheduled event, it asks the Durable Object
 *     (CrawlController) for a batch of URLs and sends them to the crawler fleet.
 *  2. HTTP API: it exposes endpoints that containers use to request work and
 *     report completed tasks.
 */

import { CrawlController } from './crawlController';

export interface Env {
  CRAWL_CONTROLLER: DurableObjectNamespace;
  CRAWL_BUCKET: R2Bucket;
  CRAWL_DB: D1Database;
  VISITED_KV?: KVNamespace;
  API_TOKEN?: string;
}

// Re-export the Durable Object class
export { CrawlController };

export default {
  /**
   * HTTP API for crawlers and control plane
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for browser-based clients
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Optional: API token authentication
    if (env.API_TOKEN) {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.replace('Bearer ', '');
      if (token !== env.API_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
    }

    try {
      // API routing
      const path = url.pathname;
      const method = request.method;

      // Health check
      if (path === '/health' && method === 'GET') {
        return Response.json({ status: 'ok', timestamp: Date.now() }, { headers: corsHeaders });
      }

      // Container requests a batch of URLs to crawl
      if (path === '/api/request-work' && method === 'POST') {
        const payload = await request.json() as { runId: string; batchSize?: number };
        const id = env.CRAWL_CONTROLLER.idFromName(payload.runId || 'default');
        const obj = env.CRAWL_CONTROLLER.get(id);
        const res = await obj.fetch(new Request('http://internal/internal/request-work', {
          method: 'POST',
          body: JSON.stringify(payload),
        }));
        const data = await res.json();
        return Response.json(data, { headers: corsHeaders });
      }

      // Container reports a crawled page result
      if (path === '/api/report-result' && method === 'POST') {
        const payload = await request.json() as { runId: string; url: string; content?: string };
        const runId = payload.runId || 'default';

        // Store raw HTML content in R2 if provided
        if (payload.content && env.CRAWL_BUCKET) {
          const contentHash = await hashContent(payload.content);
          const key = buildR2Key(runId, payload.url, contentHash);
          await env.CRAWL_BUCKET.put(key, payload.content, {
            httpMetadata: { contentType: 'text/html' },
            customMetadata: { url: payload.url, fetchedAt: String(Date.now()) },
          });
          // Add content hash to payload for DO
          (payload as any).contentHash = contentHash;
          (payload as any).contentSize = payload.content.length;
          delete payload.content; // Don't send content to DO
        }

        const id = env.CRAWL_CONTROLLER.idFromName(runId);
        const obj = env.CRAWL_CONTROLLER.get(id);
        const res = await obj.fetch(new Request('http://internal/internal/report-result', {
          method: 'POST',
          body: JSON.stringify(payload),
        }));
        const data = await res.json();
        return Response.json(data, { headers: corsHeaders });
      }

      // Seed the crawler with initial URLs
      if (path === '/api/seed' && method === 'POST') {
        const payload = await request.json() as { runId?: string; urls: string[] };
        const runId = payload.runId || 'default';
        const id = env.CRAWL_CONTROLLER.idFromName(runId);
        const obj = env.CRAWL_CONTROLLER.get(id);
        const res = await obj.fetch(new Request('http://internal/internal/seed', {
          method: 'POST',
          body: JSON.stringify({ urls: payload.urls }),
        }));
        const data = await res.json();
        return Response.json(data, { headers: corsHeaders });
      }

      // Get crawl statistics
      if (path === '/api/stats' && method === 'GET') {
        const runId = url.searchParams.get('runId') || 'default';
        const id = env.CRAWL_CONTROLLER.idFromName(runId);
        const obj = env.CRAWL_CONTROLLER.get(id);
        const res = await obj.fetch(new Request('http://internal/internal/stats', {
          method: 'GET',
        }));
        const data = await res.json();
        return Response.json(data, { headers: corsHeaders });
      }

      // List recently crawled pages from D1
      if (path === '/api/pages' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const domain = url.searchParams.get('domain');

        let query = 'SELECT * FROM pages';
        const params: any[] = [];

        if (domain) {
          query += ' WHERE domain = ?';
          params.push(domain);
        }

        query += ' ORDER BY fetched_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.CRAWL_DB.prepare(query).bind(...params).all();
        return Response.json({ pages: result.results, meta: result.meta }, { headers: corsHeaders });
      }

      // Get content from R2
      if (path.startsWith('/api/content/') && method === 'GET') {
        const key = decodeURIComponent(path.replace('/api/content/', ''));
        const object = await env.CRAWL_BUCKET.get(key);
        if (!object) {
          return new Response('Not found', { status: 404, headers: corsHeaders });
        }
        return new Response(object.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': object.httpMetadata?.contentType || 'text/html',
          },
        });
      }

      return new Response('Not found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(`Internal error: ${error}`, { status: 500, headers: corsHeaders });
    }
  },

  /**
   * Scheduled event to trigger crawl maintenance.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Process the default run
    const runId = 'default';
    const id = env.CRAWL_CONTROLLER.idFromName(runId);
    const obj = env.CRAWL_CONTROLLER.get(id);
    await obj.fetch(new Request('http://internal/internal/on-cron', { method: 'POST' }));
  },
};

/**
 * Generate a SHA-256 hash of content
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build R2 key from run ID, URL and content hash
 */
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
