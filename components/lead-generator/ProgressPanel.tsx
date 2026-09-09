'use client';

import { PipelineState } from '@/hooks/lead-generator/usePipeline';

const STAGE_LABELS: Record<string, string> = {
  generating_queries: 'Генерація запитів',
  searching: 'Пошук DuckDuckGo',
  deduplicating: 'Дедуплікація',
  scanning: 'Сканування сайтів',
  ai_analysis: 'AI-аналіз',
  scoring: 'Фінальний скоринг',
  completed: 'Завершено',
};

const STAGE_ORDER = [
  'generating_queries',
  'searching',
  'deduplicating',
  'scanning',
  'ai_analysis',
  'scoring',
];

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export default function ProgressPanel({ state }: { state: PipelineState }) {
  if (!state.isRunning && !state.stage) return null;

  const currentIndex = STAGE_ORDER.indexOf(state.stage);
  const showStages = state.isRunning || (state.stage && state.stage !== 'error');

  return (
    <div className="lg-card anim-stagger">
      {showStages && (
        <div className="lg-stages">
          {STAGE_ORDER.map((stage, idx) => {
            const isCurrent = state.isRunning && state.stage === stage;
            const isDone = !state.isRunning || (currentIndex > idx && currentIndex !== -1);
            return (
              <div
                key={stage}
                className={`lg-stage${isCurrent ? ' lg-stage--current' : ''}${isDone && !isCurrent ? ' lg-stage--done' : ''}`}
              >
                <span className="lg-stage-dot" />
                <span style={{ flex: 1 }}>{STAGE_LABELS[stage]}</span>
                {isCurrent && state.total > 0 && (
                  <span>
                    {state.current}/{state.total}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {state.total > 0 && state.isRunning && (
        <div className="lg-progressbar">
          <div
            className="lg-progressbar-fill"
            style={{ width: `${Math.min(100, (state.current / state.total) * 100)}%` }}
          />
        </div>
      )}

      {(state.message || state.isRunning) && (
        <div className="lg-progress-meta">
          <span>{state.message}</span>
          {state.startTime && <span>⏱ {formatDuration(state.elapsedMs)}</span>}
        </div>
      )}
    </div>
  );
}
