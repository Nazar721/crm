'use client';
import { useEffect, useState } from 'react';
import { todayKyiv } from '@/lib/dates';

/** Refresh day-based indicators after midnight or returning to a sleeping tab. */
export function useKyivDay(): string {
  const [day, setDay] = useState(() => todayKyiv());
  useEffect(() => {
    const refresh = () => setDay(todayKyiv());
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return day;
}
