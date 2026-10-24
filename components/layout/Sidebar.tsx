'use client';
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { hostingExpiringWithin } from '@/lib/hosting';

/** Drawer-режим: 768–1199px. На ширшому desktop панель постійна,
 *  на вужчому навігацію повністю бере на себе TabBar. */
const DRAWER_QUERY = '(min-width: 768px) and (max-width: 1199px)';

const navSections = [
  {
    title: 'Головна',
    items: [
      { href: '/dashboard', label: 'Огляд', icon: 'grid', badge: null },
    ],
  },
  {
    title: 'Агенція',
    items: [
      { href: '/projects', label: 'Проєкти', icon: 'list', badge: 'projects' },
      { href: '/clients', label: 'Клієнти', icon: 'users', badge: 'clients' },
      { href: '/specialists', label: 'Фахівці', icon: 'code', badge: 'specialists' },
      { href: '/partners', label: 'Партнери', icon: 'users2', badge: 'partners' },
      // Пакети 04–06: хостинг і заплановані проєкти — операційний
      // облік агенції, одразу за «Партнери», а не в «Фінансах».
      { href: '/hosting', label: 'Хостинг', icon: 'target', badge: null },
      { href: '/planned-projects', label: 'Заплановані проєкти', icon: 'list', badge: null },
    ],
  },
  {
    title: 'Фінанси',
    items: [
      { href: '/finance', label: 'Фінанси', icon: 'card', badge: null },
      { href: '/debts', label: 'Борги', icon: 'dollar', badge: null },
      { href: '/savings', label: 'Відкладення', icon: 'wallet', badge: null },
    ],
  },
  {
    title: 'AI',
    items: [
      { href: '/assistant', label: 'AI-помічник', icon: 'spark', badge: null },
    ],
  },
];

function NavIcon({ icon }: { icon: string }) {
  const icons: Record<string, React.ReactNode> = {
    grid: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/><rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/></svg>,
    list: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 7h18M3 12h18M3 17h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2"/></svg>,
    code: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    users2: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="2"/><path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2"/></svg>,
    card: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/><line x1="2" y1="10" x2="22" y2="10" stroke="currentColor" strokeWidth="2"/></svg>,
    dollar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    wallet: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="2"/><path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" strokeWidth="2"/></svg>,
    target: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>,
    spark: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M18.5 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  };
  return icons[icon] || null;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { badges, plannedDueCount, snapshot, sidebarOpen, closeSidebar, assistantOpen, setAssistantOpen } = useApp();
  const navRef = useRef<HTMLElement>(null);
  const hostingExpiring = hostingExpiringWithin(snapshot.hostingServices, snapshot.hostingPayments, 5);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const updateActiveMarker = () => {
      const active = nav.querySelector<HTMLElement>('.nav-item.active');
      if (!active) {
        nav.dataset.activeReady = 'false';
        return;
      }

      const navRect = nav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      nav.style.setProperty('--nav-marker-x', `${activeRect.left - navRect.left - nav.clientLeft + nav.scrollLeft}px`);
      nav.style.setProperty('--nav-marker-y', `${activeRect.top - navRect.top - nav.clientTop + nav.scrollTop}px`);
      nav.style.setProperty('--nav-marker-width', `${activeRect.width}px`);
      nav.style.setProperty('--nav-marker-height', `${activeRect.height}px`);
      nav.style.setProperty('--nav-marker-accent', getComputedStyle(active).getPropertyValue('--nav-accent').trim() || 'var(--g-accent)');
      nav.dataset.activeReady = 'true';
    };

    updateActiveMarker();
    const observer = new ResizeObserver(updateActiveMarker);
    observer.observe(nav);
    const active = nav.querySelector<HTMLElement>('.nav-item.active');
    if (active) observer.observe(active);
    return () => observer.disconnect();
  }, [pathname, assistantOpen]);

  useEffect(() => {
    if (!sidebarOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (!window.matchMedia(DRAWER_QUERY).matches) return;
      closeSidebar();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, closeSidebar]);

  // Закриваємо drawer і при навігації «назад/вперед» браузером.
  useEffect(() => { closeSidebar(); }, [pathname, closeSidebar]);

  return (
    <>
      <aside id="app-sidebar" className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon">
            <img src="/logo.webp" alt="WebCRM" width="38" height="38" style={{ borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
          </div>
          <span className="logo-text">WebCRM</span>
        </div>

        <nav ref={navRef} className="sidebar-nav">
          <span className="sidebar-active-marker" aria-hidden="true" />
          {navSections.map((section) => (
            <div className="nav-section" key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                const badgeValue = item.href === '/hosting'
                  ? (hostingExpiring || null)
                  : item.href === '/planned-projects' ? (plannedDueCount || null)
                  : item.badge ? (badges as unknown as Record<string, number>)[item.badge] : null;
                const hostingAlertClass = item.href === '/hosting' && hostingExpiring > 0
                  ? ' nav-item--hosting-alert nav-item--hosting-ending'
                  : '';
                const navTitle = item.href === '/hosting' && hostingExpiring > 0
                  ? `Хостинг: ${hostingExpiring} ${hostingExpiring === 1 ? 'послуга завершується' : 'послуги завершуються'} протягом 5 днів`
                  : item.href === '/planned-projects' && plannedDueCount > 0
                    ? `Заплановані проєкти: ${plannedDueCount} на найближчі 2 дні`
                    : item.label;
                if (item.href === '/assistant') return (
                  <button
                    key={item.href}
                    type="button"
                    className={`nav-item nav-item--assistant${assistantOpen ? ' active' : ''}`}
                    aria-expanded={assistantOpen}
                    aria-label={item.label}
                    title={navTitle}
                    data-tooltip={navTitle}
                    onClick={() => { closeSidebar(); setAssistantOpen(true); }}
                  >
                    <NavIcon icon={item.icon} />
                    <span className="nav-label">{item.label}</span>
                  </button>
                );
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-nav={item.href}
                    className={`nav-item${isActive ? ' active' : ''}${hostingAlertClass}${item.href === '/planned-projects' && plannedDueCount > 0 ? ' nav-item--planned-alert' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.href === '/planned-projects' && plannedDueCount > 0 ? navTitle : item.label}
                    title={navTitle}
                    data-tooltip={navTitle}
                    onClick={closeSidebar}
                  >
                    <NavIcon icon={item.icon} />
                    <span className="nav-label">{item.label}</span>
                    {badgeValue !== null && badgeValue !== undefined && (
                      <span className="nav-badge">{badgeValue}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <Link
            href="/settings"
            data-nav="/settings"
            className={`nav-item nav-item--settings${pathname === '/settings' ? ' active' : ''}`}
            aria-current={pathname === '/settings' ? 'page' : undefined}
            aria-label="Налаштування"
            title="Налаштування"
            data-tooltip="Налаштування"
            onClick={closeSidebar}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 3.84l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.36.58.61 1 .6h.6a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.4z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            <span className="nav-label">Налаштування</span>
          </Link>
          <div className="sidebar-footer-info">
            <span className="footer-version">MVP v2.0</span>
            <span className="footer-storage">Next.js</span>
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="sidebar-overlay open" onClick={closeSidebar} />}
    </>
  );
}
