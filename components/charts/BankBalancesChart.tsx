'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';
import { BANKS } from '@/lib/banks';

interface BankBalancesChartProps {
  balances: Record<string, number>;
}

export default function BankBalancesChart({ balances }: BankBalancesChartProps) {
  const labels = BANKS.map(b => b.label);
  const data = BANKS.map(b => balances[b.id] || 0);

  return (
    <div className="chart-body">
      <Bar
        data={{
          labels,
          datasets: [{
            label: 'Баланс',
            data,
            backgroundColor: BANKS.map(b => b.chartColor),
            borderColor: BANKS.map(b => b.borderColor),
            borderWidth: 1,
            borderRadius: 6,
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
