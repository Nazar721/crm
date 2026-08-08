interface BadgeProps {
  children: React.ReactNode;
  variant: 'blue' | 'green' | 'purple' | 'orange' | 'teal' | 'pink' | 'gray' | 'gold' | 'black' | 'paper';
}

export default function Badge({ children, variant }: BadgeProps) {
  return (
    <span className={`badge badge--${variant}`}>{children}</span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    'В роботі': 'blue',
    'На паузі': 'orange',
    'Очікування оплати': 'gold',
  };
  return <Badge variant={(map[status] || 'gray') as any}>{status}</Badge>;
}

export function BankBadge({ bankId }: { bankId: string }) {
  const { normalizeBank, BANKS } = require('@/lib/banks');
  const id = normalizeBank(bankId) || bankId;
  const bank = BANKS.find((b: any) => b.id === id);
  if (!bank) return <Badge variant="gray">{bankId || '—'}</Badge>;
  return <Badge variant={bank.badge.replace('badge--', '') as any}>{bank.label}</Badge>;
}

export function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = { IT: 'blue', Design: 'pink', Video: 'purple' };
  return <Badge variant={(map[type] || 'gray') as any}>{type}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    Telegram: 'blue', Instagram: 'pink', YouTube: 'orange',
    'Реклама': 'purple', 'Сайт': 'teal', 'Сарафанне радіо': 'green', 'Інше': 'gray',
  };
  return <Badge variant={(map[source] || 'gray') as any}>{source || 'Інше'}</Badge>;
}

export function FinanceTypeBadge({ type }: { type: string }) {
  return type === 'income' ? <Badge variant="green">Дохід</Badge> : <Badge variant="orange">Витрата</Badge>;
}

export function DebtTypeBadge({ type }: { type: string }) {
  return type === 'owed_to_me' ? <Badge variant="green">Борг мені</Badge> : <Badge variant="orange">Мій борг</Badge>;
}
