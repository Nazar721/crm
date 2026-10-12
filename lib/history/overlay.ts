import { HISTORY_LIMIT_EVENTS, type HistoryEvent } from './types';
import { normalizeHistoryEvent } from './engine';
import { stripSecrets } from '@/lib/export';

// ============================================================
// Імпортована історія — НЕДОВІРИЙ локальний шар (окремий ключ).
// Такі події лише переглядаються: вони не є серверним журналом,
// не дають права на скасування і не потрапляють у довірений список.
// ============================================================

const IMPORTED_KEY = 'crm_history_imported_v1';

export interface HistoryExportPayload {
  app: 'CRM history export';
  version: 1;
  exportedAt: string;
  events: unknown[];
}

export function readImportedHistory(): HistoryEvent[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(IMPORTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { events?: unknown[] };
    const events = (Array.isArray(parsed?.events) ? parsed.events : [])
      .map(normalizeHistoryEvent)
      .filter((e): e is HistoryEvent => !!e)
      .map(e => ({ ...e, imported: true }));
    return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, HISTORY_LIMIT_EVENTS);
  } catch {
    return [];
  }
}

export type HistoryImportResult =
  | { ok: true; added: number; skipped: number }
  | { ok: false; message: string };

/** Імпорт історії з JSON-файлу (окремо від журналу даних). */
export function importHistoryPayload(raw: unknown): HistoryImportResult {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'Непридатний файл історії' };
  const payload = raw as Partial<HistoryExportPayload> & { history?: unknown };
  const list = Array.isArray(payload.events) ? payload.events
    : Array.isArray((payload.history as { events?: unknown })?.events) ? (payload.history as { events: unknown[] }).events
    : null;
  if (!list) return { ok: false, message: 'У файлі немає списку подій історії' };
  if (list.length > HISTORY_LIMIT_EVENTS * 2) {
    return { ok: false, message: 'Файл задовгий для журналу історії' };
  }
  const normalized = list
    .map(e => normalizeHistoryEvent(stripSecrets(e)))
    .filter((e): e is HistoryEvent => !!e)
    .map(e => ({ ...e, imported: true }));
  if (!normalized.length) return { ok: false, message: 'Жодна подія з файлу не пройшла перевірку' };
  const existing = readImportedHistory();
  const known = new Set(existing.map(e => e.id));
  const added = normalized.filter(e => !known.has(e.id));
  if (!added.length) return { ok: false, message: 'Нових подій для імпорту немає' };
  try {
    const merged = [...existing, ...added]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, HISTORY_LIMIT_EVENTS);
    localStorage.setItem(IMPORTED_KEY, JSON.stringify({ v: 1, events: merged }));
    return { ok: true, added: added.length, skipped: normalized.length - added.length };
  } catch {
    return { ok: false, message: 'Перевищено ліміт локального сховища при запису імпортованої історії' };
  }
}

export function clearImportedHistory(): void {
  try {
    if (typeof window !== 'undefined') localStorage.removeItem(IMPORTED_KEY);
  } catch {
    // Неможливість прибрати імпортований шар не впливає на дані чи журнал.
  }
}

export function buildHistoryExport(events: HistoryEvent[]): HistoryExportPayload {
  return {
    app: 'CRM history export',
    version: 1,
    exportedAt: new Date().toISOString(),
    events: stripSecrets(events),
  };
}
