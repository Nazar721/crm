import Modal from './Modal';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ isOpen, title, text, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
      <p className="confirm-text">{text}</p>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onCancel}>Скасувати</button>
        <button className="btn btn-danger" onClick={onConfirm}>Підтвердити</button>
      </div>
    </Modal>
  );
}
