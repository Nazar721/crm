import type { FinanceSettings, Specialist } from '@/types';
import { rateForCurrency } from '@/lib/calc';
import { toFiniteNumber } from '@/lib/validate';

// ============================================================
// Правило «Моя частка»: автоматичний відсоток фахівця у проєкті.
// Поріг порівнюється з ПОВНИМ бюджетом проєкту у гривневому
// еквіваленті (не з передоплатою чи залишком оплати).
//
// У проєкті зберігається КОНКРЕТНЕ значення myPercent, тому зміна
// налаштувань фахівця не перераховує вже збережені проєкти.
// ============================================================

export interface MyShareRule {
  /** Поріг бюджету, грн. Відсоток до порогу — включно. */
  threshold: number;
  /** Відсоток до порогу включно (0–100). */
  percentUpTo: number;
  /** Відсоток понад поріг (0–100). */
  percentAbove: number;
}

/** Початкове правило для фахівців без налаштувань (і тестів). */
export const DEFAULT_MY_SHARE: MyShareRule = {
  threshold: 3000,
  percentUpTo: 30,
  percentAbove: 25,
};

function validThreshold(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function validPercent(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

/**
 * Налаштування фахівця. Відсутнє або некоректне поле замінюється
 * початковим значенням — старі записи без цих полів сумісні.
 */
export function resolveMyShare(specialist?: Partial<Specialist> | null): MyShareRule {
  return {
    threshold: validThreshold(specialist?.myShareThreshold) ?? DEFAULT_MY_SHARE.threshold,
    percentUpTo: validPercent(specialist?.mySharePercentUpTo) ?? DEFAULT_MY_SHARE.percentUpTo,
    percentAbove: validPercent(specialist?.mySharePercentAbove) ?? DEFAULT_MY_SHARE.percentAbove,
  };
}

/**
 * Автоматичний «Мій %» для проєкту за правилом фахівця.
 * Повертає `null` (відсоток НЕ підставляється), якщо фахівця не вибрано
 * або бюджет некоректний: порожній, не число, від'ємний або NaN/Infinity.
 */
export function autoMyPercent(
  specialist: Partial<Specialist> | null | undefined,
  budget: unknown,
  currency: string | undefined,
  settings?: FinanceSettings,
): number | null {
  if (!specialist) return null;
  const amount = toFiniteNumber(budget);
  if (amount === null || amount < 0) return null;
  const uah = amount * rateForCurrency(currency || 'UAH', settings);
  if (!Number.isFinite(uah)) return null;
  const rule = resolveMyShare(specialist);
  return uah <= rule.threshold ? rule.percentUpTo : rule.percentAbove;
}