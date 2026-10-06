import { normalizeBank } from '@/lib/banks';
import { generateId } from '@/lib/utils';
import * as store from '@/lib/store';
import { isMigrationApplied, markMigrationApplied } from '@/lib/migration-flags';
import type { Client, Project, Saving, Specialist, Transaction } from '@/types';
import type { CollectionKey } from '@/lib/datasource/types';

// ============================================================
// Міграції виконуються ОДИН РАЗ на версію (прапорець у localStorage).
// Раніше частину переписувань (stripProject/партнери/фахівці) виконували
// безумовно при кожному завантаженні — це перезаписувало дані й
// видаляло поля, які користувач заповнив вручну.
// ============================================================

export interface Migration {
  id: string;
  title: string;
  run: () => void | Promise<void>;
}

/**
 * Запис під час міграції. Відмова НЕ є винятком іззовні — тому тут вона
 * перетворюється на виняток, щоб міграція НЕ позначилась виконаною.
 */
async function saveOrThrow(key: CollectionKey, value: unknown[]): Promise<void> {
  const result = await store.saveCollection(key, value, 'system');
  if (!result.ok) throw new Error(result.issue.message);
}

function stripProject(p: Project): Project {
  const raw = { ...p } as Record<string, unknown>;
  delete raw.myIncome;
  delete raw.projectProfit;
  delete raw.clientDebt;
  delete raw.specialistDebt;
  delete raw.remainingPayment;
  if (raw.prepayment == null) raw.prepayment = 0;
  if (raw.paidToSpecialist == null) raw.paidToSpecialist = 0;
  if (raw.myPercent == null) raw.myPercent = 0;
  if (raw.profitTaken == null) raw.profitTaken = 0;
  if (raw.partnerCommission == null) raw.partnerCommission = 0;
  if (!raw.partnerId) raw.partnerId = '';
  return raw as unknown as Project;
}

const TYPE_MAP: Record<string, string> = {
  'Landing Page': 'IT',
  'Корпоративний сайт': 'IT',
  'Інтернет-магазин': 'IT',
  'Дизайн': 'Design',
  'Інше': 'IT',
};

export const MIGRATIONS: Migration[] = [
  {
    id: 'v11',
    title: 'Прибрано зайві поля з фахівців',
    run: async () => {
      const list = store.getSnapshot().specialists.map(s => {
        const raw = { ...s } as Record<string, unknown>;
        if (raw.paidToSpecialist != null) delete raw.paidToSpecialist;
        if (raw.debt != null) delete raw.debt;
        return raw as unknown as Specialist;
      });
      await saveOrThrow('specialists', list);
    },
  },
  {
    id: 'v21',
    title: 'Нормалізація проєктів та партнерів (один раз)',
    run: async () => {
      const snap = store.getSnapshot();
      await saveOrThrow('projectsActive', snap.projectsActive.map(stripProject));
      await saveOrThrow('projectsCompleted', snap.projectsCompleted.map(stripProject));
      await saveOrThrow('partners', snap.partners.map(p => ({
        ...p,
        givenProjectsCount: p.givenProjectsCount ?? 0,
        givenProjectsPrice: p.givenProjectsPrice ?? 0,
        ourCommission: p.ourCommission ?? 0,
        paidToUs: p.paidToUs ?? 0,
      })));
    },
  },
  {
    id: 'v13',
    title: 'Нормалізація типів проєктів',
    run: async () => {
      const snap = store.getSnapshot();
      const mapType = (p: Project) => (p.type && TYPE_MAP[p.type] ? { ...p, type: TYPE_MAP[p.type] } : p);
      await saveOrThrow('projectsActive', snap.projectsActive.map(mapType));
      await saveOrThrow('projectsCompleted', snap.projectsCompleted.map(mapType));
    },
  },
  {
    id: 'v14',
    title: 'Нормалізація рахунків',
    run: async () => {
      const snap = store.getSnapshot();
      await saveOrThrow('transactions', snap.transactions.map((t: Transaction) => ({ ...t, bank: normalizeBank(t.bank) || t.bank })));
      await saveOrThrow('savings', snap.savings.map((s: Saving) => ({ ...s, bank: normalizeBank(s.bank) || s.bank })));
    },
  },
  {
    id: 'v15',
    title: 'Статуси доходів',
    run: async () => {
      const cutoff = new Date('2026-07-01');
      await saveOrThrow('transactions', store.getSnapshot().transactions.map(t => {
        if (t.type === 'income' && !t.incomeStatus) {
          const d = new Date(t.date || t.plannedDate || '');
          if (!isNaN(d.getTime()) && d < cutoff) return { ...t, incomeStatus: 'earned' as const };
        }
        return t;
      }));
    },
  },
  {
    id: 'v16',
    title: 'Комісія партнера у відсотках',
    run: async () => {
      const convert = (p: Project): Project => {
        const pc = Number(p.partnerCommission) || 0;
        const budget = Number(p.budget) || 0;
        if (pc > 0 && pc <= 100) return p;
        if (pc > 0 && budget > 0 && pc <= budget) {
          return { ...p, partnerCommission: Math.round(pc / budget * 100) };
        }
        return p;
      };
      const snap = store.getSnapshot();
      await saveOrThrow('projectsActive', snap.projectsActive.map(convert));
      await saveOrThrow('projectsCompleted', snap.projectsCompleted.map(convert));
    },
  },
  {
    id: 'v17',
    title: 'Прив’язка клієнтів до проєктів',
    run: async () => {
      const snap = store.getSnapshot();
      const clients: Client[] = [...snap.clients];
      let changed = false;
      const link = (p: Project): Project => {
        if (p.clientId || !p.clientName) return p;
        const nameLower = String(p.clientName).toLowerCase().trim();
        const existing = clients.find(c => c.name.toLowerCase().trim() === nameLower);
        if (existing) return { ...p, clientId: existing.id };
        const created: Client = {
          id: generateId(),
          name: p.clientName,
          telegram: p.clientTelegram || '',
          source: p.clientSource || 'Інше',
          createdAt: p.createdAt || new Date().toISOString(),
        };
        clients.push(created);
        changed = true;
        return { ...p, clientId: created.id };
      };
      await saveOrThrow('projectsActive', snap.projectsActive.map(link));
      await saveOrThrow('projectsCompleted', snap.projectsCompleted.map(link));
      if (changed) await saveOrThrow('clients', clients);
    },
  },
  {
    id: 'v18',
    title: 'Відлік дедлайну лише «В роботі»',
    run: async () => {
      const migrateWorkStart = (p: Project): Project => {
        const raw = { ...p } as Record<string, unknown>;
        if (raw.workedDays == null) raw.workedDays = 0;
        if (raw.status === 'В роботі') {
          if (!raw.workStartDate) {
            raw.workStartDate = raw.startDate || (raw.createdAt ? String(raw.createdAt).split('T')[0] : '');
          }
        } else {
          delete raw.workStartDate;
        }
        return raw as unknown as Project;
      };
      const snap = store.getSnapshot();
      await saveOrThrow('projectsActive', snap.projectsActive.map(migrateWorkStart));
      await saveOrThrow('projectsCompleted', snap.projectsCompleted.map(migrateWorkStart));
    },
  },
  {
    id: 'v19',
    title: 'Прибрано старий модуль лідогенерації',
    run: async () => {
      try {
        localStorage.removeItem('leadgen_leads');
        localStorage.removeItem('leadgen_filters');
      } catch {
        // Службові ключі — не критично.
      }
    },
  },
  {
    id: 'v20',
    title: 'Дата створення клієнтів',
    run: async () => {
      const snap = store.getSnapshot();
      const allProjects = [...snap.projectsActive, ...snap.projectsCompleted];
      let changed = false;
      const clients = snap.clients.map(c => {
        if (c.createdAt) return c;
        const earliest = allProjects
          .filter(p => p.clientId === c.id)
          .map(p => p.createdAt)
          .filter(Boolean)
          .sort()[0];
        changed = true;
        return { ...c, createdAt: earliest || new Date().toISOString() };
      });
      if (changed) await saveOrThrow('clients', clients);
    },
  },
];

export interface MigrationReport {
  applied: string[];
  skipped: string[];
  /** Міграції, що НЕ виконалися. Прапорці для них не ставляться. */
  failed: string[];
}

/**
 * Запускає лише ті міграції, які ще не застосовані до поточної версії.
 *
 * - прапорець версії ставиться ТІЛЬКИ після успішного виконання;
 * - після першої відмови ланцюжок зупиняється (подальші міграції можуть
 *   спиратися на невиконану), невиконані потрапляють у `failed`;
 * - асинхронний: чекає записів, щоб споживачі бачили актуальні дані.
 */
export async function migrate(): Promise<MigrationReport> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  if (typeof window === 'undefined') return { applied, skipped, failed };

  for (const migration of MIGRATIONS) {
    if (isMigrationApplied(migration.id)) {
      skipped.push(migration.id);
      continue;
    }
    try {
      await migration.run();
      markMigrationApplied(migration.id);
      applied.push(migration.id);
    } catch (err) {
      console.error(`Міграція ${migration.id} не виконалася:`, err);
      failed.push(migration.id);
      // Прапорець не ставимо; подальші міграції не запускаємо.
      break;
    }
  }
  // Синхронізація блокування запису: допоки потрібна міграція не
  // виконалася, редагування даних заблоковане — незалежно від того, хто
  // викликав migrate(): сторінка, імпорт чи тест.
  store.setMigrationBlock(
    failed.length
      ? `Міграції не застосовано: ${failed.join(', ')}. Запис даних заблоковано до виправлення.`
      : null,
  );
  return { applied, skipped, failed };
}

/** Сумісна обгортка (той самий виклик, що й migrate). */
export const runMigrations = migrate;
