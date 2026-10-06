import type { DataSnapshot } from '@/types';
import { buildExportPayload } from '@/lib/export';

// ============================================================
// Важка повна копія (rotating full snapshot) відокремлена від
// основного збереження: основний запис не серіалізує мегабайти.
// Стан чесний і видимий: є прапорець відкладеного backup та
// остання помилка (див. getBackupRuntimeStatus).
// ============================================================

const BACKUP_KEYS = ['crm_backup_1', 'crm_backup_2', 'crm_backup_3', 'crm_backup_4', 'crm_backup_5'];
const LAST_ROTATION_KEY = 'crm_backup_rotated_at';
const PENDING_KEY = 'crm_backup_pending';
const ERROR_KEY = 'crm_backup_error';
const ROTATION_INTERVAL_MS = 30_000;

export interface BackupRuntimeStatus {
  pending: boolean;
  lastRotationAt: string;
  lastError: string;
  throttled: boolean;
}

let lastRotationAt = 0;
let scheduled: ReturnType<typeof setTimeout> | null = null;
let rotating = false;

function nowMs(): number {
  return Date.now();
}

function readFlag(key: string): string {
  try {
    return (typeof window !== 'undefined' && localStorage.getItem(key)) || '';
  } catch {
    return '';
  }
}

function writeFlag(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Службові прапорці не критичні — ігноруємо збій їх запису.
  }
}

function initRotationClock(): void {
  if (lastRotationAt) return;
  const raw = readFlag(LAST_ROTATION_KEY);
  const parsed = raw ? Date.parse(raw) : 0;
  lastRotationAt = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  if (readFlag(PENDING_KEY)) {
    // Зміни, не встигнуті у backup перед закриттям вкладки — фіксуємо.
    pending = true;
  }
}

let pending = false;
let suppressed = 0;

/**
 * Тимчасово заборонити повне резервування (наприклад, під час імпорту,
 * коли дані у частковому стані). Прапорець скидається ОБОВ'ЯЗКОВО через
 * finally — навіть за збою, інакше резервування «вимкнеться» назавжди.
 */
export function withBackupsSuppressed<T>(fn: () => T | Promise<T>): T | Promise<T> {
  suppressed += 1;
  const release = () => {
    suppressed = Math.max(0, suppressed - 1);
    if (suppressed === 0 && pending) scheduleRotation();
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).then(
        value => { release(); return value; },
        err => { release(); throw err; },
      );
    }
    release();
    return result;
  } catch (err) {
    release();
    throw err;
  }
}

export function isBackupSuppressed(): boolean {
  return suppressed > 0;
}

/** Позначити, що дані змінилися і повна копія ще не оновлена. */
export function markSnapshotDirty(): void {
  initRotationClock();
  if (!pending) {
    pending = true;
    writeFlag(PENDING_KEY, '1');
  }
  if (suppressed > 0) return;
  scheduleRotation();
}

function scheduleRotation(): void {
  if (scheduled || rotating) return;
  const delay = Math.max(0, ROTATION_INTERVAL_MS - (nowMs() - lastRotationAt));
  const run = () => {
    scheduled = null;
    const cb = (window as unknown as { requestIdleCallback?: (fn: () => void, opts?: unknown) => void }).requestIdleCallback;
    if (typeof cb === 'function') cb(() => flushBackup());
    else setTimeout(() => flushBackup(), 0);
  };
  scheduled = setTimeout(run, delay + 100);
  // Не блокуємо завершення процесу в Node (тести); у браузері unref відсутній.
  const handle = scheduled as unknown as { unref?: () => void };
  if (typeof handle.unref === 'function') handle.unref();
}

/**
 * Оновити повну копію з переданого snapshot.
 * Не є атомарним: кожен ключ окремий запис у localStorage.
 */
export function rotateBackups(snapshot: DataSnapshot, force = false): { ok: boolean; error?: string } {
  initRotationClock();
  if (suppressed > 0) return { ok: false, error: 'Резервування тимчасово вимкнено (імпорт)' };
  const elapsed = nowMs() - lastRotationAt;
  if (!force) {
    if (!pending) return { ok: true };
    if (elapsed < ROTATION_INTERVAL_MS) return { ok: true };
  }

  rotating = true;
  try {
    const payload = { createdAt: new Date().toISOString(), payload: buildExportPayload(snapshot) };
    const serialized = JSON.stringify(payload);
    for (let i = BACKUP_KEYS.length - 1; i > 0; i--) {
      const prev = localStorage.getItem(BACKUP_KEYS[i - 1]);
      if (prev) localStorage.setItem(BACKUP_KEYS[i], prev);
      else localStorage.removeItem(BACKUP_KEYS[i]);
    }
    localStorage.setItem(BACKUP_KEYS[0], serialized);
    lastRotationAt = nowMs();
    pending = false;
    writeFlag(PENDING_KEY, '');
    writeFlag(LAST_ROTATION_KEY, String(lastRotationAt));
    writeFlag(ERROR_KEY, '');
    return { ok: true };
  } catch (err) {
    const message = `Не вдалося оновити резервну копію: ${String(err)}`;
    writeFlag(ERROR_KEY, message);
    return { ok: false, error: message };
  } finally {
    rotating = false;
  }
}

function flushBackup(): void {
  if (!pending) return;
  const snapshot = readSnapshot?.();
  if (snapshot) rotateBackups(snapshot);
}

// Легасі-зв'язок, щоб backup.ts не імпортував store (уникаємо циклу).
let readSnapshot: (() => DataSnapshot | null) | null = null;
export function registerSnapshotReader(fn: () => DataSnapshot | null): void {
  readSnapshot = fn;
}

/** Best-effort останній backup перед закриттям вкладки. */
export function flushBackupOnClose(): void {
  if (!pending) return;
  try {
    flushBackup();
  } catch {
    // Закриття вкладки не можна заблокувати; прапорець pending
    // збережеться в localStorage і backup буде зроблено при наступному старті.
  }
}

export function getBackupRuntimeStatus(): BackupRuntimeStatus {
  initRotationClock();
  const rawError = readFlag(ERROR_KEY);
  return {
    pending,
    lastRotationAt: lastRotationAt ? new Date(lastRotationAt).toISOString() : '',
    lastError: rawError,
    throttled: nowMs() - lastRotationAt < ROTATION_INTERVAL_MS,
  };
}

/** Тільки для тестів/ініціалізації. */
export function resetBackupRuntime(): void {
  pending = false;
  lastRotationAt = 0;
  if (scheduled) {
    clearTimeout(scheduled);
    scheduled = null;
  }
}
