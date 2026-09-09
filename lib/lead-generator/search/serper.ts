import { SearchQuery } from '../types';
import { SearchProvider, SearchBlockedError } from './provider';

const TIMEOUT_MS = 15000;

export class SerperProvider implements SearchProvider {
  getName(): string {
    return 'Serper';
  }

  static isEnabled(): boolean {
    return Boolean(process.env.SEARCH_PROVIDER_API_KEY);
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchQuery[]> {
    const apiKey = process.env.SEARCH_PROVIDER_API_KEY || '';
    if (!apiKey) throw new SearchBlockedError('Serper API key not configured');

    const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: Math.min(maxResults, 100),
      }),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) throw new SearchBlockedError(`Serper ${res.status}`);
      return [];
    }

    const data = await res.json();
    const organic = Array.isArray(data.organic) ? data.organic : [];
    return organic
      .filter((item: { link?: string }) => typeof item.link === 'string' && item.link.startsWith('http'))
      .slice(0, maxResults)
      .map(
        (item: { title?: string; link: string; snippet?: string }, index: number): SearchQuery => ({
          title: item.title || '',
          url: item.link,
          snippet: item.snippet || '',
          search_query: query,
          position: index + 1,
        })
      );
  }
}
