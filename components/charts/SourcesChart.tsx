'use client';
import { Doughnut } from 'react-chartjs-2';
import './ChartSetup';

interface SourcesChartProps {
  labels: string[];
  data: number[];
  colors: string[];
}

export default function SourcesChart({ labels, data, colors }: SourcesChartProps) {
  const srcLabels = labels.length ? labels : ['Немає даних'];
  const srcData = data.length ? data : [1];
  const srcColors = colors.length ? colors : ['#555a70'];

  return (
    <div className="chart-body chart-body--donut">
      <Doughnut
        data={{
          labels: srcLabels,
          datasets: [{
            data: srcData,
            backgroundColor: srcColors,
            borderColor: '#10131f',
            borderWidth: 2,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: { color: '#8b90a7', font: { size: 10 }, padding: 10, boxWidth: 10 },
            },
          },
        }}
      />
    </div>
  );
}
