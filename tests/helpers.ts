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
export class FlakyDataSource implements CrmDataSource {
  readonly kind = 'local' as const;
  private counts: Record<string, number> = {};
  private issueId = 0;

  constructor(
    private readonly inner: LocalDataSource,
    private readonly shouldFail: (key: CollectionKey, callNumber: number) => boolean,
  ) {}

  load() { return this.inner.load(); }

  async saveCollection(key: CollectionKey, value: unknown[]): Promise<WriteOutcome> {
    this.counts[key] = (this.counts[key] || 0) + 1;
    if (this.shouldFail(key, this.counts[key])) {
      const issue: StorageIssue = {
        id: `flaky_${++this.issueId}`,
        kind: 'quota_exceeded',
        key,
        message: `Симуляція збою запису «${key}»`,
        at: new Date().toISOString(),
      };
      return { ok: false, issue };
    }
    return this.inner.saveCollection(key, value);
  }

  saveSettings(s: Parameters<CrmDataSource['saveSettings']>[0]) { return this.inner.saveSettings(s); }
  saveMeta(m: Parameters<CrmDataSource['saveMeta']>[0]) { return this.inner.saveMeta(m); }
  saveBackupCopy(s: string) { return this.inner.saveBackupCopy(s); }
  listIssues() { return this.inner.listIssues(); }
  clearIssues() { this.inner.clearIssues(); }
}
