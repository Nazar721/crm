'use client';
import { useEffect, type ReactNode } from 'react';
import { useToast } from '@/hooks/useToast';
import { subscribeToasts } from '@/lib/toast-bus';
import ToastContainer from '@/components/ui/Toast';

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, showToast } = useToast();

  useEffect(() => subscribeToasts((message, type) => showToast(message, type)), [showToast]);

  return (
    <>
      {children}
      <ToastContainer toasts={toasts} />
    </>
  );
}
