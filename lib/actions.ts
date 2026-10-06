import {fingerprint,records,type Plan} from '@/lib/assistant/plan';
import type {
  Client, FinanceSettings, Partner, PersonalDebt, Project, Saving, Specialist, Transaction,
} from '@/types';
import type { FieldError } from '@/lib/validate';
import {
  validateAmount, validateBank, validateCurrency, validateDate,
  validateEnum, validatePercent, validateProjectBank, validateRate,
  validateRequiredText, validateTelegram, toFiniteNumber,
} from '@/lib/validate';
import { generateId, today, daysBetween } from '@/lib/utils';
import * as Storage from '@/lib/storage';
import * as store from '@/lib/store';
import { bankLabel, normalizeBank } from '@/lib/banks';
import { bankCurrencyLocal, projectStartDate, rateForCurrency } from '@/lib/calc';

// ============================================================
// Доменні дії. Відокремлені від React-сторінок, щоб форми та майбутній
// AI-помічник використовували ТІ САМІ перевірки й той самий запис.
// Кожна дія: валідація → запис → явний результат.
// ============================================================

export type ActionResult<T = void> =
  | { ok: true; value?: T }
  | { ok: false; errors: FieldError[] };

type Failure = { ok: false; errors: FieldError[] };

function fail(errors: FieldError[]): Failure {
  return { ok: false, errors };
}

function ok<T>(value?: T): ActionResult<T> {
  return { ok: true, value };
}

async function persist<T = void>(run: Promise<store.WriteOutcome>): Promise<ActionResult<T>> {
  const result = await run;
  if (result.ok) return { ok: true };
  return fail([{ field: 'storage', message: `Не вдалося зберегти: ${result.issue.message}` }]);
}

function positiveAmount(value: unknown, field: string, label: string): FieldError[] {
  const errors = validateAmount(value, { field, label, min: 0 });
  if (errors.length) return errors;
  const n = toFiniteNumber(value);
  if (n === null || n <= 0) return [{ field, message: `${label}: має бути більшою за 0` }];
  return [];
}

// ------------------------------------------------------------
// Клієнти
// ------------------------------------------------------------

export function validateClientInput(input: Partial<Client>): FieldError[] {
  return [
    ...validateRequiredText(input.name, 'name', 'Ім’я', 120),
    ...validateTelegram(input.telegram),
  ];
}

async function _createClient(input: Partial<Client>): Promise<ActionResult<Client>> {
  const errors = validateClientInput(input);
  if (errors.length) return fail(errors);
  const client: Client = {
    id: generateId(),
    name: String(input.name).trim(),
    telegram: (input.telegram || '').trim(),
    source: input.source || 'Інше',
    isRegular: !!input.isRegular,
    createdAt: new Date().toISOString(),
  };
  const result = await persist(Storage.saveClients([...Storage.getClients(), client]));
  return result.ok ? ok(client) : result;
}

async function _updateClient(id: string, input: Partial<Client>): Promise<ActionResult<Client>> {
  const errors = validateClientInput(input);
  if (errors.length) return fail(errors);
  const clients = Storage.getClients();
  const index = clients.findIndex(c => c.id === id);
  if (index < 0) return fail([{ field: 'id', message: 'Клієнта не знайдено' }]);
  const next = { ...clients[index], ...input, name: String(input.name).trim() };
  clients[index] = next;
  const result = await persist(Storage.saveClients(clients));
  return result.ok ? ok(next) : result;
}

async function _toggleClientRegular(id: string): Promise<ActionResult> {
  const clients = Storage.getClients();
  const index = clients.findIndex(c => c.id === id);
  if (index < 0) return fail([{ field: 'id', message: 'Клієнта не знайдено' }]);
  clients[index] = { ...clients[index], isRegular: !clients[index].isRegular };
  return persist(Storage.saveClients(clients));
}

async function _deleteClient(id: string): Promise<ActionResult> {
  return persist(Storage.saveClients(Storage.getClients().filter(c => c.id !== id)));
}

/** Знаходить або створює клієнта за назвою (використовується формою проєкту й AI). */
async function _resolveClient(input: { name: string; telegram?: string; source?: string }): Promise<ActionResult<{ clientId: string; created: boolean }>> {
  const name = (input.name || '').trim();
  if (!name) return fail([{ field: 'clientName', message: 'Ім’я клієнта: обов’язкове поле' }]);
  const clients = Storage.getClients();
  const lower = name.toLowerCase();
  const existing = clients.find(c => c.name.toLowerCase().trim() === lower);
  if (existing) {
    let changed = false;
    const next = { ...existing };
    if (input.telegram && input.telegram !== existing.telegram) { next.telegram = input.telegram; changed = true; }
    if (input.source && input.source !== existing.source) { next.source = input.source; changed = true; }
    if (changed) {
      const list = clients.map(c => (c.id === next.id ? next : c));
      const result = await persist(Storage.saveClients(list));
      if (!result.ok) return result;
    }
    return ok({ clientId: existing.id, created: false });
  }
  const created: Client = {
    id: generateId(),
    name,
    telegram: (input.telegram || '').trim(),
    source: input.source || 'Інше',
    createdAt: new Date().toISOString(),
  };
  const result = await persist(Storage.saveClients([...clients, created]));
  return result.ok ? ok({ clientId: created.id, created: true }) : result;
}

// ------------------------------------------------------------
// Проєкти
// ------------------------------------------------------------

/** Відлік дедлайну йде ТІЛЬКИ поки статус «В роботі». */
export function resolveDeadlineTracking(next: Partial<Project>, prev?: Project): Pick<Project, 'workStartDate' | 'workedDays'> {
  const wasWorking = prev?.status === 'В роботі';
  const isWorking = next.status === 'В роботі';
  const accumulated = Number(prev?.workedDays) || 0;

  if (isWorking) {
    if (wasWorking) return { workStartDate: prev?.workStartDate || today(), workedDays: accumulated };
    return { workStartDate: today(), workedDays: accumulated };
  }

  if (wasWorking) {
    const from = (prev?.workStartDate || '').split('T')[0] || projectStartDate(prev!);
    const segment = from ? Math.max(0, daysBetween(from, today())) : 0;
    return { workStartDate: undefined, workedDays: accumulated + segment };
  }

  return { workStartDate: undefined, workedDays: accumulated };
}

const PROJECT_TYPES = ['IT', 'Design', 'Video'] as const;
const PROJECT_STATUSES = ['Очікування оплати', 'В роботі', 'На паузі', 'Завершено'] as const;

export function validateProjectInput(input: Partial<Project>): FieldError[] {
  const errors: FieldError[] = [
    ...validateRequiredText(input.name, 'name', 'Назва проєкту', 200),
    ...validateEnum(input.type, PROJECT_TYPES, 'type', 'Тип'),
    ...validateEnum(input.status, PROJECT_STATUSES, 'status', 'Статус'),
    ...validateDate(input.startDate, { field: 'startDate', label: 'Дата старту', required: true }),
    ...validateAmount(input.budget, { field: 'budget', label: 'Бюджет', min: 0 }),
    ...validateAmount(input.prepayment, { field: 'prepayment', label: 'Передоплата', min: 0, required: false }),
    ...validateAmount(input.paidToSpecialist, { field: 'paidToSpecialist', label: 'Виплачено фахівцю', min: 0, required: false }),
    ...validateAmount(input.profitTaken, { field: 'profitTaken', label: 'Забрав собі', min: 0, required: false }),
    ...validatePercent(input.myPercent, 'myPercent', 'Мій %'),
    ...validatePercent(input.fop, 'fop', 'ФОП %'),
    ...validatePercent(input.partnerCommission, 'partnerCommission', 'Комісія партнеру %'),
    ...validateCurrency(input.currency ?? 'UAH', 'currency', 'Валюта'),
    ...validateProjectBank(input.bank, 'bank', 'Банк'),
    ...validateDate(input.endDate, { field: 'endDate', label: 'Дата завершення' }),
  ];
  if (input.deadlineDays !== undefined && input.deadlineDays !== null) {
    const n = toFiniteNumber(input.deadlineDays);
    if (n === null || n < 0) errors.push({ field: 'deadlineDays', message: 'Дедлайн: має бути числом днів ≥ 0' });
  }
  return errors;
}

async function _saveProject(input: Partial<Project>, editId?: string): Promise<ActionResult<Project>> {
  const errors = validateProjectInput(input);
  if (errors.length) return fail(errors);

  let clientId = editId ? (Storage.getProjects().find(p => p.id === editId)?.clientId || Storage.getCompleted().find(p => p.id === editId)?.clientId || '') : '';
  if (input.clientName) {
    const resolved = await _resolveClient({
      name: input.clientName,
      telegram: input.clientTelegram,
      source: input.clientSource,
    });
    if (!resolved.ok) return resolved;
    clientId = resolved.value!.clientId;
  }

  const payload: Partial<Project> = { ...input, clientId };

  if (editId) {
    const active = Storage.getProjects();
    const activeIndex = active.findIndex(p => p.id === editId);
    if (activeIndex >= 0) {
      const prev = active[activeIndex];
      active[activeIndex] = { ...prev, ...payload, ...resolveDeadlineTracking(payload, prev) };
      const result = await persist(Storage.saveProjects(active));
      return result.ok ? ok(active[activeIndex]) : result;
    }
    const completed = Storage.getCompleted();
    const completedIndex = completed.findIndex(p => p.id === editId);
    if (completedIndex < 0) return fail([{ field: 'id', message: 'Проєкт не знайдено' }]);
    completed[completedIndex] = { ...completed[completedIndex], ...payload };
    const result = await persist(Storage.saveCompleted(completed));
    return result.ok ? ok(completed[completedIndex]) : result;
  }

  const project: Project = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    ...payload,
    ...resolveDeadlineTracking(payload),
  } as Project;
  const result = await persist(Storage.saveProjects([...Storage.getProjects(), project]));
  return result.ok ? ok(project) : result;
}

async function _completeProject(id: string): Promise<ActionResult<Project>> {
  const active = Storage.getProjects();
  const index = active.findIndex(p => p.id === id);
  if (index < 0) return fail([{ field: 'id', message: 'Активний проєкт не знайдено' }]);
  const p = active[index];
  const finishDate = p.endDate || today();
  const start = projectStartDate(p);
  const days = daysBetween(start, finishDate);
  const frozen = resolveDeadlineTracking({ status: 'Завершено' }, p);
  const completed = Storage.getCompleted();
  const record: Project = { ...p, ...frozen, endDate: finishDate, finishDate, days, completedAt: Date.now() };
  completed.push(record);
  const resultCompleted = await persist(Storage.saveCompleted(completed));
  if (!resultCompleted.ok) return resultCompleted;
  const rest = active.filter(x => x.id !== id);
  const resultActive = await persist(Storage.saveProjects(rest));
  return resultActive.ok ? ok(record) : resultActive;
}

async function _deleteProject(id: string, fromCompleted: boolean): Promise<ActionResult> {
  return fromCompleted
    ? persist(Storage.saveCompleted(Storage.getCompleted().filter(p => p.id !== id)))
    : persist(Storage.saveProjects(Storage.getProjects().filter(p => p.id !== id)));
}

// ------------------------------------------------------------
// Транзакції
// ------------------------------------------------------------

export function validateTransactionInput(input: Partial<Transaction>): FieldError[] {
  const errors: FieldError[] = [
    ...validateEnum(input.type, ['income', 'expense'] as const, 'type', 'Тип'),
    ...positiveAmount(input.amount, 'amount', 'Сума'),
    ...validateBank(input.bank, 'bank', 'Банк', true),
    ...validateDate(input.date, { field: 'date', label: 'Дата' }),
  ];
  if (input.type === 'income' && input.incomeStatus && !['earned', 'incoming'].includes(input.incomeStatus)) {
    errors.push({ field: 'incomeStatus', message: 'Статус доходу: недопустиме значення' });
  }
  return errors;
}

async function _saveTransaction(input: Partial<Transaction>, editId?: string): Promise<ActionResult<Transaction>> {
  const errors = validateTransactionInput(input);
  if (errors.length) return fail(errors);
  const transactions = Storage.getTransactions();

  if (editId) {
    const index = transactions.findIndex(t => t.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Транзакцію не знайдено' }]);
    transactions[index] = { ...transactions[index], ...input };
    const result = await persist(Storage.saveTransactions(transactions));
    return result.ok ? ok(transactions[index]) : result;
  }

  const record: Transaction = {
    id: generateId(),
    status: 'done',
    ...input,
  } as Transaction;
  transactions.push(record);
  const result = await persist(Storage.saveTransactions(transactions));
  return result.ok ? ok(record) : result;
}

async function _deleteTransaction(id: string): Promise<ActionResult> {
  return persist(Storage.saveTransactions(Storage.getTransactions().filter(t => t.id !== id)));
}

// ------------------------------------------------------------
// Конвертація
// ------------------------------------------------------------

async function _convertCurrency(input: { fromBank: string; toBank: string; amount: number }): Promise<ActionResult<Transaction>> {
  const errors: FieldError[] = [];
  if (!input.fromBank) errors.push({ field: 'fromBank', message: 'Оберіть рахунок-джерело' });
  if (!input.toBank) errors.push({ field: 'toBank', message: 'Оберіть рахунок-отримувач' });
  if (input.fromBank && input.fromBank === input.toBank) errors.push({ field: 'toBank', message: 'Рахунки мають відрізнятися' });
  errors.push(...positiveAmount(input.amount, 'amount', 'Сума'));
  if (errors.length) return fail(errors);

  const fromCur = bankCurrencyLocal(input.fromBank);
  const toCur = bankCurrencyLocal(input.toBank);
  const uah = input.amount * rateForCurrency(fromCur);
  const target = uah / rateForCurrency(toCur);

  const record: Transaction = {
    id: generateId(),
    type: 'transfer',
    bank: normalizeBank(input.fromBank) || input.fromBank,
    toBank: normalizeBank(input.toBank) || input.toBank,
    amount: input.amount,
    targetAmount: target,
    category: 'Конвертація',
    description: `${bankLabel(input.fromBank)} → ${bankLabel(input.toBank)}`,
    date: today(),
    status: 'done',
  };
  const result = await persist(Storage.saveTransactions([...Storage.getTransactions(), record]));
  return result.ok ? ok(record) : result;
}

// ------------------------------------------------------------
// Фахівці / партнери
// ------------------------------------------------------------

async function _saveSpecialist(input: Partial<Specialist>, editId?: string): Promise<ActionResult<Specialist>> {
  const errors = [
    ...validateRequiredText(input.name, 'name', 'Ім’я', 120),
    ...validateRequiredText(input.specialization, 'specialization', 'Спеціалізація', 120),
    ...validateTelegram(input.telegram),
  ];
  if (errors.length) return fail(errors);
  const list = Storage.getSpecialists();
  if (editId) {
    const index = list.findIndex(s => s.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Фахівця не знайдено' }]);
    list[index] = { ...list[index], ...input };
    const result = await persist(Storage.saveSpecialists(list));
    return result.ok ? ok(list[index]) : result;
  }
  const record: Specialist = { id: generateId(), name: String(input.name).trim(), specialization: input.specialization || '', telegram: input.telegram || '' };
  list.push(record);
  const result = await persist(Storage.saveSpecialists(list));
  return result.ok ? ok(record) : result;
}

async function _deleteSpecialist(id: string): Promise<ActionResult> {
  return persist(Storage.saveSpecialists(Storage.getSpecialists().filter(s => s.id !== id)));
}

export function validatePartnerInput(input: Partial<Partner>): FieldError[] {
  return [
    ...validateRequiredText(input.name, 'name', 'Назва / ім’я', 120),
    ...validateCurrency(input.currency ?? 'UAH', 'currency', 'Валюта'),
    ...validateAmount(input.paidToPartner, { field: 'paidToPartner', label: 'Виплачено партнеру', min: 0, required: false }),
    ...validateAmount(input.givenProjectsPrice, { field: 'givenProjectsPrice', label: 'Ціна переданих проєктів', min: 0, required: false }),
    ...validateAmount(input.ourCommission, { field: 'ourCommission', label: 'Наша комісія', min: 0, required: false }),
    ...validateAmount(input.paidToUs, { field: 'paidToUs', label: 'Виплачено нам', min: 0, required: false }),
  ];
}

async function _savePartner(input: Partial<Partner>, editId?: string): Promise<ActionResult<Partner>> {
  const errors = validatePartnerInput(input);
  if (errors.length) return fail(errors);
  const list = Storage.getPartners();
  const normalized: Partial<Partner> = {
    ...input,
    givenProjectsCount: toFiniteNumber(input.givenProjectsCount) ?? 0,
    givenProjectsPrice: toFiniteNumber(input.givenProjectsPrice) ?? 0,
    ourCommission: toFiniteNumber(input.ourCommission) ?? 0,
    paidToPartner: toFiniteNumber(input.paidToPartner) ?? 0,
    paidToUs: toFiniteNumber(input.paidToUs) ?? 0,
  };
  if (editId) {
    const index = list.findIndex(p => p.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Партнера не знайдено' }]);
    list[index] = { ...list[index], ...normalized };
    const result = await persist(Storage.savePartners(list));
    return result.ok ? ok(list[index]) : result;
  }
  const record: Partner = { id: generateId(), name: String(input.name).trim(), ...normalized } as Partner;
  list.push(record);
  const result = await persist(Storage.savePartners(list));
  return result.ok ? ok(record) : result;
}

async function _deletePartner(id: string): Promise<ActionResult> {
  return persist(Storage.savePartners(Storage.getPartners().filter(p => p.id !== id)));
}

// ------------------------------------------------------------
// Особисті борги
// ------------------------------------------------------------

export function validateDebtInput(input: Partial<PersonalDebt>): FieldError[] {
  return [
    ...validateEnum(input.type, ['owed_to_me', 'my_debt'] as const, 'type', 'Тип'),
    ...validateRequiredText(input.person, 'person', 'Хто / Кому', 160),
    ...positiveAmount(input.amount, 'amount', 'Сума'),
    ...validateCurrency(input.currency ?? 'UAH', 'currency', 'Валюта'),
    ...validateDate(input.date, { field: 'date', label: 'Дата' }),
  ];
}

async function _saveDebt(input: Partial<PersonalDebt>, editId?: string): Promise<ActionResult<PersonalDebt>> {
  const errors = validateDebtInput(input);
  if (errors.length) return fail(errors);
  const list = Storage.getPersonalDebts();
  if (editId) {
    const index = list.findIndex(d => d.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Запис не знайдено' }]);
    list[index] = { ...list[index], ...input };
    const result = await persist(Storage.savePersonalDebts(list));
    return result.ok ? ok(list[index]) : result;
  }
  const record: PersonalDebt = { id: generateId(), ...input } as PersonalDebt;
  list.push(record);
  const result = await persist(Storage.savePersonalDebts(list));
  return result.ok ? ok(record) : result;
}

async function _deleteDebt(id: string): Promise<ActionResult> {
  return persist(Storage.savePersonalDebts(Storage.getPersonalDebts().filter(d => d.id !== id)));
}

// ------------------------------------------------------------
// Відкладення
// ------------------------------------------------------------

export function validateSavingInput(input: Partial<Saving>): FieldError[] {
  return [
    ...validateBank(input.bank, 'bank', 'Банк', true),
    ...validateAmount(input.goal, { field: 'goal', label: 'Ціль', min: 0 }),
    ...validateAmount(input.amount, { field: 'amount', label: 'Сума', min: 0, required: false }),
    ...validateCurrency(input.currency ?? 'UAH', 'currency', 'Валюта'),
    ...validateDate(input.date, { field: 'date', label: 'Дата' }),
  ];
}

async function _saveSaving(input: Partial<Saving>, editId?: string): Promise<ActionResult<Saving>> {
  const errors = validateSavingInput(input);
  if (errors.length) return fail(errors);
  const goal = toFiniteNumber(input.goal);
  if (goal === null || goal <= 0) return fail([{ field: 'goal', message: 'Ціль: має бути більшою за 0' }]);
  const list = Storage.getSavings();
  if (editId) {
    const index = list.findIndex(s => s.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Запис не знайдено' }]);
    list[index] = { ...list[index], ...input };
    const result = await persist(Storage.saveSavings(list));
    return result.ok ? ok(list[index]) : result;
  }
  const record: Saving = { id: generateId(), ...input, goal } as Saving;
  list.push(record);
  const result = await persist(Storage.saveSavings(list));
  return result.ok ? ok(record) : result;
}

async function _deleteSaving(id: string): Promise<ActionResult> {
  return persist(Storage.saveSavings(Storage.getSavings().filter(s => s.id !== id)));
}

// ------------------------------------------------------------
// Налаштування фінансів
// ------------------------------------------------------------

/**
 * Збереження курсів. displayCurrency НЕ скидається: чинне значення
 * зберігається, якщо його не передано явно.
 */
async function _saveRates(input: { usdRate?: unknown; eurRate?: unknown; usdtRate?: unknown; displayCurrency?: FinanceSettings['displayCurrency'] }): Promise<ActionResult<FinanceSettings>> {
  const errors: FieldError[] = [
    ...validateRate(input.usdRate, 'usdRate', 'Курс долара'),
    ...validateRate(input.eurRate, 'eurRate', 'Курс євро'),
  ];
  if (input.usdtRate !== undefined && input.usdtRate !== '') {
    errors.push(...validateRate(input.usdtRate, 'usdtRate', 'Курс USDT'));
  }
  if (errors.length) return fail(errors);

  const current = store.getSnapshot().financeSettings;
  const usdRate = toFiniteNumber(input.usdRate) ?? current.usdRate;
  const next: FinanceSettings = {
    usdRate,
    eurRate: toFiniteNumber(input.eurRate) ?? current.eurRate,
    usdtRate: toFiniteNumber(input.usdtRate) ?? usdRate,
    displayCurrency: input.displayCurrency || current.displayCurrency || 'UAH',
  };
  const result = await persist(store.saveSettings(next));
  return result.ok ? ok(next) : result;
}

async function _setDisplayCurrency(currency: FinanceSettings['displayCurrency']): Promise<ActionResult<FinanceSettings>> {
  if (currency !== 'UAH' && currency !== 'USD' && currency !== 'EUR') {
    return fail([{ field: 'displayCurrency', message: 'Валюта відображення: недопустиме значення' }]);
  }
  const current = store.getSnapshot().financeSettings;
  const result = await persist(store.saveSettings({ ...current, displayCurrency: currency }));
  return result.ok ? ok({ ...current, displayCurrency: currency }) : result;
}

// One atomic remote commit per complete domain action.
export const createClient = (...args: Parameters<typeof _createClient>) => store.atomicAction(() => _createClient(...args));
export const updateClient = (...args: Parameters<typeof _updateClient>) => store.atomicAction(() => _updateClient(...args));
export const toggleClientRegular = (...args: Parameters<typeof _toggleClientRegular>) => store.atomicAction(() => _toggleClientRegular(...args));
export const deleteClient = (...args: Parameters<typeof _deleteClient>) => store.atomicAction(() => _deleteClient(...args));
export const resolveClient = (...args: Parameters<typeof _resolveClient>) => store.atomicAction(() => _resolveClient(...args));
export const saveProject = (...args: Parameters<typeof _saveProject>) => store.atomicAction(() => _saveProject(...args));
export const completeProject = (...args: Parameters<typeof _completeProject>) => store.atomicAction(() => _completeProject(...args));
export const deleteProject = (...args: Parameters<typeof _deleteProject>) => store.atomicAction(() => _deleteProject(...args));
export const saveTransaction = (...args: Parameters<typeof _saveTransaction>) => store.atomicAction(() => _saveTransaction(...args));
export const deleteTransaction = (...args: Parameters<typeof _deleteTransaction>) => store.atomicAction(() => _deleteTransaction(...args));
export const convertCurrency = (...args: Parameters<typeof _convertCurrency>) => store.atomicAction(() => _convertCurrency(...args));
export const saveSpecialist = (...args: Parameters<typeof _saveSpecialist>) => store.atomicAction(() => _saveSpecialist(...args));
export const deleteSpecialist = (...args: Parameters<typeof _deleteSpecialist>) => store.atomicAction(() => _deleteSpecialist(...args));
export const savePartner = (...args: Parameters<typeof _savePartner>) => store.atomicAction(() => _savePartner(...args));
export const deletePartner = (...args: Parameters<typeof _deletePartner>) => store.atomicAction(() => _deletePartner(...args));
export const saveDebt = (...args: Parameters<typeof _saveDebt>) => store.atomicAction(() => _saveDebt(...args));
export const deleteDebt = (...args: Parameters<typeof _deleteDebt>) => store.atomicAction(() => _deleteDebt(...args));
export const saveSaving = (...args: Parameters<typeof _saveSaving>) => store.atomicAction(() => _saveSaving(...args));
export const deleteSaving = (...args: Parameters<typeof _deleteSaving>) => store.atomicAction(() => _deleteSaving(...args));
export const saveRates = (...args: Parameters<typeof _saveRates>) => store.atomicAction(() => _saveRates(...args));
export const setDisplayCurrency = (...args: Parameters<typeof _setDisplayCurrency>) => store.atomicAction(() => _setDisplayCurrency(...args));

async function _recordProjectPayment(id:string,input:{amount:number;bank:string;date:string;description?:string}):Promise<ActionResult<Project>> {
  const p=[...Storage.getProjects(),...Storage.getCompleted()].find(p=>p.id===id);
  if(!p)return fail([{field:'id',message:'Проєкт не знайдено'}]);
  const errors=validateTransactionInput({type:'income',...input});
  if(bankCurrencyLocal(input.bank)!==(p.currency||'UAH'))errors.push({field:'bank',message:'Валюта рахунку має відповідати валюті проєкту'});
  const paid=Number(p.prepayment||0)+Number(input.amount);
  if(paid>Number(p.budget))errors.push({field:'amount',message:'Оплата перевищує залишок бюджету проєкту'});
  if(errors.length)return fail(errors);
  const next={...p,prepayment:paid};
  const active=Storage.getProjects();
  const saved=active.some(p=>p.id===id)
    ? await persist(Storage.saveProjects(active.map(p=>p.id===id?next:p)))
    : await persist(Storage.saveCompleted(Storage.getCompleted().map(p=>p.id===id?next:p)));
  if(!saved.ok)return saved;
  const transaction=await _saveTransaction({type:'income',amount:Number(input.amount),bank:input.bank,date:input.date,projectId:id,incomeStatus:'earned',description:input.description||`Оплата: ${p.name}`});
  return transaction.ok?ok(next):transaction;
}
export const recordProjectPayment=(...args:Parameters<typeof _recordProjectPayment>)=>store.atomicAction(()=>_recordProjectPayment(...args));

export const applyAssistantPlan=(plan:Plan):Promise<ActionResult<unknown>>=>store.atomicAction(async()=>{
  if(plan.base!==await fingerprint(store.getSnapshot()))return fail([{field:'storage',message:'Дані змінилися. Онови CRM й створи нову чернетку.'}]);
  const id=plan.recordId,fields=plan.fields,edit=plan.action==='update'?id:undefined;
  const old=id?records(plan.domain,store.getSnapshot()).find(x=>x.id===id):undefined;
  const input={...old,...fields};const remove=plan.action==='delete';
  switch(plan.domain){
    case 'clients':return remove?_deleteClient(id!):edit?_updateClient(edit,input):_createClient(fields);
    case 'projects':return remove?_deleteProject(id!,store.getSnapshot().projectsCompleted.some(p=>p.id===id)):_saveProject(input,edit);
    case 'finance':return remove?_deleteTransaction(id!):_saveTransaction(input,edit);
    case 'payments':return _recordProjectPayment(id!,fields as {amount:number;bank:string;date:string;description?:string});
    case 'specialists':return remove?_deleteSpecialist(id!):_saveSpecialist(input,edit);
    case 'partners':return remove?_deletePartner(id!):_savePartner(input,edit);
    case 'debts':return remove?_deleteDebt(id!):_saveDebt(input,edit);
    case 'savings':return remove?_deleteSaving(id!):_saveSaving(input,edit);
    default:return fail([{field:'action',message:'Дія не підтримується'}]);
  }
});
