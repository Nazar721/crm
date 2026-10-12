import type { DataSnapshot, FinanceSettings } from '@/types';
import type { CollectionKey } from '@/lib/datasource/types';
import { COLLECTION_KEYS } from '@/lib/datasource/types';
import { stripSecrets } from '@/lib/export';
import { generateId } from '@/lib/utils';
import type {
  HistoryAction, HistoryChange, HistoryCounts, HistoryEvent, HistoryFieldChange,
  HistoryPatch, HistorySection, HistorySource, UndoPlan, UndoPreviewRow,
} from './types';
import {
  COLLECTION_LABELS, HISTORY_LIMIT_DAYS, HISTORY_LIMIT_EVENTS,
  collectionToSection,
} from './types';

// ============================================================
// Чиста логіка журналу: фактична різниця даних → подія;
// подія + поточні дані → план відновлення (без запису).
// Той самий engine використовує локальний адаптер; серверна SQL-версія
// відтворює ті самі правила в межах crm_commit/crm_history_undo.
// ============================================================

/** Поля налаштувань, які взагалі можуть потрапити в журнал (allowlist). */
export const SETTINGS_HISTORY_KEYS = ['usdRate', 'eurRate', 'usdtRate', 'displayCurrency'] as const;

const SETTINGS_KEY_LABELS: Record<string, string> = {
  usdRate: 'курс USD',
  eurRate: 'курс EUR',
  usdtRate: 'курс USDT',
  displayCurrency: 'валюта відображення',
};

/** Групи понад ці межі зберігаються як підсумок (без деталей і без undo). */
const BULK_MAX_CHANGES = 50;
const BULK_MAX_BYTES = 96 * 1024;

type PartialState = Partial<Record<CollectionKey, unknown[]>> & { settings?: FinanceSettings };

// ------------------------------------------------------------
// Допоміжні
// ------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  // Ключі з undefined еквівалентні відсутнім: записи проходять JSON,
  // і такий ключ там не переживає (порівнюємо як JSON-еквіваленти).
  const ak = Object.entries(a as Record<string, unknown>).filter(([, v]) => v !== undefined);
  const bk = Object.entries(b as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every(([k, v]) => deepEqual(v, (b as Record<string, unknown>)[k]));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 120 ? `${json.slice(0, 117)}…` : json;
  }
  return String(value);
}

/** Короткий підпис запису — дзеркалить SQL-хелпер crm_record_label. */
export function recordLabel(collection: CollectionKey, record: unknown): string {
  const rec = asRecord(record);
  if (!rec) return collection;
  const name = [rec.name, rec.person, rec.description, rec.category, rec.title]
    .find(v => typeof v === 'string' && v.trim());
  return typeof name === 'string' && name.trim() ? name.trim() : String(rec.id ?? collection);
}

function mapById(list: unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const item of list) {
    const rec = asRecord(item);
    if (rec && typeof rec.id === 'string') out.set(rec.id, item);
  }
  return out;
}

function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>): HistoryFieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: HistoryFieldChange[] = [];
  for (const key of keys) {
    if (!deepEqual(before[key], after[key])) {
      out.push({ key, before: stripSecrets(before[key]), after: stripSecrets(after[key]) });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// ------------------------------------------------------------
// Різниця: дані → зміни
// ------------------------------------------------------------

export interface DiffCounts {
  added: number;
  removed: number;
  changed: number;
}

export function diffCollection(collection: CollectionKey, before: unknown[], after: unknown[]): HistoryChange[] {
  const b = mapById(before);
  const a = mapById(after);
  const changes: HistoryChange[] = [];
  for (const [id, rec] of a) {
    if (!b.has(id)) {
      changes.push({ collection, id, change: 'create', label: recordLabel(collection, rec), after: stripSecrets(asRecord(rec) ?? {}) });
    }
  }
  for (const [id, rec] of b) {
    if (!a.has(id)) {
      changes.push({ collection, id, change: 'delete', label: recordLabel(collection, rec), before: stripSecrets(asRecord(rec) ?? {}) });
    }
  }
  for (const [id, rec] of a) {
    const prev = b.get(id);
    if (prev !== undefined && !deepEqual(prev, rec)) {
      const prevRec = asRecord(prev) ?? {};
      const nextRec = asRecord(rec) ?? {};
      changes.push({
        collection, id, change: 'update',
        label: recordLabel(collection, rec),
        fields: fieldChanges(prevRec, nextRec),
      });
    }
  }
  return changes;
}

export function diffSettings(before: FinanceSettings, after: FinanceSettings): HistoryChange | null {
  const b = asRecord(before) ?? {};
  const a = asRecord(after) ?? {};
  const fields = SETTINGS_HISTORY_KEYS
    .filter(key => !deepEqual(b[key], a[key]))
    .map(key => ({ key, before: b[key], after: a[key] }));
  if (!fields.length) return null;
  return { collection: 'settings', id: 'settings', change: 'update', label: 'Налаштування фінансів', fields };
}

function countsOf(changes: HistoryChange[]): DiffCounts {
  return {
    added: changes.filter(c => c.change === 'create').length,
    removed: changes.filter(c => c.change === 'delete').length,
    changed: changes.filter(c => c.change === 'update').length,
  };
}

function bulkChanges(changes: HistoryChange[]): HistoryChange[] {
  const byCollection = new Map<string, HistoryChange[]>();
  for (const change of changes) {
    const key = change.collection;
    byCollection.set(key, [...(byCollection.get(key) ?? []), change]);
  }
  return [...byCollection.entries()].map(([collection, list]) => {
    const counts: HistoryCounts = countsOf(list);
    return {
      collection: collection as CollectionKey | 'settings',
      id: collection,
      change: 'bulk' as const,
      label: COLLECTION_LABELS[collection] ?? collection,
      counts,
    };
  });
}

function isBulkSize(changes: HistoryChange[]): boolean {
  if (changes.length > BULK_MAX_CHANGES) return true;
  try {
    return JSON.stringify(changes).length > BULK_MAX_BYTES;
  } catch {
    return true;
  }
}

/** Перенесення проєкту між колекціями (завершення) в одній групі. */
function detectComplete(changes: HistoryChange[]): boolean {
  const removedActive = changes.filter(c => c.collection === 'projectsActive' && c.change === 'delete');
  const addedDone = changes.filter(c => c.collection === 'projectsCompleted' && c.change === 'create');
  const removedDone = changes.filter(c => c.collection === 'projectsCompleted' && c.change === 'delete');
  const addedActive = changes.filter(c => c.collection === 'projectsActive' && c.change === 'create');
  return (removedActive.some(a => addedDone.some(d => d.id === a.id))
    || removedDone.some(a => addedActive.some(d => d.id === a.id)));
}

function sumCounts(changes: HistoryChange[]): DiffCounts {
  const total: DiffCounts = { added: 0, removed: 0, changed: 0 };
  for (const change of changes) {
    const counts = change.counts;
    if (counts) {
      total.added += counts.added;
      total.removed += counts.removed;
      total.changed += counts.changed;
    } else if (change.change === 'create') total.added += 1;
    else if (change.change === 'delete') total.removed += 1;
    else if (change.change === 'update') total.changed += 1;
  }
  return total;
}

function formatCounts(counts: DiffCounts): string {
  return `+${counts.added} −${counts.removed} ~${counts.changed}`;
}

function humanizeKey(key: string): string {
  return SETTINGS_KEY_LABELS[key] ?? key;
}

export function buildSummary(action: HistoryAction, section: HistorySection, changes: HistoryChange[]): string {
  if (action === 'import' || action === 'restore') {
    const prefix = action === 'restore' ? 'Відновлення з копії' : 'Імпорт даних';
    return `${prefix} (${formatCounts(sumCounts(changes))})`;
  }
  if (action === 'settings') {
    const keys = changes.flatMap(c => (c.fields ?? []).map(f => humanizeKey(f.key)));
    return `Налаштування: ${[...new Set(keys)].join(', ') || 'змінено'}`;
  }
  const primary = changes.find(c => c.change !== 'bulk') ?? changes[0];
  const label = primary?.label ?? 'запис';
  const extra = changes.length > 1 && action !== 'complete' ? ` · +${changes.length - 1}` : '';
  switch (action) {
    case 'create': return `Створено «${label}»${extra}`;
    case 'delete': return `Видалено «${label}»${extra}`;
    case 'complete': return `Завершено «${label}»`;
    case 'payment': return `Оплата по «${label}»`;
    case 'undo': return `Скасовано: «${label}»`;
    default: {
      const fields = changes.flatMap(c => c.fields ?? []).length;
      const one = changes.length === 1 && fields === 1
        ? `: ${humanizeKey(changes[0].fields![0].key)}`
        : fields ? ` (${fields} пол.)` : '';
      return `Змінено «${label}»${one}${extra}`;
    }
  }
}

export interface BuildEventInput {
  /** Часткові стани ДО та ПІСЛЯ (лише ключі, які порівнюємо). */
  before: PartialState;
  after: PartialState;
  ctx: { source: HistorySource; hint?: HistoryAction | null };
  /** Явне перевизначення (подія-відновлення, імпорт). */
  forced?: {
    action?: HistoryAction;
    section?: HistorySection;
    summary?: string;
    undoneEventId?: string | null;
    at?: string;
    requestId?: string | null;
    revision?: number | null;
  };
}

/**
 * Подія з ФАКТИЧНОЇ різниці. `null` — змістових змін немає
 * (зміни лише службових meta/таймстемпів не журналюються).
 */
export function buildEvent(input: BuildEventInput): HistoryEvent | null {
  const { before, after, ctx, forced } = input;
  let changes: HistoryChange[] = [];
  for (const key of COLLECTION_KEYS) {
    const b = before[key];
    const a = after[key];
    if (b && a) changes = changes.concat(diffCollection(key, b, a));
  }
  if (before.settings && after.settings) {
    const settingsChange = diffSettings(before.settings, after.settings);
    if (settingsChange) changes.push(settingsChange);
  }
  if (!changes.length) return null;

  const bulk = ctx.source === 'Імпорт' || forced?.action === 'import' || forced?.action === 'restore'
    || isBulkSize(changes);
  const detailChanges = changes;
  if (bulk) changes = bulkChanges(changes);

  // Розділ/дія: підказка джерела лише уточнює мітку; контент — різниця.
  const first = detailChanges[0];
  let section: HistorySection = forced?.section
    ?? (ctx.source === 'Імпорт' || forced?.action === 'import' || forced?.action === 'restore'
      ? 'import'
      : collectionToSection(first.collection));
  if (first.collection === 'settings' && detailChanges.length === 1) section = 'settings';

  let action: HistoryAction = forced?.action ?? 'update';
  if (!forced?.action) {
    if (detailChanges.every(c => c.collection === 'settings')) action = 'settings';
    else if (ctx.source === 'Імпорт') action = ctx.hint === 'restore' ? 'restore' : 'import';
    else if (detectComplete(detailChanges)) action = 'complete';
    else if (ctx.hint === 'payment' && detailChanges.some(c => c.collection === 'projectsActive' || c.collection === 'projectsCompleted')) action = 'payment';
    else if (detailChanges.every(c => c.change === 'create')) action = 'create';
    else if (detailChanges.every(c => c.change === 'delete')) action = 'delete';
    else action = 'update';
  }
  if (action === 'settings') section = 'settings';

  const summary = forced?.summary ?? buildSummary(action, section, changes);
  const at = forced?.at ?? new Date().toISOString();
  const id = generateId();
  return {
    id,
    at,
    requestId: forced?.requestId ?? null,
    revision: forced?.revision ?? null,
    section,
    action,
    source: ctx.source,
    summary,
    changes,
    group: id,
    undoneBy: null,
    undoneEventId: forced?.undoneEventId ?? null,
  };
}

/** Подія з повного snapshot (локальний запис після успіху). */
export function buildEventFromSnapshots(
  before: DataSnapshot,
  after: DataSnapshot,
  ctx: { source: HistorySource; hint?: HistoryAction | null },
): HistoryEvent | null {
  const toState = (snap: DataSnapshot): PartialState => {
    const state: PartialState = { settings: snap.financeSettings };
    for (const key of COLLECTION_KEYS) state[key] = snap[key] as unknown[];
    return state;
  };
  return buildEvent({ before: toState(before), after: toState(after), ctx });
}

// ------------------------------------------------------------
// Ліміти: 90 днів / 2000 груп, із захистом живих recovery-посилань
// ------------------------------------------------------------

export function enforceHistoryLimits(events: HistoryEvent[], now: number = Date.now()): HistoryEvent[] {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : -1)));
  const cutoff = new Date(now - HISTORY_LIMIT_DAYS * 86400000).toISOString();
  const expired = (event: HistoryEvent, index: number): boolean =>
    event.at < cutoff || index >= HISTORY_LIMIT_EVENTS;
  // Захист живих recovery-посилань: подія, на яку посилається УТРИМУВАНЕ
  // відновлення, не видаляється (пара лишається цілісною).
  const keptUndoTargets = new Set(
    sorted.filter((event, index) => !expired(event, index))
      .map(event => event.undoneEventId)
      .filter((id): id is string => !!id),
  );
  return sorted.filter((event, index) => !expired(event, index) || keptUndoTargets.has(event.id));
}

// ------------------------------------------------------------
// План відновлення
// ------------------------------------------------------------

interface RefTarget {
  /** Колекції, з яких можуть йти посилання. */
  from: CollectionKey[];
  keys: string[];
}

/** Посилання між сутностями (для перевірки залежностей). */
const REFERENCES: Record<string, RefTarget> = {
  clients: { from: ['projectsActive', 'projectsCompleted'], keys: ['clientId'] },
  specialists: { from: ['projectsActive', 'projectsCompleted'], keys: ['developerId'] },
  partners: { from: ['projectsActive', 'projectsCompleted'], keys: ['partnerId'] },
  projects: { from: ['transactions'], keys: ['projectId'] },
};

const REF_TARGET_COLLECTIONS: Record<string, CollectionKey[]> = {
  clientId: ['clients'],
  developerId: ['specialists'],
  partnerId: ['partners'],
  projectId: ['projectsActive', 'projectsCompleted'],
};

function idSet(list: unknown[]): Set<string> {
  return new Set([...mapById(list).keys()]);
}

/**
 * План відновлення: подія + поточні дані → патч і попередній перегляд
 * або перелік конфліктів (жодного запису тут не відбувається).
 *
 * Правила:
 * - поточні значення мають збігатися з очікуваним «після» події;
 * - відновлюються лише змістовні поля/сутності групи (patch поверх
 *   тільки зачеплених колекцій), непов'язані пізніші зміни зберігаються;
 * - створення прибирається лише за відсутності змін і залежностей;
 * - видалене повертається лише за вільного ID та валідних посилань;
 * - уся група застосовується атомарно або не застосовується взагалі.
 */
export function computeUndoPlan(event: HistoryEvent, current: DataSnapshot): UndoPlan {
  const conflicts: string[] = [];
  const preview: UndoPreviewRow[] = [];
  const touched = new Set<CollectionKey>();
  let settingsPatch: FinanceSettings | undefined;
  const patches = new Map<CollectionKey, unknown[]>();

  const viewOf = (key: CollectionKey): unknown[] => patches.get(key) ?? (current[key] as unknown[]);

  for (const change of event.changes) {
    if (change.change === 'bulk') {
      conflicts.push('Занадто велика група змін збережена як підсумок — скасування недоступне.');
      continue;
    }

    if (change.collection === 'settings') {
      const currentSettings = asRecord(current.financeSettings) ?? {};
      const fields = change.fields ?? [];
      const lines: UndoPreviewRow['lines'] = [];
      for (const field of fields) {
        const currentValue = currentSettings[field.key];
        if (!deepEqual(currentValue, field.after)) {
          conflicts.push(`Налаштування «${humanizeKey(field.key)}» змінилося після цієї події — не перезаписую.`);
        } else {
          lines.push({ key: humanizeKey(field.key), from: displayValue(currentValue), to: displayValue(field.before) });
        }
      }
      if (lines.length) {
        preview.push({ collection: 'settings', id: 'settings', label: 'Налаштування фінансів', change: 'update', lines });
        settingsPatch = {
          ...current.financeSettings,
          ...Object.fromEntries(fields.map(f => [f.key, f.before])),
        } as FinanceSettings;
      }
      continue;
    }

    const key = change.collection as CollectionKey;
    touched.add(key);
    const list = viewOf(key);
    const byId = mapById(list);
    const next = [...list];

    if (change.change === 'create') {
      const record = byId.get(change.id);
      if (!record) {
        conflicts.push(`«${change.label ?? change.id}» уже видалено — запису немає для прибирання.`);
        continue;
      }
      if (!deepEqual(record, change.after)) {
        conflicts.push(`«${change.label ?? change.id}» змінився після створення — прибирання втратило б нові дані.`);
        continue;
      }
      preview.push({
        collection: key, id: change.id, label: change.label ?? change.id, change: 'create',
        lines: [], note: 'Запис буде прибрано (скасування створення)',
      });
      patches.set(key, next.filter(item => asRecord(item)?.id !== change.id));
      continue;
    }

    if (change.change === 'delete') {
      if (byId.has(change.id)) {
        conflicts.push(`Запис «${change.label ?? change.id}» уже існує (ID зайнято) — попередній ID не повернуто.`);
        continue;
      }
      const restored = change.before;
      if (!restored) {
        conflicts.push(`Немає збереженого вмісту «${change.label ?? change.id}» для відновлення.`);
        continue;
      }
      preview.push({
        collection: key, id: change.id, label: change.label ?? change.id, change: 'delete',
        lines: [], note: 'Запис буде повернено з попереднім ID',
      });
      patches.set(key, [...next, restored]);
      continue;
    }

    // update
    const record = asRecord(byId.get(change.id));
    if (!record) {
      conflicts.push(`«${change.label ?? change.id}» видалено після цієї події — поля відновити нема де.`);
      continue;
    }
    const fields = change.fields ?? [];
    const lines: UndoPreviewRow['lines'] = [];
    const restored: Record<string, unknown> = {};
    for (const field of fields) {
      const currentValue = record[field.key];
      if (!deepEqual(currentValue, field.after)) {
        conflicts.push(`«${change.label ?? change.id}», поле «${humanizeKey(field.key)}» змінилося після цієї події — не перезаписую.`);
      } else {
        lines.push({ key: humanizeKey(field.key), from: displayValue(currentValue), to: displayValue(field.before) });
        restored[field.key] = field.before;
      }
    }
    if (lines.length) {
      preview.push({ collection: key, id: change.id, label: change.label ?? change.id, change: 'update', lines });
      patches.set(key, next.map(item => {
        const rec = asRecord(item);
        return rec && rec.id === change.id ? { ...rec, ...restored } : item;
      }));
    }
  }

  if (conflicts.length) return { ok: false, conflicts };

  // ---- Перевірка залежностей і унікальності на КІНЦЕВОМУ стані ----
  const projectSet = new Set([...idSet(viewOf('projectsActive')), ...idSet(viewOf('projectsCompleted'))]);

  // Унікальність ID проєктів між активними/завершеними.
  const activeIds = idSet(viewOf('projectsActive'));
  for (const id of idSet(viewOf('projectsCompleted'))) {
    if (activeIds.has(id)) {
      conflicts.push(`Проєкт «${id}» одночасно в активних і завершених — унікальність ID порушено.`);
    }
  }

  const existsIn = (collections: CollectionKey[], id: string): boolean =>
    collections.some(c => (c === 'projectsActive' || c === 'projectsCompleted' ? projectSet : idSet(viewOf(c))).has(id));

  // Логічна сутність «проєкт» існує в будь-якій із двох колекцій.
  const stillExists = (collection: string, id: string): boolean =>
    collection === 'projectsActive' || collection === 'projectsCompleted'
      ? projectSet.has(id)
      : idSet(viewOf(collection as CollectionKey)).has(id);

  const refTargetFor = (collection: string): RefTarget | undefined =>
    collection === 'projectsActive' || collection === 'projectsCompleted'
      ? REFERENCES.projects
      : REFERENCES[collection];

  // Прибрані записи (скасування створення): на них не повинні посилатися інші.
  for (const change of event.changes) {
    if (change.change !== 'create' || change.collection === 'settings') continue;
    if (stillExists(change.collection, change.id)) continue; // запис лишився в іншій колекції
    const target = refTargetFor(change.collection);
    if (!target) continue;
    for (const from of target.from) {
      const records = viewOf(from);
      const referencing = records.filter(item => {
        const rec = asRecord(item);
        return rec && target.keys.some(k => rec[k] === change.id);
      });
      if (referencing.length) {
        conflicts.push(`«${change.label ?? change.id}» не можна прибрати: на нього посилається ${referencing.length} запис(ів).`);
      }
    }
  }

  // Відновлені/додані записи: їхні посилання мають бути валідними.
  const checkRefs = (collection: CollectionKey, rec: Record<string, unknown>, context: string): void => {
    for (const refKey of Object.keys(REF_TARGET_COLLECTIONS)) {
      if (!Object.prototype.hasOwnProperty.call(REF_TARGET_COLLECTIONS, refKey)) continue;
      const value = rec[refKey];
      if (typeof value !== 'string' || !value) continue;
      if (!existsIn(REF_TARGET_COLLECTIONS[refKey], value)) {
        conflicts.push(`${context}: посилання «${refKey}» веде на відсутній запис (ID ${value}).`);
      }
    }
    void collection;
  };
  for (const change of event.changes) {
    if (change.collection === 'settings') continue;
    const key = change.collection as CollectionKey;
    if (change.change === 'delete' && change.before) {
      checkRefs(key, asRecord(change.before) ?? {}, `Повернення «${change.label ?? change.id}»`);
    }
    if (change.change === 'update') {
      const record = asRecord(mapById(viewOf(key)).get(change.id)) ?? {};
      const refKeys = (change.fields ?? []).map(f => f.key).filter(k => k in REF_TARGET_COLLECTIONS);
      if (refKeys.length) {
        const restoredRec = { ...record, ...Object.fromEntries((change.fields ?? []).filter(f => refKeys.includes(f.key)).map(f => [f.key, f.before])) };
        checkRefs(key, restoredRec, `Відновлення «${change.label ?? change.id}»`);
      }
    }
  }

  if (conflicts.length) return { ok: false, conflicts };

  const patch: HistoryPatch = {};
  if (patches.size) {
    patch.collections = {};
    for (const [key, value] of patches) patch.collections[key] = value;
  }
  if (settingsPatch) patch.settings = settingsPatch;
  return { ok: true, patch, preview };
}

/** Підсумковий стан для локального застосування (без перевірки конфліктів). */
export function patchSnapshot(snapshot: DataSnapshot, patch: HistoryPatch): DataSnapshot {
  const next: DataSnapshot = { ...snapshot };
  if (patch.collections) {
    for (const [key, value] of Object.entries(patch.collections)) {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (patch.settings) next.financeSettings = patch.settings;
  return next;
}

// ------------------------------------------------------------
// Нормалізація подій з неповірених джерел (імпорт історії, старі записи)
// ------------------------------------------------------------

const CHANGE_KINDS = new Set(['create', 'update', 'delete', 'bulk']);

function normalizeChange(raw: unknown): HistoryChange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const collection = r.collection;
  const validCollection = collection === 'settings'
    || (COLLECTION_KEYS as readonly string[]).includes(String(collection));
  if (!validCollection) return null;
  const change = String(r.change);
  if (!CHANGE_KINDS.has(change)) return null;
  if (typeof r.id !== 'string') return null;
  const out: HistoryChange = {
    collection: collection as CollectionKey | 'settings',
    id: r.id,
    change: change as HistoryChange['change'],
  };
  if (typeof r.label === 'string') out.label = r.label.slice(0, 200);
  if (Array.isArray(r.fields)) {
    out.fields = r.fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as Record<string, unknown>).key === 'string')
      .map(f => ({ key: String(f.key).slice(0, 80), before: stripSecrets(f.before), after: stripSecrets(f.after) }))
      .slice(0, 200);
  }
  if (r.before && typeof r.before === 'object' && !Array.isArray(r.before)) out.before = stripSecrets(r.before as Record<string, unknown>);
  if (r.after && typeof r.after === 'object' && !Array.isArray(r.after)) out.after = stripSecrets(r.after as Record<string, unknown>);
  if (r.counts && typeof r.counts === 'object') {
    const c = r.counts as Record<string, unknown>;
    out.counts = {
      added: Math.max(0, Number(c.added) || 0),
      removed: Math.max(0, Number(c.removed) || 0),
      changed: Math.max(0, Number(c.changed) || 0),
    };
  }
  if (out.change === 'bulk' && !out.counts) return null;
  return out;
}

/**
 * Оборонний розбір події з будь-якого джерела. Секрети вилучаються,
 * невідомі значення відкидаються; `null` — подія непридатна.
 */
export function normalizeHistoryEvent(raw: unknown): HistoryEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim() || r.id.length > 100) return null;
  if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null;
  const section = (['projects', 'clients', 'finance', 'specialists', 'partners', 'debts', 'savings', 'settings', 'import'] as const)
    .find(s => s === r.section);
  if (!section) return null;
  const action = (['create', 'update', 'delete', 'complete', 'payment', 'settings', 'import', 'restore', 'undo'] as const)
    .find(a => a === r.action);
  if (!action) return null;
  const source = (['Форма', 'Помічник', 'Імпорт', 'Система', 'Застасунок'] as const)
    .find(s => s === r.source) ?? 'Застасунок';
  const changes = (Array.isArray(r.changes) ? r.changes : [])
    .map(normalizeChange)
    .filter((c): c is HistoryChange => !!c);
  if (!changes.length) return null;
  const optionalId = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() && value.length <= 100 ? value : null;
  return {
    id: r.id,
    at: r.at,
    requestId: typeof r.requestId === 'string' ? r.requestId : null,
    revision: Number.isFinite(Number(r.revision)) && r.revision !== null ? Number(r.revision) : null,
    section,
    action,
    source,
    summary: typeof r.summary === 'string' ? r.summary.slice(0, 400) : '',
    changes,
    group: typeof r.group === 'string' && r.group ? r.group : r.id,
    undoneBy: optionalId(r.undoneBy),
    undoneEventId: optionalId(r.undoneEventId),
    imported: r.imported === true ? true : undefined,
  };
}
