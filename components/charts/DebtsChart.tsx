'use client';
import { Bar } from 'react-chartjs-2';
import './ChartSetup';
import { CHART, CHART_TOOLTIP, CHART_X, CHART_Y, chartAnimation } from './ChartSetup';

interface DebtsChartProps {
  owedToMe: number;
  myDebts: number;
}

export default function DebtsChart({ owedToMe, myDebts }: DebtsChartProps) {
  return (
    <div className="chart-body" role="img" aria-label="Борг мені та мої борги">
      <Bar
        data={{
          labels: ['Борг мені', 'Мої борги'],
          datasets: [{
            data: [owedToMe, myDebts],
            backgroundColor: [CHART.incomeFill, CHART.expenseFill],
            borderColor: [CHART.income, CHART.expense],
            borderWidth: 1,
            borderRadius: 4,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: chartAnimation(),
          plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, displayColors: false } },
          scales: { x: CHART_X, y: CHART_Y },
        }}
      />
    </div>
  );
}
