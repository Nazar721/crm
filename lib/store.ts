import type { BackupInfo, DataSnapshot, FinanceSettings } from '@/types';
import { COLLECTION_KEYS, type CollectionKey, type CrmDataSource, type StorageIssue, type WriteOutcome } from '@/lib/datasource/types';
import { localDataSource } from '@/lib/datasource/local';
import { normalizeSettings, primeSettings } from '@/lib/settings';
import { flushBackupOnClose, markSnapshotDirty, registerSnapshotReader } from '@/lib/backup';

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error';

let dataSource: CrmDataSource = localDataSource;
let snapshot: DataSnapshot = emptySnapshot();
let status: StoreStatus = 'idle';
let loadError: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function emptySnapshot(): DataSnapshot {
  return {
    projectsActive: [],
    projectsCompleted: [],
    clients: [],
    specialists: [],
    partners: [],
    transactions: [],
    personalDebts: [],
    savings: [],
    financeSettings: normalizeSettings(null),
    meta: { lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' },
  };
}

function notify(): void {
  listeners.forEach(fn => {
    try { fn(); } catch (err) { console.error('store listener failed', err); }
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Актуальний snapshot у пам'яті. Не читає localStorage. */
export function getSnapshot(): DataSnapshot {
  return snapshot;
}

export function getStoreStatus(): StoreStatus {
  return status;
}

export function getStoreError(): string | null {
  return loadError;
}

export function isReady(): boolean {
  return status === 'ready';
}

export function getIssues(): StorageIssue[] {
  return dataSource.listIssues();
}

/**
 * Перше завантаження сховища. Викликається один раз до того, як
 * сторінки отримують доступ до даних (див. AppContext).
 */
export async function initStore(source: CrmDataSource = localDataSource): Promise<void> {
  dataSource = source;
  status = 'loading';
  loadError = null;
  notify();
  try {
    const result = await dataSource.load();
    snapshot = result.data as DataSnapshot;
    primeSettings(snapshot.financeSettings);
    status = 'ready';
    loadError = null;
  } catch (err) {
    status = 'error';
    loadError = err instanceof Error ? err.message : String(err);
  }
  if (!initialized) {
    initialized = true;
    registerSnapshotReader(() => (status === 'ready' ? snapshot : null));
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushBackupOnClose);
      window.addEventListener('beforeunload', flushBackupOnClose);
    }
  }
  notify();
}

/** Перечитати сховище після міграцій/імпорту. */
export async function reloadStore(): Promise<void> {
  const result = await dataSource.load();
  snapshot = result.data as DataSnapshot;
  primeSettings(snapshot.financeSettings);
  status = 'ready';
  loadError = null;
  notify();
}

function commit(next: DataSnapshot): void {
  const now = new Date().toISOString();
  snapshot = { ...next, meta: { ...next.meta, lastSavedAt: now } };
  markSnapshotDirty();
  notify();
  // Службова мітка «останнє збереження» — один короткий запис,
  // окремо від важкої повної копії (див. lib/backup.ts).
  void dataSource.saveMeta({ lastSavedAt: now }).then(result => {
    if (!result.ok) notify();
  });
}

/**
 * Запис колекції. Спочатку — запис у сховище, потім оновлення пам'яті:
 * якщо запис упав (квота/збій), дані не «зберігаються» мовчки.
 * НЕ атомарно щодо інших колекцій (localStorage не має транзакцій).
 */
export async function saveCollection(key: CollectionKey, value: unknown[]): Promise<WriteOutcome> {
  const outcome = await dataSource.saveCollection(key, value);
  if (!outcome.ok) {
    notify();
    return outcome;
  }
  commit({ ...snapshot, [key]: value } as DataSnapshot);
  return { ok: true };
}

export async function saveSettings(settings: FinanceSettings): Promise<WriteOutcome> {
  const normalized = normalizeSettings(settings);
  const outcome = await dataSource.saveSettings(normalized);
  if (!outcome.ok) {
    notify();
    return outcome;
  }
  commit({ ...snapshot, financeSettings: normalized });
  primeSettings(normalized);
  return { ok: true };
}

export async function saveMeta(patch: Partial<BackupInfo>): Promise<WriteOutcome> {
  const outcome = await dataSource.saveMeta(patch);
  if (!outcome.ok) {
    notify();
    return outcome;
  }
  commit({ ...snapshot, meta: { ...snapshot.meta, ...patch } });
  return { ok: true };
}

/** Окрема важка копія (наприклад, попередній стан перед імпортом). */
export async function saveBackupCopy(serialized: string): Promise<WriteOutcome> {
  const outcome = await dataSource.saveBackupCopy(serialized);
  if (!outcome.ok) notify();
  return outcome;
}

/** Замінити snapshot після того, як імпорт уже записав дані у сховище. */
export function replaceSnapshot(next: DataSnapshot): void {
  commit(next);
  primeSettings(next.financeSettings);
}

export function clearIssues(): void {
  dataSource.clearIssues();
  notify();
}

export function resetStoreForTests(): void {
  snapshot = emptySnapshot();
  status = 'idle';
  loadError = null;
  initialized = false;
  listeners.clear();
  primeSettings(null);
}

export { COLLECTION_KEYS };
export type { CollectionKey, StorageIssue, WriteOutcome };
