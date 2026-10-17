import type { BackupInfo, DataSnapshot, FinanceSettings } from '@/types';
import type {
  HistoryEvent, HistoryListResult, HistoryPatch, HistoryQuery,
  HistoryUndoRequest, HistoryUndoResult,
} from '@/lib/history/types';

// ============================================================
// Контракт сховища даних (етап 1: локальний адаптер;
// етап 2: серверна база реалізує той самий інтерфейс).
// Сторінки та форми не знають, чи дані з localStorage чи з БД:
// вони працюють із snapshot у пам'яті (див. lib/store.ts).
// ============================================================

export const COLLECTION_KEYS = [
  'projectsActive',
  'projectsCompleted',
  'clients',
  'specialists',
  'partners',
  'transactions',
  'personalDebts',
  'savings',
  'hostingServices',
  'hostingPayments',
  'tasks',
  'plannedProjects',
] as const;

export type CollectionKey = (typeof COLLECTION_KEYS)[number];

export type StorageIssueKind =
  | 'corrupt_json'      // непридатний JSON у сховищі
  | 'read_failed'       // збій читання
  | 'write_failed'      // збій запису
  | 'quota_exceeded'    // перевищено ліміт сховища
  | 'import_failed'     // збій під час імпорту
  | 'restore_failed';   // не вдалося відновити попередній стан

export interface StorageIssue {
  id: string;
  kind: StorageIssueKind;
  key?: string;
  /** Колекція даних, до якої відноситься проблема (для коректних ключів). */
  collection?: CollectionKey;
  message: string;
  at: string;
  /** Дані збережено в резервному ключі (для corrupt_json). */
  preservedAt?: string;
}

export type WriteOutcome =
  | { ok: true }
  | { ok: false; issue: StorageIssue };

export interface DataSnapshotPayload {
  data: DataSnapshot;
  issues: StorageIssue[];
  /**
   * Сирий вміст пошкоджених колекцій (ті, для яких JSON не розібрався).
   * Використовується для відновлення БЕЗ залежності від карантинної копії.
   */
  corruptRaw: Partial<Record<CollectionKey, string>>;
}

/** Стан здоров'я даних колекції — незалежний від журналу повідомлень. */
export type CollectionHealth = 'corrupt';

/**
 * Асинхронне джерело даних.
 *
 * Гарантії локального адаптера:
 * - `load()` НЕ кидає виняток через непридатний JSON: пошкоджений ключ
 *   ізольовується (кварантується) і потрапляє в `issues`;
 * - `load()` НЕ кидає виняток, якщо сховище читається, але не пишеться
 *   (перевищено ліміт): такий стан оголошується через
 *   `writeBlockedReason()`, дані доступні для перегляду та експорту;
 * - `load()` кидає виняток лише тоді, коли читання неможливе;
 * - `saveCollection()` НЕ атомарний: окремий запис може впасти після
 *   успішних попередніх (localStorage не має транзакцій);
 * - міжвкладинкова консистентність не гарантується — реальна
 *   атомарність/ідемпотентність/захист від паралельних змін робить етап 2.
 */
export interface CrmDataSource {
  readonly kind: 'local' | 'remote';
  load(): Promise<DataSnapshotPayload>;
  /**
   * Причина, чому ЗАПИС недоступний (наприклад, перевищено ліміт),
   * а читання працює. `null` — запис дозволений.
   */
  writeBlockedReason(): string | null;
  saveCollection(key: CollectionKey, value: unknown[]): Promise<WriteOutcome>;
  saveSettings(settings: FinanceSettings): Promise<WriteOutcome>;
  saveMeta(patch: Partial<BackupInfo>): Promise<WriteOutcome>;
  /**
   * Окрема важка копія. `key` дозволяє тримати початкову точку
   * відновлення окремо від копії поточного (часткового) стану.
   */
  saveBackupCopy(serialized: string, key?: string): Promise<WriteOutcome>;
  /** Прочитати копію (null — копії немає або вона непридатна). */
  loadBackupCopy(key?: string): Promise<string | null>;
  listIssues(): StorageIssue[];
  clearIssues(): void;
  /** Прибрати issue про пошкодження конкретної колекції (після успішного відновлення). */
  clearCollectionIssue(collection: CollectionKey): void;
  /**
   * Стан здоров'я колекцій ('corrupt' — дані непридатні, запис заблоковано).
   * Це НЕ журнал повідомлень: очищення журналу не змінює здоров'я.
   */
  collectionHealth(): Partial<Record<CollectionKey, CollectionHealth>>;
  markCollectionHealth(collection: CollectionKey, state: CollectionHealth | 'ok'): void;
  /** Повернути сирий вміст колекції (для відновлення пошкоджених даних). */
  restoreRaw(collection: CollectionKey, raw: string): Promise<WriteOutcome>;

  // ------------------------------------------------------------
  // Пакет 03: журнал історії змін (окремо від snapshot).
  // ------------------------------------------------------------

  /**
   * Поточна ревізія даних (remote; local — null, бо ревізій немає).
   * Використовується як очікувана ревізія при скасуванні.
   */
  currentRevision(): number | null;
  /** Сторінка журналу з фільтрами та пагінацією. */
  historyList(query: HistoryQuery): Promise<HistoryListResult>;
  /** Одна подія (null — не знайдено). Виняток — журнал недоступний. */
  historyGet(id: string): Promise<HistoryEvent | null>;
  /**
   * Додати подію журналу (локальний адаптер: окремий ключ із recovery-міткою).
   * Віддалений адаптер — no-op: подію створює сервер у межах commit.
   */
  historyAppend(event: HistoryEvent): Promise<WriteOutcome>;
  /**
   * Застосувати патч відновлення і створити подію-відновлення (remote —
   * одна серверна транзакція; local — послідовний запис із відкочуванням
   * при збої; фактичні гарантії описані в HANDOFF-PACKAGE-03).
   */
  historyUndo(request: HistoryUndoRequest & { patch: HistoryPatch }): Promise<HistoryUndoResult>;
}
