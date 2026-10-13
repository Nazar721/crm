import type { Task } from '@/types';
import { dueReminders } from '@/lib/tasks';

// ============================================================
// Оркестрація показу нагадувань (пакет 05, огляд 04–06).
// Чистий модуль без DOM: показ ВСІХ наявних due (без прихованого
// slice), позначка ЛИШЕ реально показаних; in-flight guard проти
// одночасних перевірок (interval/focus/visibility); прихована
// вкладка не споживає нагадування; збій позначки — без сліпого
// повтору, з явним callback для синхронізації стану.
// ============================================================

export interface ReminderDeliveryInput {
  tasks: Task[];
  now?: Date;
  enabled: boolean;
  /** Документ видимий (прихована вкладка не споживає нагадування). */
  visible: boolean;
  /** Показ в заявленому каналі (інтерфейс CRM). */
  deliver: (task: Task) => void;
  /** Позначка показу (стійкий стан); ok=false → без повторного показу в цій же перевірці. */
  claim: (ids: string[]) => Promise<{ ok: boolean }>;
  /** Викликається, коли позначка не вдалася (stale revision/конкурентна доставка) — синхронізувати стан, без сліпого повтору. */
  onClaimFailed?: () => void;
}

export interface ReminderDeliveryResult {
  shown: string[];
  claimed: string[];
  skipped?: 'disabled' | 'hidden' | 'none';
}

/**
 * Захист від одночасних перевірок: interval/focus/visibility можуть
 * стартувати, поки попередня перевіка ще показує/позначає пачку.
 */
export function createReminderDeliveryGate() {
  let running = false;
  return {
    async run<T>(fn: () => Promise<T>): Promise<T | 'in-flight'> {
      if (running) return 'in-flight';
      running = true;
      try {
        return await fn();
      } finally {
        running = false;
      }
    },
  };
}

/**
 * Показує ВСІ наявні due-нагадування й позначає лише реально показані.
 * Виконані/скасовані/показані/перенесені не доставляються (dueReminders).
 */
export async function deliverDueReminders(input: ReminderDeliveryInput): Promise<ReminderDeliveryResult> {
  if (!input.enabled) return { shown: [], claimed: [], skipped: 'disabled' };
  // Не споживати нагадування у прихованій вкладці: показ став би невидимим,
  // а позначка — незворотною втратою.
  if (!input.visible) return { shown: [], claimed: [], skipped: 'hidden' };
  const due = dueReminders(input.tasks, input.now);
  if (!due.length) return { shown: [], claimed: [], skipped: 'none' };

  const shown: string[] = [];
  for (const task of due) {
    try {
      input.deliver(task);
      shown.push(task.id);
    } catch {
      // Збій показу одного не блокує решту; показане вважається доставленим.
    }
  }
  if (!shown.length) return { shown: [], claimed: [] };

  const result = await input.claim(shown);
  if (!result.ok) {
    // Конкурентна доставка/stale revision: без сліпого повтору; стан синхронізує виклик.
    input.onClaimFailed?.();
    return { shown, claimed: [] };
  }
  return { shown, claimed: shown };
}
