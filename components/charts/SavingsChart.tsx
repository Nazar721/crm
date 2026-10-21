'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, CHART_LEGEND, CHART_TOOLTIP, CHART_X, CHART_Y, chartAnimation } from './ChartSetup';

interface SavingsChartProps {
  labels: string[];
  saved: number[];
  remaining: number[];
}

export default function SavingsChart({ labels, saved, remaining }: SavingsChartProps) {
  return (
    <div className="chart-body" role="img" aria-label="Прогрес по цілях відкладень: відкладено і залишилось">
      <Bar
        data={{
          labels,
          datasets: [
            { label: 'Відкладено', data: saved, backgroundColor: CHART.incomeFill, borderColor: CHART.income, borderWidth: 1, borderRadius: 4 },
            { label: 'Залишилось', data: remaining, backgroundColor: CHART.neutralFill, borderColor: CHART.neutral, borderWidth: 1, borderRadius: 4 },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: chartAnimation(),
          plugins: { legend: CHART_LEGEND, tooltip: CHART_TOOLTIP },
          scales: { x: { ...CHART_X, stacked: true }, y: { ...CHART_Y, stacked: true } },
        }}
      />
    </div>
  );
}
