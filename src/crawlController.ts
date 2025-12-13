/*
 * Durable Object implementation for the Crawl Controller
 *
 * This object maintains crawl state (pending/visited URLs, per‑domain rate limits,
 * run statistics) and provides an API for the Worker and crawler containers.
 * The implementation here is intentionally minimal; you should flesh out
 * queue management, deduplication, and error handling according to your
 * requirements.  See TODO.md for guidance.
 */

export class CrawlController {
  state: DurableObjectState;
  env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/internal/request-work' && request.method === 'POST') {
      return this.handleRequestWork(await request.json());
    }
    if (path === '/internal/report-result' && request.method === 'POST') {
      return this.handleReportResult(await request.json());
    }
    if (path === '/internal/on-cron' && request.method === 'POST') {
      return this.handleCron();
    }
    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle a container requesting work.  This should pop a batch of pending URLs
   * from the queue and return them.  If the queue is empty, return an empty
   * array.  For now we return a placeholder.
   */
  async handleRequestWork(payload: any): Promise<Response> {
    // TODO: implement queue popping logic.  For now, respond with no work.
    const batch: string[] = [];
    return Response.json({ urls: batch });
  }

  /**
   * Handle a container reporting a result.  This should update visit status,
   * persist content to R2/D1 and enqueue discovered links.  Currently a stub.
   */
  async handleReportResult(payload: any): Promise<Response> {
    // TODO: handle reporting logic: store metadata, upload HTML to R2, push new URLs.
    return new Response('ok');
  }

  /**
   * Handle cron triggers from the Worker.  Perform maintenance tasks such as
   * expiring old entries or adjusting rate limits.  Currently a no‑op.
   */
  async handleCron(): Promise<Response> {
    // TODO: implement maintenance logic.
    return new Response('ok');
  }
}

export default {
  fetch: (state: DurableObjectState, env: any) => {
    const controller = new CrawlController(state, env);
    return (request: Request) => controller.fetch(request);
  },
};
