'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';

interface ProjectsBarChartProps {
  labels: string[];
  data: number[];
}

export default function ProjectsBarChart({ labels, data }: ProjectsBarChartProps) {
  return (
    <div className="chart-body">
      <Bar
        data={{
          labels,
          datasets: [{
            data,
            backgroundColor: 'rgba(167, 139, 250, 0.5)',
            borderColor: '#a78bfa',
            borderWidth: 1,
            borderRadius: 4,
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
