'use client';

import { useEffect, useRef, useState } from 'react';
import { useVisibleOnce } from '@/hooks/useViewportMotion';

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  duration?: number;
}

/** Count-up для великих підсумків; шанує системне налаштування reduced motion. */
export default function AnimatedNumber({ value, format, duration = 1050 }: AnimatedNumberProps) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const elementRef = useRef<HTMLSpanElement>(null);
  const visible = useVisibleOnce(elementRef);

  useEffect(() => {
    if (!visible) return;
    const target = Number.isFinite(value) ? value : 0;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduceMotion = preference.matches;
    const from = shownRef.current;
    if (reduceMotion || duration <= 0 || target === from) {
      shownRef.current = target;
      setShown(target);
      return;
    }

    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      const next = from + (target - from) * eased;
      shownRef.current = progress === 1 ? target : next;
      setShown(shownRef.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    const settleImmediately = () => {
      if (!preference.matches) return;
      cancelAnimationFrame(frame);
      shownRef.current = target;
      setShown(target);
    };
    preference.addEventListener('change', settleImmediately);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener('change', settleImmediately);
    };
  }, [value, duration, visible]);

  return <span ref={elementRef} className="animated-number">
    <span className="sr-only">{format(Number.isFinite(value) ? value : 0)}</span>
    <span aria-hidden="true">{format(shown)}</span>
  </span>;
}
