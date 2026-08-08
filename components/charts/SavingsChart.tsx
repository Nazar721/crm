'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';

interface SavingsChartProps {
  labels: string[];
  saved: number[];
  remaining: number[];
}

export default function SavingsChart({ labels, saved, remaining }: SavingsChartProps) {
  return (
    <div className="chart-body">
      <Bar
        data={{
          labels,
          datasets: [
            { label: 'Наразі', data: saved, backgroundColor: 'rgba(52, 211, 153, 0.6)', borderColor: '#34d399', borderWidth: 1, borderRadius: 4 },
            { label: 'Залишилось', data: remaining, backgroundColor: 'rgba(85, 90, 112, 0.4)', borderColor: '#555a70', borderWidth: 1, borderRadius: 4 },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { color: '#8b90a7', font: { size: 10 } } } },
          scales: {
            x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
            y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
          },
        }}
      />
    </div>
  );
}
