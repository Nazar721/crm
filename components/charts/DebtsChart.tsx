'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';

interface DebtsChartProps {
  owedToMe: number;
  myDebts: number;
}

export default function DebtsChart({ owedToMe, myDebts }: DebtsChartProps) {
  return (
    <div className="chart-body">
      <Bar
        data={{
          labels: ['Борг мені', 'Мої борги'],
          datasets: [{
            data: [owedToMe, myDebts],
            backgroundColor: ['rgba(52, 211, 153, 0.6)', 'rgba(251, 146, 60, 0.6)'],
            borderColor: ['#34d399', '#fb923c'],
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
