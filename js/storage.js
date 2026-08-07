/* =============================================
   storage.js — LocalStorage (raw data only)
   ============================================= */

const Storage = {
  KEYS: {
    projectsActive: 'projects_active',
    projectsCompleted: 'projects_completed',
    clients: 'clients',
    specialists: 'specialists',
    partners: 'partners',
    transactions: 'transactions',
    personalDebts: 'personal_debts',
    savings: 'savings',
    leads: 'leadgen_leads',
    leadFilters: 'leadgen_filters',
  },

  META_KEYS: {
    lastSavedAt: 'crm_last_saved_at',
    lastManualBackupAt: 'crm_last_manual_backup_at',
    backupSnoozedUntil: 'crm_backup_snoozed_until',
    financeSettings: 'crm_finance_settings',
  },

  BACKUP_KEYS: ['crm_backup_1', 'crm_backup_2', 'crm_backup_3', 'crm_backup_4', 'crm_backup_5'],

  _suppressBackups: false,

  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }
  },

  set(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
    this.afterSave();
  },

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  },

  normalizeBank(value) {
    const v = String(value || '').toLowerCase().trim();
    if (!v) return '';
    if (v === 'mono' || v.includes('monobank') || v.includes('моно')) return 'mono';
    if (v === 'privat' || v.includes('privatbank') || v.includes('приват')) return 'privat';
    if (v === 'cash_usd' || v.includes('готівка $') || v.includes('cash usd') || v.includes('usd')) return 'cash_usd';
    if (v === 'cash_eur' || v.includes('готівка €') || v.includes('cash eur') || v.includes('eur')) return 'cash_eur';
    if (v === 'cash' || v.includes('готів') || v.includes('gotiv')) return 'cash';
    return '';
  },

  getProjects() { return this.get(this.KEYS.projectsActive); },
  getCompleted() { return this.get(this.KEYS.projectsCompleted); },
  getClients() { return this.get(this.KEYS.clients); },
  getSpecialists() { return this.get(this.KEYS.specialists); },
  getPartners() { return this.get(this.KEYS.partners); },
  getTransactions() { return this.get(this.KEYS.transactions); },
  getPersonalDebts() { return this.get(this.KEYS.personalDebts); },
  getSavings() { return this.get(this.KEYS.savings); },
  getLeads() { return this.get(this.KEYS.leads); },
  getLeadFilters() {
    return {
      onlyNoWebsite: false,
      hideNotInteresting: true,
      showHidden: false,
      ...(this.get(this.KEYS.leadFilters) || {}),
    };
  },

  saveProjects(d) { this.set(this.KEYS.projectsActive, d); },
  saveCompleted(d) { this.set(this.KEYS.projectsCompleted, d); },
  saveClients(d) { this.set(this.KEYS.clients, d); },
  saveSpecialists(d) { this.set(this.KEYS.specialists, d); },
  savePartners(d) { this.set(this.KEYS.partners, d); },
  saveTransactions(d) { this.set(this.KEYS.transactions, d); },
  savePersonalDebts(d) { this.set(this.KEYS.personalDebts, d); },
  saveSavings(d) { this.set(this.KEYS.savings, d); },
  saveLeads(d) { this.set(this.KEYS.leads, d); },
  saveLeadFilters(d) { this.set(this.KEYS.leadFilters, d); },

  getFinanceSettings() {
    try {
      return {
        usdRate: 41,
        eurRate: 44,
        ...(JSON.parse(localStorage.getItem(this.META_KEYS.financeSettings)) || {}),
      };
    } catch {
      return { usdRate: 41, eurRate: 44 };
    }
  },

  saveFinanceSettings(settings) {
    localStorage.setItem(this.META_KEYS.financeSettings, JSON.stringify({
      usdRate: Number(settings.usdRate) || 41,
      eurRate: Number(settings.eurRate) || 44,
    }));
    this.afterSave();
  },

  getAllProjects() {
    return [...this.getProjects(), ...this.getCompleted()];
  },

  afterSave() {
    if (this._suppressBackups) return;
    const now = new Date().toISOString();
    localStorage.setItem(this.META_KEYS.lastSavedAt, now);
    this.rotateInternalBackups(now);
  },

  rotateInternalBackups(now = new Date().toISOString()) {
    for (let i = this.BACKUP_KEYS.length - 1; i > 0; i--) {
      const prev = localStorage.getItem(this.BACKUP_KEYS[i - 1]);
      if (prev) localStorage.setItem(this.BACKUP_KEYS[i], prev);
      else localStorage.removeItem(this.BACKUP_KEYS[i]);
    }
    localStorage.setItem(this.BACKUP_KEYS[0], JSON.stringify({
      createdAt: now,
      payload: this.exportData(false),
    }));
  },

  exportData(includeMeta = true) {
    const data = {};
    Object.entries(this.KEYS).forEach(([name, key]) => {
      data[name] = this.get(key);
    });
    const payload = {
      app: 'WebAgency CRM',
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
      financeSettings: this.getFinanceSettings(),
    };
    if (includeMeta) payload.meta = this.getBackupInfo();
    return payload;
  },

  importData(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Некоректний файл');
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const nextData = {};

    Object.entries(this.KEYS).forEach(([name, key]) => {
      const value = data[name];
      if (value != null && !Array.isArray(value)) throw new Error('Некоректний формат даних');
      nextData[key] = Array.isArray(value) ? value : [];
    });

    this._suppressBackups = true;
    Object.entries(nextData).forEach(([key, value]) => this.set(key, value));
    if (payload.financeSettings) this.saveFinanceSettings(payload.financeSettings);
    ['crm_migrated_v11', 'crm_migrated_v12', 'crm_migrated_v13', 'crm_migrated_v14', 'crm_migrated_v15'].forEach(key => localStorage.removeItem(key));
    this.migrate();
    this._suppressBackups = false;
    this.afterSave();
  },

  markManualBackup() {
    const now = new Date().toISOString();
    localStorage.setItem(this.META_KEYS.lastManualBackupAt, now);
    localStorage.removeItem(this.META_KEYS.backupSnoozedUntil);
    return now;
  },

  snoozeBackupReminder(days = 3) {
    const until = new Date(Date.now() + days * 86400000).toISOString();
    localStorage.setItem(this.META_KEYS.backupSnoozedUntil, until);
  },

  getBackupInfo() {
    return {
      lastSavedAt: localStorage.getItem(this.META_KEYS.lastSavedAt) || '',
      lastManualBackupAt: localStorage.getItem(this.META_KEYS.lastManualBackupAt) || '',
      backupSnoozedUntil: localStorage.getItem(this.META_KEYS.backupSnoozedUntil) || '',
    };
  },

  shouldShowBackupReminder(maxAgeDays = 7) {
    const info = this.getBackupInfo();
    if (info.backupSnoozedUntil && new Date(info.backupSnoozedUntil) > new Date()) return false;
    if (!info.lastManualBackupAt) return true;
    return Date.now() - new Date(info.lastManualBackupAt).getTime() > maxAgeDays * 86400000;
  },

  /** Strip computed fields & migrate legacy v1.0 data */
  migrate() {
    const stripProject = (p) => {
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
    };

    if (!localStorage.getItem('crm_migrated_v12')) {
      const migratePercent = (p) => {
        const raw = stripProject(p);
        const budget = Number(raw.budget) || 0;
        if (budget > 0) {
          const storedCost = Number(raw.specialistCost) || 0;
          raw.myPercent = Math.round((budget - storedCost) / budget * 100);
        }
        return raw;
      };
      this.saveProjects(this.getProjects().map(migratePercent));
      this.saveCompleted(this.getCompleted().map(migratePercent));
      localStorage.setItem('crm_migrated_v12', '1');
    } else {
      this.saveProjects(this.getProjects().map(stripProject));
      this.saveCompleted(this.getCompleted().map(stripProject));
    }

    const partners = this.getPartners();
    partners.forEach(p => {
      if (p.givenProjectsCount == null) p.givenProjectsCount = 0;
      if (p.givenProjectsPrice == null) p.givenProjectsPrice = 0;
      if (p.ourCommission == null) p.ourCommission = 0;
      if (p.paidToUs == null) p.paidToUs = 0;
    });
    this.savePartners(partners);

    if (!partners.length && !localStorage.getItem('crm_migrated_v11')) {
      this.getPartners(); // ensure key exists
    }

    const specialists = this.getSpecialists();
    specialists.forEach(s => {
      if (s.paidToSpecialist != null) delete s.paidToSpecialist;
      if (s.debt != null) delete s.debt;
    });
    this.saveSpecialists(specialists);

    localStorage.setItem('crm_migrated_v11', '1');

    if (!localStorage.getItem('crm_migrated_v13')) {
      const typeMap = {
        'Landing Page': 'IT',
        'Корпоративний сайт': 'IT',
        'Інтернет-магазин': 'IT',
        'Дизайн': 'Design',
        'Інше': 'IT',
      };
      const migrateType = (p) => {
        const raw = { ...p };
        if (raw.type && typeMap[raw.type]) raw.type = typeMap[raw.type];
        return raw;
      };
      this.saveProjects(this.getProjects().map(migrateType));
      this.saveCompleted(this.getCompleted().map(migrateType));
      localStorage.setItem('crm_migrated_v13', '1');
    }

    if (!localStorage.getItem('crm_migrated_v14')) {
      const normalizeBankField = (bank) => Storage.normalizeBank(bank) || bank;
      this.saveTransactions(this.getTransactions().map(t => ({
        ...t,
        bank: normalizeBankField(t.bank),
      })));
      this.saveSavings(this.getSavings().map(s => ({
        ...s,
        bank: normalizeBankField(s.bank),
      })));
      localStorage.setItem('crm_migrated_v14', '1');
    }

    if (!localStorage.getItem('crm_migrated_v15')) {
      const cutoff = new Date('2026-07-01');
      this.saveTransactions(this.getTransactions().map(t => {
        if (t.type === 'income' && !t.incomeStatus) {
          const d = new Date(t.date || t.plannedDate || '');
          if (d < cutoff) return { ...t, incomeStatus: 'earned' };
        }
        return t;
      }));
      localStorage.setItem('crm_migrated_v15', '1');
    }

    if (!localStorage.getItem('crm_migrated_v16')) {
      this.saveProjects(this.getProjects().map(p => {
        if (p.partnerCommission > 0 && p.partnerCommission <= 100) return p;
        if (p.partnerCommission && p.budget) {
          const oldVal = Number(p.partnerCommission) || 0;
          if (oldVal > 0 && oldVal <= p.budget) {
            return { ...p, partnerCommission: Math.round(oldVal / p.budget * 100) };
          }
        }
        return p;
      }));
      this.saveCompleted(this.getCompleted().map(p => {
        if (p.partnerCommission > 0 && p.partnerCommission <= 100) return p;
        if (p.partnerCommission && p.budget) {
          const oldVal = Number(p.partnerCommission) || 0;
          if (oldVal > 0 && oldVal <= p.budget) {
            return { ...p, partnerCommission: Math.round(oldVal / p.budget * 100) };
          }
        }
        return p;
      }));
      localStorage.setItem('crm_migrated_v16', '1');
    }
  },
};

/* =============================================
   Calc — dynamic analytics (never stored)
   ============================================= */
const Calc = {
  project(p) {
    const budget = Number(p.budget) || 0;
    const prepayment = Number(p.prepayment) || 0;
    const paidToSpecialist = Number(p.paidToSpecialist) || 0;
    const myPercent = Number(p.myPercent ?? 0);
    const profitTaken = Number(p.profitTaken) || 0;
    const fopPercent = Number(p.fop) || 0;
    const partnerCommissionPercent = Number(p.partnerCommission) || 0;

    const fopAmount = Math.round(budget * fopPercent / 100);
    const partnerCommission = Math.round(budget * partnerCommissionPercent / 100);
    const totalDeductions = fopAmount + partnerCommission;
    const budgetAfterDeductions = budget - totalDeductions;

    const paidAmount = Math.min(budget, Math.max(prepayment, 0));
    const projectProfit = Math.round(budgetAfterDeductions * myPercent / 100);
    const myIncome = projectProfit;
    const receivedProfit = Math.round(paidAmount * myPercent / 100);
    const specialistCost = budgetAfterDeductions - projectProfit;
    const clientDebt = budget - prepayment;
    const specialistDebt = specialistCost - paidToSpecialist;
    const remainingPayment = budget - prepayment;
    const profitLeft = myIncome - profitTaken;

    return {
      budget, specialistCost, prepayment, paidToSpecialist, myPercent, profitTaken,
      fopPercent, fopAmount, partnerCommissionPercent, partnerCommission, budgetAfterDeductions,
      projectProfit, myIncome, clientDebt, specialistDebt, remainingPayment, profitLeft,
      paidAmount, receivedProfit,
    };
  },

  projectStartDate(p) {
    return p.startDate || p.createdAt?.split('T')[0] || '';
  },

  projectEndDate(p) {
    return p.endDate || p.finishDate || '';
  },

  projectPaymentDate(p) {
    if (p.paymentDate) return p.paymentDate;
    const prepayment = Number(p.prepayment) || 0;
    if (prepayment > 0) {
      return this.projectStartDate(p) || this.projectEndDate(p) || p.createdAt?.split('T')[0] || '';
    }
    return this.projectEndDate(p) || this.projectStartDate(p) || p.createdAt?.split('T')[0] || '';
  },

  clientStats(clientId) {
    const all = Storage.getAllProjects().filter(p => p.clientId === clientId);
    let totalBudget = 0, totalProfit = 0, totalPrepayment = 0, totalClientDebt = 0;
    all.forEach(p => {
      const c = this.project(p);
      totalBudget += c.budget;
      totalProfit += c.projectProfit;
      totalPrepayment += c.prepayment;
      totalClientDebt += c.clientDebt;
    });
    return {
      count: all.length,
      totalBudget,
      totalProfit,
      totalPrepayment,
      clientDebt: totalClientDebt,
    };
  },

  specialistStats(specialistId) {
    const active = Storage.getProjects().filter(p => p.developerId === specialistId);
    const completed = Storage.getCompleted().filter(p => p.developerId === specialistId);
    const all = [...active, ...completed];
    let totalCost = 0, totalPaid = 0;
    all.forEach(p => {
      const c = this.project(p);
      totalCost += c.specialistCost;
      totalPaid += c.paidToSpecialist;
    });
    return {
      activeCount: active.length,
      count: completed.length,
      totalCost,
      totalPaid,
      debt: all.reduce((sum, p) => sum + this.project(p).specialistDebt, 0),
    };
  },

  partnerStats(partnerId) {
    const all = Storage.getAllProjects().filter(p => p.partnerId === partnerId);
    const clientIds = new Set(all.map(p => p.clientId).filter(Boolean));
    let totalDeals = 0, totalCommission = 0, ourIncome = 0;
    all.forEach(p => {
      const c = this.project(p);
      totalDeals += c.budget;
      totalCommission += c.partnerCommission;
      ourIncome += c.myIncome;
    });
    const partner = Storage.getPartners().find(x => x.id === partnerId);
    const paidToPartner = Number(partner?.paidToPartner) || 0;
    const givenProjectsCount = Number(partner?.givenProjectsCount) || 0;
    const givenProjectsPrice = Number(partner?.givenProjectsPrice) || 0;
    const ourCommission = Number(partner?.ourCommission) || 0;
    const paidToUs = Number(partner?.paidToUs) || 0;
    return {
      clientsCount: clientIds.size,
      totalDeals,
      totalCommission,
      paidToPartner,
      partnerDebt: totalCommission - paidToPartner,
      ourIncome,
      givenProjectsCount,
      givenProjectsPrice,
      ourCommission,
      paidToUs,
      theirDebt: ourCommission - paidToUs,
    };
  },

  bankCurrency(bankId) {
    const bank = Storage.normalizeBank(bankId);
    if (bank === 'cash_usd') return 'USD';
    if (bank === 'cash_eur') return 'EUR';
    return 'UAH';
  },

  rateForCurrency(currency) {
    const settings = Storage.getFinanceSettings();
    if (currency === 'USD') return Number(settings.usdRate) || 41;
    if (currency === 'EUR') return Number(settings.eurRate) || 44;
    return 1;
  },

  bankAmountToUah(amount, bankId) {
    return (Number(amount) || 0) * this.rateForCurrency(this.bankCurrency(bankId));
  },

  financeBalance(transactions) {
    const balances = this.bankBalances(transactions);
    return Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  },

  bankBalances(transactions = Storage.getTransactions()) {
    const balances = { mono: 0, privat: 0, cash: 0, cash_usd: 0, cash_eur: 0 };
    transactions.forEach(t => {
      if (t.hidden) return;
      const bank = Storage.normalizeBank(t.bank);
      if (!bank) return;
      const amount = this.bankAmountToUah(t.amount, bank);
      if (t.type === 'income') balances[bank] += amount;
      else if (t.type === 'expense') balances[bank] -= amount;
      else if (t.type === 'transfer') {
        const toBank = Storage.normalizeBank(t.toBank);
        if (!toBank) return;
        balances[bank] -= amount;
        balances[toBank] = (balances[toBank] || 0) + this.bankAmountToUah(t.targetAmount ?? t.amount, toBank);
      }
    });
    return balances;
  },

  personalDebtSummary(debts = Storage.getPersonalDebts()) {
    let owedToMe = 0, myDebts = 0;
    debts.forEach(d => {
      const amount = Number(d.amount) || 0;
      if (d.type === 'owed_to_me') owedToMe += amount;
      else if (d.type === 'my_debt') myDebts += amount;
    });
    return { owedToMe, myDebts };
  },

  savingsProgress(amount, goal) {
    const g = Number(goal) || 0;
    if (!g) return 0;
    return Math.min(100, Math.round((Number(amount) || 0) / g * 100));
  },

  savingsSummary(items = Storage.getSavings()) {
    let totalSaved = 0, totalGoal = 0;
    items.forEach(s => {
      totalSaved += Number(s.amount) || 0;
      totalGoal += Number(s.goal) || 0;
    });
    return {
      totalSaved,
      totalGoal,
      progress: totalGoal > 0 ? Math.min(100, Math.round(totalSaved / totalGoal * 100)) : 0,
      count: items.length,
    };
  },

  dashboardStats() {
    const active = Storage.getProjects();
    const completed = Storage.getCompleted();
    const all = [...active, ...completed];
    const clients = Storage.getClients();
    const specialists = Storage.getSpecialists();
    const partners = Storage.getPartners();
    const transactions = Storage.getTransactions();

    let totalBudget = 0, totalProfit = 0;
    let clientDebts = 0, specialistDebts = 0, partnerDebts = 0;

    completed.forEach(p => {
      const c = Calc.project(p);
      totalBudget += c.budget;
      totalProfit += Number(c.myIncome);
    });

    all.forEach(p => {
      const c = Calc.project(p);
      clientDebts += c.clientDebt;
      specialistDebts += c.specialistDebt;
    });

    partners.forEach(pt => {
      partnerDebts += Calc.partnerStats(pt.id).partnerDebt;
    });

    const personalDebts = Calc.personalDebtSummary();
    const avgCheck = completed.length ? totalBudget / completed.length : 0;

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthIncome = transactions
      .filter(t => {
        const key = Utils.getMonthKey(t.date || t.plannedDate);
        if (key !== monthKey) return false;
        const isProjectSource = t.source && String(t.source).startsWith('project_');
        if (t.type === 'income' && !isProjectSource && t.incomeStatus === 'incoming') return false;
        return t.type === 'income' && !isProjectSource;
      })
      .reduce((sum, t) => sum + Calc.bankAmountToUah(t.amount, t.bank), 0);

    const savings = Calc.savingsSummary();

    return {
      totalBudget,
      netProfit: totalProfit,
      savingsTotal: savings.totalSaved,
      activeCount: active.length,
      completedCount: completed.length,
      avgCheck,
      clientsCount: clients.length,
      specialistsCount: specialists.length,
      partnersCount: partners.length,
      clientDebts,
      specialistDebts,
      partnerDebts,
      monthIncome,
      balance: Calc.financeBalance(transactions),
      owedToMe: personalDebts.owedToMe,
      myDebts: personalDebts.myDebts,
    };
  },
};

Storage.migrate();
