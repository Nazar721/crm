'use client';
import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Утримує фокус усередині відкритого діалогу:
 * переміщує фокус на перший керований елемент, циклить Tab/Shift+Tab
 * і після закриття повертає фокус на елемент, що відкрив діалог.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, initialFocusSelector?: string) {
  const ref = useRef<T | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const container: HTMLElement = node;

    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const nodes = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
      );

    const initial = (initialFocusSelector ? container.querySelector<HTMLElement>(initialFocusSelector) : null) ?? nodes()[0] ?? container;
    initial.focus({ preventScroll: true });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const list = nodes();
      if (!list.length) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = current !== null && container.contains(current);

      if (e.shiftKey) {
        if (!inside || current === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || current === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const target = restoreRef.current;
      if (target && document.contains(target)) target.focus({ preventScroll: true });
    };
  }, [active, initialFocusSelector]);

  return ref;
}

/**
 * Escape закриває лише найглибший відкритий діалог.
 * Вкладені модалки/аркуші не «провалюють» Escape крізь усі рівні одразу.
 */
const escapeStack: Array<() => void> = [];

export function useEscapeToTopmost(onClose: () => void, active: boolean) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const close = () => closeRef.current();
    escapeStack.push(close);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (escapeStack[escapeStack.length - 1] !== close) return;
      e.preventDefault();
      close();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      const index = escapeStack.indexOf(close);
      if (index >= 0) escapeStack.splice(index, 1);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);
}

/**
 * Блокує прокрутку документа, рахуючи відкриті діалоги,
 * щоб закриття одного не розблокувало фон під іншим.
 */
let scrollLocks = 0;

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    scrollLocks += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      scrollLocks = Math.max(0, scrollLocks - 1);
      if (scrollLocks === 0) document.body.style.overflow = '';
    };
  }, [active]);
}
