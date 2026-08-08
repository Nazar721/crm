'use client';
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { getProjects, getCompleted, getClients, getSpecialists, getPartners, getLeads } from '@/lib/storage';
import { migrate } from '@/lib/migrations';

interface BadgeCounts {
  projects: number;
  clients: number;
  specialists: number;
  partners: number;
  leads: number;
}

interface AppContextType {
  badges: BadgeCounts;
  refreshBadges: () => void;
  refreshKey: number;
  triggerRefresh: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  closeSidebar: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [badges, setBadges] = useState<BadgeCounts>({
    projects: 0,
    clients: 0,
    specialists: 0,
    partners: 0,
    leads: 0,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !initialized) {
      migrate();
      setInitialized(true);
    }
  }, [initialized]);

  const refreshBadges = useCallback(() => {
    if (typeof window === 'undefined') return;
    setBadges({
      projects: getProjects().length,
      clients: getClients().length,
      specialists: getSpecialists().length,
      partners: getPartners().length,
      leads: getLeads().length,
    });
  }, []);

  const triggerRefresh = useCallback(() => {
    refreshBadges();
    setRefreshKey(prev => prev + 1);
  }, [refreshBadges]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    refreshBadges();
  }, [refreshBadges, initialized]);

  return (
    <AppContext.Provider value={{ badges, refreshBadges, refreshKey, triggerRefresh, sidebarOpen, setSidebarOpen, closeSidebar }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
