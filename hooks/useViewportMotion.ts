'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** Reveals each card once, including cards added by filters or expandable panels. */
export function useRevealCards(rootRef: RefObject<HTMLElement | null>, selector: string) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) return;

    const seen = new WeakSet<Element>();
    const pending = new Set<HTMLElement>();
    const reveal = (element: HTMLElement) => {
      element.dataset.motion = 'visible';
      pending.delete(element);
      observer.unobserve(element);
    };
    const observer = new IntersectionObserver(entries => {
      let order = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        element.style.setProperty('--reveal-delay', `${Math.min(order++ * 55, 165)}ms`);
        reveal(element);
      }
    }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });

    const register = () => {
      root.querySelectorAll<HTMLElement>(selector).forEach(element => {
        if (seen.has(element)) return;
        seen.add(element);
        element.dataset.motion = 'pending';
        pending.add(element);
        observer.observe(element);
      });
    };
    const showImmediately = () => {
      if (!preference.matches) return;
      pending.forEach(reveal);
    };
    register();
    const mutations = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE))) register();
    });
    mutations.observe(root, { childList: true, subtree: true });
    preference.addEventListener('change', showImmediately);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      preference.removeEventListener('change', showImmediately);
      pending.forEach(element => { delete element.dataset.motion; });
    };
  }, [rootRef, selector]);
}

/** Starts an individual counter only when it is actually visible. */
export function useVisibleOnce(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0 });
    observer.observe(element);
    const showImmediately = () => {
      if (preference.matches) { setVisible(true); observer.disconnect(); }
    };
    preference.addEventListener('change', showImmediately);
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', showImmediately);
    };
  }, [ref]);
  return visible;
}
