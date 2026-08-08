import type { ReactNode } from 'react';

interface EmptyStateCardProps {
  icon?: ReactNode;
  message: string;
  hint?: string;
}

export default function EmptyStateCard({ icon, message, hint }: EmptyStateCardProps) {
  return (
    <div className="empty-state-card">
      {icon}
      <span>{message}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}
