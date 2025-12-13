export interface Env {
  CRAWL_CONTROLLER: DurableObjectNamespace;
  CRAWL_BUCKET: R2Bucket;
  CRAWL_DB: D1Database;
  VISITED_KV?: KVNamespace;
}

export interface CrawlerAPIRequest {
  runId: string;
  batchSize?: number;
}

export interface CrawlerAPIResponse {
  urls: string[];
}
