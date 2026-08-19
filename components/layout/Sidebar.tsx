'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';

const navSections = [
  {
    title: 'Головна',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'grid', badge: null },
    ],
  },
  {
    title: 'Агенція',
    items: [
      { href: '/projects', label: 'Проєкти', icon: 'list', badge: 'projects' },
      { href: '/clients', label: 'Клієнти', icon: 'users', badge: 'clients' },
      { href: '/specialists', label: 'Фахівці', icon: 'code', badge: 'specialists' },
      { href: '/partners', label: 'Партнери', icon: 'users2', badge: 'partners' },
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
  };
  return icons[icon] || null;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { badges, sidebarOpen, closeSidebar } = useApp();

  return (
    <>
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="logo-text">WebCRM</span>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div className="nav-section" key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                const badgeValue = item.badge ? (badges as unknown as Record<string, number>)[item.badge] : null;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${isActive ? ' active' : ''}`}
                    onClick={closeSidebar}
                  >
                    <NavIcon icon={item.icon} />
                    <span>{item.label}</span>
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
            className={`nav-item nav-item--settings${pathname === '/settings' ? ' active' : ''}`}
            onClick={closeSidebar}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 3.84l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.36.58.61 1 .6h.6a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.4z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            <span>Налаштування</span>
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
