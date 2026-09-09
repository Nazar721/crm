import { SearchQuery } from '../types';
import { SearchProvider, SearchBlockedError, deduplicateByUrl } from './provider';
import { DuckDuckGoProvider } from './duckduckgo';
import { SerperProvider } from './serper';

const THROTTLE_MS = 2000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

function getProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (SerperProvider.isEnabled()) providers.push(new SerperProvider());
  providers.push(new DuckDuckGoProvider());
  return providers;
}

export interface SearchOutcome {
  results: SearchQuery[];
  blocked: boolean;
  provider: string;
}

export async function searchOneQuery(
  query: string,
  maxResults: number,
  signal?: AbortSignal
): Promise<SearchOutcome> {
  const providers = getProviders();
  let blocked = false;

  for (const provider of providers) {
    try {
      const results = await provider.search(query, maxResults, signal);
      return { results, blocked: false, provider: provider.getName() };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof SearchBlockedError) {
        blocked = true;
        continue;
      }
      console.error(`[lead-generator] ${provider.getName()} search error for "${query}":`, err);
    }
  }

  return { results: [], blocked, provider: providers[0]?.getName() || 'none' };
}

export async function searchMultipleQueries(
  queries: string[],
  maxResultsPerQuery: number,
  signal?: AbortSignal,
  onQueryDone?: (query: string, outcome: SearchOutcome) => void
): Promise<{ results: SearchQuery[]; blockedCount: number }> {
  const allResults: SearchQuery[] = [];
  let blockedCount = 0;

  for (let i = 0; i < queries.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const query = queries[i];
    const outcome = await searchOneQuery(query, maxResultsPerQuery, signal);
    if (outcome.blocked && outcome.results.length === 0) blockedCount++;
    allResults.push(...outcome.results);
    onQueryDone?.(query, outcome);
    if (i < queries.length - 1) await sleep(THROTTLE_MS, signal);
  }

  return { results: deduplicateByUrl(allResults), blockedCount };
}
