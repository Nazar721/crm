import type { ReactNode } from 'react';

interface ModalFooterProps {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  /** Гасить кнопку збереження (напр. під час очікування відповіді). */
  disabled?: boolean;
  children?: ReactNode;
}

export default function ModalFooter({ onCancel, onSave, saveLabel = 'Зберегти', disabled, children }: ModalFooterProps) {
  return (
    <div className="modal-footer">
      {children}
      <button className="btn btn-ghost" onClick={onCancel} disabled={disabled}>Скасувати</button>
      <button className="btn btn-primary" onClick={onSave} disabled={disabled}>{saveLabel}</button>
    </div>
  );
}
