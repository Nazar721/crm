import type { Project, Client, Specialist, Partner, Transaction, PersonalDebt, Saving, Lead, LeadFilters, FinanceSettings, BackupInfo, ExportPayload } from '@/types';

const KEYS = {
  projectsActive: 'projects_active',
  projectsCompleted: 'projects_completed',
  clients: 'clients',
  specialists: 'specialists',
  partners: 'partners',
  transactions: 'transactions',
  personalDebts: 'personal_debts',
  savings: 'savings',
  leads: 'leadgen_leads',
  leadFilters: 'leadgen_filters',
};

const META_KEYS = {
  lastSavedAt: 'crm_last_saved_at',
  lastManualBackupAt: 'crm_last_manual_backup_at',
  backupSnoozedUntil: 'crm_backup_snoozed_until',
  financeSettings: 'crm_finance_settings',
};

const BACKUP_KEYS = ['crm_backup_1', 'crm_backup_2', 'crm_backup_3', 'crm_backup_4', 'crm_backup_5'];

function get<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]') || [];
  } catch {
    return [];
  }
}

function set(key: string, data: unknown): void {
  localStorage.setItem(key, JSON.stringify(data));
  afterSave();
}

export function getProjects(): Project[] { return get<Project>(KEYS.projectsActive); }
export function getCompleted(): Project[] { return get<Project>(KEYS.projectsCompleted); }
export function getClients(): Client[] { return get<Client>(KEYS.clients); }
export function getSpecialists(): Specialist[] { return get<Specialist>(KEYS.specialists); }
export function getPartners(): Partner[] { return get<Partner>(KEYS.partners); }
export function getTransactions(): Transaction[] { return get<Transaction>(KEYS.transactions); }
export function getPersonalDebts(): PersonalDebt[] { return get<PersonalDebt>(KEYS.personalDebts); }
export function getSavings(): Saving[] { return get<Saving>(KEYS.savings); }
export function getLeads(): Lead[] { return get<Lead>(KEYS.leads); }

export function getLeadFilters(): LeadFilters {
  const data = get<LeadFilters>(KEYS.leadFilters);
  return { onlyNoWebsite: false, hideNotInteresting: true, showHidden: false, ...(data || {}) };
}

export function getAllProjects(): Project[] {
  return [...getProjects(), ...getCompleted()];
}

export function saveProjects(d: Project[]): void { set(KEYS.projectsActive, d); }
export function saveCompleted(d: Project[]): void { set(KEYS.projectsCompleted, d); }
export function saveClients(d: Client[]): void { set(KEYS.clients, d); }
export function saveSpecialists(d: Specialist[]): void { set(KEYS.specialists, d); }
export function savePartners(d: Partner[]): void { set(KEYS.partners, d); }
export function saveTransactions(d: Transaction[]): void { set(KEYS.transactions, d); }
export function savePersonalDebts(d: PersonalDebt[]): void { set(KEYS.personalDebts, d); }
export function saveSavings(d: Saving[]): void { set(KEYS.savings, d); }
export function saveLeads(d: Lead[]): void { set(KEYS.leads, d); }
export function saveLeadFilters(d: LeadFilters): void { set(KEYS.leadFilters, d); }

export function getFinanceSettings(): FinanceSettings {
  try {
    return { usdRate: 41, eurRate: 44, ...(JSON.parse(localStorage.getItem(META_KEYS.financeSettings) || '{}') || {}) };
  } catch {
    return { usdRate: 41, eurRate: 44 };
  }
}

export function saveFinanceSettings(settings: FinanceSettings): void {
  localStorage.setItem(META_KEYS.financeSettings, JSON.stringify({
    usdRate: Number(settings.usdRate) || 41,
    eurRate: Number(settings.eurRate) || 44,
  }));
  afterSave();
}

let _suppressBackups = false;

function afterSave(): void {
  if (_suppressBackups) return;
  const now = new Date().toISOString();
  localStorage.setItem(META_KEYS.lastSavedAt, now);
  rotateInternalBackups(now);
}

function rotateInternalBackups(now: string = new Date().toISOString()): void {
  for (let i = BACKUP_KEYS.length - 1; i > 0; i--) {
    const prev = localStorage.getItem(BACKUP_KEYS[i - 1]);
    if (prev) localStorage.setItem(BACKUP_KEYS[i], prev);
    else localStorage.removeItem(BACKUP_KEYS[i]);
  }
  localStorage.setItem(BACKUP_KEYS[0], JSON.stringify({
    createdAt: now,
    payload: exportData(false),
  }));
}

export function exportData(includeMeta: boolean = true): ExportPayload {
  const data = {
    projectsActive: getProjects(),
    projectsCompleted: getCompleted(),
    clients: getClients(),
    specialists: getSpecialists(),
    partners: getPartners(),
    transactions: getTransactions(),
    personalDebts: getPersonalDebts(),
    savings: getSavings(),
    leads: getLeads(),
    leadFilters: getLeadFilters(),
  };
  const payload: ExportPayload = {
    app: 'WebAgency CRM',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
    financeSettings: getFinanceSettings(),
  };
  if (includeMeta) payload.meta = getBackupInfo();
  return payload;
}

export function importData(payload: ExportPayload): void {
  if (!payload || typeof payload !== 'object') throw new Error('Некоректний файл');
  const data = payload.data && typeof payload.data === 'object' ? payload.data : (payload as unknown as Record<string, unknown>);

  const nextData: Record<string, unknown[]> = {};
  Object.entries(KEYS).forEach(([, key]) => {
    const value = (data as Record<string, unknown>)[key];
    nextData[key] = Array.isArray(value) ? value : [];
  });

  _suppressBackups = true;
  Object.entries(nextData).forEach(([key, value]) => set(key, value));
  if (payload.financeSettings) saveFinanceSettings(payload.financeSettings);
  ['crm_migrated_v11', 'crm_migrated_v12', 'crm_migrated_v13', 'crm_migrated_v14', 'crm_migrated_v15'].forEach(key => localStorage.removeItem(key));
  _suppressBackups = false;
  afterSave();
}

export function markManualBackup(): string {
  const now = new Date().toISOString();
  localStorage.setItem(META_KEYS.lastManualBackupAt, now);
  localStorage.removeItem(META_KEYS.backupSnoozedUntil);
  return now;
}

export function snoozeBackupReminder(days: number = 3): void {
  const until = new Date(Date.now() + days * 86400000).toISOString();
  localStorage.setItem(META_KEYS.backupSnoozedUntil, until);
}

export function getBackupInfo(): BackupInfo {
  return {
    lastSavedAt: localStorage.getItem(META_KEYS.lastSavedAt) || '',
    lastManualBackupAt: localStorage.getItem(META_KEYS.lastManualBackupAt) || '',
    backupSnoozedUntil: localStorage.getItem(META_KEYS.backupSnoozedUntil) || '',
  };
}

export function shouldShowBackupReminder(maxAgeDays: number = 7): boolean {
  const info = getBackupInfo();
  if (info.backupSnoozedUntil && new Date(info.backupSnoozedUntil) > new Date()) return false;
  if (!info.lastManualBackupAt) return true;
  return Date.now() - new Date(info.lastManualBackupAt).getTime() > maxAgeDays * 86400000;
}
