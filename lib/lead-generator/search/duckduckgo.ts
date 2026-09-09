import { SearchQuery } from '../types';
import {
  SearchProvider,
  SearchBlockedError,
  normalizeUrl,
  getDomain,
  BROWSER_HEADERS,
} from './provider';

const TIMEOUT_MS = 15000;

const CAPTCHA_SIGNATURES = [
  'anomaly',
  ' Unfortunately, our computers',
  'request has been blocked',
  'challenge-platform',
  'cf-chl',
  'recaptcha',
  'g-recaptcha',
  'hCaptcha',
];

export class DuckDuckGoProvider implements SearchProvider {
  getName(): string {
    return 'DuckDuckGo';
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchQuery[]> {
    const results: SearchQuery[] = [];
    const seen = new Set<string>();

    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
    const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) throw new SearchBlockedError(`DuckDuckGo ${res.status}`);
      return results;
    }

    const html = await res.text();

    if (CAPTCHA_SIGNATURES.some((s) => html.includes(s))) {
      throw new SearchBlockedError();
    }

    const resultRegex =
      /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    let position = 0;

    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      position++;
      let rawUrl = match[1];
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();

      if (rawUrl.includes('duckduckgo.com')) {
        const redirectMatch = rawUrl.match(/uddg=([^&]+)/);
        if (redirectMatch) {
          rawUrl = decodeURIComponent(redirectMatch[1]);
        }
      }

      const normalizedUrl = normalizeUrl(rawUrl);
      const domain = getDomain(normalizedUrl);

      if (seen.has(domain)) continue;
      seen.add(domain);

      if (!normalizedUrl.startsWith('http')) continue;

      results.push({
        title,
        url: normalizedUrl,
        snippet,
        search_query: query,
        position,
      });
    }

    return results;
  }
}
