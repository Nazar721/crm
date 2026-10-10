// ============================================================
// Тижневий звіт Фінансів: доходи й витрати по тижнях вибраного
// місяця. ЄДИНЕ джерело розрахунків для графіка на сторінці
// Фінансів та для відповідей AI-помічника — формули не дублюються,
// модель транзакції самостійно не підсумовує.
//
// Правила включення записів — ті самі, що в чинних підсумках:
// - доходи: як monthIncome (без прихованих, без project_*, без
//   incoming, без переказів між власними рахунками);
// - витрати: як financeExpenses зі звіту incomeForMonth (без
//   прихованих, без project_*, без переказів).
// Суми — у валюті відображення за чинними курсами CRM.
//
// Тиждень: понеділок — неділя, крайні відрізки обрізаються межами
// місяця (можуть бути неповними). Усі дати — календарні YYYY-MM-DD
// за Europe/Kyiv: рядки без часу не зміщуються через UTC.
// ============================================================

import type { DataSnapshot, FinanceSettings, Transaction } from '@/types';
import { bankAmountToDisplay, monthIncome } from '@/lib/calc';
import { kyivDateString } from '@/lib/dates';
import { today } from '@/lib/utils';
import { getSettings } from '@/lib/settings';

export interface WeekSegment {
  /** Порядковий номер відрізка на графіку (0-based). */
  index: number;
  /** Перший день відрізка, YYYY-MM-DD. */
  start: string;
  /** Останній день відрізка, YYYY-MM-DD. */
  end: string;
  /** Підпис осі, напр. «1–4 жовт.». */
  label: string;
  income: number;
  expense: number;
}

export interface WeeklyFinanceReport {
  monthKey: string;
  year: number;
  month: number;
  currency: string;
  weeks: WeekSegment[];
  totalIncome: number;
  totalExpense: number;
}

export type WeeklyMetric = 'income' | 'expense' | 'both';

export interface WeeklyReportQuery {
  month: string;
  metric: WeeklyMetric;
  /** 0-based номер тижня для запитань виду «другого тижня». */
  weekIndex?: number;
  focus?: 'table' | 'single' | 'best';
}

export const SHORT_MONTHS = ['січ.', 'лют.', 'берез.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'верес.', 'жовт.', 'листоп.', 'груд.'];

export const FULL_MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];

export const WEEKLY_SOURCE = 'Фінанси — транзакції';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Підпис відрізка: «1–4 жовт.», «5–11 жовт.». */
export function formatWeekLabel(startDay: number, endDay: number, month: number): string {
  const name = SHORT_MONTHS[month - 1] || '';
  if (startDay === endDay) return `${startDay} ${name}`;
  return `${startDay}–${endDay} ${name}`;
}

export function monthLabel(monthKey: string): string {
  const m = Number(monthKey.slice(5, 7));
  const y = monthKey.slice(0, 4);
  return `${FULL_MONTHS[m - 1] || ''} ${y}`.trim();
}

/**
 * Відрізки місяця Пн–Нд, обрізані межами місяця. Чиста календарна
 * математика в UTC-полях дати (без зсувів часових поясів).
 */
export function monthWeekSegments(year: number, month: number): Array<{ start: string; end: string; label: string }> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Некоректний місяць звіту');
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const segments: Array<{ start: string; end: string; label: string }> = [];
  let day = 1;
  while (day <= daysInMonth) {
    // getUTCDay: 0 = неділя … 6 = субота; понеділок — початок тижня.
    const mondayBased = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    const end = Math.min(daysInMonth, day + (6 - mondayBased));
    const start = `${year}-${pad(month)}-${pad(day)}`;
    const endStr = `${year}-${pad(month)}-${pad(end)}`;
    segments.push({ start, end: endStr, label: formatWeekLabel(day, end, month) });
    day = end + 1;
  }
  return segments;
}

/** Чи враховується запис у доходах (ті самі умови, що в monthIncome). */
function isCountedIncome(t: Transaction): boolean {
  if (t.hidden) return false;
  if (t.type !== 'income') return false;
  if (t.source && String(t.source).startsWith('project_')) return false;
  if (t.incomeStatus === 'incoming') return false;
  return true;
}

/** Чи враховується запис у витратах (ті самі умови, що в financeExpenses). */
function isCountedExpense(t: Transaction): boolean {
  if (t.hidden) return false;
  if (t.type !== 'expense') return false;
  if (t.source && String(t.source).startsWith('project_')) return false;
  return true;
}


/**
 * Спільний тижневий звіт для графіка й AI-помічника.
 * Місячні підсумки рахуються тим самим проходом і в тому самому
 * порядку, що й monthIncome / financeExpenses, тому біт-в-біт
 * збігаються з чинними місячними підсумками.
 */
export function weeklyFinanceReport(
  transactions: Transaction[],
  monthKey: string,
  settings: FinanceSettings = getSettings(),
): WeeklyFinanceReport {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error('Некоректний місяць звіту');
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const weeks: WeekSegment[] = monthWeekSegments(year, month).map((s, index) => ({
    index,
    start: s.start,
    end: s.end,
    label: s.label,
    income: 0,
    expense: 0,
  }));
  let totalIncome = 0;
  let totalExpense = 0;
  for (const t of transactions ?? []) {
    const countedIncome = isCountedIncome(t);
    if (!countedIncome && !isCountedExpense(t)) continue;
    // Рядки YYYY-MM-DD трактуються як облікова дата без UTC-зсуву
    // (див. lib/dates); моменти з часом — за Europe/Kyiv.
    const date = kyivDateString(t.date || t.plannedDate);
    if (!date || !date.startsWith(monthKey)) continue;
    const day = Number(date.slice(8, 10));
    const week = weeks.find(w => day >= Number(w.start.slice(8, 10)) && day <= Number(w.end.slice(8, 10)));
    if (!week) continue;
    const value = bankAmountToDisplay(t.amount, t.bank, settings);
    if (countedIncome) {
      week.income += value;
      totalIncome += value;
    } else {
      week.expense += value;
      totalExpense += value;
    }
  }
  return {
    monthKey,
    year,
    month,
    currency: settings.displayCurrency || 'UAH',
    weeks,
    totalIncome,
    totalExpense,
  };
}

/** Той самий розрахунок, що й monthIncome — для звірки в тестах. */
export function weeklyMatchesMonthIncome(transactions: Transaction[], monthKey: string, settings: FinanceSettings): boolean {
  return weeklyFinanceReport(transactions, monthKey, settings).totalIncome === monthIncome(transactions, monthKey, settings);
}

/** Поточний місяць за Europe/Kyiv. */
export function currentMonthKey(): string {
  return today().slice(0, 7);
}


// ------------------------------------------------------------
// Розпізнавання запитань помічника про тижневий звіт.
// Тільки читання: команди змін ніколи не перехоплюються.
// ------------------------------------------------------------

const EDIT_RE = /(?:створ|дода[йт]|запиш|видал|змін|онов|редаг|оплат|познач|постав|внес|сплат)/;
const WEEK_RE = /тижд|тижн|потижнев/;
const YEARLY_RE = /(?:за рік|за весь|всі місяц|усі місяц|рік по тижнях|за рік по)/;
const SAME_MONTH_RE = /(?:цей самий|той самий|цей же|цей)\s+місяц/;
const SHORT_ANSWER_RE = /^(?:ні|не так|саме|та|так|ага|давай|покажи|угу)(?:$|[\s.,!?;:])/;
const MONTH_WORDS = ['січ', 'лют', 'берез', 'квіт', 'трав', 'черв', 'лип', 'серп', 'верес', 'жовт', 'листоп', 'груд'];
const EXPENSE_RE = /(?:витрат|потрат|витрач)/;
const INCOME_RE = /(?:дох[іо]д|зароб|прибут)/;
const COMPARE_RE = /(?:порівняй|порівняння|кожен тиждень|по кожному тижню|кожному тижні|доходи мінус витрати)/;
const BEST_RE = /(?:найприбутков|найкращ|найуспішн|найбільш прибутков)/;
// \w у JS — лише ASCII, тому для українських закінчень — явний клас.
const CYR = 'а-яіїєґ\\u2019\\u02BC\\u0027';
const NOT_AFTER_NUM = `[^0-9${CYR}]`;
const ORDINAL_WEEKS: Array<[RegExp, number]> = [
  [new RegExp(`(?:перш[${CYR}]*|1[-\\s]?(?:й|ий))\\s+(?:тижн?[${CYR}]*|нед[${CYR}]*)|(?:тижн?[${CYR}]*|нед[${CYR}]*)\\s*(?:№\\s*)?1${NOT_AFTER_NUM}`), 0],
  [new RegExp(`(?:друг[${CYR}]*|2[-\\s]?(?:й|ий|га))\\s+(?:тижн?[${CYR}]*|нед[${CYR}]*)|(?:тижн?[${CYR}]*|нед[${CYR}]*)\\s*(?:№\\s*)?2${NOT_AFTER_NUM}`), 1],
  [new RegExp(`(?:трет[${CYR}]*|3[-\\s]?(?:й|ій))\\s+(?:тижн?[${CYR}]*|нед[${CYR}]*)|(?:тижн?[${CYR}]*|нед[${CYR}]*)\\s*(?:№\\s*)?3${NOT_AFTER_NUM}`), 2],
  [new RegExp(`(?:четверт[${CYR}]*|4[-\\s]?(?:й|ий))\\s+(?:тижн?[${CYR}]*|нед[${CYR}]*)|(?:тижн?[${CYR}]*|нед[${CYR}]*)\\s*(?:№\\s*)?4${NOT_AFTER_NUM}`), 3],
  [new RegExp(`(?:п[${CYR}]?ят[${CYR}]*|5[-\\s]?(?:й|ий))\\s+(?:тижн?[${CYR}]*|нед[${CYR}]*)|(?:тижн?[${CYR}]*|нед[${CYR}]*)\\s*(?:№\\s*)?5${NOT_AFTER_NUM}`), 4],
];

function matchMonth(value: string): string | null {
  const numeric = value.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (numeric) return numeric[0];
  const index = MONTH_WORDS.findIndex(m => value.includes(m));
  if (index >= 0) return `${value.match(/\b20\d{2}\b/)?.[0] || today().slice(0, 4)}-${String(index + 1).padStart(2, '0')}`;
  if (/(?:цей|поточн|актуальн).{0,12}місяц/.test(value)) return today().slice(0, 7);
  if (/(?:минул|попередн|поперед).{0,12}місяц/.test(value)) {
    const [y, m] = today().slice(0, 7).split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  return null;
}

function parseMetric(lower: string): WeeklyMetric | null {
  const hasExpense = EXPENSE_RE.test(lower);
  const hasIncome = INCOME_RE.test(lower);
  if (COMPARE_RE.test(lower) || BEST_RE.test(lower) || (hasExpense && hasIncome)) return 'both';
  if (hasExpense) return 'expense';
  if (hasIncome) return 'income';
  return null;
}

function parseWeekIndex(lower: string): number | undefined {
  for (const [re, index] of ORDINAL_WEEKS) {
    if (re.test(lower)) return index;
  }
  return undefined;
}

interface ParsedWeekly {
  month: string | null;
  metric: WeeklyMetric | null;
  weekIndex?: number;
  focus: 'table' | 'single' | 'best';
}

/** Розбір одного повідомлення без історії. null — не тижневий запит. */
function parseSingle(lower: string): ParsedWeekly | null {
  if (EDIT_RE.test(lower) || YEARLY_RE.test(lower)) return null;
  if (!WEEK_RE.test(lower)) return null;
  const weekIndex = parseWeekIndex(lower);
  return {
    month: matchMonth(lower),
    metric: parseMetric(lower),
    weekIndex,
    focus: BEST_RE.test(lower) ? 'best' : weekIndex !== undefined ? 'single' : 'table',
  };
}

/**
 * Розпізнає запити виду «доходи по тижнях за жовтень»,
 * «скільки витратив другого тижня липня», «порівняй доходи й витрати»,
 * «який тиждень був найприбутковішим», «а тепер витрати за цей самий
 * місяць». Неоднозначний період (без місяця й без історії) — null,
 * щоб помічник уточнив рік/період.
 */
export function requestedWeeklyReport(
  text: string,
  history: Array<{ role: string; text: string }> = [],
): WeeklyReportQuery | null {
  const lower = text.toLowerCase();
  if (EDIT_RE.test(lower) || YEARLY_RE.test(lower)) return null;
  const users = history.filter(m => m.role === 'user' && typeof m.text === 'string');
  const prevWeeklyText = [...users].reverse().find(m => WEEK_RE.test(m.text.toLowerCase()))?.text.toLowerCase() ?? null;

  // Коротке продовження («та», «ага») повторює попередній тижневий запит.
  if (SHORT_ANSWER_RE.test(lower) && prevWeeklyText) {
    const prev = parseSingle(prevWeeklyText);
    if (prev?.month) {
      const repeated: WeeklyReportQuery = { month: prev.month, metric: prev.metric ?? 'both', focus: prev.focus };
      if (prev.weekIndex !== undefined) repeated.weekIndex = prev.weekIndex;
      return repeated;
    }
  }

  const hasWeek = WEEK_RE.test(lower);
  // «А тепер витрати за цей самий місяць» — продовження тижневої теми
  // без слова «тиждень»: потрібні явне посилання на місяць з історії
  // та метрика в поточному повідомленні.
  if (!hasWeek && !(SAME_MONTH_RE.test(lower) && prevWeeklyText)) return null;
  if (!hasWeek && !prevWeeklyText) return null;

  const current = hasWeek ? parseSingle(lower) : null;
  if (hasWeek && !current) return null;

  const prevParsed = prevWeeklyText ? parseSingle(prevWeeklyText) : null;

  // Місяць: явний у тексті → «цей самий місяць» з історії → місяць
  // з попередніх повідомлень для продовження теми.
  let month = current?.month ?? null;
  if (!month && (SAME_MONTH_RE.test(lower) || hasWeek)) {
    month = prevParsed?.month ?? null;
    if (!month) {
      for (const m of [...users].reverse()) {
        month = matchMonth(m.text.toLowerCase());
        if (month) break;
      }
    }
  }
  if (!month) return null;

  const metric = current?.metric ?? parseMetric(lower) ?? prevParsed?.metric ?? 'both';
  const weekIndex = current?.weekIndex;
  // Продовження «цей самий місяць» з новою метрикою — це таблиця
  // за місяць, а не повтор номера тижня з історії.
  const focus: ParsedWeekly['focus'] = current && (current.focus !== 'table' || current.weekIndex !== undefined || current.month)
    ? current.focus
    : 'table';
  return weekIndex === undefined ? { month, metric, focus } : { month, metric, weekIndex, focus };
}

// ------------------------------------------------------------
// Готова відповідь помічника з явним джерелом даних.
// ------------------------------------------------------------

function formatSum(n: number, currency: string): string {
  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n)} ${currency}`;
}

export function weeklyFinanceReply(s: DataSnapshot, q: WeeklyReportQuery): { kind: 'text'; text: string } {
  const report = weeklyFinanceReport(s.transactions, q.month, s.financeSettings);
  const money = (n: number) => formatSum(n, report.currency);
  const title = q.metric === 'income'
    ? `Доходи по тижнях — ${monthLabel(q.month)}`
    : q.metric === 'expense'
      ? `Витрати по тижнях — ${monthLabel(q.month)}`
      : `Доходи й витрати по тижнях — ${monthLabel(q.month)}`;

  const rows = report.weeks.map(w => {
    const diff = w.income - w.expense;
    return `| ${w.index + 1} | ${w.start.slice(8, 10)}–${w.end.slice(8, 10)} ${SHORT_MONTHS[report.month - 1]} (${w.start}…${w.end}) | ${money(w.income)} | ${money(w.expense)} | ${money(diff)} |`;
  });
  const totalDiff = report.totalIncome - report.totalExpense;
  const table = [
    '| Тиждень | Дати | Доходи | Витрати | Різниця |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows,
    `| Разом за місяць | — | ${money(report.totalIncome)} | ${money(report.totalExpense)} | ${money(totalDiff)} |`,
  ].join('\n');

  const source = `Джерело: ${WEEKLY_SOURCE}.`;
  const note = 'Різниця — це «Доходи мінус витрати» за тиждень, а не чистий прибуток агенції.';
  const rates = 'Суми у валюті відображення за чинними курсами CRM.';

  if (q.weekIndex !== undefined) {
    const week = report.weeks[q.weekIndex];
    if (!week) {
      return {
        kind: 'text',
        text: `**${title}**\n\nУ ${monthLabel(q.month)} лише ${report.weeks.length} тижні (1–${report.weeks.length}). Уточни номер тижня.\n\n${table}\n\n${source} ${note} ${rates}`,
      };
    }
    const diff = week.income - week.expense;
    return {
      kind: 'text',
      text: `**${title}**\n\nТиждень №${week.index + 1} (${week.start}…${week.end}, «${week.label}»): доходи ${money(week.income)}, витрати ${money(week.expense)}, різниця (доходи мінус витрати) ${money(diff)}.\n\n${table}\n\n${source} ${note} ${rates}`,
    };
  }

  if (q.focus === 'best') {
    let best = report.weeks[0];
    for (const w of report.weeks) {
      if (w.income - w.expense > best.income - best.expense) best = w;
    }
    const bestDiff = best.income - best.expense;
    return {
      kind: 'text',
      text: `**${title}**\n\nНайприбутковіший — тиждень №${best.index + 1} (${best.start}…${best.end}, «${best.label}»): різниця (доходи мінус витрати) ${money(bestDiff)}.\n\n${table}\n\n${source} ${note} ${rates}`,
    };
  }

  const summary = q.metric === 'income'
    ? `Разом доходів за місяць: ${money(report.totalIncome)}.`
    : q.metric === 'expense'
      ? `Разом витрат за місяць: ${money(report.totalExpense)}.`
      : `Разом за місяць: доходи ${money(report.totalIncome)}, витрати ${money(report.totalExpense)}.`;
  const empty = report.totalIncome === 0 && report.totalExpense === 0
    ? '\n\nТранзакцій за цей місяць немає.'
    : '';
  return {
    kind: 'text',
    text: `**${title}**\n\n${summary}${empty}\n\n${table}\n\n${source} ${note} ${rates}`,
  };
}
