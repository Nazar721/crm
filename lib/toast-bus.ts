import type { ToastType } from '@/types';

// Глобальна шина тостів: повідомлення можуть надходити з будь-якого шару
// (сховище, доменні дії, імпорт), не тільки з React-подій.
type Listener = (message: string, type: ToastType) => void;

const listeners = new Set<Listener>();

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitToast(message: string, type: ToastType = 'info'): void {
  listeners.forEach(listener => {
    try {
      listener(message, type);
    } catch {
      // Один підписник не має ламати решту.
    }
  });
}
