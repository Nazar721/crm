'use client';

import { useLayoutEffect, useRef } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface AnimatedSegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** Segmented control with a measured sliding selection pill. */
export default function AnimatedSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: AnimatedSegmentedControlProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const updateIndicator = () => {
      const active = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) return;
      const rootRect = root.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      root.style.setProperty('--seg-left', `${activeRect.left - rootRect.left - root.clientLeft}px`);
      root.style.setProperty('--seg-top', `${activeRect.top - rootRect.top - root.clientTop}px`);
      root.style.setProperty('--seg-width', `${activeRect.width}px`);
      root.style.setProperty('--seg-height', `${activeRect.height}px`);
      root.dataset.ready = 'true';
    };

    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(root);
    const active = root.querySelector<HTMLElement>('[data-active="true"]');
    if (active) observer.observe(active);
    return () => observer.disconnect();
  }, [value, options.length]);

  return (
    <div ref={rootRef} className={`ov-seg ${className}`.trim()} role="group" aria-label={label}>
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            data-active={isActive}
            className={`ov-seg-item${isActive ? ' is-on' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
