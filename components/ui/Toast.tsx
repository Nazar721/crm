'use client';

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContainerProps {
  toasts: ToastItem[];
}

export default function ToastContainer({ toasts }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast--${toast.type}`}>
          <span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
