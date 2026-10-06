import type { DataSnapshot, ExportPayload } from '@/types';
import { EXPORT_FORMAT_ID, EXPORT_SCHEMA_VERSION } from '@/types';

const SECRET_KEY_RE = /(api[_-]?key|apikey|secret|token|password|passwd|authorization|credential|private[_-]?key)/i;

/** Глибоке копіювання без службових/секретних полів. */
export function stripSecrets<T>(value: T, depth = 0): T {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(v => stripSecrets(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = stripSecrets(v, depth + 1);
  }
  return out as unknown as T;
}

/**
 * Побудова повного JSON-експорту зі snapshot у пам'яті.
 * Не залежить від пагінації/фільтрів: завжди пише весь набір записів.
 * Секрети (API-ключі тощо) виключаються на рівні збірки payload.
 */
export function buildExportPayload(
  snapshot: DataSnapshot,
  options: { includeMeta?: boolean; exportedAt?: string } = {},
): ExportPayload {
  const payload: ExportPayload = {
    app: EXPORT_FORMAT_ID,
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: options.exportedAt || new Date().toISOString(),
    data: stripSecrets({
      projectsActive: snapshot.projectsActive,
      projectsCompleted: snapshot.projectsCompleted,
      clients: snapshot.clients,
      specialists: snapshot.specialists,
      partners: snapshot.partners,
      transactions: snapshot.transactions,
      personalDebts: snapshot.personalDebts,
      savings: snapshot.savings,
    }),
    financeSettings: stripSecrets(snapshot.financeSettings),
  };
  if (options.includeMeta !== false && snapshot.meta) payload.meta = stripSecrets(snapshot.meta);
  return payload;
}

export function serializeExport(payload: ExportPayload): string {
  return JSON.stringify(payload, null, 2);
}
