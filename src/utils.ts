/**
 * This module contains shared helper functions and type declarations used by
 * Worker, Durable Object and container clients.
 */

export interface CrawlerAPIRequest {
  runId: string;
  batchSize?: number;
}

export interface CrawlerAPIResponse {
  urls: string[];
}

/**
 * Normalise a URL by removing fragments and standardising protocol and path.
 */
export function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Extract the domain (hostname) from a URL string.
 */
export function getDomain(urlStr: string): string | undefined {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Hash a string to a simple numeric value.  Use a proper hash for production.
 */
export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash >>> 0;
}
