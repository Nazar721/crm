import type { BackupInfo, DataSnapshot, FinanceSettings } from '@/types';

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
  /** Окрема важка копія (наприклад, попередній стан перед імпортом). */
  saveBackupCopy(serialized: string): Promise<WriteOutcome>;
  /** Прочитати копію попереднього стану (null — копії немає або вона непридатна). */
  loadBackupCopy(): Promise<string | null>;
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
}
