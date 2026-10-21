'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, CHART_TOOLTIP, CHART_X, CHART_Y, chartAnimation } from './ChartSetup';

interface ProjectsBarChartProps {
  labels: string[];
  data: number[];
}

export default function ProjectsBarChart({ labels, data }: ProjectsBarChartProps) {
  return (
    <div className="chart-body" role="img" aria-label="Кількість завершених проєктів за місяць, останні 12 місяців">
      <Bar
        data={{
          labels,
          datasets: [{
            data,
            label: 'Проєктів',
            backgroundColor: CHART.neutralFill,
            borderColor: CHART.neutral,
            borderWidth: 1,
            borderRadius: 4,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: chartAnimation(),
          plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, displayColors: false } },
          scales: { x: CHART_X, y: { ...CHART_Y, ticks: { ...CHART_Y.ticks, precision: 0 } } },
        }}
      />
    </div>
  );
}
