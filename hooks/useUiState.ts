'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'crm:ui:';

function readSession<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeSession(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Немає місця/доступу — фільтри просто не переживуть перехід.
  }
}

/**
 * Стан UI (фільтри, пошук, внутрішня вкладка), що переживає переходи
 * між сторінками в межах сесії вкладки. Не зберігає секрети.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readSession(key, initial));

  useEffect(() => {
    writeSession(key, value);
  }, [key, value]);

  return [value, setValue];
}

/**
 * Зберігає позицію прокрутки сторінки при переходах і відновлює її
 * після появи даних. Викликати після того, як список відрендерено.
 */
export function useScrollRestoration(key: string, ready: boolean): void {
  const restored = useRef(false);

  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const stored = readSession<number>(`scroll:${key}`, 0);
    const frame = window.requestAnimationFrame(() => {
      if (stored > 0) window.scrollTo(0, stored);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [key, ready]);

  useEffect(() => {
    const save = () => writeSession(`scroll:${key}`, Math.round(window.scrollY));
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', save);
    };
  }, [key]);
}

/** Лічильник видимих записів для пагінації великих списків. */
export function useVisibleCount(step = 60, initial = 60) {
  const [count, setCount] = useState(initial);
  const showMore = useCallback(() => setCount(c => c + step), [step]);
  const reset = useCallback(() => setCount(initial), [initial]);
  return { count, showMore, reset } as const;
}
