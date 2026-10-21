'use client';
import { Doughnut } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, chartAnimation } from './ChartSetup';

interface SourcesChartProps {
  labels: string[];
  data: number[];
  colors: string[];
}

export default function SourcesChart({ labels, data, colors }: SourcesChartProps) {
  const srcLabels = labels.length ? labels : ['Немає даних'];
  const srcData = data.length ? data : [1];
  const srcColors = colors.length ? colors : [CHART.neutral];

  return (
    <div className="chart-body chart-body--donut" role="img" aria-label="Джерела клієнтів за кількістю">
      <Doughnut
        data={{
          labels: srcLabels,
          datasets: [{
            data: srcData,
            backgroundColor: srcColors,
            borderColor: '#1B1B23',
            borderWidth: 2,
            hoverOffset: 8,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: chartAnimation(),
          cutout: '62%',
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: { color: CHART.legend, font: CHART.font, padding: 10, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' },
            },
            tooltip: {
              backgroundColor: '#24242E',
              titleColor: '#F5F5F7',
              bodyColor: '#ACACBB',
              borderColor: '#70747C',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 10,
              callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} клієнт(ів)` },
            },
          },
        }}
      />
    </div>
  );
}
