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
}

/**
 * Асинхронне джерело даних.
 *
 * Гарантії локального адаптера:
 * - `load()` ніколи не викидає виняток на непридатному JSON: пошкоджений
 *   ключ ізольовується (кварантується) і потрапляє в `issues`;
 * - `saveCollection()` НЕ атомарний: окремий запис може впасти після
 *   успішних попередніх (localStorage не має транзакцій);
 * - міжвкладинкова консистентність не гарантується — реальна
 *   атомарність/ідемпотентність/захист від паралельних змін робить етап 2.
 */
export interface CrmDataSource {
  readonly kind: 'local' | 'remote';
  load(): Promise<DataSnapshotPayload>;
  saveCollection(key: CollectionKey, value: unknown[]): Promise<WriteOutcome>;
  saveSettings(settings: FinanceSettings): Promise<WriteOutcome>;
  saveMeta(patch: Partial<BackupInfo>): Promise<WriteOutcome>;
  /** Окрема важка копія (наприклад, попередній стан перед імпортом). */
  saveBackupCopy(serialized: string): Promise<WriteOutcome>;
  listIssues(): StorageIssue[];
  clearIssues(): void;
}
