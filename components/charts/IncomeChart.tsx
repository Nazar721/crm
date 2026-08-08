'use client';
import { Line } from 'react-chartjs-2';
import './ChartSetup';

interface IncomeChartProps {
  labels: string[];
  data: number[];
}

export default function IncomeChart({ labels, data }: IncomeChartProps) {
  return (
    <div className="chart-body">
      <Line
        data={{
          labels,
          datasets: [{
            data,
            borderColor: '#4f9cf9',
            backgroundColor: 'rgba(79, 156, 249, 0.2)',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#4f9cf9',
            pointRadius: 3,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
          },
        }}
      />
    </div>
  );
}
