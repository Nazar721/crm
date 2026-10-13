import type { Task, TaskPriority, TaskStatus } from '@/types';
import { kyivDateTimeToIso, todayKyiv } from '@/lib/dates';
import { validateRequiredText } from '@/lib/validate';

// ============================================================
// Пакет 05: спільні розрахунки завдань і нагадувань (UI + AI).
// Дата/час введення — календарні Kyiv; момент нагадування зберігається
// як однозначний ISO-інстант (див. kyivDateTimeToIso). Завдання без
// дедлайну НІКОЛИ не є простроченими; день без часу прострочується
// наступного дня Kyiv; завдання з часом — після визначеного моменту.
// Виконання завдання «оплатити» не створює жодних транзакцій.
// ============================================================

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export const TASK_STATUSES = ['planned', 'done', 'cancelled'] as const;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Низький',
  normal: 'Звичайний',
  high: 'Високий',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  planned: 'Заплановано',
  done: 'Виконано',
  cancelled: 'Скасовано',
};

/** Вкладки сторінки: виконані й скасовані показуються разом. */
export type TaskTab = 'today' | 'future' | 'overdue' | 'finished';

export interface TaskSchedule {
  /** Вкладка/група завдання за дедлайном (для finished переважає статус). */
  bucket: 'done' | 'cancelled' | 'today' | 'future' | 'overdue';
  overdue: boolean;
  /** Момент дедлайну як інстант; null — без часу або без дедлайну. */
  dueInstant: Date | null;
  /** Нагадування наставе і ще не показане — кандидат на показ. */
  reminderDue: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function isValidTaskDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isValidTaskTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function taskSchedule(task: Task, now: Date = new Date()): TaskSchedule {
  const reminderDue = Boolean(task.reminderAt) && !task.reminderShownAt
    && Number.isFinite(Date.parse(String(task.reminderAt))) && Date.parse(String(task.reminderAt)) <= now.getTime();
  if (task.status === 'done') return { bucket: 'done', overdue: false, dueInstant: null, reminderDue: false };
  if (task.status === 'cancelled') return { bucket: 'cancelled', overdue: false, dueInstant: null, reminderDue: false };

  const today = todayKyiv(now);
  const dueDate = typeof task.dueDate === 'string' ? task.dueDate : '';
  if (!isValidTaskDate(dueDate)) {
    // Без дедлайну — не прострочене; показується в «майбутніх» як без строку.
    return { bucket: 'future', overdue: false, dueInstant: null, reminderDue };
  }

  const dueTime = typeof task.dueTime === 'string' ? task.dueTime : '';
  if (isValidTaskTime(dueTime)) {
    const iso = kyivDateTimeToIso(dueDate, dueTime);
    const dueInstant = iso ? new Date(iso) : null;
    if (dueInstant) {
      const overdue = now.getTime() > dueInstant.getTime();
      const bucket = overdue ? 'overdue' : (dueDate === today ? 'today' : 'future');
      return { bucket, overdue, dueInstant, reminderDue };
    }
  }
  // День без часу: прострочення з наступного дня Kyiv (сам день ще триває).
  if (dueDate < today) return { bucket: 'overdue', overdue: true, dueInstant: null, reminderDue };
  return { bucket: dueDate === today ? 'today' : 'future', overdue: false, dueInstant: null, reminderDue };
}

/** Нагадування наставе: плановане, з моментом, що минув, і ще не показане. */
export function isReminderDue(task: Task, now: Date = new Date()): boolean {
  if (task.status !== 'planned') return false;
  return taskSchedule(task, now).reminderDue;
}

export function dueReminders(tasks: Task[], now: Date = new Date()): Task[] {
  return tasks.filter(t => isReminderDue(t, now));
}

/** Позначити показані нагадування (одна група журналу на весь прогін). */
export function reminderIdsToMark(tasks: Task[], now: Date = new Date()): string[] {
  return dueReminders(tasks, now).map(t => t.id);
}

export interface TaskCounts {
  today: number;
  future: number;
  overdue: number;
  finished: number;
  dueReminders: number;
}

export function taskCounts(tasks: Task[], now: Date = new Date()): TaskCounts {
  const counts: TaskCounts = { today: 0, future: 0, overdue: 0, finished: 0, dueReminders: 0 };
  for (const task of tasks) {
    const schedule = taskSchedule(task, now);
    if (schedule.bucket === 'done' || schedule.bucket === 'cancelled') counts.finished += 1;
    else if (schedule.bucket === 'today') counts.today += 1;
    else if (schedule.bucket === 'overdue') counts.overdue += 1;
    else counts.future += 1;
    if (schedule.reminderDue) counts.dueReminders += 1;
  }
  return counts;
}

export function filterTasks(
  tasks: Task[],
  filters: { tab?: TaskTab; query?: string; priority?: TaskPriority | ''; now?: Date },
): { task: Task; schedule: TaskSchedule }[] {
  const now = filters.now ?? new Date();
  const query = (filters.query ?? '').trim().toLowerCase();
  return tasks
    .map(task => ({ task, schedule: taskSchedule(task, now) }))
    .filter(({ task, schedule }) => {
      if (filters.priority && task.priority !== filters.priority) return false;
      if (filters.tab === 'finished' && schedule.bucket !== 'done' && schedule.bucket !== 'cancelled') return false;
      if (filters.tab === 'today' && schedule.bucket !== 'today') return false;
      if (filters.tab === 'future' && schedule.bucket !== 'future') return false;
      if (filters.tab === 'overdue' && schedule.bucket !== 'overdue') return false;
      if (query) {
        const haystack = `${task.title} ${task.description || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Прострочені/сьогоднішні — першими; далі за дедлайном, без строку — в кінці.
      const rank = (s: TaskSchedule): number =>
        s.bucket === 'overdue' ? 0 : s.bucket === 'today' ? 1 : s.dueInstant ? 2 : 3;
      const ra = rank(a.schedule);
      const rb = rank(b.schedule);
      if (ra !== rb) return ra - rb;
      const da = a.schedule.dueInstant?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const db = b.schedule.dueInstant?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.task.title.localeCompare(b.task.title);
    });
}

// ------------------------------------------------------------
// Валідація та нормалізація (форма + AI).
// ------------------------------------------------------------

export function validateTaskInput(
  input: Partial<Task>,
  options: { requireTitle?: boolean } = {},
): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  if (options.requireTitle ?? true) {
    errors.push(...validateRequiredText(input.title, 'title', 'Назва завдання', 300));
  } else if (input.title !== undefined && !String(input.title).trim()) {
    errors.push({ field: 'title', message: 'Назва не може бути порожньою' });
  }
  if (input.priority !== undefined && String(input.priority) !== '' && !(TASK_PRIORITIES as readonly string[]).includes(String(input.priority))) {
    errors.push({ field: 'priority', message: 'Пріоритет: low, normal або high' });
  }
  if (input.status !== undefined && String(input.status) !== '' && !(TASK_STATUSES as readonly string[]).includes(String(input.status))) {
    errors.push({ field: 'status', message: 'Статус: planned, done або cancelled' });
  }
  if (input.dueDate && !isValidTaskDate(input.dueDate)) errors.push({ field: 'dueDate', message: 'Дата дедлайну: YYYY-MM-DD (Kyiv)' });
  if (input.dueTime && !isValidTaskTime(input.dueTime)) errors.push({ field: 'dueTime', message: 'Час дедлайну: HH:MM (Kyiv)' });
  return errors;
}

/**
 * Побудова полів дат/нагадування з календарних значень Kyiv (форма та AI).
 * Нагадування виникає ЛИШЕ за наявності явної дати й часу нагадування —
 * випадкова година не вигадується; дедлайн не змінюється мовчки.
 */
export function taskDateTimeFields(input: {
  dueDate?: string; dueTime?: string; reminderDate?: string; reminderTime?: string;
}): Pick<Task, 'dueDate' | 'dueTime' | 'reminderAt'> {
  const out: Pick<Task, 'dueDate' | 'dueTime' | 'reminderAt'> = {};
  if (input.dueDate && isValidTaskDate(input.dueDate)) {
    out.dueDate = input.dueDate;
    if (input.dueTime && isValidTaskTime(input.dueTime)) out.dueTime = input.dueTime;
  }
  if (input.reminderDate && isValidTaskDate(input.reminderDate) && input.reminderTime && isValidTaskTime(input.reminderTime)) {
    const iso = kyivDateTimeToIso(input.reminderDate, input.reminderTime);
    if (iso) out.reminderAt = iso;
  }
  return out;
}

/** «Нагадати пізніше»: новий момент; дедлайн завдання не змінюється. */
export function snoozeReminderIso(newDate: string, newTime: string, now: Date = new Date()): string | null {
  const iso = kyivDateTimeToIso(newDate, newTime);
  if (!iso) return null;
  if (Date.parse(iso) <= now.getTime()) return null; // лише майбутній момент
  return iso;
}

// ------------------------------------------------------------
// Налаштування сповіщень у застосунку (presentation-преф, не дані).
// Не є дозволом системи; не журналюється.
// ------------------------------------------------------------

const NOTIFY_PREF_KEY = 'tasks:reminders-enabled';

export function inAppRemindersEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(NOTIFY_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setInAppRemindersEnabled(enabled: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(NOTIFY_PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    // Без доступу до сховища преф залишається типовим (увімкнено).
  }
}

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as { Notification?: unknown }).Notification !== 'undefined';
}
