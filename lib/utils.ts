export function formatMoney(n: number): string {
  const num = Number(n) || 0;
  return '₴' + num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatDate(str?: string): string {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(str?: string): string {
  if (!str) return '—';
  return new Date(str).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function daysBetween(start: string, end: string): number {
  const s = new Date(start), e = new Date(end);
  return Math.round((e.getTime() - s.getTime()) / 86400000);
}

export function escHtml(str?: string): string {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function getMonthKey(dateStr?: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthLabel(key?: string): string {
  if (!key) return '';
  const [y, m] = key.split('-');
  const months = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  }) as T;
}
