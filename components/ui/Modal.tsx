'use client';
import { useId, type ReactNode, useEffect } from 'react';
import { useBodyScrollLock, useEscapeToTopmost, useFocusTrap } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  onSubmit?: () => void;
}

export default function Modal({ isOpen, onClose, title, children, size = 'md', onSubmit }: ModalProps) {
  const titleId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);

  useBodyScrollLock(isOpen);
  useEscapeToTopmost(onClose, isOpen);

  useEffect(() => {
    if (!isOpen || !onSubmit) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        // Не обробляємо Enter для textarea і кнопок
        if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
        e.preventDefault();
        onSubmit();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onSubmit]);

  if (!isOpen) return null;

  const sizeClass = size === 'sm' ? 'modal--sm' : size === 'lg' ? 'modal--lg' : '';

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className={`modal ${sizeClass}${size === 'sm' ? ' modal--compact' : ' modal--drawer'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрити">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" />
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
