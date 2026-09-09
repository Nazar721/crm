'use client';

import { Run } from '@/lib/lead-generator/types';

interface Props {
  runs: Run[];
  activeRunId: number | null;
  onSelect: (runId: number | null) => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS: Record<string, string> = {
  running: 'Виконується',
  completed: 'Завершено',
  stopped: 'Зупинено',
  failed: 'Помилка',
};

export default function RunsList({ runs, activeRunId, onSelect }: Props) {
  if (runs.length === 0) return null;

  return (
    <div className="lg-card anim-stagger">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 className="lg-section-title" style={{ margin: 0 }}>
          Історія кампаній
        </h3>
        {activeRunId !== null && (
          <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={() => onSelect(null)}>
            Показати всі
          </button>
        )}
      </div>
      <div className="lg-runs">
        {runs.map((run) => (
          <button
            key={run.id}
            className={`lg-run-item${run.id === activeRunId ? ' lg-run-item--active' : ''}`}
            onClick={() => onSelect(run.id)}
          >
            <span>
              <strong>#{run.id}</strong> {run.niche} · {run.location} ·{' '}
              <span className="lg-hint">{formatDateTime(run.startedAt)}</span>
              {run.provider && <span className="lg-hint"> · {run.provider}</span>}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="lg-hint">
                {run.stats.leads} лідів{run.partial ? ' (частково)' : ''}
              </span>
              <span className={`lg-badge lg-badge--${run.status}`}>
                {STATUS_LABELS[run.status] || run.status}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
