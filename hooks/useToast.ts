'use client';
import { useState, useCallback } from 'react';
import type { ToastItem, ToastType } from '@/types';
import { generateId } from '@/lib/utils';

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = generateId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const showToast = useCallback((msg: string, type?: ToastType) => {
    addToast(msg, type);
  }, [addToast]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, showToast, removeToast };
}
