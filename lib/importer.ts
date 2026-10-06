import type { BackupInfo, DataSnapshot, ExportPayload } from '@/types';
import type { CollectionKey } from '@/lib/datasource/types';
import { COLLECTION_KEYS } from '@/lib/datasource/types';
import type { BackupIssue, BackupValidation, CollectionCounts } from '@/lib/validate-backup';
import { validateBackup } from '@/lib/validate-backup';
import { buildExportPayload } from '@/lib/export';
import { withBackupsSuppressed } from '@/lib/backup';
import { clearMigrationFlags, listAppliedMigrations, markMigrationApplied } from '@/lib/migration-flags';
import { runMigrations } from '@/lib/migrations';
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
  /** Чи вдалося відновити ПОВНІСТЮ попередній стан (колекції, налаштування, прапорці). */
  recovered?: boolean;
  /** Колекції, що вже були пошкоджені до імпорту: їх відновлювати не можна. */
  restoreSkipped?: CollectionKey[];
  issue?: string;
  errors: BackupIssue[];
}

interface RestoreContext {
  previous: DataSnapshot;
  previousFlags: string[];
  corruptBefore: Set<CollectionKey>;
}

type FailureOutcome = {
  ok: false;
  stage: ImportStage;
  written: CollectionKey[];
  issue: string;
  errors: BackupIssue[];
  recovered: boolean;
  restoreSkipped: CollectionKey[];
};

type ImportOutcome = { ok: true; written: CollectionKey[] } | FailureOutcome;

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
export function previewImport(raw: unknown, options: { strict?: boolean } = {}): ImportPreview {
  const validation = validateBackup(raw, options);
  const previousCounts = countSnapshot(store.getSnapshot());
  return {
    validation,
    previousCounts,
    previousTotal: total(previousCounts),
    safetyCopyKey: PREVIOUS_STATE_KEY,
  };
}

function restoreMigrationFlags(appliedIds: string[]): void {
  clearMigrationFlags();
  appliedIds.forEach(id => markMigrationApplied(id));
}

/**
 * Відновлення попереднього стану — ЄДИНА процедура для будь-якої відмови
 * після початку заміни даних (колекції, налаштування, фіналізація).
 *
 * Колекції, що були пошкоджені ДО імпорту, не перезаписуються: їхній
 * попередній стан у пам'яті — порожній, а єдиний оригінал лише в карантині.
 */
async function restorePrevious(ctx: RestoreContext): Promise<{ restored: boolean; skipped: CollectionKey[] }> {
  let restored = true;
  const skipped: CollectionKey[] = [];

  for (const key of COLLECTION_KEYS) {
    if (ctx.corruptBefore.has(key)) {
      skipped.push(key);
      continue;
    }
    const result = await store.saveCollection(key, ctx.previous[key] as unknown[], 'import');
    if (!result.ok) restored = false;
  }
  const settingsResult = await store.saveSettings(ctx.previous.financeSettings, 'import');
  if (!settingsResult.ok) restored = false;
  const metaResult = await store.saveMeta(ctx.previous.meta as Partial<BackupInfo>, 'import');
  if (!metaResult.ok) restored = false;

  restoreMigrationFlags(ctx.previousFlags);
  return { restored, skipped };
}

/**
 * Спільний шлях відновлення для КОЖНОЇ відмови після початку заміни даних
 * (колекції, налаштування, фіналізація). Викликається ВСЕРЕДИНІ
 * withBackupsSuppressed — повна копія лишається вимкненою до завершення.
 */
async function failAndRestore(
  ctx: RestoreContext,
  stage: ImportStage,
  written: CollectionKey[],
  issue: string,
  errors: BackupIssue[],
): Promise<ImportOutcome> {
  let recovered = false;
  let restoreSkipped: CollectionKey[] = [...ctx.corruptBefore];
  let finalIssue = issue;
  try {
    const recovery = await restorePrevious(ctx);
    recovered = recovery.restored;
    restoreSkipped = recovery.skipped;
  } catch (err) {
    finalIssue = `${issue} / відновлення перервано: ${String(err)}`;
  }

  await store.reloadStore();
  store.setMigrationBlock(
    recovered
      ? null
      : 'Не вдалося відновити попередній стан після збою імпорту — дані можуть бути частково замінені. Перевірте їх і за потреби імпортуйте резервну копію.',
  );

  return { ok: false, stage, written, issue: finalIssue, errors, recovered, restoreSkipped };
}

/**
 * Застосування імпорту.
 *
 * ВАЖЛИВО: localStorage не має транзакцій, тому це НЕ атомарна операція.
 * Порядок: (1) валідація до будь-якого запису, (2) копія попереднього
 * стану, (3) послідовний запис колекцій, (4) налаштування,
 * (5) міграції. Будь-яка відмова після кроку 2 проходить через ЄДИНУ
 * процедуру відновлення; повна копія залишається вимкненою аж до
 * завершення всього процесу (див. withBackupsSuppressed).
 */
export async function applyImport(raw: unknown, options: { strict?: boolean } = {}): Promise<ImportReport> {
  const validation = validateBackup(raw, options);
  if (!validation.ok || !validation.content) {
    return { ok: false, stage: 'validate', validation, written: [], errors: validation.errors };
  }

  const ctx: RestoreContext = {
    previous: store.getSnapshot(),
    previousFlags: listAppliedMigrations(),
    corruptBefore: new Set(store.getCorruptCollections()),
  };

  // 1. Копія попереднього стану — обов'язкова умова подальшого запису.
  const safetyPayload: ExportPayload = buildExportPayload(ctx.previous);
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

  const result: ImportOutcome = await withBackupsSuppressed(async (): Promise<ImportOutcome> => {
    // 2. Запис колекцій.
    const written: CollectionKey[] = [];
    for (const key of COLLECTION_KEYS) {
      const outcome = await store.saveCollection(key, validation.content![key], 'import');
      if (!outcome.ok) {
        return failAndRestore(ctx, 'write', written, outcome.issue.message, [
          { collection: key, message: `Збій запису «${key}»: ${outcome.issue.message}` },
        ]);
      }
      written.push(key);
    }

    // 3. Налаштування фінансів (якщо їх немає у файлі — чинні зберігаються).
    if (validation.settings) {
      const outcome = await store.saveSettings(validation.settings, 'import');
      if (!outcome.ok) {
        return failAndRestore(ctx, 'settings', written, outcome.issue.message, [
          { message: `Запис імпортованих налаштувань не вдався: ${outcome.issue.message}` },
        ]);
      }
    }

    // 4. Фіналізація: міграції для поточної версії схеми.
    clearMigrationFlags();
    const migrationReport = await runMigrations();
    if (migrationReport.failed.length) {
      return failAndRestore(
        ctx,
        'finalize',
        written,
        `Міграції не застосовано: ${migrationReport.failed.join(', ')}`,
        [{ message: `Фіналізація імпорту не завершена: міграції ${migrationReport.failed.join(', ')} не виконалися` }],
      );
    }

    await store.reloadStore();
    return { ok: true, written };
  });

  if (result.ok) {
    return { ok: true, stage: 'done', validation, written: result.written, errors: [] };
  }

  return {
    ok: false,
    stage: result.stage,
    validation,
    written: result.written,
    recovered: result.recovered,
    restoreSkipped: result.restoreSkipped,
    issue: result.issue,
    errors: result.errors,
  };
}
