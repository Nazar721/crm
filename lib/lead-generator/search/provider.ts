import { SearchQuery } from '../types';

export interface SearchProvider {
  getName(): string;
  search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchQuery[]>;
}

export class SearchBlockedError extends Error {
  constructor(message = 'Search provider blocked (CAPTCHA)') {
    super(message);
    this.name = 'SearchBlockedError';
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('ved');
    u.searchParams.delete('ei');
    u.searchParams.delete('usg');
    let normalized = u.origin + u.pathname.replace(/\/+$/, '');
    normalized = normalized.replace(/^https?:\/\/(www\.)?/, 'https://');
    return normalized;
  } catch {
    return url;
  }
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function deduplicateByUrl(results: SearchQuery[]): SearchQuery[] {
  const seen = new Map<string, SearchQuery>();
  for (const result of results) {
    const domain = getDomain(result.url);
    if (!seen.has(domain)) {
      seen.set(domain, result);
    }
  }
  return Array.from(seen.values());
}

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};
