'use client';

import { useRef, type ReactNode } from 'react';
import { useVisibleOnce } from '@/hooks/useViewportMotion';

/** Chart.js starts drawing on first entry into the viewport, not off screen. */
export default function ChartViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisibleOnce(ref);
  return <div ref={ref} className="chart-viewport">
    {visible ? children : <div className="chart-body" aria-hidden="true" />}
  </div>;
}
