import type { ReactNode } from 'react';

interface ModalFooterProps {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  children?: ReactNode;
}

export default function ModalFooter({ onCancel, onSave, saveLabel = 'Зберегти', children }: ModalFooterProps) {
  return (
    <div className="modal-footer">
      {children}
      <button className="btn btn-ghost" onClick={onCancel}>Скасувати</button>
      <button className="btn btn-primary" onClick={onSave}>{saveLabel}</button>
    </div>
  );
}
