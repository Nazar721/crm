'use client';

import { useEffect, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  duration?: number;
}

/** Count-up для великих підсумків; шанує системне налаштування reduced motion. */
export default function AnimatedNumber({ value, format, duration = 1050 }: AnimatedNumberProps) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || target === 0) {
      setShown(target);
      return;
    }

    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      setShown(target * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <>{format(shown)}</>;
}
