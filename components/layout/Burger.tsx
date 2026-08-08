'use client';
import { useApp } from '@/context/AppContext';

export default function Burger() {
  const { sidebarOpen, setSidebarOpen } = useApp();

  return (
    <button
      className="burger"
      aria-label="Меню"
      onClick={() => setSidebarOpen(!sidebarOpen)}
    >
      <span></span><span></span><span></span>
    </button>
  );
}
