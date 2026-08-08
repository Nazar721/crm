'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';

interface FinanceBarChartProps {
  labels: string[];
  incomeData: number[];
  expenseData: number[];
}

export default function FinanceBarChart({ labels, incomeData, expenseData }: FinanceBarChartProps) {
  return (
    <div className="chart-body">
      <Bar
        data={{
          labels,
          datasets: [
            { label: 'Доходи', data: incomeData, backgroundColor: 'rgba(52, 211, 153, 0.5)', borderColor: '#34d399', borderWidth: 1, borderRadius: 4 },
            { label: 'Витрати', data: expenseData, backgroundColor: 'rgba(251, 146, 60, 0.5)', borderColor: '#fb923c', borderWidth: 1, borderRadius: 4 },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { color: '#8b90a7', font: { size: 10 } } } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#555a70', font: { size: 10 } } },
          },
        }}
      />
    </div>
  );
}
