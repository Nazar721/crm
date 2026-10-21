'use client';
import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import type { HostingPayment, HostingService } from '@/types';
import { hostingRenewalBuckets } from '@/lib/hosting-view';
import { CHART_TOOLTIP, CHART_X, CHART_Y, chartAnimation } from './ChartSetup';

export default function HostingRenewalsChart({ services, payments }: {
  services: HostingService[];
  payments: HostingPayment[];
}) {
  const buckets = useMemo(() => hostingRenewalBuckets(services, payments), [services, payments]);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (!total) return <div className="hosting-renewal-chart empty-state"><p>Немає послуг з оплаченим покриттям на сьогодні.</p></div>;

  return (
    <div className="hosting-renewal-chart" role="img"
      aria-label={`Строки продовження хостингу. ${buckets.map(b => `${b.label}: ${b.count}`).join('; ')}.`}>
      <Bar data={{
        labels: buckets.map(b => b.label),
        datasets: [{ label: 'Послуг', data: buckets.map(b => b.count),
          backgroundColor: buckets.map(b => `${b.color}44`), borderColor: buckets.map(b => b.color),
          borderWidth: 1.5, borderRadius: 6, maxBarThickness: 56 }],
      }} options={{
        responsive: true, maintainAspectRatio: false, animation: chartAnimation(),
        plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, displayColors: false } },
        scales: { x: CHART_X, y: { ...CHART_Y, beginAtZero: true, suggestedMax: 2,
          ticks: { ...CHART_Y.ticks, precision: 0 } } },
      }} />
    </div>
  );
}
