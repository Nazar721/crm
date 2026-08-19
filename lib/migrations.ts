import { normalizeBank } from '@/lib/banks';
import { generateId } from '@/lib/utils';
import { getProjects, saveProjects, getCompleted, saveCompleted, getClients, saveClients, getPartners, savePartners, getSpecialists, saveSpecialists, getTransactions, saveTransactions, getSavings, saveSavings } from '@/lib/storage';

function stripProject(p: Record<string, unknown>): Record<string, unknown> {
  const raw = { ...p };
  delete raw.myIncome;
  delete raw.projectProfit;
  delete raw.clientDebt;
  delete raw.specialistDebt;
  delete raw.remainingPayment;
  if (raw.prepayment == null) raw.prepayment = 0;
  if (raw.paidToSpecialist == null) raw.paidToSpecialist = 0;
  if (raw.myPercent == null) raw.myPercent = 0;
  if (raw.profitTaken == null) raw.profitTaken = 0;
  if (raw.partnerCommission == null) raw.partnerCommission = 0;
  if (!raw.partnerId) raw.partnerId = '';
  return raw;
}

export function migrate(): void {
  if (typeof window === 'undefined') return;

  // v12 migration
  if (!localStorage.getItem('crm_migrated_v12')) {
    const migratePercent = (p: any) => {
      const raw = stripProject(p);
      const budget = Number(raw.budget) || 0;
      if (budget > 0) {
        const storedCost = Number(raw.specialistCost) || 0;
        raw.myPercent = Math.round((budget - storedCost) / budget * 100);
      }
      return raw;
    };
    saveProjects(getProjects().map(migratePercent) as any);
    saveCompleted(getCompleted().map(migratePercent) as any);
    localStorage.setItem('crm_migrated_v12', '1');
  } else {
    saveProjects(getProjects().map(stripProject as any));
    saveCompleted(getCompleted().map(stripProject as any));
  }

  // Partners migration
  const partners = getPartners();
  partners.forEach(p => {
    if (p.givenProjectsCount == null) p.givenProjectsCount = 0;
    if (p.givenProjectsPrice == null) p.givenProjectsPrice = 0;
    if (p.ourCommission == null) p.ourCommission = 0;
    if (p.paidToUs == null) p.paidToUs = 0;
  });
  savePartners(partners);

  if (!partners.length && !localStorage.getItem('crm_migrated_v11')) {
    // ensure key exists
  }

  // v11 migration
  const specialists = getSpecialists();
  specialists.forEach(s => {
    if ((s as any).paidToSpecialist != null) delete (s as any).paidToSpecialist;
    if ((s as any).debt != null) delete (s as any).debt;
  });
  saveSpecialists(specialists);
  localStorage.setItem('crm_migrated_v11', '1');

  // v13 migration - type normalization
  if (!localStorage.getItem('crm_migrated_v13')) {
    const typeMap: Record<string, string> = {
      'Landing Page': 'IT',
      'Корпоративний сайт': 'IT',
      'Інтернет-магазин': 'IT',
      'Дизайн': 'Design',
      'Інше': 'IT',
    };
    const migrateType = (p: any) => {
      const raw = { ...p };
      if (raw.type && typeMap[raw.type as string]) raw.type = typeMap[raw.type as string];
      return raw;
    };
    saveProjects(getProjects().map(migrateType) as any);
    saveCompleted(getCompleted().map(migrateType) as any);
    localStorage.setItem('crm_migrated_v13', '1');
  }

  // v14 migration - bank normalization
  if (!localStorage.getItem('crm_migrated_v14')) {
    const normalizeBankField = (bank: string) => normalizeBank(bank) || bank;
    saveTransactions(getTransactions().map(t => ({
      ...t,
      bank: normalizeBankField(t.bank),
    })));
    saveSavings(getSavings().map(s => ({
      ...s,
      bank: normalizeBankField(s.bank),
    })));
    localStorage.setItem('crm_migrated_v14', '1');
  }

  // v15 migration - income status
  if (!localStorage.getItem('crm_migrated_v15')) {
    const cutoff = new Date('2026-07-01');
    saveTransactions(getTransactions().map(t => {
      if (t.type === 'income' && !t.incomeStatus) {
        const d = new Date(t.date || t.plannedDate || '');
        if (d < cutoff) return { ...t, incomeStatus: 'earned' };
      }
      return t;
    }));
    localStorage.setItem('crm_migrated_v15', '1');
  }

  // v16 migration - partner commission percentage
  if (!localStorage.getItem('crm_migrated_v16')) {
    const migrateCommission = (p: any) => {
      if ((p.partnerCommission as number) > 0 && (p.partnerCommission as number) <= 100) return p;
      if (p.partnerCommission && p.budget) {
        const oldVal = Number(p.partnerCommission) || 0;
        if (oldVal > 0 && oldVal <= (p.budget as number)) {
          return { ...p, partnerCommission: Math.round(oldVal / (p.budget as number) * 100) };
        }
      }
      return p;
    };
    saveProjects(getProjects().map(migrateCommission) as any);
    saveCompleted(getCompleted().map(migrateCommission) as any);
    localStorage.setItem('crm_migrated_v16', '1');
  }

  // v17 migration - backfill clients from projects
  if (!localStorage.getItem('crm_migrated_v17')) {
    const clients = getClients();
    let changed = false;

    const linkProject = (p: any) => {
      if (p.clientId || !p.clientName) return p;
      const nameLower = String(p.clientName).toLowerCase().trim();
      const existing = clients.find(c => c.name.toLowerCase().trim() === nameLower);
      if (existing) {
        p.clientId = existing.id;
      } else {
        const newClient = { id: generateId(), name: p.clientName, telegram: p.clientTelegram || '', source: p.clientSource || 'Інше' };
        clients.push(newClient);
        p.clientId = newClient.id;
        changed = true;
      }
      return p;
    };

    saveProjects(getProjects().map(linkProject));
    saveCompleted(getCompleted().map(linkProject));
    if (changed) saveClients(clients);
    localStorage.setItem('crm_migrated_v17', '1');
  }

  // v18 migration - workStartDate/workedDays: відлік дедлайну лише в статусі «В роботі»
  if (!localStorage.getItem('crm_migrated_v18')) {
    const migrateWorkStart = (p: any) => {
      const raw = { ...p };
      if (raw.workedDays == null) raw.workedDays = 0;
      if (raw.status === 'В роботі') {
        if (!raw.workStartDate) {
          raw.workStartDate = raw.startDate || (raw.createdAt ? String(raw.createdAt).split('T')[0] : '');
        }
      } else {
        delete raw.workStartDate;
      }
      return raw;
    };
    saveProjects(getProjects().map(migrateWorkStart) as any);
    saveCompleted(getCompleted().map(migrateWorkStart) as any);
    localStorage.setItem('crm_migrated_v18', '1');
  }

  // v19 migration - прибрано модуль лідогенерації
  if (!localStorage.getItem('crm_migrated_v19')) {
    localStorage.removeItem('leadgen_leads');
    localStorage.removeItem('leadgen_filters');
    localStorage.setItem('crm_migrated_v19', '1');
  }
}
