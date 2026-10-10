'use client';
import { Line } from 'react-chartjs-2';
import './ChartSetup';
import type { TooltipItem } from 'chart.js';

export type WeeklyChartMetric = 'income' | 'expense';

interface WeeklyFinanceChartProps {
  labels: string[];
  /** Повні підписи для підказок: «1–4 жовт. (2026-10-01…2026-10-04)». */
  hints: string[];
  data: number[];
  metric: WeeklyChartMetric;
  currency: string;
}

const COLORS: Record<WeeklyChartMetric, { line: string; fill: string }> = {
  income: { line: '#30D158', fill: 'rgba(52, 211, 153, 0.2)' },
  expense: { line: '#FF453A', fill: 'rgba(255, 69, 58, 0.18)' },
};

export default function WeeklyFinanceChart({ labels, hints, data, metric, currency }: WeeklyFinanceChartProps) {
  const color = COLORS[metric];
  return (
    <div className="chart-body">
      <Line
        data={{
          labels,
          datasets: [{
            data,
            borderColor: color.line,
            backgroundColor: color.fill,
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointBackgroundColor: color.line,
            pointRadius: 3,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: items => hints[items[0]?.dataIndex ?? 0] ?? items[0]?.label ?? '',
                label: (item: TooltipItem<'line'>) => {
                  const value = Number(item.raw) || 0;
                  const name = metric === 'income' ? 'Доходи' : 'Витрати';
                  const formatted = value.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
                  return `${name}: ${formatted} ${currency}`;
                },
              },
            },
          },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
          },
        }}
      />
    </div>
  );
}
