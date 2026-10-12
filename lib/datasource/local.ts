import type { BackupInfo, FinanceSettings } from '@/types';
import type { CollectionHealth, CollectionKey, CrmDataSource, DataSnapshotPayload, StorageIssue, StorageIssueKind, WriteOutcome } from './types';
import { COLLECTION_KEYS } from './types';
import { normalizeSettings } from '@/lib/settings';
import type {
  HistoryEvent, HistoryListResult, HistoryPatch, HistoryQuery,
  HistoryUndoRequest, HistoryUndoResult,
} from '@/lib/history/types';
import { HISTORY_LIMIT_EVENTS, isUndoable } from '@/lib/history/types';
import {
  buildEvent, enforceHistoryLimits, normalizeHistoryEvent,
  type BuildEventInput,
} from '@/lib/history/engine';

export const COLLECTION_STORAGE_KEYS: Record<CollectionKey, string> = {
  projectsActive: 'projects_active',
  projectsCompleted: 'projects_completed',
  clients: 'clients',
  specialists: 'specialists',
  partners: 'partners',
  transactions: 'transactions',
  personalDebts: 'personal_debts',
  savings: 'savings',
};

export const META_STORAGE_KEYS = {
  lastSavedAt: 'crm_last_saved_at',
  importIncident: 'crm_import_incomplete',
  lastManualBackupAt: 'crm_last_manual_backup_at',
  backupSnoozedUntil: 'crm_backup_snoozed_until',
  financeSettings: 'crm_finance_settings',
  backupPending: 'crm_backup_pending',
  lastBackupError: 'crm_backup_error',
} as const;

export const BACKUP_KEYS = ['crm_backup_1', 'crm_backup_2', 'crm_backup_3', 'crm_backup_4', 'crm_backup_5'];
const ISSUES_KEY = 'crm_storage_issues';
const CORRUPT_PREFIX = 'crm_corrupt_';
/** Стан здоров'я даних — живе окремо від журналу повідомлень. */
const HEALTH_KEY = 'crm_data_health';

// Пакет 03: журнал історії живе в ОКРЕМИХ ключах — пошкодження журналу
// не впливає на дані, а збій запису не лишає приховано некоректний стан.
const HISTORY_KEY = 'crm_history_v1';
/** Стійка recovery-мітка: подія, яку ще не встигли дописати в журнал. */
const HISTORY_PENDING_KEY = 'crm_history_pending_v1';
const HISTORY_CORRUPT_KEY = 'crm_history_v1_corrupt';

/**
 * Копії стану:
 * - `previous` — початкова точка відновлення для активного інциденту,
 *   НЕ перезаписується до підтвердженого завершення;
 * - `attempt` — копія поточного (часткового) стану перед черговою спробою
 *   відновлення чи повторним імпортом.
 */
export const COPY_KEYS = {
  previous: 'crm_import_previous',
  attempt: 'crm_import_attempt',
} as const;

function issueId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name || '';
  const code = (err as { code?: number }).code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

export class LocalDataSource implements CrmDataSource {
  readonly kind = 'local' as const;
  private issues: StorageIssue[] = [];
  private writeBlockReason: string | null = null;
  private health: Partial<Record<CollectionKey, CollectionHealth>> = {};
  private corruptRaw: Partial<Record<CollectionKey, string>> = {};

  constructor() {
    this.issues = this.readPersistedIssues();
    this.health = this.readPersistedHealth();
  }

  private readPersistedHealth(): Partial<Record<CollectionKey, CollectionHealth>> {
    try {
      if (typeof window === 'undefined') return {};
      const raw = localStorage.getItem(HEALTH_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return {};
      const out: Partial<Record<CollectionKey, CollectionHealth>> = {};
      for (const key of COLLECTION_KEYS) {
        if ((parsed as Record<string, unknown>)[key] === 'corrupt') out[key] = 'corrupt';
      }
      return out;
    } catch {
      return {};
    }
  }

  private persistHealth(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(HEALTH_KEY, JSON.stringify(this.health));
    } catch {
      // Запис стану здоров'я не вдався — чинним лишається стан у пам'яті,
      // а під час наступного читання стан відновиться з реальної помилки JSON.
    }
  }

  private readPersistedIssues(): StorageIssue[] {
    try {
      if (typeof window === 'undefined') return [];
      const raw = localStorage.getItem(ISSUES_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter(i => i && typeof i.message === 'string') : [];
    } catch {
      return [];
    }
  }

  private persistIssues(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(ISSUES_KEY, JSON.stringify(this.issues.slice(0, 20)));
    } catch {
      // Не можемо записати журнал проблем — залишаємо в пам'яті.
    }
  }

  writeBlockedReason(): string | null {
    return this.writeBlockReason;
  }

  private pushIssue(
    kind: StorageIssueKind,
    message: string,
    key?: string,
    preservedAt?: string,
    collection?: CollectionKey,
  ): StorageIssue {
    const issue: StorageIssue = { id: issueId(), kind, key, collection, message, at: new Date().toISOString(), preservedAt };
    this.issues = [...this.issues.filter(i => !(i.kind === kind && i.key === key)), issue].slice(-20);
    this.persistIssues();
    return issue;
  }

  listIssues(): StorageIssue[] {
    return [...this.issues];
  }

  clearIssues(): void {
    this.issues = [];
    this.persistIssues();
  }

  clearCollectionIssue(collection: CollectionKey): void {
    this.issues = this.issues.filter(i => !(i.collection === collection && i.kind === 'corrupt_json'));
    this.persistIssues();
  }

  collectionHealth(): Partial<Record<CollectionKey, CollectionHealth>> {
    return { ...this.health };
  }

  markCollectionHealth(collection: CollectionKey, state: CollectionHealth | 'ok'): void {
    if (state === 'ok') {
      if (this.health[collection] === undefined) return;
      delete this.health[collection];
    } else {
      if (this.health[collection] === state) return;
      this.health[collection] = state;
    }
    this.persistHealth();
  }

  /**
   * Повертає сирий вміст колекції з головного ключа — відновлення не
   * залежить від того, чи вдалося раніше записати карантинну копію.
   */
  async restoreRaw(collection: CollectionKey, raw: string): Promise<WriteOutcome> {
    const outcome = this.write(COLLECTION_STORAGE_KEYS[collection], raw);
    if (outcome.ok) {
      this.markCollectionHealth(collection, 'corrupt');
      this.pushIssue(
        'corrupt_json',
        `Колекція «${collection}» відновлена до пошкодженого оригіналу — запис у неї заблоковано.`,
        COLLECTION_STORAGE_KEYS[collection],
        CORRUPT_PREFIX + COLLECTION_STORAGE_KEYS[collection],
        collection,
      );
    }
    return outcome;
  }

  /**
   * Читання всього сховища.
   *
   * - Непридатний JSON не підміняється мовчки порожнім масивом: сирий
   *   вміст ізольовується в `crm_corrupt_<key>`, фіксується issue, а
   *   колекція позначається пошкодженою (запис у неї блокується);
   * - Неможливість ЗАПИСУ (перевищено ліміт) не заважає читанню та
   *   експорту: фіксується `writeBlockedReason()`;
   * - Виняток кидається лише коли читання неможливе.
   */
  async load(): Promise<DataSnapshotPayload> {
    if (typeof window === 'undefined') {
      throw new Error('Локальне сховище недоступне поза браузером');
    }

    // 1. Чи доступне сховище взагалі (читання).
    try {
      void localStorage.length;
    } catch (err) {
      throw new Error(`Локальне сховище недоступне для читання: ${String(err)}`);
    }

    // 2. Чи доступний запис. Відмова запису НЕ блокує читання/експорт.
    this.writeBlockReason = null;
    try {
      const probe = '__crm_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
    } catch (err) {
      const quota = isQuotaError(err);
      this.writeBlockReason = quota
        ? 'Перевищено ліміт локального сховища: дані доступні для перегляду та експорту, але запис заблоковано.'
        : `Запис у локальне сховище заблоковано: ${String(err)}. Дані доступні для перегляду та експорту.`;
      this.pushIssue(quota ? 'quota_exceeded' : 'write_failed', this.writeBlockReason);
    }

    const data = {} as Record<CollectionKey, unknown[]> & { financeSettings: FinanceSettings; meta: BackupInfo };
    this.corruptRaw = {};

    for (const key of COLLECTION_KEYS) {
      data[key] = this.readCollection(COLLECTION_STORAGE_KEYS[key], key) as never;
    }

    data.financeSettings = this.readSettings();
    data.meta = this.readMeta();

    return { data: data as never, issues: this.listIssues(), corruptRaw: { ...this.corruptRaw } };
  }

  private readCollection(storageKey: string, collection: CollectionKey): unknown[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch (err) {
      this.pushIssue('read_failed', `Не вдалося прочитати «${storageKey}»: ${String(err)}`, storageKey, undefined, collection);
      return [];
    }
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('очікувався масив');
      }
      return parsed;
    } catch (err) {
      const preservedAt = this.quarantine(storageKey, raw);
      const note = preservedAt
        ? `Оригінал збережено окремо: «${preservedAt}».`
        : 'Оригінал зберегти не вдалося (перевищено ліміт) — він залишається лише під цим ключем до явного відновлення.';
      // Сирий оригінал тримаємо в пам'яті для відновлення і фіксуємо
      // здоров'я даних (окремо від журналу повідомлень).
      this.corruptRaw[collection] = raw;
      this.markCollectionHealth(collection, 'corrupt');
      this.pushIssue(
        'corrupt_json',
        `Пошкоджений JSON у «${collection}» (${storageKey}): ${String(err)}. ${note} ` +
        'Запис у цю колекцію заблоковано до відновлення через імпорт.',
        storageKey,
        preservedAt,
        collection,
      );
      return [];
    }
  }

  private quarantine(storageKey: string, raw: string): string | undefined {
    const target = CORRUPT_PREFIX + storageKey;
    try {
      localStorage.setItem(target, raw);
      return target;
    } catch {
      return undefined;
    }
  }

  private readSettings(): FinanceSettings {
    try {
      const raw = localStorage.getItem(META_STORAGE_KEYS.financeSettings);
      return raw ? normalizeSettings(JSON.parse(raw)) : normalizeSettings(null);
    } catch (err) {
      this.pushIssue('corrupt_json', `Пошкоджений JSON у налаштуваннях фінансів: ${String(err)} — використано типові значення.`, META_STORAGE_KEYS.financeSettings);
      return normalizeSettings(null);
    }
  }

  private readMeta(): BackupInfo {
    try {
      let importIncident: BackupInfo['importIncident'] = null;
      const rawIncident = localStorage.getItem(META_STORAGE_KEYS.importIncident);
      if (rawIncident) {
        try {
          const parsed = JSON.parse(rawIncident);
          if (parsed && typeof parsed === 'object' && typeof parsed.reason === 'string') {
            importIncident = parsed as NonNullable<BackupInfo['importIncident']>;
          }
        } catch {
          importIncident = { at: '', reason: 'Незавершений імпорт (стан пошкоджено)' };
        }
      }
      return {
        lastSavedAt: localStorage.getItem(META_STORAGE_KEYS.lastSavedAt) || '',
        lastManualBackupAt: localStorage.getItem(META_STORAGE_KEYS.lastManualBackupAt) || '',
        backupSnoozedUntil: localStorage.getItem(META_STORAGE_KEYS.backupSnoozedUntil) || '',
        importIncident,
      };
    } catch {
      return { lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '', importIncident: null };
    }
  }

  private write(storageKey: string, value: unknown, kindIfFail: StorageIssueKind = 'write_failed'): WriteOutcome {
    try {
      localStorage.setItem(storageKey, typeof value === 'string' ? value : JSON.stringify(value));
      return { ok: true };
    } catch (err) {
      const quota = isQuotaError(err);
      const issue = this.pushIssue(
        quota ? 'quota_exceeded' : kindIfFail,
        quota
          ? `Перевищено ліміт локального сховища при записі «${storageKey}»: ${String(err)}`
          : `Не вдалося записати «${storageKey}»: ${String(err)}`,
        storageKey,
      );
      return { ok: false, issue };
    }
  }

  async saveCollection(key: CollectionKey, value: unknown[]): Promise<WriteOutcome> {
    const wasCorrupt = this.health[key] === 'corrupt';
    const outcome = this.write(COLLECTION_STORAGE_KEYS[key], value);
    if (outcome.ok && wasCorrupt) {
      // Фактичне валідне відновлення — саме воно знімає блокування.
      this.markCollectionHealth(key, 'ok');
      this.clearCollectionIssue(key);
      delete this.corruptRaw[key];
    }
    return outcome;
  }

  async saveSettings(settings: FinanceSettings): Promise<WriteOutcome> {
    return this.write(META_STORAGE_KEYS.financeSettings, settings);
  }

  async saveMeta(patch: Partial<BackupInfo>): Promise<WriteOutcome> {
    let ok = true;
    if (patch.lastSavedAt !== undefined) ok = this.write(META_STORAGE_KEYS.lastSavedAt, patch.lastSavedAt).ok && ok;
    if (patch.lastManualBackupAt !== undefined) ok = this.write(META_STORAGE_KEYS.lastManualBackupAt, patch.lastManualBackupAt).ok && ok;
    if (patch.backupSnoozedUntil !== undefined) ok = this.write(META_STORAGE_KEYS.backupSnoozedUntil, patch.backupSnoozedUntil).ok && ok;
    if ('importIncident' in patch) {
      const incident = patch.importIncident;
      if (incident) ok = this.write(META_STORAGE_KEYS.importIncident, incident).ok && ok;
      else {
        try { localStorage.removeItem(META_STORAGE_KEYS.importIncident); } catch { ok = false; }
      }
    }
    return ok ? { ok: true } : { ok: false, issue: this.pushIssue('write_failed', 'Не вдалося оновити службові мітки сховища') };
  }

  async saveBackupCopy(serialized: string, key: string = COPY_KEYS.previous): Promise<WriteOutcome> {
    return this.write(key, serialized);
  }

  async loadBackupCopy(key: string = COPY_KEYS.previous): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      this.pushIssue('read_failed', `Не вдалося прочитати копію стану «${key}»: ${String(err)}`, key);
      return null;
    }
  }

  // ------------------------------------------------------------
  // Пакет 03: журнал історії (локальний адаптер).
  //
  // Фактичні гарантії: подія додається ОДНИМ setItem після успішного запису
  // даних (один ключ або пишеться цілком, або відхиляється — часткового
  // підриву JSON не буває). Між даними та журналом атомарності localStorage
  // НЕМАЄ: якщо запис журналу впав, стійка мітка HISTORY_PENDING_KEY
  // дозволяє дописати подію при наступному читанні, а видимий issue
  // повідомляє про втрату можливості скасування — стан не ховається.
  // ------------------------------------------------------------

  currentRevision(): number | null {
    return null;
  }

  /** Розбір журналу (без recovery). Непридатний JSON ізолюється в карантин. */
  private parseHistory(): HistoryEvent[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(HISTORY_KEY);
    } catch {
      return [];
    }
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as { events?: unknown[] };
      const events = (Array.isArray(parsed?.events) ? parsed.events : [])
        .map(normalizeHistoryEvent)
        .filter((e): e is HistoryEvent => !!e);
      return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    } catch (err) {
      try {
        localStorage.setItem(HISTORY_CORRUPT_KEY, raw);
      } catch {
        // Карантинна копія не записалась — сирий оригінал лишається під основним ключем.
      }
      // Журнал — окремий шар: здоров'я колекцій даних не змінюється.
      this.pushIssue(
        'corrupt_json',
        `Журнал історії пошкоджено (${HISTORY_KEY}): ${String(err)}. Дані не постраждали; перегляд історії та скасування недоступні до очищення журналу.`,
        HISTORY_KEY,
        HISTORY_CORRUPT_KEY,
      );
      return [];
    }
  }

  private writeHistoryStored(events: HistoryEvent[]): WriteOutcome {
    return this.write(HISTORY_KEY, { v: 1, events });
  }

  private clearPendingHistory(): void {
    try {
      localStorage.removeItem(HISTORY_PENDING_KEY);
    } catch {
      // Якщо мітку не прибрати — наступне читання просто перевірить наявність події.
    }
  }

  /** Допис події з recovery-мітки (перерваний запис минулого запуску). */
  private recoverPendingHistory(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(HISTORY_PENDING_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let event: HistoryEvent | null = null;
    try {
      event = normalizeHistoryEvent(JSON.parse(raw));
    } catch {
      event = null;
    }
    if (!event) {
      this.clearPendingHistory();
      return;
    }
    const events = this.parseHistory();
    if (events.some(e => e.id === event!.id)) {
      this.clearPendingHistory();
      return;
    }
    const withOriginal = event.undoneEventId
      ? events.map(e => (e.id === event!.undoneEventId ? { ...e, undoneBy: event!.id } : e))
      : events;
    const next = enforceHistoryLimits([...withOriginal, event]);
    if (this.writeHistoryStored(next).ok) {
      this.clearPendingHistory();
      this.clearHistoryIssue();
    }
    // Не вдалося — мітка лишається, issue про запис уже зафіксовано write().
  }

  private readHistory(): HistoryEvent[] {
    this.recoverPendingHistory();
    return this.parseHistory();
  }

  async historyAppend(event: HistoryEvent): Promise<WriteOutcome> {
    if (typeof window === 'undefined') {
      const issue: StorageIssue = {
        id: issueId(), kind: 'write_failed', key: HISTORY_KEY,
        message: 'Локальний журнал історії недоступний поза браузером',
        at: new Date().toISOString(),
      };
      return { ok: false, issue };
    }
    this.recoverPendingHistory();
    // Мітка відновлення — до запису журналу (best effort: вона маленька).
    try {
      localStorage.setItem(HISTORY_PENDING_KEY, JSON.stringify(event));
    } catch {
      // Без мітки запис може бути втрачено при збої — про це скаже результат нижче.
    }
    const events = this.parseHistory();
    if (events.some(e => e.id === event.id)) {
      this.clearPendingHistory();
      return { ok: true };
    }
    const outcome = this.writeHistoryStored(enforceHistoryLimits([...events, event]));
    if (!outcome.ok) {
      this.pushIssue(
        'write_failed',
        `Подію журналу («${event.summary}») не вдалося записати. Дані збережені, але скасування цієї зміни буде недоступне; подію буде дописано автоматично, якщо ліміт сховища дозволить повторний запис.`,
        HISTORY_KEY,
      );
      return outcome;
    }
    this.clearPendingHistory();
    this.clearHistoryIssue();
    return { ok: true };
  }

  private clearHistoryIssue(): void {
    const before = this.issues.length;
    this.issues = this.issues.filter(i => !(i.key === HISTORY_KEY && (i.kind === 'corrupt_json' || i.kind === 'write_failed')));
    if (this.issues.length !== before) this.persistIssues();
  }

  async historyList(query: HistoryQuery): Promise<HistoryListResult> {
    let events = this.readHistory();
    if (query.section) events = events.filter(e => e.section === query.section);
    if (query.action) events = events.filter(e => e.action === query.action);
    if (query.from) events = events.filter(e => e.at >= String(query.from));
    if (query.to) events = events.filter(e => e.at <= String(query.to));
    const total = events.length;
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 20)), HISTORY_LIMIT_EVENTS);
    return { events: events.slice(offset, offset + limit), total };
  }

  async historyGet(id: string): Promise<HistoryEvent | null> {
    return this.readHistory().find(e => e.id === id) ?? null;
  }

  async historyUndo(request: HistoryUndoRequest & { patch: HistoryPatch }): Promise<HistoryUndoResult> {
    if (this.writeBlockReason) {
      return { ok: false, reason: 'denied', message: this.writeBlockReason };
    }
    const events = this.readHistory();
    const duplicate = request.requestId
      ? events.find(e => e.action === 'undo' && e.requestId === request.requestId)
      : undefined;
    if (duplicate) return { ok: true, event: duplicate };
    const original = events.find(e => e.id === request.eventId);
    if (!original) return { ok: false, reason: 'not_found', message: 'Подію не знайдено в журналі.' };
    if (original.undoneBy) return { ok: false, reason: 'already_undone', message: 'Цю подію вже скасовано.' };
    if (!isUndoable(original)) return { ok: false, reason: 'not_undoable', message: 'Цю подію не можна скасувати.' };

    const patch = request.patch;
    const touched = Object.keys(patch.collections ?? {}) as CollectionKey[];

    // 1. Прочитати поточні значення (для відкочування та події журналу).
    const previousRaw: Record<string, string | null> = {};
    const previous: BuildEventInput['before'] = {};
    try {
      for (const key of touched) {
        const storageKey = COLLECTION_STORAGE_KEYS[key];
        const raw = localStorage.getItem(storageKey);
        previousRaw[storageKey] = raw;
        previous[key] = raw ? JSON.parse(raw) as unknown[] : [];
      }
      if (patch.settings) {
        const raw = localStorage.getItem(META_STORAGE_KEYS.financeSettings);
        previousRaw[META_STORAGE_KEYS.financeSettings] = raw;
        previous.settings = raw ? JSON.parse(raw) as FinanceSettings : patch.settings;
      }
    } catch (err) {
      return { ok: false, reason: 'write_failed', message: `Не вдалося прочитати поточні дані для відкочування: ${String(err)}` };
    }

    // 2. Записати патч (послідовно; при збої — відкочувати вже записане).
    const written: string[] = [];
    const rollback = (): void => {
      for (const storageKey of written) {
        try {
          const raw = previousRaw[storageKey];
          if (raw === null || raw === undefined) localStorage.removeItem(storageKey);
          else localStorage.setItem(storageKey, raw);
        } catch {
          // Відкочування теж може впасти — про це буде окремий issue нижче.
        }
      }
    };
    for (const key of touched) {
      const storageKey = COLLECTION_STORAGE_KEYS[key];
      const outcome = this.write(storageKey, patch.collections![key]);
      if (!outcome.ok) {
        rollback();
        return { ok: false, reason: 'write_failed', message: `Запис «${key}» не вдався — відновлення відкочено: ${outcome.issue.message}` };
      }
      written.push(storageKey);
    }
    if (patch.settings) {
      const outcome = this.write(META_STORAGE_KEYS.financeSettings, patch.settings);
      if (!outcome.ok) {
        rollback();
        return { ok: false, reason: 'write_failed', message: `Запис налаштувань не вдався — відновлення відкочено: ${outcome.issue.message}` };
      }
      written.push(META_STORAGE_KEYS.financeSettings);
    }

    // 3. Подія-відновлення з ФАКТИЧНОЇ різниці + позначка на оригіналі — одним записом.
    const after: BuildEventInput['before'] = {};
    for (const key of touched) after[key] = patch.collections![key];
    if (patch.settings) after.settings = patch.settings;
    const event = buildEvent({
      before: previous,
      after,
      ctx: { source: request.source },
      forced: {
        action: 'undo',
        section: original.section,
        summary: `Скасовано: «${original.summary}»`,
        undoneEventId: original.id,
        requestId: request.requestId,
      },
    });
    if (!event) {
      // Патч не змінив вміст — поточний стан уже відповідає відновленню.
      rollback();
      return { ok: false, reason: 'conflict', message: 'Поточні дані вже відповідають стану до цієї події — нічого не змінено.' };
    }
    try {
      localStorage.setItem(HISTORY_PENDING_KEY, JSON.stringify(event));
    } catch {
      // Без мітки допису — ризик втрати події видимий із результату запису.
    }
    const withOriginal = events.map(e => (e.id === original.id ? { ...e, undoneBy: event.id } : e));
    const outcome = this.writeHistoryStored(enforceHistoryLimits([...withOriginal, event]));
    if (!outcome.ok) {
      this.pushIssue(
        'write_failed',
        `Дані відновлено, але подію журналу («${event.summary}») записати не вдалося. Повторне скасування буде заблоковано перевіркою стану даних.`,
        HISTORY_KEY,
      );
      return { ok: false, reason: 'write_failed', message: 'Дані відновлено, але подію журналу записати не вдалося. Перезавантаж сторінку та перевір журнал.' };
    }
    this.clearPendingHistory();
    this.clearHistoryIssue();
    return { ok: true, event };
  }

  /** Службовий запис поза контрактом (заглушки міграцій, кварантина тощо). */
  rawSet(storageKey: string, value: string): WriteOutcome {
    return this.write(storageKey, value);
  }

  rawGet(storageKey: string): string | null {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }
}

export const localDataSource = new LocalDataSource();
