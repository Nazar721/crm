import type { BackupInfo, DataSnapshot, FinanceSettings, ImportIncident } from '@/types';
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
/** Сирий вміст пошкоджених колекцій — для відновлення без карантину. */
let corruptRaw: Partial<Record<CollectionKey, string>> = {};
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

/**
 * Причина, чому запис користувача заблоковано (banner + помилки дій).
 * Порядок: ліміт сховища → стійкий інцидент імпорту → незавершені міграції.
 * Інцидент імпорту живе в метаданих сховища: його НЕ знімають
 * reinitialize, runMigrations, очищення журналу чи перезапуск.
 */
export function getWriteBlock(): string | null {
  return storageWriteBlock || importIncidentReason() || migrationWriteBlock;
}

/** Детальний стан блокування — для діагностики та тестів. */
export function getWriteBlocks(): {
  storage: string | null;
  importIncident: ImportIncident | null;
  migration: string | null;
} {
  return {
    storage: storageWriteBlock,
    importIncident: snapshot.meta.importIncident ?? null,
    migration: migrationWriteBlock,
  };
}

export function getImportIncident(): ImportIncident | null {
  return snapshot.meta.importIncident ?? null;
}

/** Блок через незавершені міграції (тимчасовий, не плутати з інцидентом). */
export function setMigrationBlock(reason: string | null): void {
  migrationWriteBlock = reason;
  notify();
}

function importIncidentReason(): string | null {
  const incident = snapshot.meta.importIncident;
  return incident && incident.reason ? incident.reason : null;
}

/**
 * Встановити/зняти стійкий інцидент незавершеного імпорту.
 * Запис іде поза логічними блоками (інцидент і є блоком).
 * Якщо запис метаданих не вдався — стан у пам'яті НЕ змінюється
 * (безпечніший напрямок: краще лишитися заблокованим).
 */
export async function setImportIncident(incident: ImportIncident | null): Promise<boolean> {
  const outcome = await dataSource.saveMeta({ importIncident: incident });
  if (!outcome.ok) {
    notify();
    return false;
  }
  snapshot = { ...snapshot, meta: { ...snapshot.meta, importIncident: incident } };
  notify();
  return true;
}

/** Явне підтвердження відновлення користувачем (кнопка в Налаштуваннях). */
export async function acknowledgeImportIncident(): Promise<boolean> {
  return setImportIncident(null);
}

/**
 * Стан здоров'я даних читається з джерела даних, а НЕ з журналу
 * повідомлень: очищення журналу не робить непридатні дані валідними.
 */
function refreshHealth(): void {
  const health = dataSource.collectionHealth();
  corruptCollections = new Set(
    (Object.keys(health) as CollectionKey[]).filter(k => health[k] === 'corrupt'),
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
  let resultCorruptRaw: Partial<Record<CollectionKey, string>> = {};
  try {
    const result = await dataSource.load();
    snapshot = result.data as DataSnapshot;
    primeSettings(snapshot.financeSettings);
    status = 'ready';
    loadError = null;
    resultCorruptRaw = result.corruptRaw;
  } catch (err) {
    status = 'error';
    loadError = err instanceof Error ? err.message : String(err);
  }
  storageWriteBlock = status === 'ready' ? dataSource.writeBlockedReason() : null;
  corruptRaw = status === 'ready' ? { ...resultCorruptRaw } : {};
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
  corruptRaw = { ...result.corruptRaw };
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
  if (scope === 'user') {
    // Стійкий інцидент незавершеного імпорту: блокує саме ДІЇ КОРИСТУВАЧА.
    // Міграції (`system`) і відновлення (`import`) виконуються попри нього.
    const incident = importIncidentReason();
    if (incident) return failIssue(incident, key);
    if (migrationWriteBlock) return failIssue(migrationWriteBlock, key);
  }
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
  // Успішний валідний запис відновлює колекцію — здоров'я оновлює джерело даних.
  refreshHealth();
  commit({ ...snapshot, [key]: value } as DataSnapshot);
  return { ok: true };
}

/**
 * Повернути сирий вміст пошкодженої колекції (відновлення незалежно від
 * того, чи вдалося записати карантинну копію). Після успіху колекція знову
 * вважається пошкодженою — здоров'я, а не лише журнал.
 */
export async function restoreRawCollection(key: CollectionKey, raw: string): Promise<WriteOutcome> {
  const outcome = await dataSource.restoreRaw(key, raw);
  refreshHealth();
  corruptRaw = { ...corruptRaw, [key]: raw };
  if (outcome.ok) {
    // Дані знову непридатні для розбору — у пам'яті порожній список.
    snapshot = { ...snapshot, [key]: [] } as DataSnapshot;
  }
  notify();
  return outcome;
}

/** Сирий вміст пошкоджених колекцій на момент останнього читання. */
export function getCorruptRaw(): Partial<Record<CollectionKey, string>> {
  return { ...corruptRaw };
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

/** Копія попереднього стану (null — немає або непридатна). */
export function loadBackupCopy(): Promise<string | null> {
  return dataSource.loadBackupCopy();
}

/** Замінити snapshot після того, як імпорт уже записав дані у сховище. */
export function replaceSnapshot(next: DataSnapshot): void {
  commit(next);
  primeSettings(next.financeSettings);
}

/**
 * Очищення ЖУРНАЛУ повідомлень. НЕ впливає на здоров'я даних:
 * пошкоджена колекція лишається заблокованою до фактичного відновлення.
 */
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
  corruptRaw = {};
  storageWriteBlock = null;
  migrationWriteBlock = null;
  primeSettings(null);
}

export { COLLECTION_KEYS };
export type { CollectionKey, StorageIssue, WriteOutcome };
