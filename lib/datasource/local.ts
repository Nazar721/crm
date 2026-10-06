import type { BackupInfo, FinanceSettings } from '@/types';
import type { CollectionKey, CrmDataSource, StorageIssue, StorageIssueKind, WriteOutcome } from './types';
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
  lastManualBackupAt: 'crm_last_manual_backup_at',
  backupSnoozedUntil: 'crm_backup_snoozed_until',
  financeSettings: 'crm_finance_settings',
  backupPending: 'crm_backup_pending',
  lastBackupError: 'crm_backup_error',
} as const;

export const BACKUP_KEYS = ['crm_backup_1', 'crm_backup_2', 'crm_backup_3', 'crm_backup_4', 'crm_backup_5'];
const ISSUES_KEY = 'crm_storage_issues';
const CORRUPT_PREFIX = 'crm_corrupt_';

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

  constructor() {
    this.issues = this.readPersistedIssues();
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

  private pushIssue(kind: StorageIssueKind, message: string, key?: string, preservedAt?: string): StorageIssue {
    const issue: StorageIssue = { id: issueId(), kind, key, message, at: new Date().toISOString(), preservedAt };
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

  /**
   * Читання всього сховища. Непридатний JSON не підміняється мовчки
   * порожнім масивом: сирий вміст ізольовується в `crm_corrupt_<key>`,
   * фіксується issue, а колекція повертається порожньою лише для розрахунків.
   */
  async load(): Promise<{ data: import('@/types').DataSnapshot; issues: StorageIssue[] }> {
    if (typeof window === 'undefined') {
      throw new Error('Локальне сховище недоступне поза браузером');
    }
    // Якщо localStorage взагалі недоступний (privacy mode) — явна помилка.
    const probe = '__crm_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);

    const data = {} as Record<CollectionKey, unknown[]> & { financeSettings: FinanceSettings; meta: BackupInfo };

    for (const key of COLLECTION_KEYS) {
      data[key] = this.readCollection(COLLECTION_STORAGE_KEYS[key], key) as never;
    }

    data.financeSettings = this.readSettings();
    data.meta = this.readMeta();

    return { data: data as never, issues: this.listIssues() };
  }

  private readCollection(storageKey: string, collection: CollectionKey): unknown[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch (err) {
      this.pushIssue('read_failed', `Не вдалося прочитати «${storageKey}»: ${String(err)}`, storageKey);
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
      this.pushIssue(
        'corrupt_json',
        `Пошкоджений JSON у «${collection}» (${storageKey}): ${String(err)}. Оригінал збережено окремо.`,
        storageKey,
        preservedAt,
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
      this.pushIssue('corrupt_json', `Пошкоджений JSON у налаштуваннях фінансів: ${String(err)}`, META_STORAGE_KEYS.financeSettings);
      return normalizeSettings(null);
    }
  }

  private readMeta(): BackupInfo {
    try {
      return {
        lastSavedAt: localStorage.getItem(META_STORAGE_KEYS.lastSavedAt) || '',
        lastManualBackupAt: localStorage.getItem(META_STORAGE_KEYS.lastManualBackupAt) || '',
        backupSnoozedUntil: localStorage.getItem(META_STORAGE_KEYS.backupSnoozedUntil) || '',
      };
    } catch {
      return { lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' };
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
    return this.write(COLLECTION_STORAGE_KEYS[key], value);
  }

  async saveSettings(settings: FinanceSettings): Promise<WriteOutcome> {
    return this.write(META_STORAGE_KEYS.financeSettings, settings);
  }

  async saveMeta(patch: Partial<BackupInfo>): Promise<WriteOutcome> {
    let ok = true;
    if (patch.lastSavedAt !== undefined) ok = this.write(META_STORAGE_KEYS.lastSavedAt, patch.lastSavedAt).ok && ok;
    if (patch.lastManualBackupAt !== undefined) ok = this.write(META_STORAGE_KEYS.lastManualBackupAt, patch.lastManualBackupAt).ok && ok;
    if (patch.backupSnoozedUntil !== undefined) ok = this.write(META_STORAGE_KEYS.backupSnoozedUntil, patch.backupSnoozedUntil).ok && ok;
    return ok ? { ok: true } : { ok: false, issue: this.pushIssue('write_failed', 'Не вдалося оновити службові мітки сховища') };
  }

  async saveBackupCopy(serialized: string): Promise<WriteOutcome> {
    return this.write('crm_import_previous', serialized);
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
