import {fingerprint,records,type Plan} from '@/lib/assistant/plan';
import type {
  Client, FinanceSettings, HostingPayment, HostingService, PlannedProject, Task,
  Partner, PersonalDebt, Project, Saving, Specialist, Transaction,
} from '@/types';
import type { FieldError } from '@/lib/validate';
import {
  validateAmount, validateBank, validateCurrency, validateDate,
  validateEnum, validatePercent, validatePositiveNumber, validateProjectBank, validateRate,
  validateRequiredText, validateTelegram, toFiniteNumber,
} from '@/lib/validate';
import { validateHostingPaymentInput, validateHostingServiceInput } from '@/lib/hosting';
import { snoozeReminderIso, taskDateTimeFields, validateTaskInput, type TaskDraftInput } from '@/lib/tasks';
import { kyivDateTimeToIso } from '@/lib/dates';
import { autoMyPercent, DEFAULT_MY_SHARE } from '@/lib/my-share';
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

  // Початковий зв'язок: для редагування — чинний ID запису, якщо поле
  // clientId не передано взагалі (AI-update без клієнтських полів).
  let clientId = editId
    ? (Storage.getProjects().find(p => p.id === editId)?.clientId || Storage.getCompleted().find(p => p.id === editId)?.clientId || '')
    : '';
  let clientName = input.clientName;
  let clientTelegram = input.clientTelegram;
  let clientSource = input.clientSource;

  // Явний clientId — це конкретна картка, а не пошук за ім'ям. Невідомий,
  // видалений або неправильного типу ID відхиляємо ДО будь-якого запису.
  // Вхідний об'єкт НЕ мутуємо: нормалізуємо окремий payload нижче.
  const rawClientId: unknown = input.clientId;
  if (rawClientId !== undefined) {
    if (rawClientId === null || rawClientId === '') {
      // Явне від'єднання (порожнє значення): зв'язок визначається за ім'ям.
      clientId = '';
    } else if (typeof rawClientId !== 'string') {
      return fail([{ field: 'clientId', message: 'ID клієнта має бути рядком' }]);
    } else {
      clientId = rawClientId;
    }
  }

  if (clientId) {
    // Остаточне приведення в спільній доменній дії: наявна картка —
    // джерело істини для імені та контактів («ID A, ім'я B» не зберігаємо),
    // порожні telegram/source картки — теж значення (історичні контакти
    // проєкту не підставляються), саму картку не перезаписуємо.
    const match = Storage.getClients().find(c => c.id === clientId);
    if (!match) {
      return fail([{ field: 'clientId', message: `Клієнта з ID ${clientId} не знайдено. Обери чинного клієнта.` }]);
    }
    clientName = match.name;
    clientTelegram = match.telegram || '';
    clientSource = match.source || 'Інше';
  } else if (clientName) {
    const resolved = await _resolveClient({
      name: clientName,
      telegram: clientTelegram,
      source: clientSource,
    });
    if (!resolved.ok) return resolved;
    clientId = resolved.value!.clientId;
    // Підібрана/створена картка теж стає джерелом істини — форма й AI
    // зберігають однакові дані незалежно від шляху визначення зв'язку.
    const card = Storage.getClients().find(c => c.id === clientId);
    if (card) {
      clientName = card.name;
      clientTelegram = card.telegram || '';
      clientSource = card.source || 'Інше';
    }
  }

  const payload: Partial<Project> = { ...input, clientId, clientName, clientTelegram, clientSource };
  // AI може створити проєкт без явно заданого відсотка — тоді діє те саме
  // правило фахівця, що й у формі. Явно задане значення не змінюється.
  const explicitPercent: unknown = payload.myPercent;
  if (explicitPercent === undefined || explicitPercent === null || explicitPercent === '') {
    const specialist = payload.developerId
      ? Storage.getSpecialists().find(s => s.id === payload.developerId)
      : undefined;
    payload.myPercent = autoMyPercent(specialist, payload.budget, payload.currency) ?? 0;
  }

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

/**
 * Вхід збереження/валідації фахівця. Налаштування «Моя частка» можуть
 * приходити з форми рядками — перед записом вони нормалізуються до чисел.
 */
export type SpecialistInput = Omit<Partial<Specialist>, 'myShareThreshold' | 'mySharePercentUpTo' | 'mySharePercentAbove'> & {
  myShareThreshold?: unknown;
  mySharePercentUpTo?: unknown;
  mySharePercentAbove?: unknown;
};

/**
 * Налаштування «Моя частка»: поріг і два відсотки — обов'язкові,
 * поріг > 0, відсотки від 0 до 100. Перевіряється і у формі, і тут.
 */
export function validateSpecialistInput(input: SpecialistInput): FieldError[] {
  return [
    ...validateRequiredText(input.name, 'name', 'Ім’я', 120),
    ...validateRequiredText(input.specialization, 'specialization', 'Спеціалізація', 120),
    ...validateTelegram(input.telegram),
    ...validatePositiveNumber(input.myShareThreshold, 'myShareThreshold', 'Поріг бюджету'),
    ...validatePercent(input.mySharePercentUpTo, 'mySharePercentUpTo', 'Відсоток до порогу', { required: true }),
    ...validatePercent(input.mySharePercentAbove, 'mySharePercentAbove', 'Відсоток понад поріг', { required: true }),
  ];
}

async function _saveSpecialist(input: SpecialistInput, editId?: string): Promise<ActionResult<Specialist>> {
  // Відсутні налаштування (AI-створення, старі виклики) → початкове правило;
  // явно порожні або некоректні значення відхиляються перевіркою нижче.
  const prepared = {
    name: input.name,
    specialization: input.specialization,
    telegram: input.telegram,
    myShareThreshold: input.myShareThreshold ?? DEFAULT_MY_SHARE.threshold,
    mySharePercentUpTo: input.mySharePercentUpTo ?? DEFAULT_MY_SHARE.percentUpTo,
    mySharePercentAbove: input.mySharePercentAbove ?? DEFAULT_MY_SHARE.percentAbove,
  };
  const errors = validateSpecialistInput(prepared);
  if (errors.length) return fail(errors);
  const myShare = {
    myShareThreshold: toFiniteNumber(prepared.myShareThreshold)!,
    mySharePercentUpTo: toFiniteNumber(prepared.mySharePercentUpTo)!,
    mySharePercentAbove: toFiniteNumber(prepared.mySharePercentAbove)!,
  };
  const list = Storage.getSpecialists();
  if (editId) {
    const index = list.findIndex(s => s.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Фахівця не знайдено' }]);
    list[index] = { ...list[index], ...input, ...myShare };
    const result = await persist(Storage.saveSpecialists(list));
    return result.ok ? ok(list[index]) : result;
  }
  const record: Specialist = {
    id: generateId(),
    name: String(input.name).trim(),
    specialization: input.specialization || '',
    telegram: input.telegram || '',
    ...myShare,
  };
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

// ------------------------------------------------------------
// Хостинг (пакет 04)
//
// Ручний облік послуг провайдера: картки та окремі записи оплат.
// Жодних автоматичних транзакцій «Фінансів» — запис оплати хостингу є
// лише обліком факту (не підтвердженням продовження у провайдері).
// Кожна підтверджена оплата — одна група журналу історії (пакет 03).
// ------------------------------------------------------------

async function _saveHostingService(input: Partial<HostingService>, editId?: string): Promise<ActionResult<HostingService>> {
  const errors = validateHostingServiceInput(input);
  if (errors.length) return fail(errors);
  const list = Storage.getHostingServices();
  const name = String(input.name ?? '').trim();
  const normalized: Partial<HostingService> = {
    name,
    site: (input.site ?? '').toString().trim() || undefined,
    provider: (input.provider ?? '').toString().trim() || undefined,
    plan: (input.plan ?? '').toString().trim() || undefined,
    currency: input.currency || 'UAH',
    expectedPrice: input.expectedPrice === undefined || input.expectedPrice === null || input.expectedPrice === ('' as unknown)
      ? undefined
      : toFiniteNumber(input.expectedPrice) ?? undefined,
    note: (input.note ?? '').toString().trim() || undefined,
  };
  if (editId) {
    const index = list.findIndex(h => h.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Послугу хостингу не знайдено' }]);
    const next: HostingService = { ...list[index], ...normalized, id: editId };
    list[index] = next;
    const result = await persist(Storage.saveHostingServices(list));
    return result.ok ? ok(next) : result;
  }
  const record: HostingService = {
    id: generateId(),
    name,
    site: normalized.site,
    provider: normalized.provider,
    plan: normalized.plan,
    currency: normalized.currency,
    expectedPrice: normalized.expectedPrice,
    note: normalized.note,
    archived: false,
    createdAt: new Date().toISOString(),
  };
  const result = await persist(Storage.saveHostingServices([...list, record]));
  return result.ok ? ok(record) : result;
}

/** Архівування/повернення з архіву. Фізичне видалення картки в v1 не передбачено. */
async function _archiveHostingService(id: string, archived: boolean): Promise<ActionResult<HostingService>> {
  const list = Storage.getHostingServices();
  const index = list.findIndex(h => h.id === id);
  if (index < 0) return fail([{ field: 'id', message: 'Послугу хостингу не знайдено' }]);
  const next: HostingService = { ...list[index], archived };
  list[index] = next;
  const result = await persist(Storage.saveHostingServices(list));
  return result.ok ? ok(next) : result;
}

async function _saveHostingPayment(input: Partial<HostingPayment>, editId?: string): Promise<ActionResult<HostingPayment>> {
  const errors = validateHostingPaymentInput(input);
  if (errors.length) return fail(errors);
  const serviceId = String(input.serviceId ?? '').trim();
  if (!Storage.getHostingServices().some(h => h.id === serviceId)) {
    return fail([{ field: 'serviceId', message: 'Послугу хостингу не знайдено — обери наявну картку' }]);
  }
  const amount = toFiniteNumber(input.amount);
  const list = Storage.getHostingPayments();
  const normalized: Partial<HostingPayment> = {
    serviceId,
    date: String(input.date ?? '').trim(),
    amount: amount ?? 0,
    currency: input.currency || 'UAH',
    periodStart: String(input.periodStart ?? '').trim(),
    periodEnd: String(input.periodEnd ?? '').trim(),
    note: (input.note ?? '').toString().trim() || undefined,
  };
  if (editId) {
    const index = list.findIndex(p => p.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Оплату не знайдено' }]);
    const next: HostingPayment = { ...list[index], ...normalized, id: editId };
    list[index] = next;
    const result = await persist(Storage.saveHostingPayments(list));
    return result.ok ? ok(next) : result;
  }
  const record: HostingPayment = {
    id: generateId(),
    serviceId: normalized.serviceId!,
    date: normalized.date!,
    amount: normalized.amount!,
    currency: normalized.currency,
    periodStart: normalized.periodStart!,
    periodEnd: normalized.periodEnd!,
    note: normalized.note,
    createdAt: new Date().toISOString(),
  };
  const result = await persist(Storage.saveHostingPayments([...list, record]));
  return result.ok ? ok(record) : result;
}

/** Видалення окремої помилкової оплати: явна дія UI з підтвердженням. */
async function _deleteHostingPayment(id: string): Promise<ActionResult> {
  const list = Storage.getHostingPayments();
  if (!list.some(p => p.id === id)) return fail([{ field: 'id', message: 'Оплату не знайдено' }]);
  return persist(Storage.saveHostingPayments(list.filter(p => p.id !== id)));
}

export const saveHostingService = (...args: Parameters<typeof _saveHostingService>) =>
  store.atomicAction(() => _saveHostingService(...args));
export const archiveHostingService = (...args: Parameters<typeof _archiveHostingService>) =>
  store.atomicAction(() => _archiveHostingService(...args));
export const saveHostingPayment = (...args: Parameters<typeof _saveHostingPayment>) =>
  store.atomicAction(() => _saveHostingPayment(...args), { source: 'Форма', hint: 'payment' });
export const deleteHostingPayment = (...args: Parameters<typeof _deleteHostingPayment>) =>
  store.atomicAction(() => _deleteHostingPayment(...args));

// ------------------------------------------------------------
// Завдання та нагадування (пакет 05).
// ОДНА колекція tasks; нагадування — поля завдання (момент + показ).
// Виконання завдання «оплатити» НЕ створює транзакцій «Фінансів».
// ------------------------------------------------------------

async function _saveTask(input: TaskDraftInput, editId?: string): Promise<ActionResult<Task>> {
  // Створення: назва обов'язкова. Редагування: назва обов'язкова лише якщо
  // її передано (часткове оновлення статусу/нагадування — без назви).
  const errors = validateTaskInput(input, { requireTitle: !editId || input.title !== undefined });
  if (errors.length) return fail(errors);
  const list = Storage.getTasks();
  const nowIso = new Date().toISOString();
  const title = String(input.title ?? '').trim();

  if (editId) {
    const index = list.findIndex(t => t.id === editId);
    if (index < 0) return fail([{ field: 'id', message: 'Завдання не знайдено' }]);
    const existing = list[index];
    const next: Task = { ...existing };
    if (input.title !== undefined) next.title = title;
    if (input.description !== undefined) next.description = String(input.description).trim() || undefined;
    if (input.priority !== undefined) next.priority = input.priority;
    if (input.dueDate !== undefined) {
      const dates = taskDateTimeFields({ dueDate: input.dueDate, dueTime: input.dueTime ?? existing.dueTime });
      if (input.dueDate === '') { delete next.dueDate; delete next.dueTime; }
      else { next.dueDate = dates.dueDate; if (dates.dueTime) next.dueTime = dates.dueTime; else delete next.dueTime; }
    } else if (input.dueTime !== undefined && next.dueDate) {
      const dates = taskDateTimeFields({ dueDate: next.dueDate, dueTime: input.dueTime });
      if (dates.dueTime) next.dueTime = dates.dueTime; else delete next.dueTime;
    }
    if (input.reminderClear === true) {
      // Явне прибирання нагадування (дедлайн не змінюється).
      delete next.reminderAt;
      delete next.reminderShownAt;
    } else if (input.reminderDate && input.reminderTime) {
      // Явне оновлення: ЛИШЕ повна пара дата+час (неповна відхилена
      // validateTaskInput — чинне нагадування не видаляється мовчки).
      const dates = taskDateTimeFields({ reminderDate: input.reminderDate, reminderTime: input.reminderTime });
      if (dates.reminderAt) {
        next.reminderAt = dates.reminderAt;
        delete next.reminderShownAt;
      }
    } else if (input.reminderAt !== undefined) {
      if (input.reminderAt && Number.isFinite(Date.parse(input.reminderAt))) next.reminderAt = input.reminderAt;
      else delete next.reminderAt;
      delete next.reminderShownAt;
    }
    if (input.status !== undefined) {
      next.status = input.status;
      if (input.status === 'done') next.completedAt = existing.completedAt || nowIso;
      else { delete next.completedAt; }
    }
    // Часткове оновлення: ефективна пара дедлайн+час має існувати в Kyiv.
    if (next.dueDate && next.dueTime && kyivDateTimeToIso(next.dueDate, next.dueTime) === null) {
      return fail([{ field: 'dueTime', message: 'Такого часу дедлайну в Kyiv не існує (перехід) — приберіть час або змініть дату' }]);
    }
    next.updatedAt = nowIso;
    list[index] = next;
    const result = await persist(Storage.saveTasks(list));
    return result.ok ? ok(next) : result;
  }

  const dates = taskDateTimeFields(input);
  const record: Task = {
    id: generateId(),
    title,
    description: (input.description ?? '').toString().trim() || undefined,
    priority: input.priority || 'normal',
    status: input.status || 'planned',
    dueDate: dates.dueDate,
    dueTime: dates.dueTime,
    reminderAt: dates.reminderAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (record.status === 'done') record.completedAt = nowIso;
  const result = await persist(Storage.saveTasks([...list, record]));
  return result.ok ? ok(record) : result;
}

async function _completeTask(id: string): Promise<ActionResult<Task>> {
  const list = Storage.getTasks();
  const index = list.findIndex(t => t.id === id);
  if (index < 0) return fail([{ field: 'id', message: 'Завдання не знайдено' }]);
  const existing = list[index];
  if (existing.status === 'done') return ok(existing); // повторне виконання без дубліката
  const nowIso = new Date().toISOString();
  const next: Task = { ...existing, status: 'done', completedAt: existing.completedAt || nowIso, updatedAt: nowIso };
  list[index] = next;
  const result = await persist(Storage.saveTasks(list));
  return result.ok ? ok(next) : result;
}

async function _cancelTask(id: string): Promise<ActionResult<Task>> {
  const list = Storage.getTasks();
  const index = list.findIndex(t => t.id === id);
  if (index < 0) return fail([{ field: 'id', message: 'Завдання не знайдено' }]);
  const existing = list[index];
  const nowIso = new Date().toISOString();
  const next: Task = { ...existing, status: 'cancelled', updatedAt: nowIso };
  delete next.completedAt;
  list[index] = next;
  const result = await persist(Storage.saveTasks(list));
  return result.ok ? ok(next) : result;
}

/** «Нагадати пізніше»: новий момент нагадування; дедлайн НЕ змінюється. */
async function _snoozeTaskReminder(id: string, newDate: string, newTime: string): Promise<ActionResult<Task>> {
  const iso = snoozeReminderIso(newDate, newTime);
  if (!iso) return fail([{ field: 'reminderAt', message: 'Вкажіть майбутній момент нагадування (дата + час Kyiv)' }]);
  const list = Storage.getTasks();
  const index = list.findIndex(t => t.id === id);
  if (index < 0) return fail([{ field: 'id', message: 'Завдання не знайдено' }]);
  const existing = list[index];
  const nowIso = new Date().toISOString();
  const next: Task = { ...existing, reminderAt: iso, updatedAt: nowIso };
  delete next.reminderShownAt;
  list[index] = next;
  const result = await persist(Storage.saveTasks(list));
  return result.ok ? ok(next) : result;
}

/**
 * Позначити показані нагадування (одна група журналу). Захист від
 * повторного показу узгоджується між пристроями через саму колекцію.
 */
async function _markRemindersShown(ids: string[]): Promise<ActionResult> {
  if (!ids.length) return ok();
  const list = Storage.getTasks();
  const nowIso = new Date().toISOString();
  let changed = false;
  const next = list.map(task => {
    if (ids.includes(task.id) && task.status === 'planned' && task.reminderAt && !task.reminderShownAt) {
      changed = true;
      return { ...task, reminderShownAt: nowIso } as Task;
    }
    return task;
  });
  if (!changed) return ok();
  return persist(Storage.saveTasks(next));
}

export const saveTask = (...args: Parameters<typeof _saveTask>) =>
  store.atomicAction(() => _saveTask(...args));
export const completeTask = (...args: Parameters<typeof _completeTask>) =>
  store.atomicAction(() => _completeTask(...args));
export const cancelTask = (...args: Parameters<typeof _cancelTask>) =>
  store.atomicAction(() => _cancelTask(...args));
export const snoozeTaskReminder = (...args: Parameters<typeof _snoozeTaskReminder>) =>
  store.atomicAction(() => _snoozeTaskReminder(...args));
export const markRemindersShown = (...args: Parameters<typeof _markRemindersShown>) =>
  store.atomicAction(() => _markRemindersShown(...args), { source: 'Система' });

// ------------------------------------------------------------
// Заплановані проєкти (пакет 06).
// Нова колекція plannedProjects; старі tasks лишаються legacy.
// Жодних фінансових полів, статусів чи автоперенесення в проєкти.
// Клієнт: явний вибір картки зберігає clientId; ручне ім'я — лише текст
// (не створює картку і не лінкується за іменем).
// ------------------------------------------------------------

export function validatePlannedProjectInput(input: Partial<PlannedProject>): FieldError[] {
  const errors = [
    ...validateRequiredText(input.name, 'name', 'Назва проєкту', 300),
    ...validateEnum(input.category, ['IT', 'Design', 'Video'], 'category', 'Категорія'),
  ];
  // Клієнт: явний непорожній clientId (рядок) АБО ручне ім'я — обов'язково одне
  // з двох. Невідомість ID перевіряється нижче за чинними clients (_savePlannedProject).
  const hasClientId = input.clientId !== undefined && input.clientId !== null && String(input.clientId).trim() !== '';
  if (hasClientId) {
    if (typeof input.clientId !== 'string') errors.push({ field: 'clientId', message: 'Клієнт: некоректний ID' });
  } else {
    errors.push(...validateRequiredText(input.clientName, 'clientName', 'Клієнт', 200));
  }
  return errors;
}

// Рев'ю 18.10: канонічні правила клієнта для всіх шляхів запису (форма, AI):
// 1) clientId (наявна картка) — джерело канонічного clientName; невідомий ID —
//    зрозуміла відмова до запису, без тихого переходу в ручне ім'я;
// 2) лише clientName — ручний режим: без автопідбору за збігом імені й без
//    створення картки;
// 3) без обох полів (partial edit) — чинний зв'язок запису зберігається, якщо
//    картка ще існує (застарілий ID скидається без відмови редагування).
async function _savePlannedProject(input: Partial<PlannedProject>, editId?: string): Promise<ActionResult<PlannedProject>> {
  const list = Storage.getPlannedProjects();
  const old = editId ? list.find(p => p.id === editId) : undefined;
  if (editId && !old) return fail([{ field: 'id', message: 'Запланований проєкт не знайдено' }]);
  if (input.clientId !== undefined && input.clientId !== null && typeof input.clientId !== 'string') {
    return fail([{ field: 'clientId', message: 'Клієнт: некоректний ID' }]);
  }
  const clients = Storage.getClients();
  const rawId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
  let clientId: string | undefined;
  let clientName: string | undefined;
  if (rawId) {
    const card = clients.find(c => c.id === rawId);
    if (!card) {
      return fail([{
        field: 'clientId',
        message: `Клієнта «${rawId}» не знайдено — обери наявну картку або вкажи ім'я вручну (без clientId)`,
      }]);
    }
    clientId = card.id;
    clientName = card.name;
  } else if (input.clientName !== undefined && input.clientName !== null) {
    clientId = undefined;
    clientName = String(input.clientName).trim();
  } else if (old) {
    clientId = old.clientId && clients.some(c => c.id === old.clientId) ? old.clientId : undefined;
    clientName = old.clientName;
  }
  const errors = validatePlannedProjectInput({ ...input, clientId, clientName });
  if (errors.length) return fail(errors);
  const name = String(input.name).trim();
  const category = input.category as PlannedProject['category'];
  const resolvedClientName = String(clientName).trim();
  const description = String(input.description ?? '').trim() || undefined;
  const nowIso = new Date().toISOString();

  if (editId) {
    const next: PlannedProject = {
      ...old!,
      name,
      category,
      clientName: resolvedClientName,
      clientId,
      description,
      updatedAt: nowIso,
    };
    list[list.indexOf(old!)] = next;
    const result = await persist(Storage.savePlannedProjects(list));
    return result.ok ? ok(next) : result;
  }

  const record: PlannedProject = {
    id: generateId(),
    name,
    category,
    clientName: resolvedClientName,
    clientId,
    description,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const result = await persist(Storage.savePlannedProjects([...list, record]));
  return result.ok ? ok(record) : result;
}

async function _deletePlannedProject(id: string): Promise<ActionResult> {
  const list = Storage.getPlannedProjects();
  if (!list.some(p => p.id === id)) return fail([{ field: 'id', message: 'Запланований проєкт не знайдено' }]);
  return persist(Storage.savePlannedProjects(list.filter(p => p.id !== id)));
}

export const savePlannedProject = (...args: Parameters<typeof _savePlannedProject>) =>
  store.atomicAction(() => _savePlannedProject(...args));
export const deletePlannedProject = (...args: Parameters<typeof _deletePlannedProject>) =>
  store.atomicAction(() => _deletePlannedProject(...args));
export const saveRates = (...args: Parameters<typeof _saveRates>) => store.atomicAction(() => _saveRates(...args));
export const setDisplayCurrency = (...args: Parameters<typeof _setDisplayCurrency>) => store.atomicAction(() => _setDisplayCurrency(...args));

async function _recordProjectPayment(id:string,input:{amount:number;bank?:string;date?:string;description?:string}):Promise<ActionResult<Project>> {
  const p=[...Storage.getProjects(),...Storage.getCompleted()].find(p=>p.id===id);
  if(!p)return fail([{field:'id',message:'Проєкт не знайдено'}]);
  // Оплата проєкту змінює тільки картку, не фінансовий журнал.
  const errors=[...validatePositiveNumber(input.amount,'amount','Сума доплати'),...validateDate(input.date),...validateBank(input.bank,'bank','Рахунок',false)];
  if(input.bank&&bankCurrencyLocal(input.bank)!==(p.currency||'UAH'))errors.push({field:'bank',message:'Валюта рахунку має відповідати валюті проєкту'});
  const paid=Number(p.prepayment||0)+Number(input.amount);
  if(paid>Number(p.budget))errors.push({field:'amount',message:'Оплата перевищує залишок бюджету проєкту'});
  if(errors.length)return fail(errors);
  const next={...p,prepayment:paid};
  const active=Storage.getProjects();
  const saved=active.some(p=>p.id===id)
    ? await persist(Storage.saveProjects(active.map(p=>p.id===id?next:p)))
    : await persist(Storage.saveCompleted(Storage.getCompleted().map(p=>p.id===id?next:p)));
  if(!saved.ok)return saved;
  return ok(next);
}
export const recordProjectPayment=(...args:Parameters<typeof _recordProjectPayment>)=>store.atomicAction(()=>_recordProjectPayment(...args),{source:'Форма',hint:'payment'});

/** Пакет 03: скасування події журналу — окремий шлях (без commit-черги). */
async function _undoHistoryEvent(plan: Plan): Promise<ActionResult<unknown>> {
  const eventId = plan.recordId;
  if (!eventId) return fail([{ field: 'recordId', message: 'Вкажи ID події журналу' }]);
  const result = await store.undoHistory({
    eventId,
    requestId: crypto.randomUUID(),
    source: 'Помічник',
  });
  if (!result.ok) return fail([{ field: 'eventId', message: result.message }]);
  return ok({ id: result.event ? result.event.id : eventId });
}

export const applyAssistantPlan=(plan:Plan):Promise<ActionResult<unknown>>=>plan.domain==='history'
  ? _undoHistoryEvent(plan)
  : store.atomicAction(async()=>{
  if(plan.base!==await fingerprint(store.getSnapshot()))return fail([{field:'storage',message:'Дані змінилися. Онови CRM й створи нову чернетку.'}]);
  const id=plan.recordId,fields=plan.fields,edit=plan.action==='update'?id:undefined;
  const old=id?records(plan.domain,store.getSnapshot()).find(x=>x.id===id):undefined;
  const input={...old,...fields};const remove=plan.action==='delete';
  switch(plan.domain){
    case 'settings': {
      const next={...store.getSnapshot().financeSettings,...fields};
      const currencyErrors=validateEnum(next.displayCurrency,['UAH','USD','EUR'],'displayCurrency','Валюта відображення');
      return currencyErrors.length?fail(currencyErrors):_saveRates(next);
    }
    case 'clients':return remove?_deleteClient(id!):edit?_updateClient(edit,input):_createClient(fields);
    case 'projects':return remove?_deleteProject(id!,store.getSnapshot().projectsCompleted.some(p=>p.id===id)):_saveProject(input,edit);
    case 'finance':return remove?_deleteTransaction(id!):_saveTransaction(input,edit);
    case 'payments':return _recordProjectPayment(id!,fields as {amount:number;bank?:string;date?:string;description?:string});
    case 'specialists':return remove?_deleteSpecialist(id!):_saveSpecialist(input,edit);
    case 'hosting':return remove?fail([{field:'action',message:'Картку хостингу не видаляють — використай архів (archived: true)'}]):_saveHostingService(fields,edit);
    case 'hostingPayments':return remove?_deleteHostingPayment(id!):_saveHostingPayment(fields,edit);
    case 'plannedProjects': {
      if (remove) return _deletePlannedProject(id!);
      // Рев'ю 18.10: partial update — зберігаємо не передані поля; клієнт за
      // явними полями чернетки (див. канонічні правила вище), а не за merged:
      // без полів клієнта — чинний зв'язок; лише clientName — явне відв'язування
      // в ручний режим; clientId: null — явне відв'язування зі збереженням імені;
      // непорожній clientId — перевірка існування та канонічне ім'я — у
      // _savePlannedProject (draft показує канонічні поля, запис не розходиться).
      const explicit = fields as Record<string, unknown>;
      const hasClientField = 'clientId' in explicit || 'clientName' in explicit;
      if (!hasClientField) {
        const oldClientId = typeof old?.clientId === 'string' ? old.clientId : '';
        input.clientId = oldClientId && store.getSnapshot().clients.some(c => c.id === oldClientId)
          ? oldClientId
          : undefined;
      } else if (!('clientId' in explicit)) {
        input.clientId = undefined;
      } else if (explicit.clientId === null || explicit.clientId === '') {
        input.clientId = undefined;
        if (explicit.clientName === undefined || explicit.clientName === null) input.clientName = old?.clientName;
      }
      return _savePlannedProject(input as Partial<PlannedProject>, edit);
    }
    case 'partners':return remove?_deletePartner(id!):_savePartner(input,edit);
    case 'debts':return remove?_deleteDebt(id!):_saveDebt(input,edit);
    case 'savings':return remove?_deleteSaving(id!):_saveSaving(input,edit);
    default:return fail([{field:'action',message:'Дія не підтримується'}]);
  }
},{source:'Помічник',hint:plan.domain==='payments'?'payment':null});
