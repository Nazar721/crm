'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Lead, PipelineEvent } from '@/lib/lead-generator/types';
import type { PipelineConfig } from '@/lib/lead-generator/types';

export interface PipelineState {
  isRunning: boolean;
  runId: number | null;
  stage: string;
  current: number;
  total: number;
  message: string;
  startTime: number | null;
  elapsedMs: number;
  error: string | null;
  searchBlocked: string | null;
}

const INITIAL_STATE: PipelineState = {
  isRunning: false,
  runId: null,
  stage: '',
  current: 0,
  total: 0,
  message: '',
  startTime: null,
  elapsedMs: 0,
  error: null,
  searchBlocked: null,
};

export function usePipeline(onCompleted: (runId: number, partial: boolean) => void) {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string>('');
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const stopTicker = () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  };

  useEffect(() => () => stopTicker(), []);

  const tick = () => {
    setState((s) =>
      s.startTime && s.isRunning ? { ...s, elapsedMs: Date.now() - s.startTime } : s
    );
  };

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    if (requestIdRef.current) {
      try {
        await fetch(`/api/lead-generator/runs/${requestIdRef.current}/stop`, { method: 'POST' });
      } catch {
        // ignore — abort already requested via signal
      }
    }
    stopTicker();
    setState((s) => ({ ...s, isRunning: false }));
  }, []);

  const start = useCallback(
    async (config: PipelineConfig, onEvent?: (event: PipelineEvent) => void) => {
      if (!config.niche.trim() || !config.location.trim()) {
        setState({ ...INITIAL_STATE, error: 'Вкажіть нішу та локацію' });
        return;
      }

      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      requestIdRef.current = requestId;
      abortRef.current = new AbortController();

      setState({
        ...INITIAL_STATE,
        isRunning: true,
        startTime: Date.now(),
        message: 'Запуск...',
      });
      tickerRef.current = setInterval(tick, 1000);

      try {
        const res = await fetch('/api/lead-generator/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, config }),
          signal: abortRef.current.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Помилка сервера: ${res.status} ${errText.slice(0, 200)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event: PipelineEvent;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            onEvent?.(event);

            if (event.type === 'progress') {
              setState((s) => ({
                ...s,
                isRunning: event.stage !== 'completed',
                runId: event.runId || s.runId,
                stage: event.stage,
                current: event.current,
                total: event.total,
                message: event.message,
                startTime: s.startTime ?? event.startTime,
                elapsedMs: event.elapsedMs,
              }));
            } else if (event.type === 'search_blocked') {
              setState((s) => ({ ...s, searchBlocked: event.message }));
            } else if (event.type === 'completed') {
              stopTicker();
              setState((s) => ({
                ...s,
                isRunning: false,
                runId: event.runId,
                stage: 'completed',
                message: event.partial
                  ? `Готово (частково): ${event.totalLeads} лідів збережено`
                  : `Готово! Знайдено ${event.totalLeads} лідів`,
              }));
              onCompletedRef.current(event.runId, event.partial);
            } else if (event.type === 'error') {
              stopTicker();
              setState((s) => ({
                ...s,
                isRunning: false,
                error: event.partial ? `${event.message} (часткові результати збережено)` : event.message,
              }));
              if (event.partial && event.runId) onCompletedRef.current(event.runId, true);
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // stopped by user — results preserved
        } else {
          stopTicker();
          setState((s) => ({
            ...s,
            isRunning: false,
            error: err instanceof Error ? err.message : 'Помилка пайплайна',
          }));
        }
      } finally {
        stopTicker();
        abortRef.current = null;
        requestIdRef.current = '';
        setState((s) => ({ ...s, isRunning: false }));
      }
    },
    []
  );

  return { state, start, stop };
}
