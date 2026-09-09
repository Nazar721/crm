import { z } from 'zod';
import { PipelineConfig, Lead, PipelineEvent, Run, ProviderId, PROVIDER_IDS, isCustomProviderId, customProviderSettingId } from './types';
import { createRun, finishRun, updateRunProgress, getLGSettings, upsertLead, saveVerifiedEmails } from './db/sqlite';
import { searchMultipleQueries } from './search';
import { ScannerPool, scanMultipleWebsites } from './scanner/playwright';
import { calculateRuleBasedScore, analyzeWithAI, scrapedToLead } from './scoring/leadScore';
import { resolveMX } from './emailVerification';

export const pipelineConfigSchema = z.object({
  niche: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  keywords: z.string().trim().max(300).default(''),
  maxResults: z.number().int().min(10).max(200).default(50),
  additionalCriteria: z.string().trim().max(500).default(''),
  concurrency: z.number().int().min(1).max(8).default(4),
  useAI: z.boolean().default(true),
  provider: z.string().trim().max(40).default(''),
  model: z.string().trim().max(160).default(''),
});

export const CAMPAIGN_TIMEOUT_MS = 10 * 60 * 1000;

function generateQueries(config: PipelineConfig): string[] {
  const queries: string[] = [];
  const niche = config.niche.trim();
  const location = config.location.trim();

  queries.push(`${niche} ${location}`);
  queries.push(`${niche} website ${location}`);
  queries.push(`${niche} contact ${location}`);

  if (config.keywords) {
    const kws = config.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    for (const kw of kws.slice(0, 2)) {
      queries.push(`${niche} ${kw} ${location}`);
    }
  }

  return queries;
}

function timedEvent(
  runId: number,
  startTime: number,
  base: Omit<Extract<PipelineEvent, { type: 'progress' }>, 'type' | 'startTime' | 'elapsedMs' | 'runId'>
): Extract<PipelineEvent, { type: 'progress' }> {
  return { type: 'progress', runId, startTime, elapsedMs: Date.now() - startTime, ...base };
}

export async function runPipeline(
  rawConfig: unknown,
  requestSignal: AbortSignal,
  sendEvent: (event: PipelineEvent) => void,
  onAbortController?: (controller: AbortController) => void
): Promise<void> {
  const startTime = Date.now();

  const parsed = pipelineConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    sendEvent({
      type: 'error',
      runId: 0,
      partial: false,
      message: `Некоректна конфігурація: ${parsed.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`).join('; ')}`,
    });
    return;
  }

  const settings = getLGSettings();
  const provider =
    parsed.data.provider &&
    (PROVIDER_IDS.includes(parsed.data.provider as ProviderId) || isCustomProviderId(parsed.data.provider))
      ? parsed.data.provider
      : settings.provider;
  const apiKey = isCustomProviderId(provider)
    ? settings.customProviders.find((c) => customProviderSettingId(c.id) === provider)?.apiKey || ''
    : settings.keys[provider as ProviderId] || '';
  const config: PipelineConfig = {
    ...parsed.data,
    provider,
    model: parsed.data.model || settings.model,
  };
  const aiSettings = { provider, apiKey, model: config.model, customProviders: settings.customProviders };

  const abortController = new AbortController();
  onAbortController?.(abortController);
  const onExternalAbort = () => abortController.abort();
  requestSignal.addEventListener('abort', onExternalAbort, { once: true });

  const timeoutId = setTimeout(() => abortController.abort(new Error('Campaign timeout')), CAMPAIGN_TIMEOUT_MS);
  const signal = abortController.signal;

  let run: Run | null = null;
  let partial = false;
  const leads: Lead[] = [];
  const stats = { found: 0, scanned: 0, analyzed: 0, leads: 0 };
  const pool = new ScannerPool(signal);

  const progress = (
    stage: Parameters<typeof timedEvent>[2]['stage'],
    current: number,
    total: number,
    message: string
  ) => sendEvent(timedEvent(run?.id ?? 0, startTime, { stage, current, total, message }));

  try {
    run = createRun({
      niche: config.niche,
      location: config.location,
      keywords: config.keywords,
      criteria: config.additionalCriteria,
      provider: config.provider,
      model: config.model,
    });

    // Stage 1: queries
    progress('generating_queries', 0, 1, 'Генерація пошукових запитів...');
    const queries = generateQueries(config);
    progress('generating_queries', 1, 1, `Згенеровано ${queries.length} запитів`);

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // Stage 2: search
    progress('searching', 0, queries.length, `Пошук (${queries.length} запитів)...`);
    let blockedCount = 0;
    const searchResult = await searchMultipleQueries(queries, 30, signal, (_query, outcome) => {
      if (outcome.blocked && outcome.results.length === 0) blockedCount++;
      sendEvent(
        timedEvent(run!.id, startTime, {
          stage: 'searching',
          current: Math.min(queries.length, queries.indexOf(_query) + 1),
          total: queries.length,
          message: outcome.blocked
            ? `Запит заблоковано (${outcome.provider}), пропускаю: ${_query}`
            : `Знайдено ${outcome.results.length} за запитом: ${_query}`,
        })
      );
    });
    if (searchResult.blockedCount > 0 || blockedCount > 0) {
      sendEvent({
        type: 'search_blocked',
        runId: run.id,
        message:
          blockedCount >= queries.length
            ? 'Пошук заблоковано (CAPTCHA). Спробуйте пізніше або додайте Serper API-ключ.'
            : `Деякі запити заблоковано (${blockedCount}/${queries.length}). Результати можуть бути неповними.`,
      });
    }

    const allResults = searchResult.results;
    stats.found = allResults.length;
    updateRunProgress(run.id, stats);

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // Stage 3: dedupe
    progress('deduplicating', 0, 1, 'Видалення дублікатів...');
    const urlsToScan = allResults
      .map((r) => r.url)
      .filter((url) => {
        try {
          const u = new URL(url);
          return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
          return false;
        }
      })
      .slice(0, config.maxResults);
    stats.found = urlsToScan.length;
    updateRunProgress(run.id, stats);
    progress('deduplicating', 1, 1, `Знайдено ${urlsToScan.length} унікальних сайтів`);

    // Stage 4: scan (shared browser, per-site error isolation)
    progress('scanning', 0, urlsToScan.length, 'Сканування сайтів...');
    const scanOutcome = await scanMultipleWebsites(
      urlsToScan,
      pool,
      { runId: run.id, location: config.location, concurrency: config.concurrency, signal },
      (current, total) => progress('scanning', current, total, `Сканування ${current}/${total}`)
    );
    if (scanOutcome.aborted) partial = true;
    stats.scanned = scanOutcome.results.length;
    updateRunProgress(run.id, stats);

    const availableWebsites = scanOutcome.results.filter((s) => s.websiteStatus === 'available');

    // Stage 5: AI analysis + scoring (per-site isolation, UPSERT per site)
    progress('ai_analysis', 0, availableWebsites.length, 'AI-аналіз...');

    for (let i = 0; i < availableWebsites.length; i++) {
      if (signal.aborted) {
        partial = true;
        break;
      }
      const scraped = availableWebsites[i];
      try {
        const ruleScores = calculateRuleBasedScore(scraped, config);
        const aiData = await analyzeWithAI(scraped, config, aiSettings.apiKey, signal, aiSettings.customProviders);
        const scores = { ...ruleScores, aiScore: aiData.aiScore };
        const leadData = scrapedToLead(scraped, config, scores, aiData, queries);
        const savedLead = upsertLead({ ...leadData, runId: run.id });

        if (savedLead.emails.length > 0 && savedLead.verifiedEmails.length === 0) {
          void resolveMX(savedLead.emails)
            .then((verified) => {
              if (verified.length > 0) saveVerifiedEmails(savedLead.id, verified);
            })
            .catch(() => undefined);
        }

        leads.push(savedLead);
        stats.leads = leads.length;
        stats.analyzed = i + 1;
        updateRunProgress(run.id, stats);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          partial = true;
          break;
        }
        console.error(`[lead-generator] Failed to analyze ${scraped.domain}:`, err);
        partial = true;
      }
      progress('ai_analysis', i + 1, availableWebsites.length, `AI-аналіз ${i + 1}/${availableWebsites.length}: ${scraped.domain}`);
    }

    if (signal.aborted) partial = true;

    // Stage 6: scoring done inline; final event
    progress('scoring', 1, 1, 'Фінальний скоринг завершено');
    progress('completed', 1, 1, `Готово! Збережено ${leads.length} лідів${partial ? ' (частково)' : ''}`);

    sendEvent({
      type: 'completed',
      runId: run.id,
      partial,
      leads: [...leads].sort((a, b) => b.leadScore - a.leadScore),
      totalFound: urlsToScan.length,
      totalScanned: stats.scanned,
      totalAnalyzed: stats.analyzed,
      totalLeads: leads.length,
    });

    await finishRun(run.id, signal.aborted ? 'stopped' : 'completed', { partial, stats: { ...stats } });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (!aborted) {
      console.error('[lead-generator] Pipeline error:', err);
      partial = true;
    }
    try {
      progress('completed', 1, 1, aborted ? 'Зупинено користувачем' : 'Помилка пайплайна');
      if (aborted) {
        sendEvent({
          type: 'completed',
          runId: run?.id ?? 0,
          partial: true,
          leads: [...leads].sort((a, b) => b.leadScore - a.leadScore),
          totalFound: stats.found,
          totalScanned: stats.scanned,
          totalAnalyzed: stats.analyzed,
          totalLeads: leads.length,
        });
      } else {
        sendEvent({
          type: 'error',
          runId: run?.id ?? 0,
          partial: true,
          message: err instanceof Error ? err.message : 'Pipeline failed',
        });
      }
      if (run) {
        await finishRun(run.id, aborted ? 'stopped' : 'failed', { partial: true, stats: { ...stats } });
      }
    } catch {
      // ignore secondary errors during error handling
    }
  } finally {
    clearTimeout(timeoutId);
    requestSignal.removeEventListener('abort', onExternalAbort);
    await pool.close();
  }
}
