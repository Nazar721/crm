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
/** Копія поточного (часткового) стану перед черговою спробою. */
export const ATTEMPT_STATE_KEY = 'crm_import_attempt';

export type ImportStage = 'validate' | 'safety-copy' | 'write' | 'settings' | 'finalize' | 'done';

export interface ImportOptions {
  /** Строгий режим: жоден запис не пропускається (для фінальної міграції етапу 2). */
  strict?: boolean;
  /**
   * `import` — звичайний імпорт (пошкоджена колекція відновлюється валідними даними файлу);
   * `restore-previous` — повернення копії попереднього стану (сирий вміст пошкоджених
   * колекцій відновлюється як є, без підміни порожнім масивом).
   */
  mode?: 'import' | 'restore-previous';
}

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
  /** Чи відновлено ПОВНІСТЮ попередній стан (колекції, налаштування, прапорці, сирі вмісти). */
  recovered?: boolean;
  /** Колекції, які відновити не вдалося (сирого вмісту немає або запис впав). */
  restoreSkipped?: CollectionKey[];
  issue?: string;
  errors: BackupIssue[];
}

interface RestoreContext {
  previous: DataSnapshot;
  previousFlags: string[];
  corruptBefore: Set<CollectionKey>;
  corruptRaw: Partial<Record<CollectionKey, string>>;
  /** Точка відновлення, прив'язана до активного інциденту. */
  initialCopyKey: string;
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

function emptyValidation(message: string): BackupValidation {
  const counts = countSnapshot({
    projectsActive: [], projectsCompleted: [], clients: [], specialists: [], partners: [],
    transactions: [], personalDebts: [], savings: [],
    financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
    meta: { lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' },
  });
  return {
    ok: false, format: 'unknown', version: null, exportedAt: null,
    errors: [{ message }], recordIssues: [], counts, skipped: { ...counts },
    warnings: [], content: null, settings: null,
  };
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
 * - колекції, що були пошкоджені ДО імпорту, відновлюються із СИРОГО
 *   вмісту, знятого під час читання (карантин не єдина надія);
 * - якщо сирий вміст відновити не вдалося — колекція потрапляє в
 *   `skipped`, а `restored` стає false (жодного «повного відновлення»).
 */
async function restorePrevious(ctx: RestoreContext): Promise<{ restored: boolean; skipped: CollectionKey[] }> {
  let restored = true;
  const skipped: CollectionKey[] = [];

  for (const key of COLLECTION_KEYS) {
    if (ctx.corruptBefore.has(key)) {
      const raw = ctx.corruptRaw[key];
      if (raw === undefined) {
        restored = false;
        skipped.push(key);
        continue;
      }
      const outcome = await store.restoreRawCollection(key, raw);
      if (!outcome.ok) {
        restored = false;
        skipped.push(key);
      }
      continue;
    }
    const result = await store.saveCollection(key, ctx.previous[key] as unknown[], 'import');
    if (!result.ok) restored = false;
  }

  const settingsResult = await store.saveSettings(ctx.previous.financeSettings, 'import');
  if (!settingsResult.ok) restored = false;
  // Відновлюємо й попередній інцидент (якщо він був) — це частина стану.
  const metaResult = await store.saveMeta(
    { ...ctx.previous.meta, importIncident: ctx.previous.meta.importIncident ?? null } as Partial<BackupInfo>,
    'import',
  );
  if (!metaResult.ok) restored = false;

  restoreMigrationFlags(ctx.previousFlags);
  return { restored, skipped };
}

/**
 * Спільний шлях відновлення для КОЖНОЇ відмови після початку заміни даних.
 * Викликається ВСЕРЕДИНІ withBackupsSuppressed — повна копія лишається
 * вимкненою до завершення всього процесу.
 */
async function failAndRestore(
  ctx: RestoreContext,
  stage: ImportStage,
  written: CollectionKey[],
  issue: string,
  errors: BackupIssue[],
): Promise<ImportOutcome> {
  let recovered = false;
  let restoreSkipped: CollectionKey[] = [];
  let finalIssue = issue;
  try {
    const recovery = await restorePrevious(ctx);
    recovered = recovery.restored;
    restoreSkipped = recovery.skipped;
  } catch (err) {
    finalIssue = `${issue} / відновлення перервано: ${String(err)}`;
  }

  await store.reloadStore();

  // Міграційний блок більше не потрібен: прапорці відновлено, а стан
  // даних накриває СТІЙКИЙ інцидент імпорту (живе в метаданих).
  store.setMigrationBlock(null);

  if (recovered) {
    // Стан повністю попередній, у т.ч. інцидент (якщо він був до імпорту).
    await store.setImportIncident(ctx.previous.meta.importIncident ?? null);
  } else {
    await store.setImportIncident({
      at: new Date().toISOString(),
      reason: `Імпорт не завершено (${stage}): ${finalIssue}. Попередній стан відновлено не повністю — перегляд і експорт доступні, запис заблоковано.`,
      stage,
      recovered: false,
      copyKey: ctx.initialCopyKey,
    });
  }

  return { ok: false, stage, written, issue: finalIssue, errors, recovered, restoreSkipped };
}

/**
 * Застосування імпорту.
 *
 * ВАЖЛИВО: localStorage не має транзакцій, тому це НЕ атомарна операція.
 * Порядок: (1) валідація до будь-якого запису, (2) копія попереднього стану,
 * (3) стійка мітка «імпорт розпочато» — ДО першої зміни основних даних,
 * (4) послідовний запис колекцій, (5) налаштування, (6) міграції.
 * Мітка знімається лише після повністю успішного імпорту або повністю
 * успішного відновлення; інакше вона переживає reinitialize і перезапуск.
 */
export async function applyImport(raw: unknown, options: ImportOptions = {}): Promise<ImportReport> {
  const mode = options.mode ?? 'import';
  const validation = validateBackup(raw, options);
  if (!validation.ok || !validation.content) {
    return { ok: false, stage: 'validate', validation, written: [], errors: validation.errors };
  }

  const existingIncident = store.getImportIncident();
  const ctx: RestoreContext = {
    previous: store.getSnapshot(),
    previousFlags: listAppliedMigrations(),
    corruptBefore: new Set(store.getCorruptCollections()),
    corruptRaw: store.getCorruptRaw(),
    initialCopyKey: existingIncident?.copyKey ?? PREVIOUS_STATE_KEY,
  };
  const incomingCorruptRaw = (raw as { corruptRaw?: Record<string, string> }).corruptRaw;

  // 1. Копія стану перед записом.
  //
  // Початкова точка відновлення (`PREVIOUS_STATE_KEY`) пишеться ЛИШЕ коли
  // активного інциденту немає. Поки інцидент активний (і для кожної спроби
  // відновлення) копія поточного стану йде в ОКРЕМИЙ ключ — інакше повторна
  // спроба стирала б єдину початкову точку, з якої саме відновлюються.
  const safetyKey = mode === 'restore-previous' || existingIncident
    ? ATTEMPT_STATE_KEY
    : PREVIOUS_STATE_KEY;
  const safetyPayload: ExportPayload = buildExportPayload(ctx.previous, {
    issues: store.getIssues(),
    corruptRaw: ctx.corruptRaw,
  });
  const serialized = JSON.stringify({ createdAt: new Date().toISOString(), kind: 'pre-import', payload: safetyPayload });
  const copyResult = await store.saveBackupCopy(serialized, safetyKey);
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
    // 2. Стійка мітка до ПЕРШОЇ зміни основних даних: аварійне закриття
    // вкладки під час імпорту має бути виявлене при наступному старті.
    // Якщо інцидент уже є — не перезаписуємо його (зберігаємо час, причину
    // та прив'язку до початкової копії). Мітка вже стоїть до першого запису.
    const marked = existingIncident
      ? true
      : await store.setImportIncident({
          at: new Date().toISOString(),
          reason: 'Імпорт розпочато і не завершено — стан не підтверджено.',
          stage: 'write',
          copyKey: safetyKey,
        });
    if (!marked) {
      return {
        ok: false,
        stage: 'write',
        written: [],
        recovered: true,
        restoreSkipped: [],
        issue: 'Не вдалося зафіксувати початок імпорту (ліміт сховища) — жодних записів не зроблено',
        errors: [{ message: 'Не вдалося зафіксувати початок імпорту — дані не змінювалися' }],
      };
    }

    // 3. Запис колекцій.
    const written: CollectionKey[] = [];
    for (const key of COLLECTION_KEYS) {
      if (mode === 'restore-previous') {
        const incomingRaw = incomingCorruptRaw?.[key];
        if (incomingRaw !== undefined) {
          // Відновлюємо сирий оригінал, а не масив із копії.
          const outcome = await store.restoreRawCollection(key, incomingRaw);
          if (!outcome.ok) {
            return failAndRestore(ctx, 'write', written, outcome.issue.message, [
              { collection: key, message: `Відновлення сирого вмісту «${key}» не вдалося: ${outcome.issue.message}` },
            ]);
          }
          written.push(key);
          continue;
        }
        if (ctx.corruptBefore.has(key)) {
          // Сирого вмісту в копії немає, а колекція й так у пошкодженому
          // (поперньому) стані — не чіпаємо, щоб не підмінити її порожнім.
          continue;
        }
      }
      const outcome = await store.saveCollection(key, validation.content![key], 'import');
      if (!outcome.ok) {
        return failAndRestore(ctx, 'write', written, outcome.issue.message, [
          { collection: key, message: `Збій запису «${key}»: ${outcome.issue.message}` },
        ]);
      }
      written.push(key);
    }

    // 4. Налаштування фінансів (якщо їх немає у файлі — чинні зберігаються).
    if (validation.settings) {
      const outcome = await store.saveSettings(validation.settings, 'import');
      if (!outcome.ok) {
        return failAndRestore(ctx, 'settings', written, outcome.issue.message, [
          { message: `Запис імпортованих налаштувань не вдався: ${outcome.issue.message}` },
        ]);
      }
    }

    // 5. Фіналізація.
    if (mode === 'import') {
      // Нові дані потребують міграцій поточної версії схеми.
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
    } else {
      // Відновлення попереднього стану: міграції до нього вже
      // застосовані. Повторний запуск на частково пошкоджених
      // колекціях лише заблокував би системний запис.
      restoreMigrationFlags(ctx.previousFlags);
    }

    await store.reloadStore();
    return { ok: true, written };
  });

  if (result.ok) {
    // Повністю успішний імпорт — єдина умова зняття стійкої мітки.
    await store.setImportIncident(null);
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

/**
 * Явне відновлення з ТОЧКИ, на яку посилається активний інцидент
 * (типово `crm_import_previous`). Читає копію ДО будь-якого запису, тому
 * сама спроба не може її перезаписати; власна копія спроби йде в
 * `crm_import_attempt`. Стійкий інцидент знімається лише за повного успіху.
 */
export async function restoreFromPreviousCopy(): Promise<ImportReport> {
  // Точкою відновлення є саме та копія, на яку посилається інцидент
  // (після перезапуску вона читається зі стійких метаданих).
  const incident = store.getImportIncident();
  const copyKey = incident?.copyKey || PREVIOUS_STATE_KEY;
  const serialized = await store.loadBackupCopy(copyKey);
  if (!serialized) {
    return {
      ok: false,
      stage: 'safety-copy',
      validation: emptyValidation('Копію попереднього стану не знайдено або її не вдалося прочитати'),
      written: [],
      recovered: false,
      issue: `Копію попереднього стану («${copyKey}») не знайдено`,
      errors: [{ message: `Точку відновлення «${copyKey}» не знайдено або її не вдалося прочитати` }],
    };
  }

  let payload: unknown;
  try {
    const parsed = JSON.parse(serialized) as { payload?: unknown };
    payload = parsed && parsed.payload ? parsed.payload : parsed;
  } catch (err) {
    const message = `Копію попереднього стану «${copyKey}» пошкоджено: ${String(err)}`;
    return {
      ok: false,
      stage: 'safety-copy',
      validation: emptyValidation(message),
      written: [],
      recovered: false,
      issue: message,
      errors: [{ message }],
    };
  }

  return applyImport(payload, { mode: 'restore-previous' });
}
