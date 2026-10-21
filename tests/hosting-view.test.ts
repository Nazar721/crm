import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostingRenewalBuckets } from '@/lib/hosting-view';
import { addCalendarDays } from '@/lib/hosting';
import type { HostingService, HostingPayment } from '@/types';

test('renewal chart assigns each paid service once at all boundaries and excludes uncovered/archived services', () => {
  const day = '2026-10-21';
  const services: HostingService[] = [];
  const payments: HostingPayment[] = [];
  for (const [index, days] of [0, 5, 6, 30, 31, 90, 91].entries()) {
    const id = `service-${index}`;
    services.push({ id, name: id });
    payments.push({ id, serviceId: id, date: day, amount: 1, currency: 'UAH', periodStart: day, periodEnd: addCalendarDays(day, days) });
  }
  services.push({ id: 'archived', name: 'archived', archived: true }, { id: 'unpaid', name: 'unpaid' }, { id: 'future', name: 'future' }, { id: 'expired', name: 'expired' });
  payments.push(
    { id: 'archived', serviceId: 'archived', date: day, amount: 1, currency: 'UAH', periodStart: day, periodEnd: day },
    { id: 'future', serviceId: 'future', date: day, amount: 1, currency: 'USD', periodStart: '2026-11-01', periodEnd: '2026-11-30' },
    { id: 'expired', serviceId: 'expired', date: day, amount: 1, currency: 'USD', periodStart: '2026-09-01', periodEnd: '2026-10-20' },
  );
  assert.deepEqual(hostingRenewalBuckets(services, payments, day).map(b => b.count), [2, 2, 2, 1]);
  assert.deepEqual(hostingRenewalBuckets([], [], day).map(b => b.count), [0, 0, 0, 0]);
});
