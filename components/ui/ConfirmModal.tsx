import Modal from './Modal';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  text: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmModal({ isOpen, title, text, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm" onSubmit={onConfirm} initialFocusSelector="[data-dialog-submit]">
      <p className="confirm-text">{text}</p>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Скасувати</button>
        <button type="submit" data-dialog-submit className="btn btn-danger">Підтвердити</button>
      </div>
    </Modal>
  );
}
