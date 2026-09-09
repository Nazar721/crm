'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';

interface TabItem {
  href: string;
  label: string;
  icon: string;
  badge?: string;
}

const mainTabs: TabItem[] = [
  { href: '/dashboard', label: 'Дашборд', icon: 'grid' },
  { href: '/projects', label: 'Проєкти', icon: 'list', badge: 'projects' },
  { href: '/finance', label: 'Фінанси', icon: 'card' },
  { href: '/clients', label: 'Клієнти', icon: 'users', badge: 'clients' },
];

const moreItems: TabItem[] = [
  { href: '/specialists', label: 'Фахівці', icon: 'code', badge: 'specialists' },
  { href: '/partners', label: 'Партнери', icon: 'users2', badge: 'partners' },
  { href: '/debts', label: 'Борги', icon: 'dollar' },
  { href: '/savings', label: 'Відкладення', icon: 'wallet' },
  { href: '/lead-generator', label: 'Lead Generator', icon: 'target' },
  { href: '/settings', label: 'Налаштування', icon: 'settings' },
];

function TabIcon({ icon }: { icon: string }) {
  const icons: Record<string, React.ReactNode> = {
    grid: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/></svg>,
    list: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 7h18M3 12h18M3 17h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
    card: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><line x1="2" y1="10" x2="22" y2="10" stroke="currentColor" strokeWidth="1.8"/></svg>,
    users: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.8"/></svg>,
    more: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>,
    code: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    users2: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="1.8"/><path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.8"/></svg>,
    dollar: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
    wallet: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="1.8"/><path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" strokeWidth="1.8"/></svg>,
    target: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>,
    settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 3.84l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.36.58.61 1 .6h.6a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.4z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  };
  return icons[icon] || null;
}

export default function TabBar() {
  const pathname = usePathname();
  const { badges } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = moreOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [moreOpen]);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const moreActive = moreItems.some(i => isActive(i.href));
  const badgeCount = (t: TabItem) => (t.badge ? (badges as unknown as Record<string, number>)[t.badge] : null);

  const renderBadge = (t: TabItem) => {
    const val = badgeCount(t);
    if (val === null || val === undefined) return null;
    return <span className="tabbar-badge">{val > 99 ? '99+' : val}</span>;
  };

  return (
    <>
      <nav className="tabbar" aria-label="Основна навігація">
        {mainTabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tabbar-item${isActive(tab.href) ? ' active' : ''}`}
            aria-current={isActive(tab.href) ? 'page' : undefined}
          >
            <span className="tabbar-icon">
              <TabIcon icon={tab.icon} />
              {renderBadge(tab)}
            </span>
            <span className="tabbar-label">{tab.label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={`tabbar-item${moreActive || moreOpen ? ' active' : ''}`}
          onClick={() => setMoreOpen(true)}
        >
          <span className="tabbar-icon"><TabIcon icon="more" /></span>
          <span className="tabbar-label">Більше</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="tabbar-sheet-overlay" onClick={() => setMoreOpen(false)} />
          <div className="tabbar-sheet" role="dialog" aria-label="Більше розділів">
            <div className="tabbar-sheet-handle" />
            <div className="tabbar-sheet-title">Більше</div>
            <div className="tabbar-sheet-grid">
              {moreItems.map((item) => {
                const val = badgeCount(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`tabbar-sheet-item${isActive(item.href) ? ' active' : ''}`}
                    onClick={() => setMoreOpen(false)}
                  >
                    <span className={`tabbar-sheet-icon`}><TabIcon icon={item.icon} /></span>
                    <span className="tabbar-sheet-label">{item.label}</span>
                    {val !== null && val !== undefined && <span className="tabbar-badge">{val > 99 ? '99+' : val}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
