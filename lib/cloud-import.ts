import type { ExportData } from '@/types';
import { validateBackup, type BackupValidation } from '@/lib/validate-backup';
/** Existing historical records stay byte-for-byte equivalent as JSON objects.
 * Only the validation copy gets an explicit placeholder for a missing legacy bank.
 * New domain actions still require a real bank. Never assign historical money to one.
 */
export function validateCloudBackup(raw:unknown):BackupValidation {
  if (!raw || typeof raw !== 'object' || !('data' in raw) || !raw.data || typeof raw.data !== 'object') {
    const invalid = validateBackup(null, {strict:true});
    invalid.errors = [{message:'Для перенесення в базу потрібен JSON-експорт CRM з полем data.'}];
    return invalid;
  }
  const copy = structuredClone(raw) as {data?:ExportData};
  const historical = new Set<string>();
  if (Array.isArray(copy?.data?.transactions)) {
    copy.data.transactions.forEach(t=>{
      if (t && typeof t.id === 'string' && !String(t.bank || '').trim() && t.type !== 'transfer') {
        historical.add(t.id); t.bank='__legacy_unassigned__';
      }
    });
  }
  const result = validateBackup(copy,{strict:true});
  if (result.ok && result.content) {
    // Validate first, then retain the original IDs, values, optional fields and links.
    result.content = structuredClone((raw as {data:ExportData}).data);
    if (historical.size) result.warnings.push({collection:'transactions',message:`Історичних записів без рахунку: ${historical.size}. Збережено як у файлі, рахунок не призначався.`});
  }
  return result;
}
