'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';
import { BANKS, bankLabel } from '@/lib/banks';

interface BankBalancesChartProps {
  balances: Record<string, number>;
}

export default function BankBalancesChart({ balances }: BankBalancesChartProps) {
  const entries = Object.entries(balances).filter(([_, v]) => v !== 0);
  const labels = entries.map(([id]) => bankLabel(id));
  const data = entries.map(([_, v]) => v);
  const colors = entries.map(([id]) => {
    const bank = BANKS.find(b => b.id === id);
    return bank?.chartColor || 'rgba(128, 128, 128, 0.65)';
  });
  const borders = entries.map(([id]) => {
    const bank = BANKS.find(b => b.id === id);
    return bank?.borderColor || '#888';
  });

  return (
    <div className="chart-body">
      <Bar
        data={{
          labels,
          datasets: [{
            label: 'Баланс',
            data,
            backgroundColor: colors,
            borderColor: borders,
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
