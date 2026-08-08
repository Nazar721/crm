'use client';
import { type ReactNode } from 'react';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/ui/Toast';

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts } = useToast();
  return (
    <>
      {children}
      <ToastContainer toasts={toasts} />
    </>
  );
}
