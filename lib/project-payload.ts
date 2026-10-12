import type { Client, Project } from '@/types';

// ============================================================
// Пакет 02: одне явне формулювання того, що форма проєкту відправляє
// при збереженні. Чиста функція без React і без доступу до сховища —
// її викликає ProjectForm.handleSave, і ті самі значення перевіряють тести.
//
// Правило зв'язку з клієнтом:
//  - `selectedClientId` — єдине джерело ID (prefill лише ініціалізує стан);
//  - якщо картка з таким ID ще існує — її ім'я та контакти є джерелом
//    істини (зокрема й порожні telegram/source: порожнє актуальне значення
//    — теж значення, `||` НЕ підставляє історичні контакти стану форми);
//  - якщо картки в колекції вже немає — ID НЕ ховається fallback на ім'я:
//    неіснуючий ID має відхилити спільна доменна дія.
// ============================================================

export interface ProjectFormValues {
  name: string;
  type: string;
  status: string;
  startDate: string;
  deadlineDays: string;
  endDate: string;
  developerId: string;
  partnerId: string;
  clientName: string;
  clientTelegram: string;
  clientSource: string;
  budget: string;
  currency: string;
  bank: string;
  prepayment: string;
  paidToSpecialist: string;
  myPercent: string;
  profitTaken: string;
  fop: string;
  partnerCommission: string;
  description: string;
  /** Поточний вибір користувача в формі; саме він визначає clientId. */
  selectedClientId: string;
}

export function buildProjectPayload(values: ProjectFormValues, clients: Client[]): Partial<Project> {
  const selected = values.selectedClientId
    ? clients.find(c => c.id === values.selectedClientId)
    : undefined;

  return {
    name: values.name,
    type: values.type,
    status: values.status,
    startDate: values.startDate,
    deadlineDays: Number(values.deadlineDays) || 0,
    endDate: values.endDate,
    developerId: values.developerId,
    partnerId: values.partnerId,
    clientId: values.selectedClientId,
    clientName: selected ? selected.name : values.clientName,
    clientTelegram: selected ? (selected.telegram || '') : values.clientTelegram,
    clientSource: selected ? (selected.source || 'Інше') : values.clientSource,
    budget: Number(values.budget) || 0,
    currency: values.currency,
    bank: values.bank,
    prepayment: Number(values.prepayment) || 0,
    paidToSpecialist: Number(values.paidToSpecialist) || 0,
    myPercent: Number(values.myPercent) || 0,
    profitTaken: Number(values.profitTaken) || 0,
    fop: Number(values.fop) || 0,
    partnerCommission: Number(values.partnerCommission) || 0,
    description: values.description,
  };
}
