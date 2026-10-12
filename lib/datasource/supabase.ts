import type { BackupInfo, DataSnapshot, FinanceSettings } from '@/types';
import type { CollectionKey, CrmDataSource, DataSnapshotPayload, StorageIssue, WriteOutcome } from './types';
import { supabase } from '@/lib/supabase/client';
import { normalizeSettings } from '@/lib/settings';
import type {
  HistoryEvent, HistoryListResult, HistoryPatch, HistoryQuery,
  HistoryUndoRequest, HistoryUndoResult,
} from '@/lib/history/types';
import { normalizeHistoryEvent } from '@/lib/history/engine';
import { getWriteContext } from '@/lib/history/source';

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null; status?: number }>;

/** Функцію ще не застосовано в базі (SQL-міграція 003 відсутня). */
function isMissingFunctionError(error: { message: string; code?: string }): boolean {
  return error.code === 'PGRST202'
    || /could not find the function|function .* does not exist/i.test(error.message || '');
}
export class SupabaseDataSource implements CrmDataSource {
  readonly kind = 'remote' as const;
  private revision = 0;
  private current!: DataSnapshot;
  private blocked: string | null = null;
  private issues: StorageIssue[] = [];
  private batching = false;
  constructor(private rpc: Rpc = async (name,args) => { const result = await supabase().rpc(name,args); return {data:result.data,error:result.error,status:result.status}; }) {}
  private failure(message: string, key?: string): WriteOutcome {
    this.blocked = message;
    const issue: StorageIssue = {id:crypto.randomUUID(),kind:'write_failed',key,message,at:new Date().toISOString()};
    this.issues = [issue]; return {ok:false,issue};
  }
  async load(): Promise<DataSnapshotPayload> {
    const result = await this.rpc('crm_read');
    if (result.error) throw new Error('Не вдалося завантажити базу. Перевір вхід, доступ власника та встановлення SQL.');
    const row = result.data as {revision:number;snapshot:DataSnapshot};
    if (!row || !Number.isSafeInteger(row.revision) || !row.snapshot) throw new Error('Некоректна відповідь бази');
    this.current = row.snapshot; this.revision = row.revision; this.blocked = null; this.issues = [];
    return {data:structuredClone(this.current),issues:[],corruptRaw:{}};
  }
  async saveSnapshot(next: DataSnapshot): Promise<WriteOutcome> {
    if (this.blocked) return this.failure(this.blocked);
    try {
      const ctx = getWriteContext();
      const base = { p_revision: this.revision, p_request: crypto.randomUUID(), p_snapshot: next };
      let result = await this.rpc('crm_commit', { ...base, p_source: ctx.source, p_action: ctx.hint ?? null });
      if (result.error && isMissingFunctionError(result.error)) {
        // Міграція 003 ще не застосована: зберегти дані без журналу
        // (стара сигнатура). Журнал з'явиться після застосування SQL.
        result = await this.rpc('crm_commit', base);
      }
      if (result.error) {
        // Лише безпечні коди, без текстів SQL, snapshot або токенів.
        const code = /^[A-Za-z0-9_]{1,40}$/.test(result.error.code || '') ? result.error.code : undefined;
        const status = Number.isInteger(result.status) && result.status! >= 100 && result.status! <= 599 ? result.status : undefined;
        const detail = [status ? `HTTP ${status}` : '', code || ''].filter(Boolean).join(', ');
        const reason = result.error.message.includes('CRM_CONFLICT')
          ? 'Дані змінилися на іншому пристрої. Онови сторінку й повтори дію.'
          : status === 401
            ? 'База відхилила перевірку входу. Онови сторінку та увійди повторно.'
            : status === 403
              ? 'База відхилила доступ до запису. Перевір доступ власника CRM.'
              : 'Запис у базу не підтверджено. Онови сторінку, перевір результат і лише тоді повтори дію.';
        return this.failure(reason + (detail ? ` Код: ${detail}.` : ''), `crm_commit${detail ? ':' + detail : ''}`);
      }
      const revision = result.data as number;
      if (!Number.isSafeInteger(revision)) return this.failure('Некоректне підтвердження запису. Онови сторінку.');
      this.revision = revision; this.current = structuredClone(next); return {ok:true};
    } catch { return this.failure('З’єднання перервано. Онови сторінку та перевір, чи запис уже збережений.'); }
  }
  async transaction<T extends {ok:boolean}>(work:()=>Promise<T>):Promise<T | WriteOutcome> {
    const previous = structuredClone(this.current);
    this.batching = true;
    try {
      const result = await work();
      if (!result.ok) { this.current = previous; return result; }
      this.batching = false;
      const saved = await this.saveSnapshot(this.current);
      if (!saved.ok) { this.current = previous; return saved; }
      return result;
    } catch (error) { this.current = previous; throw error; }
    finally { this.batching = false; }
  }
  private async update(next:DataSnapshot):Promise<WriteOutcome> {
    if (this.blocked) return this.failure(this.blocked);
    if (this.batching) { this.current = structuredClone(next); return {ok:true}; }
    return this.saveSnapshot(next);
  }
  saveCollection(key:CollectionKey,value:unknown[]) { return this.update({...this.current,[key]:value} as DataSnapshot); }
  saveSettings(settings:FinanceSettings) { return this.update({...this.current,financeSettings:normalizeSettings(settings)}); }
  saveMeta(patch:Partial<BackupInfo>) { return this.update({...this.current,meta:{...this.current.meta,...patch}}); }
  writeBlockedReason() { return this.blocked; }
  listIssues() { return [...this.issues]; }
  clearIssues() { this.issues=[]; }
  clearCollectionIssue() {}
  collectionHealth() { return {}; }
  markCollectionHealth() {}
  async restoreRaw():Promise<WriteOutcome> { return this.failure('Пошкоджені сирі дані не можна записати в базу. Використай перевірений JSON.'); }
  async saveBackupCopy(serialized:string,key='crm_import_previous'):Promise<WriteOutcome> {
    try { localStorage.setItem(key,serialized); return {ok:true}; }
    catch { return this.failure('Не вдалося створити локальну резервну копію'); }
  }
  async loadBackupCopy(key='crm_import_previous') { return localStorage.getItem(key); }

  // ------------------------------------------------------------
  // Пакет 03: журнал історії (серверні RPC). Це КОНТРАКТ клієнта:
  // фактичну поведінку SQL перевіряє основний агент на контрольованій БД.
  // ------------------------------------------------------------

  currentRevision(): number | null {
    return this.revision;
  }

  private historyReadError(error: { message: string; code?: string }): Error {
    if (isMissingFunctionError(error)) {
      return new Error('Серверний журнал історії недоступний: у базі ще не застосовано міграцію supabase/003-history.sql.');
    }
    return new Error('Не вдалося прочитати журнал історії. Онови сторінку та перевір доступ власника.');
  }

  async historyList(query: HistoryQuery): Promise<HistoryListResult> {
    const result = await this.rpc('crm_history_list', {
      p_limit: Math.min(Math.max(1, Math.floor(query.limit ?? 20)), 200),
      p_offset: Math.max(0, Math.floor(query.offset ?? 0)),
      p_section: query.section ?? null,
      p_action: query.action ?? null,
      p_from: query.from ?? null,
      p_to: query.to ?? null,
    });
    if (result.error) throw this.historyReadError(result.error);
    const row = result.data as { events?: unknown[]; total?: number } | null;
    const events = (Array.isArray(row?.events) ? row.events : [])
      .map(normalizeHistoryEvent)
      .filter((e): e is HistoryEvent => !!e);
    const total = Number(row?.total);
    return { events, total: Number.isFinite(total) ? total : events.length };
  }

  async historyGet(id: string): Promise<HistoryEvent | null> {
    const result = await this.rpc('crm_history_get', { p_id: id });
    if (result.error) throw this.historyReadError(result.error);
    if (result.data === null || result.data === undefined) return null;
    return normalizeHistoryEvent(result.data);
  }

  /** Віддалений журнал пише сервер у межах commit — клієнтський append не потрібен. */
  async historyAppend(event: HistoryEvent): Promise<WriteOutcome> {
    void event;
    return { ok: true };
  }

  async historyUndo(request: HistoryUndoRequest & { patch: HistoryPatch }): Promise<HistoryUndoResult> {
    let result: { data: unknown; error: { message: string; code?: string } | null; status?: number };
    try {
      result = await this.rpc('crm_history_undo', {
        p_event_id: request.eventId,
        p_request: request.requestId,
        p_expected_revision: request.expectedRevision ?? null,
        p_source: request.source,
        p_patch: request.patch,
      });
    } catch {
      return {
        ok: false,
        reason: 'write_failed',
        message: 'З’єднання перервано. Перевір журнал: скасування могло вже виконатися — не повторюй сліпо.',
      };
    }
    if (result.error) return mapUndoError(result.error);
    const row = result.data as { eventId?: string; revision?: number } | null;
    const eventId = typeof row?.eventId === 'string' ? row.eventId : '';
    let event: HistoryEvent | null = null;
    if (eventId) {
      try {
        event = await this.historyGet(eventId);
      } catch {
        event = null;
      }
    }
    return { ok: true, event };
  }
}

function mapUndoError(error: { message: string; code?: string }): HistoryUndoResult {
  const message = error.message || '';
  if (isMissingFunctionError(error)) {
    return { ok: false, reason: 'denied', message: 'Серверний журнал недоступний: застосуй міграцію supabase/003-history.sql.' };
  }
  if (message.includes('CRM_CONFLICT')) {
    return { ok: false, reason: 'conflict', message: 'Дані змінилися після перегляду — перечитай журнал і повтори скасування.' };
  }
  if (message.includes('CRM_ALREADY_UNDONE')) {
    return { ok: false, reason: 'already_undone', message: 'Цю подію вже скасовано.' };
  }
  if (message.includes('CRM_UNDO_NOT_ALLOWED')) {
    return { ok: false, reason: 'not_undoable', message: 'Цю подію не можна скасувати звичайним способом.' };
  }
  if (message.includes('CRM_HISTORY_NOT_FOUND')) {
    return { ok: false, reason: 'not_found', message: 'Подію не знайдено в журналі.' };
  }
  if (message.includes('CRM_ACCESS_DENIED')) {
    return { ok: false, reason: 'denied', message: 'База відхилила доступ власника CRM.' };
  }
  if (message.includes('CRM_INVALID')) {
    return { ok: false, reason: 'write_failed', message: 'Сервер відхилив некоректний запит скасування.' };
  }
  return { ok: false, reason: 'write_failed', message: 'Скасування в базу не підтверджено. Онови сторінку та перевір журнал.' };
}
