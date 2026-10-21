import type { HostingPayment, HostingService } from '@/types';
import { hostingCoverage } from '@/lib/hosting';
import { today } from '@/lib/utils';

/** Mutually exclusive renewal buckets, based on current continuous paid coverage. */
export function hostingRenewalBuckets(services: HostingService[], payments: HostingPayment[], day = today()) {
  const buckets = [
    { label: '0–5 днів', count: 0, color: '#F48891' },
    { label: '6–30 днів', count: 0, color: '#E8BD69' },
    { label: '31–90 днів', count: 0, color: '#52C8C4' },
    { label: 'Понад 90', count: 0, color: '#65D6A1' },
  ];
  for (const service of services) {
    if (service.archived) continue;
    const { daysLeft } = hostingCoverage(service, payments, day);
    if (daysLeft === null) continue;
    const index = daysLeft <= 5 ? 0 : daysLeft <= 30 ? 1 : daysLeft <= 90 ? 2 : 3;
    buckets[index].count += 1;
  }
  return buckets;
}
