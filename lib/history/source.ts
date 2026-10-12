import type { HistoryAction, HistorySource } from './types';

// ============================================================
// Контекст запису: звідки береться джерело/дія поточної операції.
// Джерело — інформаційний атрибут події; автора й дозволи визначає
// СЕРВЕР (auth.uid + crm_owners), а не цей прапорець.
//
// Контекст — модульна змінна з явним відновленням (finally). У застосунку
// записи серіалізуються через actionQueue/один потік UI, тому перетин
// потоків малоймовірний; при вкладеності зберігається попереднє значення.
// ============================================================

/** Дозволені значення, які клієнт передає серверу як p_source. */
export type WriteSource = Extract<HistorySource, 'Форма' | 'Помічник' | 'Імпорт' | 'Система'>;

export interface WriteContext {
  source: WriteSource;
  /** Необов'язковий підказуваний тип дії (напр. 'payment'); контент події визначає різниця даних. */
  hint?: HistoryAction | null;
}

const DEFAULT_CONTEXT: WriteContext = { source: 'Форма' };
let current: WriteContext = DEFAULT_CONTEXT;

export function getWriteContext(): WriteContext {
  return current;
}

export function runWithWriteContext<T>(ctx: Partial<WriteContext> | null | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = current;
  current = { source: ctx?.source ?? previous.source, hint: ctx?.hint ?? (ctx?.source ? null : previous.hint) };
  return Promise.resolve()
    .then(fn)
    .finally(() => { current = previous; });
}

/** Скидання контексту (тести/перезапуск). */
export function resetWriteContext(): void {
  current = DEFAULT_CONTEXT;
}
