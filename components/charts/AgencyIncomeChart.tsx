'use client';
import { Line } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, CHART_TOOLTIP, CHART_X, CHART_Y } from './ChartSetup';

interface AgencyIncomeChartProps {
  labels: string[];
  data: number[];
}

export default function AgencyIncomeChart({ labels, data }: AgencyIncomeChartProps) {
  return (
    <div className="chart-body" style={{ padding: 0, minHeight: 320 }} role="img" aria-label="Мій дохід від агенції по місяцях">
      <Line
        data={{
          labels,
          datasets: [{
            data,
            label: 'Дохід від агенції',
            borderColor: CHART.income,
            backgroundColor: CHART.incomeFill,
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointBackgroundColor: CHART.income,
            pointBorderColor: '#1B1B23',
            pointBorderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: CHART_TOOLTIP },
          scales: { x: CHART_X, y: CHART_Y },
        }}
      />
    </div>
  );
}
