'use client';
import { useMemo } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import './ChartSetup';
import Modal from '@/components/ui/Modal';
import { getProjects, getCompleted } from '@/lib/storage';
import { project as calcProject } from '@/lib/calc';
import { formatMoney } from '@/lib/utils';
import type { Project, Specialist } from '@/types';

interface SpecialistStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  specialist: Specialist | null;
}

const TYPE_LABELS: Record<string, string> = { IT: 'IT', Design: 'Дизайн', Video: 'Відео' };
const TYPE_COLORS: Record<string, string> = { IT: '#0A84FF', Design: '#BF5AF2', Video: '#FF9F0A' };

// Місяць, у який проєкт «заробив»: дата завершення, а якщо її немає — старт.
function projectMonth(p: Project): string {
  const raw = p.finishDate || p.endDate || (p.completedAt ? new Date(p.completedAt).toISOString() : '') || p.startDate || p.createdAt || '';
  return String(raw).split('T')[0].slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('uk-UA', { month: 'short' }) + (m === 1 ? ` ${y}` : '');
}

export default function SpecialistStatsModal({ isOpen, onClose, specialist }: SpecialistStatsModalProps) {
  const stats = useMemo(() => {
    if (!specialist) return null;
    // Активні/завершені визначаємо за масивом сховища: статус у завершених
    // проєктах може залишатися «В роботі» (так імпортувався бекап).
    const active = getProjects().filter(p => p.developerId === specialist.id);
    const completed = getCompleted().filter(p => p.developerId === specialist.id);
    const activeCount = active.length;
    // Виплати по проєктах у роботі — показуємо окремо, щоб не змішувати з графіком.
    const activePaid = active.reduce((s, p) => s + (Number(p.paidToSpecialist) || 0), 0);

    let totalPaid = 0, totalMy = 0, totalBudget = 0;
    const byMonth = new Map<string, { spec: number; my: number }>();
    const byType = new Map<string, number>();

    completed.forEach(p => {
      const c = calcProject(p);
      totalPaid += c.paidToSpecialist;
      totalMy += c.myIncome;
      totalBudget += c.budget;
      const mk = projectMonth(p);
      if (mk) {
        const cell = byMonth.get(mk) || { spec: 0, my: 0 };
        cell.spec += c.paidToSpecialist;
        cell.my += c.myIncome;
        byMonth.set(mk, cell);
      }
      byType.set(p.type || 'IT', (byType.get(p.type || 'IT') || 0) + c.myIncome);
    });

    // Останні 12 місяців, у які була активність (від першого проєкту до поточного)
    const months: string[] = [];
    if (byMonth.size) {
      const keys = [...byMonth.keys()].sort();
      const now = new Date();
      let cur = new Date(Number(keys[0].split('-')[0]), Number(keys[0].split('-')[1]) - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      while (cur <= end) {
        months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    }
    const visible = months.slice(-12);
    const specData = visible.map(mk => byMonth.get(mk)?.spec || 0);
    const myData = visible.map(mk => byMonth.get(mk)?.my || 0);

    let bestMonth = ''; let bestVal = 0;
    byMonth.forEach((v, k) => { if (v.my > bestVal) { bestVal = v.my; bestMonth = k; } });

    const avgMyPercent = totalBudget > 0 ? Math.round(totalMy / totalBudget * 100) : 0;
    const monthsCount = byMonth.size || 1;

    return {
      completedCount: completed.length, activeCount, activePaid, totalPaid, totalMy, avgMyPercent,
      labels: visible.map(monthLabel), specData, myData,
      byType: [...byType.entries()],
      bestMonth: bestMonth ? `${monthLabel(bestMonth)} — ${formatMoney(bestVal)}` : '—',
      avgPerMonth: totalMy / monthsCount,
      hasData: completed.length > 0,
    };
  }, [specialist, isOpen]);

  if (!specialist || !stats) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Статистика: ${specialist.name}`} size="lg">
      {!stats.hasData ? (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0' }}>
          Ще немає завершених проєктів з цим фахівцем — графіку поки не буде.
        </p>
      ) : (
        <>
          <div className="dev-stats dev-stats--4" style={{ marginBottom: 20 }}>
            <div className="dev-stat"><div className="dev-stat-label">Завершено</div><div className="dev-stat-value">{stats.completedCount}</div></div>
            <div className="dev-stat"><div className="dev-stat-label">Виплачено йому</div><div className="dev-stat-value">{formatMoney(stats.totalPaid)}</div></div>
            <div className="dev-stat"><div className="dev-stat-label">Мій прибуток</div><div className="dev-stat-value" style={{ color: 'var(--accent-green)' }}>{formatMoney(stats.totalMy)}</div></div>
            <div className="dev-stat"><div className="dev-stat-label">Мій % у середньому</div><div className="dev-stat-value">{stats.avgMyPercent}%</div></div>
          </div>

          <div className="chart-body" style={{ height: 260, marginBottom: 8 }}>
            <Bar
              data={{
                labels: stats.labels,
                datasets: [
                  {
                    label: 'Заробіток фахівця',
                    data: stats.specData,
                    backgroundColor: 'rgba(10, 132, 255, 0.55)',
                    borderColor: '#0A84FF',
                    borderWidth: 1,
                    borderRadius: 4,
                  },
                  {
                    label: 'Мій прибуток',
                    data: stats.myData,
                    backgroundColor: 'rgba(48, 209, 88, 0.5)',
                    borderColor: '#30D158',
                    borderWidth: 1,
                    borderRadius: 4,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#8e8e93', font: { size: 11 }, boxWidth: 12 } } },
                scales: {
                  x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
                  y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
                },
              }}
            />
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', margin: '4px 0 0' }}>
            Усі суми — лише завершені проєкти (графік — за місяцем завершення). Виплати по проєктах у роботі показані окремо внизу.
          </p>

          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <div className="chart-body chart-body--donut" style={{ width: 200, flexShrink: 0 }}>
              <Doughnut
                data={{
                  labels: stats.byType.map(([t]) => TYPE_LABELS[t] || t),
                  datasets: [{
                    data: stats.byType.map(([, v]) => v),
                    backgroundColor: stats.byType.map(([t]) => TYPE_COLORS[t] || '#8E8E93'),
                    borderWidth: 0,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '62%',
                  plugins: { legend: { position: 'right', labels: { color: '#8e8e93', font: { size: 11 }, boxWidth: 12 } } },
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="dev-stat"><div className="dev-stat-label">Мій прибуток за типами проєктів</div></div>
              <div className="dev-stat"><div className="dev-stat-label">Найкращий місяць</div><div className="dev-stat-value" style={{ fontSize: '1rem' }}>{stats.bestMonth}</div></div>
              <div className="dev-stat"><div className="dev-stat-label">Мій прибуток / місяць у середньому</div><div className="dev-stat-value" style={{ fontSize: '1rem' }}>{formatMoney(Math.round(stats.avgPerMonth))}</div></div>
              {stats.activeCount > 0 && (
                <div className="dev-stat">
                  <div className="dev-stat-label">Зараз в роботі (виплачено)</div>
                  <div className="dev-stat-value" style={{ fontSize: '1rem', color: 'var(--accent-blue)' }}>{stats.activeCount} · {formatMoney(stats.activePaid)}</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
