/*
 * Cloudflare Worker entry point
 *
 * This Worker provides two primary responsibilities:
 *  1. Cron‑driven scheduling: on each scheduled event, it asks the Durable Object
 *     (CrawlController) for a batch of URLs and sends them to the crawler fleet.
 *  2. HTTP API: it exposes endpoints that containers use to request work and
 *     report completed tasks.  Containers authenticate via an API token (to be
 *     added in the future).  For now the API is open.
 */

import { CrawlerAPIRequest, CrawlerAPIResponse } from './utils';

export interface Env {
  CRAWL_CONTROLLER: DurableObjectNamespace;
  CRAWL_BUCKET: R2Bucket;
  CRAWL_DB: D1Database;
  VISITED_KV?: KVNamespace;
}

export default {
  /**
   * HTTP API for crawlers and control plane
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Simple routing based on path
    if (url.pathname === '/api/request-work' && request.method === 'POST') {
      // Container requests a batch of URLs
      const payload: CrawlerAPIRequest = await request.json();
      const id = env.CRAWL_CONTROLLER.idFromName(payload.runId);
      const obj = env.CRAWL_CONTROLLER.get(id);
      const res = await obj.fetch('/internal/request-work', { method: 'POST', body: JSON.stringify(payload) });
      return res;
    }
    if (url.pathname === '/api/report-result' && request.method === 'POST') {
      // Container reports a crawled page
      const payload = await request.json();
      const id = env.CRAWL_CONTROLLER.idFromName(payload.runId);
      const obj = env.CRAWL_CONTROLLER.get(id);
      const res = await obj.fetch('/internal/report-result', { method: 'POST', body: JSON.stringify(payload) });
      return res;
    }
    return new Response('Not found', { status: 404 });
  },

  /**
   * Scheduled event to trigger crawl batches.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Determine the runId (could be based on date or environment variable). For now, use a fixed run.
    const runId = 'default';
    const id = env.CRAWL_CONTROLLER.idFromName(runId);
    const obj = env.CRAWL_CONTROLLER.get(id);
    // Ask the Durable Object to process any pending logic (e.g. expiry, backoff).
    await obj.fetch('/internal/on-cron', { method: 'POST' });
  },
};
