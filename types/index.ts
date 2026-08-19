// Project types
export interface Project {
  id: string;
  createdAt?: string;
  name: string;
  type: 'IT' | 'Design' | 'Video' | string;
  status: 'Очікування оплати' | 'В роботі' | 'На паузі' | string;
  startDate: string;
  workStartDate?: string;
  workedDays?: number;
  deadlineDays?: number;
  endDate?: string;
  finishDate?: string;
  clientId: string;
  clientName: string;
  clientTelegram?: string;
  clientSource?: string;
  budget: number;
  bank?: string;
  prepayment: number;
  specialistCost?: number;
  paidToSpecialist: number;
  myPercent: number;
  profitTaken: number;
  developerId?: string;
  partnerId?: string;
  fop: number;
  partnerCommission: number;
  description?: string;
  days?: number;
  completedAt?: number;
  paymentDate?: string;
}

// Client type
export interface Client {
  id: string;
  name: string;
  telegram?: string;
  source?: string;
  isRegular?: boolean;
}

// Specialist type
export interface Specialist {
  id: string;
  name: string;
  specialization?: string;
  telegram?: string;
}

// Partner type
export interface Partner {
  id: string;
  name: string;
  services?: string;
  paidToPartner?: number;
  givenProjectsCount?: number;
  givenProjectsPrice?: number;
  ourCommission?: number;
  paidToUs?: number;
}

// Transaction type
export interface Transaction {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  bank: string;
  toBank?: string;
  targetAmount?: number;
  rate?: number;
  category?: string;
  description?: string;
  date?: string;
  plannedDate?: string;
  status?: string;
  hidden?: boolean;
  source?: string;
  projectId?: string;
  incomeStatus?: 'earned' | 'incoming';
}

// Personal Debt type
export interface PersonalDebt {
  id: string;
  type: 'owed_to_me' | 'my_debt';
  person: string;
  amount: number;
  note?: string;
  date?: string;
}

// Saving type
export interface Saving {
  id: string;
  name?: string;
  bank: string;
  amount: number;
  goal: number;
  date?: string;
}

// Finance settings
export interface FinanceSettings {
  usdRate: number;
  eurRate: number;
}

// Backup info
export interface BackupInfo {
  lastSavedAt: string;
  lastManualBackupAt: string;
  backupSnoozedUntil: string;
}

// Export data
export interface ExportPayload {
  app: string;
  version: number;
  exportedAt: string;
  data: {
    projectsActive: Project[];
    projectsCompleted: Project[];
    clients: Client[];
    specialists: Specialist[];
    partners: Partner[];
    transactions: Transaction[];
    personalDebts: PersonalDebt[];
    savings: Saving[];
  };
  financeSettings: FinanceSettings;
  meta?: BackupInfo;
}

// Calculated project stats
export interface ProjectCalc {
  budget: number;
  specialistCost: number;
  prepayment: number;
  paidToSpecialist: number;
  myPercent: number;
  profitTaken: number;
  fopPercent: number;
  fopAmount: number;
  partnerCommissionPercent: number;
  partnerCommission: number;
  budgetAfterDeductions: number;
  projectProfit: number;
  myIncome: number;
  clientDebt: number;
  specialistDebt: number;
  remainingPayment: number;
  profitLeft: number;
  paidAmount: number;
  receivedProfit: number;
}

// Client stats
export interface ClientStats {
  count: number;
  totalBudget: number;
  totalProfit: number;
  totalPrepayment: number;
  clientDebt: number;
}

// Specialist stats
export interface SpecialistStats {
  activeCount: number;
  count: number;
  totalCost: number;
  totalPaid: number;
  debt: number;
}

// Partner stats
export interface PartnerStats {
  clientsCount: number;
  totalDeals: number;
  totalCommission: number;
  paidToPartner: number;
  partnerDebt: number;
  ourIncome: number;
  givenProjectsCount: number;
  givenProjectsPrice: number;
  ourCommission: number;
  paidToUs: number;
  theirDebt: number;
}

// Dashboard stats
export interface DashboardStats {
  totalBudget: number;
  netProfit: number;
  savingsTotal: number;
  activeCount: number;
  completedCount: number;
  avgCheck: number;
  clientsCount: number;
  specialistsCount: number;
  partnersCount: number;
  clientDebts: number;
  specialistDebts: number;
  partnerDebts: number;
  monthIncome: number;
  balance: number;
  owedToMe: number;
  myDebts: number;
}

// Bank definition
export interface Bank {
  id: string;
  label: string;
  currency: string;
  badge: string;
  chartColor: string;
  borderColor: string;
}

// Toast type
export type ToastType = 'success' | 'error' | 'info';

// Toast item
export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}
