import type { ButtonHTMLAttributes } from 'react';

type ActionIcon = 'payment' | 'history' | 'edit' | 'archive' | 'restore' | 'delete' | 'expand' | 'collapse';

const ICON_PATHS: Record<ActionIcon, string> = {
  payment: 'M3 8h18M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 11h4',
  history: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-4v5l3 2',
  edit: 'm16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z',
  archive: 'M4 9h16v11H4V9ZM3 4h18v5H3V4Zm7 9h4',
  restore: 'M4 10a8 8 0 1 1 1.5 7M4 4v6h6',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  expand: 'm6 9 6 6 6-6',
  collapse: 'm6 15 6-6 6 6',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ActionIcon;
  tone?: 'neutral' | 'payment' | 'edit' | 'danger';
};

/** Visible labels stay alongside icons, including in narrow mobile row cards. */
export default function RowActionButton({ icon, tone = 'neutral', className = '', children, ...props }: Props) {
  return (
    <button {...props} type="button" className={`btn row-action row-action--${tone} ${className}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={ICON_PATHS[icon]} />
      </svg>
      <span>{children}</span>
    </button>
  );
}
