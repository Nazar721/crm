import type { CollectionKey } from '@/lib/datasource/types';
import type { FinanceSettings } from '@/types';

// ============================================================
// Пакет 03: журнал історії змін і скасування.
// Журнал — окремий шар від DataSnapshot: він НЕ потрапляє у snapshot,
// експорт даних чи AI-контекст як повні дані (лише короткі підсумки).
// Подія описує ФАКТИЧНУ різницю даних групи (один commit = одна група).
// ============================================================

/** Джерело події — інформаційний атрибут, не доказ авторизації. */
export const HISTORY_SOURCES = ['Форма', 'Помічник', 'Імпорт', 'Система', 'Застасунок'] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];

export const HISTORY_SECTIONS = [
  'projects', 'clients', 'finance', 'specialists',
  'partners', 'debts', 'savings', 'settings', 'import',
] as const;
export type HistorySection = (typeof HISTORY_SECTIONS)[number];

export const HISTORY_ACTIONS = [
  'create', 'update', 'delete', 'complete', 'payment',
  'settings', 'import', 'restore', 'undo',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export type HistoryChangeKind = 'create' | 'update' | 'delete' | 'bulk';

export interface HistoryFieldChange {
  key: string;
  before: unknown;
  after: unknown;
  /**
   * Наявність ключа в записі ОКРЕМО від значення (ревізія 3):
   * відсутній ключ ≠ явний JSON-null. Події без прапорців (старі
   * TS-події) трактуються за наявністю самого ключя в JSON.
   */
  beforeExists?: boolean;
  afterExists?: boolean;
}

export interface HistoryCounts {
  added: number;
  removed: number;
  changed: number;
}

export interface HistoryChange {
  /** Сутність (колекція) або 'settings' для налаштувань фінансів. */
  collection: CollectionKey | 'settings';
  id: string;
  change: HistoryChangeKind;
  /** Короткий підпис запису («запис» у таблиці журналу). */
  label?: string;
  /** Для update: лише змінені поля. */
  fields?: HistoryFieldChange[];
  /** Для delete: повний запис для відновлення. */
  before?: Record<string, unknown>;
  /** Для create: повний запис (для перевірки при скасуванні). */
  after?: Record<string, unknown>;
  /** Для bulk (імпорт/великі групи): лише підсумок, без вмісту. */
  counts?: HistoryCounts;
}

export interface HistoryEvent {
  id: string;
  /** Час події (для сервера — час БД; для локального — час пристрою). */
  at: string;
  requestId: string | null;
  /** Ревізія даних ПІСЛЯ запису події (сервер). */
  revision: number | null;
  section: HistorySection;
  action: HistoryAction;
  source: HistorySource;
  summary: string;
  changes: HistoryChange[];
  /** Група логічної операції: у першій версії = id події (1 commit = 1 група). */
  group: string;
  /** Подія-відновлення, яка вже скасувала цю (id). */
  undoneBy: string | null;
  /** Для подій-відновлень: яку подію скасовано. */
  undoneEventId: string | null;
  /** Імпортована (недовіра) подія: лише перегляд, без скасування. */
  imported?: boolean;
}

export interface HistoryQuery {
  limit?: number;
  offset?: number;
  section?: HistorySection | null;
  action?: HistoryAction | null;
  /** ISO-час початку періоду (включно). */
  from?: string | null;
  /** ISO-час кінця періоду (включно). */
  to?: string | null;
}

export interface HistoryListResult {
  events: HistoryEvent[];
  total: number;
}

/** Патч відновлення: лише зачеплені колекції (повні масиви) та налаштування. */
export interface HistoryPatch {
  collections?: Partial<Record<CollectionKey, unknown[]>>;
  settings?: FinanceSettings;
}

export interface HistoryUndoRequest {
  eventId: string;
  requestId: string;
  source: HistorySource;
  /** Ревізія, на якій розраховано патч (сервер перевіряє під блокуванням). */
  expectedRevision?: number | null;
}

export type HistoryUndoReason =
  | 'not_found'
  | 'not_undoable'
  | 'already_undone'
  | 'conflict'
  | 'denied'
  | 'write_failed';

export type HistoryUndoResult =
  | { ok: true; event: HistoryEvent | null }
  | { ok: false; reason: HistoryUndoReason; message: string; conflicts?: string[] };

/** Рядок попереднього перегляду відновлення. */
export interface UndoPreviewRow {
  collection: CollectionKey | 'settings';
  id: string;
  label: string;
  change: HistoryChangeKind;
  /** Що буде відновлено: значення зараз → значення до події. */
  lines: { key: string; from: string; to: string }[];
  /** Службовий підпис для create/delete («видалити»/«повернути»). */
  note?: string;
}

export type UndoPlan =
  | { ok: true; patch: HistoryPatch; preview: UndoPreviewRow[] }
  | { ok: false; conflicts: string[] };

/** Прапорець «скасування доступне» для кнопки в UI. */
export function isUndoable(event: HistoryEvent): boolean {
  if (event.imported) return false;
  if (event.action === 'import' || event.action === 'restore' || event.action === 'undo') return false;
  if (event.undoneBy) return false;
  if (event.changes.some(c => c.change === 'bulk')) return false;
  return true;
}

/** Межі першої версії: останні 90 днів і максимум 2000 груп на власника. */
export const HISTORY_LIMIT_DAYS = 90;
export const HISTORY_LIMIT_EVENTS = 2000;

export const SECTION_LABELS: Record<HistorySection, string> = {
  projects: 'Проєкти',
  clients: 'Клієнти',
  finance: 'Фінанси',
  specialists: 'Фахівці',
  partners: 'Партнери',
  debts: 'Борги',
  savings: 'Відкладення',
  settings: 'Налаштування',
  import: 'Системні',
};

/** Підписи колекцій у деталях події (дзеркалить SQL crm_collection_label). */
export const COLLECTION_LABELS: Record<string, string> = {
  projectsActive: 'Активні проєкти',
  projectsCompleted: 'Завершені проєкти',
  clients: 'Клієнти',
  specialists: 'Фахівці',
  partners: 'Партнери',
  transactions: 'Фінанси',
  personalDebts: 'Борги',
  savings: 'Відкладення',
  settings: 'Налаштування фінансів',
};

export const ACTION_LABELS: Record<HistoryAction, string> = {
  create: 'Створено',
  update: 'Змінено',
  delete: 'Видалено',
  complete: 'Завершено',
  payment: 'Оплата',
  settings: 'Налаштування',
  import: 'Імпорт',
  restore: 'Відновлення',
  undo: 'Скасування',
};

export function collectionToSection(collection: CollectionKey | 'settings'): HistorySection {
  switch (collection) {
    case 'projectsActive':
    case 'projectsCompleted': return 'projects';
    case 'transactions': return 'finance';
    case 'personalDebts': return 'debts';
    case 'savings': return 'savings';
    case 'clients': return 'clients';
    case 'specialists': return 'specialists';
    case 'partners': return 'partners';
    case 'settings': return 'settings';
    default: return 'import';
  }
}

/** Сировина клієнтського запису → джерело журналу (без вгадувань). */
export function normalizeHistorySource(value: unknown): HistorySource {
  return (HISTORY_SOURCES as readonly string[]).includes(String(value)) ? (value as HistorySource) : 'Застасунок';
}

export function normalizeHistoryAction(value: unknown): HistoryAction | null {
  return (HISTORY_ACTIONS as readonly string[]).includes(String(value)) ? (value as HistoryAction) : null;
}

export function normalizeHistorySection(value: unknown): HistorySection | null {
  return (HISTORY_SECTIONS as readonly string[]).includes(String(value)) ? (value as HistorySection) : null;
}
