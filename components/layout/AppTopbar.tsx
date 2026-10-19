'use client';
import React from 'react';
import { useApp } from '@/context/AppContext';

/**
 * Верхній рядок для планшета/вузького desktop (768–1199px).
 * У цьому діапазоні постійного sidebar немає, а TabBar показується
 * лише до 767px — без цього контролю секції взагалі недосяжні.
 * На ширшому desktop і на мобільному рядок прихований.
 */
export default function AppTopbar() {
  const { sidebarOpen, setSidebarOpen } = useApp();

  return (
    <div className="app-topbar">
      <button
        type="button"
        className="app-burger"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? 'Закрити меню розділів' : 'Відкрити меню розділів'}
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {sidebarOpen ? (
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </g>
          ) : (
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </g>
          )}
        </svg>
      </button>
      <span className="app-topbar-title">WebCRM</span>
    </div>
  );
}
