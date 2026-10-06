import './setup';
import type { Client, DataSnapshot, Project, Transaction } from '@/types';
import type { CollectionKey, CrmDataSource, StorageIssue, WriteOutcome } from '@/lib/datasource/types';
import { LocalDataSource } from '@/lib/datasource/local';
import * as store from '@/lib/store';
import { resetSettingsCache } from '@/lib/settings';
import { resetBackupRuntime } from '@/lib/backup';

export function clearAll(): void {
  localStorage.clear();
  sessionStorage.clear();
  resetSettingsCache();
  resetBackupRuntime();
  store.resetStoreForTests();
}

/** Відбиток даних для повної звірки після збою (колекції + налаштування). */
export function snapshotFingerprint(value: DataSnapshot = store.getSnapshot()): string {
  return JSON.stringify({
    projectsActive: value.projectsActive,
    projectsCompleted: value.projectsCompleted,
    clients: value.clients,
    specialists: value.specialists,
    partners: value.partners,
    transactions: value.transactions,
    personalDebts: value.personalDebts,
    savings: value.savings,
    financeSettings: value.financeSettings,
  });
}

export async function bootStore(source?: CrmDataSource): Promise<void> {
  await store.initStore(source ?? new LocalDataSource());
}

export function emptySnapshot(): DataSnapshot {
  return {
    projectsActive: [],
    projectsCompleted: [],
    clients: [],
    specialists: [],
    partners: [],
    transactions: [],
    personalDebts: [],
    savings: [],
    financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
    meta: { lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' },
  };
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${(++seq).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: nextId('cli'),
    name: `Клієнт ${seq}`,
    telegram: '@client',
    source: 'Telegram',
    createdAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: nextId('prj'),
    name: `Проєкт ${seq}`,
    type: 'IT',
    status: 'В роботі',
    startDate: '2026-02-01',
    clientId: '',
    clientName: 'Клієнт',
    budget: 100000,
    prepayment: 40000,
    paidToSpecialist: 20000,
    myPercent: 30,
    profitTaken: 0,
    fop: 10,
    partnerCommission: 0,
    ...overrides,
  };
}

export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId('txn'),
    type: 'income',
    amount: 1000,
    bank: 'mono',
    category: 'Проєкт',
    description: 'Синтетична транзакція',
    date: '2026-03-05',
    status: 'done',
    incomeStatus: 'earned',
    ...overrides,
  };
}

/**
 * Адаптер, що може зазнавати збою запису для окремої колекції —
 * для перевірки відновлення під час імпорту.
 */
export type FlakyKind = 'collection' | 'settings' | 'backupCopy' | 'restoreRaw';
export type FlakyPredicate = (kind: FlakyKind, key: string, callNumber: number) => boolean;

/**
 * Адаптер, що може зазнавати збою запису — для перевірки відновлення
 * під час імпорту, міграцій та фіналізації.
 *
 * - `shouldFail(kind, key, perKeyCall)` — постійне правило (наприклад,
 *   «завжди відмовляти specialists»);
 * - `failNextOn(keys, minTotalCollectionCalls)` — ОДИН збій на першому
 *   записі вказаних ключів, коли вже зроблено `minTotalCollectionCalls`
 *   записів колекцій. Зручно для того, щоб зламати саме фіналізацію.
 */
export class FlakyDataSource implements CrmDataSource {
  readonly kind = 'local' as const;
  collectionCalls = 0;
  shouldFail: FlakyPredicate = () => false;
  private oneShot: { keys: CollectionKey[]; minCalls: number } | null = null;
  private counts: Record<string, number> = {};
  private issueId = 0;

  constructor(private readonly inner: LocalDataSource, shouldFail?: FlakyPredicate) {
    if (shouldFail) this.shouldFail = shouldFail;
  }

  failNextOn(keys: CollectionKey[], minTotalCollectionCalls: number): void {
    this.oneShot = { keys, minCalls: minTotalCollectionCalls };
  }

  load() { return this.inner.load(); }
  writeBlockedReason() { return this.inner.writeBlockedReason(); }
  clearCollectionIssue(c: CollectionKey) { this.inner.clearCollectionIssue(c); }
  collectionHealth() { return this.inner.collectionHealth(); }
  markCollectionHealth(c: CollectionKey, state: 'corrupt' | 'ok') { this.inner.markCollectionHealth(c, state); }

  async restoreRaw(collection: CollectionKey, raw: string): Promise<WriteOutcome> {
    const call = this.next('restoreRaw', collection);
    if (this.shouldFail('restoreRaw', collection, call)) return this.fail('restoreRaw', collection);
    return this.inner.restoreRaw(collection, raw);
  }

  private next(kind: FlakyKind, key: string): number {
    const id = `${kind}:${key}`;
    this.counts[id] = (this.counts[id] || 0) + 1;
    return this.counts[id];
  }

  private fail(kind: FlakyKind, key: string): WriteOutcome {
    return {
      ok: false,
      issue: {
        id: `flaky_${++this.issueId}`,
        kind: kind === 'restoreRaw' ? 'restore_failed' : 'write_failed',
        key,
        collection: kind === 'collection' || kind === 'restoreRaw' ? (key as CollectionKey) : undefined,
        message: `Симуляція збою запису «${key}» (${kind})`,
        at: new Date().toISOString(),
      },
    };
  }

  async saveCollection(key: CollectionKey, value: unknown[]): Promise<WriteOutcome> {
    this.collectionCalls += 1;
    const call = this.next('collection', key);
    if (this.oneShot && this.oneShot.keys.includes(key) && this.collectionCalls >= this.oneShot.minCalls) {
      this.oneShot = null;
      return this.fail('collection', key);
    }
    if (this.shouldFail('collection', key, call)) return this.fail('collection', key);
    return this.inner.saveCollection(key, value);
  }

  async saveSettings(s: Parameters<CrmDataSource['saveSettings']>[0]): Promise<WriteOutcome> {
    const call = this.next('settings', 'financeSettings');
    if (this.shouldFail('settings', 'financeSettings', call)) return this.fail('settings', 'financeSettings');
    return this.inner.saveSettings(s);
  }

  async saveBackupCopy(value: string): Promise<WriteOutcome> {
    const call = this.next('backupCopy', 'crm_import_previous');
    if (this.shouldFail('backupCopy', 'crm_import_previous', call)) return this.fail('backupCopy', 'crm_import_previous');
    return this.inner.saveBackupCopy(value);
  }

  saveMeta(m: Parameters<CrmDataSource['saveMeta']>[0]) { return this.inner.saveMeta(m); }
  loadBackupCopy() { return this.inner.loadBackupCopy(); }
  listIssues() { return this.inner.listIssues(); }
  clearIssues() { this.inner.clearIssues(); }
}
