import type {
  BackupInfo, Client, DataSnapshot, ExportPayload, FinanceSettings,
  Partner, PersonalDebt, Project, Saving, Specialist, Transaction,
} from '@/types';
import * as store from '@/lib/store';
import { getSettings } from '@/lib/settings';
import { buildExportPayload } from '@/lib/export';
import { applyImport, type ImportReport } from '@/lib/importer';

// ============================================================
// Публічний фасад сховища. Сторінки/форми викликають ці функції
// і не знають, чи дані лежать у localStorage, чи (етап 2) на сервері.
// Синхронні читання йдуть зі snapshot у пам'яті, запис — асинхронний.
// ============================================================

const read = <T,>(pick: (s: DataSnapshot) => T[]): T[] => [...pick(store.getSnapshot())];

export const getProjects = (): Project[] => read(s => s.projectsActive);
export const getCompleted = (): Project[] => read(s => s.projectsCompleted);
export const getClients = (): Client[] => read(s => s.clients);
export const getSpecialists = (): Specialist[] => read(s => s.specialists);
export const getPartners = (): Partner[] => read(s => s.partners);
export const getTransactions = (): Transaction[] => read(s => s.transactions);
export const getPersonalDebts = (): PersonalDebt[] => read(s => s.personalDebts);
export const getSavings = (): Saving[] => read(s => s.savings);

export function getAllProjects(): Project[] {
  const s = store.getSnapshot();
  return [...s.projectsActive, ...s.projectsCompleted];
}

export const saveProjects = (d: Project[]) => store.saveCollection('projectsActive', d);
export const saveCompleted = (d: Project[]) => store.saveCollection('projectsCompleted', d);
export const saveClients = (d: Client[]) => store.saveCollection('clients', d);
export const saveSpecialists = (d: Specialist[]) => store.saveCollection('specialists', d);
export const savePartners = (d: Partner[]) => store.saveCollection('partners', d);
export const saveTransactions = (d: Transaction[]) => store.saveCollection('transactions', d);
export const savePersonalDebts = (d: PersonalDebt[]) => store.saveCollection('personalDebts', d);
export const saveSavings = (d: Saving[]) => store.saveCollection('savings', d);

export function getFinanceSettings(): FinanceSettings {
  const snap = store.getSnapshot();
  return snap.financeSettings ?? getSettings();
}

export function saveFinanceSettings(settings: FinanceSettings) {
  return store.saveSettings(settings);
}

/** Повний JSON-експорт зі snapshot (незалежно від пагінації/фільтрів). */
export function exportData(includeMeta = true): ExportPayload {
  return buildExportPayload(store.getSnapshot(), {
    includeMeta,
    issues: store.getIssues(),
    corruptRaw: store.getCorruptRaw(),
  });
}

/**
 * Сумісна обгортка над імпортом: строга валідація, попередній стан
 * зберігається для відновлення. Кидає виняток із переліком помилок.
 */
export async function importData(payload: unknown): Promise<ImportReport> {
  const report = await applyImport(payload);
  if (!report.ok) {
    throw new Error(report.errors.map(e => e.message).join('; ') || 'Некоректний файл');
  }
  return report;
}

export async function markManualBackup(): Promise<string> {
  const now = new Date().toISOString();
  await store.saveMeta({ lastManualBackupAt: now, backupSnoozedUntil: '' });
  return now;
}

export async function snoozeBackupReminder(days = 3): Promise<void> {
  await store.saveMeta({ backupSnoozedUntil: new Date(Date.now() + days * 86400000).toISOString() });
}

export function getBackupInfo(): BackupInfo {
  return { ...store.getSnapshot().meta };
}

export function shouldShowBackupReminder(maxAgeDays = 7): boolean {
  const info = getBackupInfo();
  if (info.backupSnoozedUntil && new Date(info.backupSnoozedUntil) > new Date()) return false;
  if (!info.lastManualBackupAt) return true;
  return Date.now() - new Date(info.lastManualBackupAt).getTime() > maxAgeDays * 86400000;
}

export { getIssues as getStorageIssues } from '@/lib/store';
