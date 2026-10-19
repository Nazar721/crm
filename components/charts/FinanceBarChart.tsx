'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, CHART_LEGEND, CHART_TOOLTIP, CHART_X, CHART_Y } from './ChartSetup';

export type FinanceMode = 'both' | 'in' | 'out' | 'net';

interface FinanceBarChartProps {
  labels: string[];
  incomeData: number[];
  expenseData: number[];
  /** 'both' — дві серії (дефолт, сумісно зі старими викликами). */
  mode?: FinanceMode;
}

const MODE_LABEL: Record<FinanceMode, string> = {
  both: 'Надходження / витрати',
  in: 'Надходження',
  out: 'Витрати',
  net: 'Сальдо',
};

export default function FinanceBarChart({ labels, incomeData, expenseData, mode = 'both' }: FinanceBarChartProps) {
  const datasets =
    mode === 'both'
      ? [
          { label: 'Надходження', data: incomeData, backgroundColor: CHART.incomeFill, borderColor: CHART.income, borderWidth: 1, borderRadius: 4 },
          { label: 'Витрати', data: expenseData, backgroundColor: CHART.expenseFill, borderColor: CHART.expense, borderWidth: 1, borderRadius: 4 },
        ]
      : mode === 'in'
        ? [{ label: 'Надходження', data: incomeData, backgroundColor: CHART.incomeFill, borderColor: CHART.income, borderWidth: 1, borderRadius: 4 }]
        : mode === 'out'
          ? [{ label: 'Витрати', data: expenseData, backgroundColor: CHART.expenseFill, borderColor: CHART.expense, borderWidth: 1, borderRadius: 4 }]
          : [
              {
                label: 'Сальдо',
                data: incomeData.map((v, i) => v - (expenseData[i] ?? 0)),
                backgroundColor: CHART.accentFill,
                borderColor: CHART.accent,
                borderWidth: 1,
                borderRadius: 4,
              },
            ];

  return (
    <div className="chart-body" role="img" aria-label={`${MODE_LABEL[mode]}, останні 12 місяців`}>
      <Bar
        data={{ labels, datasets }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: CHART_LEGEND, tooltip: CHART_TOOLTIP },
          scales: { x: CHART_X, y: CHART_Y },
        }}
      />
    </div>
  );
}
