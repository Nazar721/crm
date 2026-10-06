import type { BackupInfo, FinanceSettings } from '@/types';
import type { CollectionHealth, CollectionKey, CrmDataSource, DataSnapshotPayload, StorageIssue, StorageIssueKind, WriteOutcome } from './types';
import { COLLECTION_KEYS } from './types';
import { normalizeSettings } from '@/lib/settings';

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

  async saveBackupCopy(serialized: string): Promise<WriteOutcome> {
    return this.write('crm_import_previous', serialized);
  }

  async loadBackupCopy(): Promise<string | null> {
    try {
      return localStorage.getItem('crm_import_previous');
    } catch (err) {
      this.pushIssue('read_failed', `Не вдалося прочитати копію попереднього стану: ${String(err)}`, 'crm_import_previous');
      return null;
    }
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
