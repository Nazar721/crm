interface EmptyStateProps {
  message: string;
  hint?: string;
}

export default function EmptyState({ message, hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span>{message}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}
