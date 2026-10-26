'use client';
import { useContext, type ReactNode } from 'react';
import { DialogSubmitContext } from './DialogSubmitContext';

interface ModalFooterProps {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  /** Гасить кнопку збереження (напр. під час очікування відповіді). */
  disabled?: boolean;
  children?: ReactNode;
}

export default function ModalFooter({ onCancel, onSave, saveLabel = 'Зберегти', disabled, children }: ModalFooterProps) {
  const { nativeSubmit, submitting } = useContext(DialogSubmitContext);
  const busy = disabled || submitting;
  return (
    <div className="modal-footer">
      {children}
      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Скасувати</button>
      <button type={nativeSubmit ? 'submit' : 'button'} data-dialog-submit className="btn btn-primary" onClick={nativeSubmit ? undefined : onSave} disabled={busy}>{saveLabel}</button>
    </div>
  );
}
