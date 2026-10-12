import type { Client, Partner, Project, Specialist } from '@/types';
import { today } from '@/lib/utils';

// ============================================================
// Пакет 02: копіювання завершеного проєкту як основи нового.
// Чиста функція з allowlist — НЕ spread усього об'єкта.
// Ту саму функцію використовують форма проєкту (кнопка «Копіювати»
// в завершених) і AI-помічник (чернетка projects/create з copyFromId).
//
// Скинуто ЗАВЖДИ: id, createdAt, усі оплати/виплати/забраний прибуток,
// усі дати (старт — сьогодні Kyiv, завершення/оплата/робота — порожні),
// архівні метадані (days/completedAt/workedDays), банк (старий рахунок
// надходжень не є фактом нової оплати) та specialistCost — він у чинних
// формулах РОЗРАХОВУЄТЬСЯ (calc.ts: budgetAfterDeductions − projectProfit),
// а не є збереженим полем виплати, тому історичну суму не переносимо.
//
// clientId — передається тільки тоді, коли картка клієнта ще існує;
// інакше поле відсутнє, щоб збереження не підставляло неіснуючий ID.
// ============================================================

export interface CopyProjectSources {
  clients: Client[];
  specialists: Specialist[];
  partners: Partner[];
}

export interface CopyProjectMissing {
  /** Картку клієнта видалено: ім'я лишається текстом, ID не підставляється. */
  client: boolean;
  /** Фахівця видалено: поле відкривається для повторного вибору. */
  specialist: boolean;
  /** Партнера видалено: поле відкривається для повторного вибору. */
  partner: boolean;
}

export interface CopyProjectResult {
  /** Початкові поля форми нового проєкту (без ID та архівних даних). */
  prefill: Partial<Project>;
  missing: CopyProjectMissing;
}

/**
 * Дозволені умови нового замовлення: їх копія переносить і їх AI може
 * явно уточнити разом із copyFromId. Скинуті поля сюди не потрапляють.
 * `clientId` — явний вибір чинної картки клієнта для копії: він має
 * проходити через overrides (інакше вибір іншого клієнта модель
 * не зможе висловити, а джерельний ID лишився б єдиним).
 */
export const COPY_CONDITION_FIELDS = [
  'name', 'type', 'description', 'budget', 'currency',
  'myPercent', 'fop', 'partnerCommission', 'deadlineDays',
  'clientName', 'clientTelegram', 'clientSource', 'clientId',
  'developerId', 'partnerId',
] as const;

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Побудова початкових полів нового проєкту із завершеного (або активного).
 * Чиста: не читає сховище і нічого не записує — викликач вирішує, коли
 * створювати запис (форма — лише після «Зберегти»; AI — після підтвердження).
 */
export function initialProjectForCopy(source: Project, sources: CopyProjectSources): CopyProjectResult {
  const client = source.clientId ? sources.clients.find(c => c.id === source.clientId) : undefined;
  const specialist = source.developerId ? sources.specialists.find(s => s.id === source.developerId) : undefined;
  const partner = source.partnerId ? sources.partners.find(p => p.id === source.partnerId) : undefined;

  const prefill: Partial<Project> = {
    name: typeof source.name === 'string' ? source.name : '',
    type: source.type || '',
    description: source.description || '',
    budget: finite(source.budget),
    currency: source.currency || 'UAH',
    myPercent: finite(source.myPercent),
    fop: finite(source.fop),
    partnerCommission: finite(source.partnerCommission),
    // Новий стан і нова дата старту — типові для нового проєкту.
    status: 'Очікування оплати',
    startDate: today(),
  };

  // Клієнт: ID — лише якщо картка ще існує; ім'я/telegram/джерело —
  // дозволені поля, лишаються текстом навіть після видалення картки
  // (збереження створить картку заново або власник обере іншого).
  prefill.clientName = source.clientName || (client ? client.name : '');
  prefill.clientTelegram = source.clientTelegram || '';
  prefill.clientSource = source.clientSource || 'Інше';
  if (client) prefill.clientId = source.clientId;

  if (specialist) prefill.developerId = source.developerId;
  if (partner) prefill.partnerId = source.partnerId;

  // Тривалість дедлайну (дні) — умова нового замовлення; конкретні
  // дати дедлайну/завершення не переносяться.
  const deadline = Number(source.deadlineDays);
  if (Number.isFinite(deadline) && deadline >= 0) prefill.deadlineDays = deadline;

  return {
    prefill,
    missing: {
      client: Boolean(source.clientId) && !client,
      specialist: Boolean(source.developerId) && !specialist,
      partner: Boolean(source.partnerId) && !partner,
    },
  };
}

/**
 * З полів AI-чернетки залишити лише дозволені умови; скинуті, службові
 * та службовий copyFromId відкинути. Порожні значення не переносяться,
 * щоб не затирати умови копії порожніми полями. `clientId: null` або
 * порожній рядок не передаються — явним вибором вважається лише
 * непорожній ID чинної картки.
 */
export function pickCopyOverrides(fields: Record<string, unknown>): Partial<Project> {
  const out: Partial<Project> = {};
  for (const key of COPY_CONDITION_FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Тексти попереджень для форми, коли пов'язану сутність видалено. */
export function copyMissingWarnings(source: Project, missing: CopyProjectMissing): string[] {
  const warnings: string[] = [];
  if (missing.client) {
    warnings.push(`Картку клієнта «${source.clientName || source.clientId}» видалено — оберіть клієнта заново або підтвердьте створення картки при збереженні.`);
  }
  if (missing.specialist) {
    warnings.push('Фахівця з цього проєкту більше немає — оберіть фахівця заново (поле порожнє).');
  }
  if (missing.partner) {
    warnings.push('Партнера з цього проєкту більше немає — оберіть партнера заново (поле порожнє).');
  }
  return warnings;
}
