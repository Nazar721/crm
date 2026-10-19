'use client';
import { useId, type ReactNode } from 'react';
import { useBodyScrollLock, useEscapeToTopmost, useFocusTrap } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const titleId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);

  useBodyScrollLock(isOpen);
  useEscapeToTopmost(onClose, isOpen);

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
        className={`modal ${sizeClass}`}
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
