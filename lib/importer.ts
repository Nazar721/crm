import type { BackupInfo, DataSnapshot, ExportPayload } from '@/types';
import type { CollectionKey } from '@/lib/datasource/types';
import { COLLECTION_KEYS } from '@/lib/datasource/types';
import type { BackupIssue, BackupValidation, CollectionCounts } from '@/lib/validate-backup';
import { validateBackup } from '@/lib/validate-backup';
import { buildExportPayload } from '@/lib/export';
import { withBackupsSuppressed } from '@/lib/backup';
import { clearMigrationFlags } from '@/lib/migration-flags';
import { migrate } from '@/lib/migrations';
import * as store from '@/lib/store';

export const PREVIOUS_STATE_KEY = 'crm_import_previous';

export type ImportStage = 'validate' | 'safety-copy' | 'write' | 'settings' | 'finalize' | 'done';

export interface ImportPreview {
  validation: BackupValidation;
  /** Поточний стан (для порівняння перед імпортом). */
  previousCounts: CollectionCounts;
  previousTotal: number;
  /** Ключ, куди буде записано копію попереднього стану. */
  safetyCopyKey: string;
}

export interface ImportReport {
  ok: boolean;
  stage: ImportStage;
  validation: BackupValidation;
  written: CollectionKey[];
  /** Чи вдалося відновити попередній стан після збою запису. */
  recovered?: boolean;
  issue?: string;
  errors: BackupIssue[];
}

function countSnapshot(snapshot: DataSnapshot): CollectionCounts {
  return {
    projectsActive: snapshot.projectsActive.length,
    projectsCompleted: snapshot.projectsCompleted.length,
    clients: snapshot.clients.length,
    specialists: snapshot.specialists.length,
    partners: snapshot.partners.length,
    transactions: snapshot.transactions.length,
    personalDebts: snapshot.personalDebts.length,
    savings: snapshot.savings.length,
  };
}

function total(counts: CollectionCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * Попередній перегляд імпорту: кількість записів, помилки, попередження.
 * НІЧОГО не пише в сховище.
 */
export function previewImport(raw: unknown): ImportPreview {
  const validation = validateBackup(raw);
  const previousCounts = countSnapshot(store.getSnapshot());
  return {
    validation,
    previousCounts,
    previousTotal: total(previousCounts),
    safetyCopyKey: PREVIOUS_STATE_KEY,
  };
}

async function restore(previous: DataSnapshot): Promise<boolean> {
  let allOk = true;
  for (const key of COLLECTION_KEYS) {
    const res = await store.saveCollection(key, previous[key] as unknown[]);
    if (!res.ok) allOk = false;
  }
  const settingsRes = await store.saveSettings(previous.financeSettings);
  if (!settingsRes.ok) allOk = false;
  const metaRes = await store.saveMeta(previous.meta as Partial<BackupInfo>);
  if (!metaRes.ok) allOk = false;
  return allOk;
}

/**
 * Застосування імпорту.
 *
 * ВАЖЛИВО: localStorage не має транзакцій, тому це НЕ атомарна операція.
 * Порядок дій: (1) валідація до будь-якого запису, (2) копія попереднього
 * стану, (3) послідовний запис колекцій, (4) налаштування, (5) міграції.
 * На будь-якому кроці збою виконується відновлення з копії; якщо
 * відновлення не вдалося — повертається явний стан помилки (`recovered:false`).
 */
export async function applyImport(raw: unknown): Promise<ImportReport> {
  const validation = validateBackup(raw);
  if (!validation.ok || !validation.content) {
    return { ok: false, stage: 'validate', validation, written: [], errors: validation.errors };
  }

  const previous = store.getSnapshot();

  // 1. Копія попереднього стану — обов'язкова умова подальшого запису.
  const safetyPayload: ExportPayload = buildExportPayload(previous);
  const serialized = JSON.stringify({ createdAt: new Date().toISOString(), kind: 'pre-import', payload: safetyPayload });
  const copyResult = await store.saveBackupCopy(serialized);
  if (!copyResult.ok) {
    return {
      ok: false,
      stage: 'safety-copy',
      validation,
      written: [],
      recovered: false,
      issue: copyResult.issue.message,
      errors: [{ message: `Не вдалося створити копію попереднього стану: ${copyResult.issue.message}` }],
    };
  }

  // 2–3. Запис колекцій і налаштувань. Повна копія на цей час вимкнена,
  // щоб не зафіксувати частковий стан; прапорець скидається через finally.
  const writeResult = await withBackupsSuppressed(async () => {
    const written: CollectionKey[] = [];
    for (const key of COLLECTION_KEYS) {
      const result = await store.saveCollection(key, validation.content![key]);
      if (!result.ok) {
        const recovered = await restore(previous);
        await store.reloadStore();
        return {
          ok: false as const,
          stage: 'write' as ImportStage,
          written,
          recovered,
          issue: result.issue.message,
          errors: [{ collection: key, message: `Збій запису «${key}»: ${result.issue.message}` }],
        };
      }
      written.push(key);
    }

    if (validation.settings) {
      const result = await store.saveSettings(validation.settings);
      if (!result.ok) {
        await store.reloadStore();
        return {
          ok: false as const,
          stage: 'settings' as ImportStage,
          written,
          recovered: false,
          issue: result.issue.message,
          errors: [{ message: `Запис імпортованих налаштувань не вдався: ${result.issue.message}` }],
        };
      }
    }
    return { ok: true as const, written };
  });

  if (!writeResult.ok) {
    return { ok: false, stage: writeResult.stage, validation, written: writeResult.written, recovered: writeResult.recovered, issue: writeResult.issue, errors: writeResult.errors };
  }
  const written = writeResult.written;

  // 4. Імпортовані дані потребують міграцій для поточної версії схеми.
  clearMigrationFlags();
  await migrate();
  await store.reloadStore();

  return { ok: true, stage: 'done', validation, written, errors: [] };
}
