'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, CHART_TOOLTIP, CHART_X, CHART_Y, chartAnimation } from './ChartSetup';
import { BANKS, bankLabel } from '@/lib/banks';
import { formatMoney } from '@/lib/utils';

interface BankBalancesChartProps {
  balances: Record<string, number>;
  usdtRate?: number;
}

export default function BankBalancesChart({ balances, usdtRate = 41 }: BankBalancesChartProps) {
  const entries = Object.entries(balances).filter(([_, v]) => v !== 0);
  const labels = entries.map(([id]) => bankLabel(id));
  // Висота всіх стовпчиків — в гривні (єдина шкала). Тільки крипта покаже $ в тултіпі.
  const data = entries.map(([_, v]) => v);
  const colors = entries.map(([id]) => {
    const bank = BANKS.find(b => b.id === id);
    return bank?.chartColor || CHART.neutralFill;
  });
  const borders = entries.map(([id]) => {
    const bank = BANKS.find(b => b.id === id);
    return bank?.borderColor || CHART.neutral;
  });

  return (
    <div className="chart-body" role="img" aria-label="Активи по банках у гривневому еквіваленті">
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
          animation: chartAnimation(),
          plugins: {
            legend: { display: false },
            tooltip: {
              ...CHART_TOOLTIP,
              callbacks: {
                label: (ctx) => {
                  const id = entries[ctx.dataIndex]?.[0] || '';
                  const raw = Number(ctx.parsed.y) || 0;
                  if (id === 'crypto_usdt') {
                    const usdt = raw / (usdtRate || 41);
                    return `Баланс: $${usdt.toLocaleString('uk-UA', { maximumFractionDigits: 0 })} = ${formatMoney(raw, 'UAH')}`;
                  }
                  return `Баланс: ${formatMoney(raw, 'UAH')}`;
                },
              },
            },
          },
          scales: { x: CHART_X, y: CHART_Y },
        }}
      />
    </div>
  );
}
