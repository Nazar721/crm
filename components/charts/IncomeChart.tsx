'use client';
import { Line } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, CHART_TOOLTIP, CHART_X, CHART_Y, chartAnimation } from './ChartSetup';

interface IncomeChartProps {
  labels: string[];
  data: number[];
}

export default function IncomeChart({ labels, data }: IncomeChartProps) {
  return (
    <div className="chart-body" role="img" aria-label="Сума закритих замовлень за місяць, останні 12 місяців">
      <Line
        data={{
          labels,
          datasets: [{
            data,
            label: 'Закрито, сума',
            borderColor: CHART.accent,
            backgroundColor: CHART.accentFill,
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointBackgroundColor: CHART.accent,
            pointBorderColor: '#1B1B23',
            pointBorderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: chartAnimation(),
          plugins: { legend: { display: false }, tooltip: CHART_TOOLTIP },
          scales: { x: CHART_X, y: CHART_Y },
        }}
      />
    </div>
  );
}
