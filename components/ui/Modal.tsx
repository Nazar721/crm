'use client';
import { useId, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { DialogSubmitContext } from './DialogSubmitContext';
import { emitToast } from '@/lib/toast-bus';
import { useBodyScrollLock, useEscapeToTopmost, useFocusTrap } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  onSubmit?: () => void | Promise<void>;
  initialFocusSelector?: string;
}

export default function Modal({ isOpen, onClose, title, children, size = 'md', onSubmit, initialFocusSelector }: ModalProps) {
  const titleId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen, initialFocusSelector ?? (onSubmit
    ? 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [data-dialog-submit]:not([disabled])'
    : undefined));
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useBodyScrollLock(isOpen);
  useEscapeToTopmost(onClose, isOpen);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit();
    } catch (error) {
      emitToast(error instanceof Error ? error.message : 'Не вдалося зберегти зміни', 'error');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

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
        <DialogSubmitContext.Provider value={{ nativeSubmit: !!onSubmit, submitting }}>
          {onSubmit ? (
            <form className="modal-body" noValidate onSubmit={handleSubmit} aria-busy={submitting}
              onKeyDown={event => {
                // Holding Enter must not generate duplicate submissions.
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                const target = event.target as HTMLElement;
                if (event.repeat || (target.tagName !== 'TEXTAREA' && (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey))) {
                  event.preventDefault();
                }
              }}>
              {children}
            </form>
          ) : <div className="modal-body">{children}</div>}
        </DialogSubmitContext.Provider>
      </div>
    </div>
  );
}
