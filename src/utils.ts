/**
 * Shared helper functions and type declarations used by
 * Worker, Durable Object and container clients.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface CrawlerAPIRequest {
  runId: string;
  batchSize?: number;
  workerId?: string;
}

export interface CrawlerAPIResponse {
  urls: string[];
  queueSize: number;
}

export interface CrawlResultPayload {
  runId: string;
  url: string;
  status: number;
  content?: string;
  contentHash?: string;
  contentSize?: number;
  discoveredUrls?: string[];
  error?: string;
  fetchedAt: number;
}

export interface SeedPayload {
  runId?: string;
  urls: string[];
}

export interface StatsResponse {
  stats: {
    urlsQueued: number;
    urlsFetched: number;
    urlsFailed: number;
    bytesDownloaded: number;
    startedAt: number;
    lastActivityAt: number;
  };
  queueSize: number;
  visitedCount: number;
  domainsTracked: number;
}

// ============================================================================
// URL Utilities
// ============================================================================

/**
 * Normalise a URL by removing fragments, standardising protocol and path.
 * Returns lowercase hostname for consistent deduplication.
 */
export function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    // Remove fragment
    url.hash = '';
    // Lowercase hostname
    url.hostname = url.hostname.toLowerCase();
    // Remove trailing slash from path (except root)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    // Sort query parameters for consistency
    url.searchParams.sort();
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
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Check if a URL is valid and uses http/https protocol.
 */
export function isValidUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
export function resolveUrl(base: string, relative: string): string | undefined {
  try {
    return new URL(relative, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * Check if two URLs are on the same domain.
 */
export function isSameDomain(url1: string, url2: string): boolean {
  const domain1 = getDomain(url1);
  const domain2 = getDomain(url2);
  return domain1 !== undefined && domain1 === domain2;
}

/**
 * Extract the path from a URL.
 */
export function getPath(urlStr: string): string {
  try {
    return new URL(urlStr).pathname;
  } catch {
    return '/';
  }
}

// ============================================================================
// Hashing Utilities
// ============================================================================

/**
 * Simple string hash to a 32-bit unsigned integer.
 * Fast but not cryptographically secure - use for deduplication only.
 */
export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
}

/**
 * Generate a SHA-256 hash (async, uses Web Crypto API).
 */
export async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Rate Limiting Utilities
// ============================================================================

/**
 * Calculate exponential backoff time in milliseconds.
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60000,
  multiplier: number = 2
): number {
  const delay = baseDelayMs * Math.pow(multiplier, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Add jitter to a delay to prevent thundering herd.
 */
export function addJitter(delayMs: number, jitterFactor: number = 0.1): number {
  const jitter = delayMs * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, delayMs + jitter);
}

// ============================================================================
// Content Extraction Utilities
// ============================================================================

/**
 * Extract all href links from HTML content.
 * Simple regex-based extraction - for production use a proper HTML parser.
 */
export function extractLinks(html: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    // Skip javascript:, mailto:, tel:, and anchor-only links
    if (
      !href.startsWith('javascript:') &&
      !href.startsWith('mailto:') &&
      !href.startsWith('tel:') &&
      !href.startsWith('#')
    ) {
      links.push(href);
    }
  }

  return links;
}

/**
 * Filter links to only include those matching allowed domains.
 */
export function filterLinksByDomain(links: string[], allowedDomains: string[]): string[] {
  return links.filter(link => {
    const domain = getDomain(link);
    return domain && allowedDomains.includes(domain);
  });
}

/**
 * Deduplicate an array of URLs after normalisation.
 */
export function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const normalised = normaliseUrl(url);
    if (!seen.has(normalised)) {
      seen.add(normalised);
      result.push(normalised);
    }
  }

  return result;
}

// ============================================================================
// Robots.txt Utilities
// ============================================================================

/**
 * Parse robots.txt content and check if a path is allowed for a user agent.
 * Simplified implementation - for production use a proper robots.txt parser.
 */
export function isAllowedByRobots(
  robotsTxt: string,
  path: string,
  userAgent: string = '*'
): boolean {
  const lines = robotsTxt.split('\n').map(line => line.trim().toLowerCase());
  let inRelevantBlock = false;
  let isAllowed = true;

  for (const line of lines) {
    if (line.startsWith('user-agent:')) {
      const agent = line.replace('user-agent:', '').trim();
      inRelevantBlock = agent === '*' || agent === userAgent.toLowerCase();
    } else if (inRelevantBlock) {
      if (line.startsWith('disallow:')) {
        const disallowedPath = line.replace('disallow:', '').trim();
        if (disallowedPath && path.toLowerCase().startsWith(disallowedPath)) {
          isAllowed = false;
        }
      } else if (line.startsWith('allow:')) {
        const allowedPath = line.replace('allow:', '').trim();
        if (allowedPath && path.toLowerCase().startsWith(allowedPath)) {
          isAllowed = true;
        }
      }
    }
  }

  return isAllowed;
}
