'use client';
import { useCallback, useEffect, useState } from 'react';
import * as store from '@/lib/store';
import { emitToast } from '@/lib/toast-bus';
import { formatDateTime } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import {
  ACTION_LABELS, COLLECTION_LABELS, HISTORY_ACTIONS, HISTORY_SECTIONS,
  SECTION_LABELS, isUndoable,
  type HistoryAction, type HistoryEvent, type HistorySection, type UndoPreviewRow,
} from '@/lib/history/types';
import {
  buildHistoryExport, clearImportedHistory, importHistoryPayload, readImportedHistory,
} from '@/lib/history/overlay';

// ============================================================
// Вкладка «Налаштування → Історія змін» (пакет 03).
// Читає журнал (remote або local), показує деталі «було → стало»,
// попередній перегляд відновлення та явне підтвердження скасування.
// Імпортована історія — окремий недовірий блок лише для перегляду.
// ============================================================

const PAGE_SIZE = 20;

interface PreviewState {
  event: HistoryEvent;
  rows: UndoPreviewRow[];
}

export default function HistorySection() {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [section, setSection] = useState<HistorySection | ''>('');
  const [action, setAction] = useState<HistoryAction | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<HistoryEvent[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await store.listHistory({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        section: section || null,
        action: action || null,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : null,
      });
      setEvents(result.events);
      setTotal(result.total);
    } catch (err) {
      setEvents([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Не вдалося прочитати журнал історії.');
    }
  }, [page, section, action, from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setImported(readImportedHistory()); }, []);

  const changeFilters = (patch: Partial<{ section: HistorySection | ''; action: HistoryAction | ''; from: string; to: string }>) => {
    if ('section' in patch) setSection(patch.section ?? '');
    if ('action' in patch) setAction(patch.action ?? '');
    if ('from' in patch) setFrom(patch.from ?? '');
    if ('to' in patch) setTo(patch.to ?? '');
    setPage(0);
  };

  const recordLabel = (event: HistoryEvent): string => {
    const first = event.changes[0];
    if (!first) return '—';
    const base = first.label ?? COLLECTION_LABELS[first.collection] ?? first.collection;
    return event.changes.length > 1 ? `${base} (+${event.changes.length - 1})` : base;
  };

  const changeSummary = (change: HistoryEvent['changes'][number]): string => {
    if (change.change === 'bulk' && change.counts) {
      return `+${change.counts.added} −${change.counts.removed} ~${change.counts.changed}`;
    }
    if (change.change === 'create') return 'запис буде прибрано (скасування створення)';
    if (change.change === 'delete') return 'запис буде повернено';
    return (change.fields ?? []).map(f => `${f.key}: ${formatValue(f.before)} → ${formatValue(f.after)}`).join('; ') || '—';
  };

  const openPreview = async (event: HistoryEvent) => {
    setBusy(true);
    try {
      const result = await store.previewUndo(event.id);
      if (!result.ok) {
        emitToast(result.conflicts?.length ? `${result.message} ${result.conflicts.join(' ')}` : result.message, 'error');
        return;
      }
      setPreview({ event: result.event, rows: result.preview });
    } catch (err) {
      emitToast(err instanceof Error ? err.message : 'Не вдалося підготувати перегляд', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmUndo = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await store.undoHistory({
        eventId: preview.event.id,
        requestId: crypto.randomUUID(),
        source: 'Форма',
      });
      if (!result.ok) {
        const details = result.conflicts?.length ? ` ${result.conflicts.join(' ')}` : '';
        emitToast(`${result.message}${details}`, 'error');
        return;
      }
      emitToast('Зміну скасовано — у журналі з’явилася нова подія відновлення', 'success');
      setPreview(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const exportHistory = async () => {
    try {
      const result = await store.listHistory({ limit: 2000, offset: 0 });
      const payload = buildHistoryExport(result.events);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date();
      a.download = `crm-history-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      emitToast(`Не вдалося експортувати історію: ${String(err)}`, 'error');
    }
  };

  const importHistoryFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => emitToast('Не вдалося прочитати файл', 'error');
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const result = importHistoryPayload(parsed);
        if (!result.ok) {
          emitToast(result.message, 'error');
          return;
        }
        emitToast(`Імпортовано подій: ${result.added}. Це лише перегляд — права на скасування вони не дають.`, 'success');
        setImported(readImportedHistory());
      } catch (err) {
        emitToast(`Некоректний JSON: ${String(err)}`, 'error');
      }
    };
    reader.readAsText(file);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="settings-grid">
      <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
        <h3 className="settings-title">Історія змін</h3>
        <p className="settings-text" style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 0 }}>
          Журнал починається після встановлення цього пакета — старішої історії система не вигадує.
          Зберігаються останні 90 днів і максимум 2000 груп змін; за межами збереженого
          скасування недоступне. Скасування відновлює лише зміст поля/сутності цієї групи;
          непов’язані пізніші зміни зберігаються. Відновлення з резервної копії фіксується
          окремою подією без кнопки скасування — сам журнал не є резервною копією.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', margin: '12px 0' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem' }}>
            Розділ
            <select className="form-input" value={section} onChange={e => changeFilters({ section: e.target.value as HistorySection | '' })}>
              <option value="">Усі</option>
              {HISTORY_SECTIONS.map(s => <option key={s} value={s}>{SECTION_LABELS[s]}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem' }}>
            Дія
            <select className="form-input" value={action} onChange={e => changeFilters({ action: e.target.value as HistoryAction | '' })}>
              <option value="">Усі</option>
              {HISTORY_ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem' }}>
            З
            <input type="date" className="form-input" value={from} onChange={e => changeFilters({ from: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem' }}>
            По
            <input type="date" className="form-input" value={to} onChange={e => changeFilters({ to: e.target.value })} />
          </label>
          <button className="btn btn-ghost" onClick={() => changeFilters({ section: '', action: '', from: '', to: '' })}>Скинути</button>
          <button className="btn btn-ghost" onClick={() => void load()}>Оновити</button>
          <button className="btn btn-ghost" onClick={() => void exportHistory()}>Експортувати історію</button>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            Імпортувати історію
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={e => { importHistoryFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
        </div>
        {error && (
          <div className="backup-warning" style={{ marginBottom: 12 }}>
            <strong>Журнал недоступний</strong>
            <p style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>{error}</p>
          </div>
        )}
        {events.length === 0 && !error && (
          <p className="settings-text">Подій за обраними фільтрами немає.</p>
        )}
        {events.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата й час</th>
                  <th>Розділ</th>
                  <th>Дія</th>
                  <th>Джерело</th>
                  <th>Запис</th>
                  <th>Опис</th>
                  <th aria-label="Дії" />
                </tr>
              </thead>
              <tbody>
                {events.map(event => (
                  <EventRow
                    key={event.id}
                    event={event}
                    expanded={expanded === event.id}
                    busy={busy}
                    onToggle={() => setExpanded(expanded === event.id ? null : event.id)}
                    onUndo={() => void openPreview(event)}
                    recordLabel={recordLabel(event)}
                    changeSummary={changeSummary}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              Сторінка {page + 1} з {pages} · подій: {total}
            </span>
            <button className="btn btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Далі</button>
          </div>
        )}
      </div>

      {imported.length > 0 && (
        <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
          <h3 className="settings-title">Імпортована історія (лише перегляд)</h3>
          <p className="settings-text" style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 0 }}>
            Ці події завантажені з файлу: вони не є серверним журналом, не дають права на
            скасування і не впливають на дані.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {imported.slice(0, 100).map(event => (
              <li key={event.id} style={{ marginBottom: 4, fontSize: '0.8rem' }}>
                <span className="badge badge--orange" style={{ marginRight: 6 }}>імпортована</span>
                {formatDateTime(event.at)} · {SECTION_LABELS[event.section]} · {ACTION_LABELS[event.action]} · {event.summary}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={() => { clearImportedHistory(); setImported([]); }}>
              Очистити імпортовану історію
            </button>
          </div>
        </div>
      )}

      <Modal isOpen={!!preview} onClose={() => { if (!busy) setPreview(null); }} title="Попередній перегляд відновлення" size="lg">
        {preview && (
          <>
            <p style={{ marginTop: 0 }}>
              Скасування: <strong>{preview.event.summary}</strong>. Буде відновлено лише наведені
              нижче значення цієї групи; інші зміни не постраждають. Після підтвердження
              створиться нова подія відновлення (стара лишиться у журналі).
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Сутність</th><th>Запис</th><th>Що буде відновлено</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={`${row.collection}:${row.id}:${index}`}>
                      <td data-label="Сутність">{COLLECTION_LABELS[row.collection] ?? row.collection}</td>
                      <td data-label="Запис">{row.label}</td>
                      <td data-label="Що буде відновлено">
                        {row.note ? row.note : row.lines.map(line => (
                          <div key={line.key} style={{ fontSize: '0.8rem' }}>
                            <strong>{line.key}</strong>: {line.from} → {line.to}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={busy}>Скасувати</button>
              <button className="btn btn-danger" onClick={() => void confirmUndo()} disabled={busy}>
                {busy ? 'Виконую…' : 'Підтвердити відновлення'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 100 ? `${json.slice(0, 97)}…` : json;
  }
  return String(value);
}

function EventRow({
  event, expanded, busy, onToggle, onUndo, recordLabel, changeSummary,
}: {
  event: HistoryEvent;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onUndo: () => void;
  recordLabel: string;
  changeSummary: (change: HistoryEvent['changes'][number]) => string;
}) {
  const restoreEvent = event.action === 'import' || event.action === 'restore';
  const canUndo = isUndoable(event);
  return (
    <>
      <tr>
        <td data-label="Дата й час" className="cell-nowrap">
          <button
            className="btn btn-ghost"
            style={{ padding: 0, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {formatDateTime(event.at)}
          </button>
        </td>
        <td data-label="Розділ">{SECTION_LABELS[event.section]}</td>
        <td data-label="Дія">
          <span className={`badge badge--${event.action === 'undo' ? 'purple' : event.action === 'import' || event.action === 'restore' ? 'orange' : 'blue'}`}>
            {ACTION_LABELS[event.action]}
          </span>
          {event.undoneBy && <span className="badge badge--orange" style={{ marginLeft: 6 }}>скасовано</span>}
        </td>
        <td data-label="Джерело">{event.source}</td>
        <td data-label="Запис" className="cell-name">{recordLabel}</td>
        <td data-label="Опис">{event.summary}</td>
        <td data-label="Дії" style={{ whiteSpace: 'nowrap' }}>
          {restoreEvent ? (
            <a className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.75rem' }} href="/settings?tab=backup">
              Відновити з копії
            </a>
          ) : canUndo ? (
            <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={onUndo} disabled={busy}>
              Скасувати зміну
            </button>
          ) : null}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} data-label="Деталі" style={{ background: 'var(--bg-secondary, transparent)' }}>
            <div style={{ fontSize: '0.8rem' }}>
              {event.changes.map((change, index) => (
                <div key={`${change.collection}:${change.id}:${index}`} style={{ marginBottom: 6 }}>
                  <strong>{COLLECTION_LABELS[change.collection] ?? change.collection}</strong>
                  {change.label ? ` · ${change.label}` : ''} — {changeSummary(change)}
                </div>
              ))}
              <div style={{ color: 'var(--text-tertiary)' }}>ID події: {event.id}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
