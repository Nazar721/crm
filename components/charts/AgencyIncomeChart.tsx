'use client';
import { Line } from 'react-chartjs-2';
import './ChartSetup';

interface AgencyIncomeChartProps {
  labels: string[];
  data: number[];
}

export default function AgencyIncomeChart({ labels, data }: AgencyIncomeChartProps) {
  return (
    <div className="chart-body" style={{ padding: 0, minHeight: 320 }}>
      <Line
        data={{
          labels,
          datasets: [{
            data,
            borderColor: '#facc15',
            backgroundColor: 'rgba(250, 204, 21, 0.2)',
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointBackgroundColor: '#facc15',
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
