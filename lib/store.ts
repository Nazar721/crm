import type { BackupInfo, DataSnapshot, FinanceSettings, ImportIncident } from '@/types';
import { COLLECTION_KEYS, type CollectionKey, type CrmDataSource, type StorageIssue, type WriteOutcome } from '@/lib/datasource/types';
import { SupabaseDataSource } from '@/lib/datasource/supabase';
import { cloudEnabled } from '@/lib/supabase/client';
import { localDataSource } from '@/lib/datasource/local';
import { normalizeSettings, primeSettings } from '@/lib/settings';
import { flushBackupOnClose, markSnapshotDirty, registerSnapshotReader, resumePendingBackup } from '@/lib/backup';
import type {
  HistoryEvent, HistoryListResult, HistoryPatch, HistoryQuery,
  HistoryUndoRequest, HistoryUndoResult, UndoPreviewRow,
} from '@/lib/history/types';
import { buildEventFromSnapshots, computeUndoPlan, patchSnapshot } from '@/lib/history/engine';
import { getWriteContext, runWithWriteContext, resetWriteContext, type WriteContext } from '@/lib/history/source';

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
  if (staging) return;
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
  if (dataSource.writeBlockedReason()) return dataSource.writeBlockedReason();
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
export async function initStore(source: CrmDataSource = cloudEnabled() ? new SupabaseDataSource() : localDataSource): Promise<void> {
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

let staging = false;
let actionQueue: Promise<unknown> = Promise.resolve();
export function remoteEnabled(): boolean { return dataSource.kind === 'remote'; }

/**
 * Пакет 03: запис журналу ПІСЛЯ успіху дії — з фактичної різниці до/після.
 * Для remote подію створює сервер у межах commit (тут — no-op).
 * Збій журналу не фальшує вже виконану дію: локальний адаптер докладає
 * recovery-мітку та видимий issue (див. lib/datasource/local.ts).
 */
export async function recordHistoryAfter(before: DataSnapshot, ctx?: Partial<WriteContext>): Promise<void> {
  if (dataSource.kind !== 'local') return;
  try {
    const active = ctx
      ? { source: ctx.source ?? getWriteContext().source, hint: ctx.hint ?? null }
      : getWriteContext();
    const event = buildEventFromSnapshots(before, snapshot, active);
    if (!event) return;
    const outcome = await dataSource.historyAppend(event);
    // Новий issue про збій журналу має бути помітним в UI одразу після
    // успішної основної дії — сповіщаємо підписників.
    if (!outcome.ok) notify();
  } catch (err) {
    console.error('history journal append failed', err);
    notify();
  }
}

/**
 * Атомарна доменна дія. `ctx` — джерело/підказка дії для журналу
 * (за замовчуванням «Форма»; помічник/імпорт/система вказують явно).
 */
export function atomicAction<T extends {ok:boolean}>(work:()=>Promise<T>, ctx?: Partial<WriteContext>):Promise<T> {
  if (!(dataSource instanceof SupabaseDataSource)) {
    // Локальний режим: одна дія — одна група журналу (як і один commit remote).
    return runWithWriteContext(ctx, async () => {
      const before = structuredClone(snapshot);
      const result = await work();
      if (result.ok) await recordHistoryAfter(before);
      return result;
    });
  }
  const source = dataSource;
  const run = async ():Promise<T> => runWithWriteContext(ctx, async () => {
    const previous = structuredClone(snapshot);
    staging = true;
    try {
      const result = await source.transaction(work);
      if (!result.ok) {
        snapshot = previous;
        if ('issue' in result) return {ok:false,errors:[{field:'storage',message:result.issue.message}]} as unknown as T;
      }
      if (result.ok) markSnapshotDirty();
      return result as T;
    } catch { snapshot=previous; return {ok:false,errors:[{field:'storage',message:'Запис не підтверджено. Онови сторінку перед повторною дією.'}]} as unknown as T; }
    finally { staging=false; storageWriteBlock=source.writeBlockedReason(); primeSettings(snapshot.financeSettings); notify(); }
  });
  const pending = actionQueue.then(run,run);
  actionQueue = pending.then(()=>undefined,()=>undefined);
  return pending;
}

function commit(next: DataSnapshot): void {
  const now = new Date().toISOString();
  snapshot = { ...next, meta: { ...next.meta, lastSavedAt: now } };
  if (staging) return;
  markSnapshotDirty();
  notify();
  if (dataSource.kind === 'remote') return;
  // Службова мітка «останнє збереження» — один короткий запис,
  // окремо від важкої повної копії (див. lib/backup.ts).
  void dataSource.saveMeta({ lastSavedAt: now }).then(result => {
    if (!result.ok) notify();
  });
}

function guard(key: CollectionKey | undefined, scope: WriteScope): WriteOutcome | null {
  if (dataSource.writeBlockedReason()) return failIssue(dataSource.writeBlockedReason()!, key);
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

/** Джерело журналу для записів поза atomicAction (міграції/імпорт). */
async function withScopeContext<T>(scope: WriteScope, fn: () => Promise<T>): Promise<T> {
  if (scope === 'user') return fn();
  return runWithWriteContext({ source: scope === 'import' ? 'Імпорт' : 'Система' }, fn);
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
  const outcome = await withScopeContext(scope, () => dataSource.saveCollection(key, value));
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
  const outcome = await withScopeContext(scope, () => dataSource.saveSettings(normalized));
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
export async function saveBackupCopy(serialized: string, key?: string): Promise<WriteOutcome> {
  const outcome = await dataSource.saveBackupCopy(serialized, key);
  if (!outcome.ok) notify();
  return outcome;
}

/** Копія стану (null — немає або непридатна). */
export function loadBackupCopy(key?: string): Promise<string | null> {
  return dataSource.loadBackupCopy(key);
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

// ------------------------------------------------------------
// Пакет 03: журнал історії та скасування (фасад над адаптером).
// Журнал НЕ входить у snapshot, експорт даних і AI-контекст.
// ------------------------------------------------------------

/** Сторінка журналу з фільтрами (remote — сервер; local — localStorage). */
export function listHistory(query: HistoryQuery = {}): Promise<HistoryListResult> {
  return dataSource.historyList(query);
}

export function getHistoryEvent(id: string): Promise<HistoryEvent | null> {
  return dataSource.historyGet(id);
}

/** Поточна ревізія даних для очікування при скасуванні (local — null). */
export function getRevision(): number | null {
  return dataSource.currentRevision();
}

function notUndoableMessage(event: HistoryEvent): string | null {
  if (event.imported) return 'Імпортована подія — лише перегляд, скасування недоступне.';
  if (event.action === 'import' || event.action === 'restore') {
    return 'Імпорт і відновлення скасуються через резервну копію, а не цією кнопкою.';
  }
  if (event.action === 'undo') return 'Подію-відновлення не скасовують.';
  if (event.undoneBy) return 'Цю подію вже скасовано.';
  if (event.changes.some(c => c.change === 'bulk')) {
    return 'Група збережена як підсумок без деталей — скасування недоступне.';
  }
  return null;
}

export type PreviewUndoResult =
  | { ok: true; event: HistoryEvent; patch: HistoryPatch; preview: UndoPreviewRow[] }
  | { ok: false; message: string; conflicts?: string[] };

/** Попередній перегляд відновлення — без жодного запису. */
export async function previewUndo(eventId: string): Promise<PreviewUndoResult> {
  let event: HistoryEvent | null;
  try {
    event = await dataSource.historyGet(eventId);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Журнал історії недоступний.' };
  }
  if (!event) return { ok: false, message: 'Подію не знайдено в журналі.' };
  const notAllowed = notUndoableMessage(event);
  if (notAllowed) return { ok: false, message: notAllowed };
  const plan = computeUndoPlan(event, snapshot);
  if (!plan.ok) {
    return { ok: false, message: 'Зміни після цієї події заважають відновленню — нічого не перезаписано.', conflicts: plan.conflicts };
  }
  return { ok: true, event, patch: plan.patch, preview: plan.preview };
}

/**
 * Скасування події. Перевіряє конфлікти/залежності за поточним snapshot,
 * потім передає патч адаптеру (remote — сервер перевіряє ревізію під
 * блокуванням і створює подію атомарно; local — послідовний запис із
 * відкочуванням). Після успіху snapshot перечитується/оновлюється.
 */
export async function undoHistory(request: HistoryUndoRequest): Promise<HistoryUndoResult> {
  const result = await runUndoHistory(request);
  // Підписники (UI) мають побачити issue про збій/інцидент одразу.
  notify();
  return result;
}

async function runUndoHistory(request: HistoryUndoRequest): Promise<HistoryUndoResult> {
  const block = getWriteBlock();
  if (block) return { ok: false, reason: 'denied', message: block };
  // Повтор того самого запиту (підтверджений кнопкою двічі) — ідемпотентний
  // успішний результат без другої події та без повторних перевірок.
  try {
    const recent = await dataSource.historyList({ limit: 200, action: 'undo' });
    const duplicate = recent.events.find(e => e.requestId && e.requestId === request.requestId);
    if (duplicate) return { ok: true, event: duplicate };
  } catch {
    // Журнал недоступний для пошуку дубліката — основний шлях дасть зрозумілу відмову.
  }
  let event: HistoryEvent | null;
  try {
    event = await dataSource.historyGet(request.eventId);
  } catch (err) {
    return { ok: false, reason: 'denied', message: err instanceof Error ? err.message : 'Журнал історії недоступний.' };
  }
  if (!event) return { ok: false, reason: 'not_found', message: 'Подію не знайдено в журналі.' };
  if (event.undoneBy) return { ok: false, reason: 'already_undone', message: 'Цю подію вже скасовано.' };
  const notAllowed = notUndoableMessage(event);
  if (notAllowed) return { ok: false, reason: 'not_undoable', message: notAllowed };
  const plan = computeUndoPlan(event, snapshot);
  if (!plan.ok) {
    return { ok: false, reason: 'conflict', message: 'Зміни після цієї події заважають відновленню — нічого не перезаписано.', conflicts: plan.conflicts };
  }
  const expectedRevision = request.expectedRevision === undefined ? dataSource.currentRevision() : request.expectedRevision;
  const result = await dataSource.historyUndo({ ...request, expectedRevision, patch: plan.patch });
  if (!result.ok) return result;
  if (dataSource.kind === 'remote') {
    try {
      await reloadStore();
    } catch {
      // Дані вже відновлено на сервері; перечитання відбудеться при завантаженні.
    }
  } else {
    replaceSnapshot(patchSnapshot(snapshot, plan.patch));
  }
  notify();
  return result;
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
  resetWriteContext();
  primeSettings(null);
}

export { COLLECTION_KEYS };
export type { CollectionKey, StorageIssue, WriteOutcome };
