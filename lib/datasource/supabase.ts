import type { BackupInfo, DataSnapshot, FinanceSettings } from '@/types';
import type { CollectionKey, CrmDataSource, DataSnapshotPayload, StorageIssue, WriteOutcome } from './types';
import { supabase } from '@/lib/supabase/client';
import { normalizeSettings } from '@/lib/settings';

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export class SupabaseDataSource implements CrmDataSource {
  readonly kind = 'remote' as const;
  private revision = 0;
  private current!: DataSnapshot;
  private blocked: string | null = null;
  private issues: StorageIssue[] = [];
  private batching = false;
  constructor(private rpc: Rpc = async (name,args) => { const result = await supabase().rpc(name,args); return {data:result.data,error:result.error}; }) {}
  private failure(message: string): WriteOutcome {
    this.blocked = message;
    const issue: StorageIssue = {id:crypto.randomUUID(),kind:'write_failed',message,at:new Date().toISOString()};
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
      const result = await this.rpc('crm_commit',{p_revision:this.revision,p_request:crypto.randomUUID(),p_snapshot:next});
      if (result.error) return this.failure(result.error.message.includes('CRM_CONFLICT')
        ? 'Дані змінилися на іншому пристрої. Онови сторінку й повтори дію.'
        : 'Запис у базу не підтверджено. Онови сторінку, перевір результат і лише тоді повтори дію.');
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
}
