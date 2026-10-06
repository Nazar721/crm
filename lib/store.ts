import type { BackupInfo, DataSnapshot, FinanceSettings } from '@/types';
import { COLLECTION_KEYS, type CollectionKey, type CrmDataSource, type StorageIssue, type WriteOutcome } from '@/lib/datasource/types';
import { localDataSource } from '@/lib/datasource/local';
import { normalizeSettings, primeSettings } from '@/lib/settings';
import { flushBackupOnClose, markSnapshotDirty, registerSnapshotReader, resumePendingBackup } from '@/lib/backup';

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Хто пише:
 * - `user`   — доменні дії (форми/AI): блокуються непридатною колекцією,
 *              заблокованим записом сховища чи незавершеними міграціями;
 * - `system` — міграції: блокуються непридатною колекцією/записом сховища,
 *              але НЕ блокуються прапорцем міграцій (щоб можна було повторити);
 * - `import` — імпорт/відновлення: минає логічні блоки, бо саме відновлює дані.
 */
export type WriteScope = 'user' | 'system' | 'import';

let dataSource: CrmDataSource = localDataSource;
let snapshot: DataSnapshot = emptySnapshot();
let status: StoreStatus = 'idle';
let loadError: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

/** Колекції, у яких виявлено непридатний JSON (запис до них заблоковано). */
let corruptCollections = new Set<CollectionKey>();
/** Запис заблоковано самим сховищем (ліміт/політика). */
let storageWriteBlock: string | null = null;
/** Запис заблоковано незавершеними міграціями. */
let migrationWriteBlock: string | null = null;

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

function failIssue(message: string, key?: CollectionKey): WriteOutcome {
  return {
    ok: false,
    issue: {
      id: `blocked_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'write_failed',
      key,
      collection: key,
      message,
      at: new Date().toISOString(),
    },
  };
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

export function getCorruptCollections(): CollectionKey[] {
  return [...corruptCollections];
}

export function isCollectionCorrupt(key: CollectionKey): boolean {
  return corruptCollections.has(key);
}

/** Причина, чому запис користувача заблоковано (banner + помилки дій). */
export function getWriteBlock(): string | null {
  return storageWriteBlock || migrationWriteBlock;
}

export function setMigrationBlock(reason: string | null): void {
  migrationWriteBlock = reason;
  notify();
}

function refreshHealth(): void {
  const issues = dataSource.listIssues();
  corruptCollections = new Set(
    issues.filter(i => i.kind === 'corrupt_json' && i.collection).map(i => i.collection!),
  );
}

/**
 * Перше завантаження сховища. Викликається один раз до того, як
 * сторінки отримують доступ до даних (див. AppContext).
 */
export async function initStore(source: CrmDataSource = localDataSource): Promise<void> {
  dataSource = source;
  status = 'loading';
  loadError = null;
  migrationWriteBlock = null;
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
  storageWriteBlock = status === 'ready' ? dataSource.writeBlockedReason() : null;
  refreshHealth();
  if (!initialized) {
    initialized = true;
    registerSnapshotReader(() => (status === 'ready' ? snapshot : null));
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushBackupOnClose);
      window.addEventListener('beforeunload', flushBackupOnClose);
    }
  }
  if (status === 'ready') {
    // Відкладена повна копія (прапорець пережив закриття вкладки)
    // має виконатися без необхідності нової зміни даних.
    resumePendingBackup();
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
  storageWriteBlock = dataSource.writeBlockedReason();
  refreshHealth();
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

function guard(key: CollectionKey | undefined, scope: WriteScope): WriteOutcome | null {
  if (scope === 'import') return null;
  if (storageWriteBlock) return failIssue(storageWriteBlock, key);
  if (key && corruptCollections.has(key)) {
    return failIssue(
      `Колекція «${key}» містить пошкоджені дані. Запис заблоковано до відновлення через імпорт.`,
      key,
    );
  }
  if (scope === 'user' && migrationWriteBlock) return failIssue(migrationWriteBlock, key);
  return null;
}

/**
 * Запис колекції. Спочатку — запис у сховище, потім оновлення пам'яті:
 * якщо запис упав (квота/збій), дані не «зберігаються» мовчки.
 * НЕ атомарно щодо інших колекцій (localStorage не має транзакцій).
 */
export async function saveCollection(
  key: CollectionKey,
  value: unknown[],
  scope: WriteScope = 'user',
): Promise<WriteOutcome> {
  const blocked = guard(key, scope);
  if (blocked) {
    notify();
    return blocked;
  }
  const outcome = await dataSource.saveCollection(key, value);
  if (!outcome.ok) {
    // Перевищено ліміт — фіксуємо стан «запис заблоковано», щоб наступні
    // спроби падали швидко з зрозумілою причиною, а не кожен раз оновленням.
    if (outcome.issue.kind === 'quota_exceeded' && !storageWriteBlock) {
      storageWriteBlock = outcome.issue.message;
    }
    notify();
    return outcome;
  }
  if (corruptCollections.has(key)) {
    // Успішний явний запис відновлює колекцію — прибираємо мітку пошкодження.
    corruptCollections.delete(key);
    dataSource.clearCollectionIssue(key);
  }
  commit({ ...snapshot, [key]: value } as DataSnapshot);
  return { ok: true };
}

export async function saveSettings(settings: FinanceSettings, scope: WriteScope = 'user'): Promise<WriteOutcome> {
  const blocked = guard(undefined, scope);
  if (blocked) {
    notify();
    return blocked;
  }
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

export async function saveMeta(patch: Partial<BackupInfo>, scope: WriteScope = 'user'): Promise<WriteOutcome> {
  const blocked = guard(undefined, scope);
  if (blocked) {
    notify();
    return blocked;
  }
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
  refreshHealth();
  notify();
}

export function resetStoreForTests(): void {
  snapshot = emptySnapshot();
  status = 'idle';
  loadError = null;
  initialized = false;
  listeners.clear();
  corruptCollections = new Set();
  storageWriteBlock = null;
  migrationWriteBlock = null;
  primeSettings(null);
}

export { COLLECTION_KEYS };
export type { CollectionKey, StorageIssue, WriteOutcome };
