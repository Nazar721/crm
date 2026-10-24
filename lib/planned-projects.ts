import type { PlannedProject } from '@/types';
import { calendarDaysBetween, kyivDateString, todayKyiv } from '@/lib/dates';

/** Date-only values avoid timezone shifts and invalid imported dates. */
export function isPlannedDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && kyivDateString(value) === value;
}

export function plannedDaysLeft(project: Pick<PlannedProject, 'plannedDate'>, day = todayKyiv()): number | null {
  return isPlannedDate(project.plannedDate) ? calendarDaysBetween(day, project.plannedDate) : null;
}

/** Upcoming means today through two calendar days ahead; old dates do not stay lit. */
export function plannedDueCount(projects: PlannedProject[], day = todayKyiv()): number {
  return projects.filter(project => {
    const days = plannedDaysLeft(project, day);
    return days !== null && days >= 0 && days <= 2;
  }).length;
}
