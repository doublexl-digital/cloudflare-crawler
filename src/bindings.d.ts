/**
 * Type definitions for Cloudflare Worker bindings.
 */

export interface Env {
  CRAWL_CONTROLLER: DurableObjectNamespace;
  CRAWL_BUCKET: R2Bucket;
  CRAWL_DB: D1Database;
  VISITED_KV?: KVNamespace;
  API_TOKEN?: string;
}

// Re-export types from utils for convenience
export {
  CrawlerAPIRequest,
  CrawlerAPIResponse,
  CrawlResultPayload,
  SeedPayload,
  StatsResponse,
} from './utils';
