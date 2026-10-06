// Прапорці версій міграцій. Кожна міграція виконується РОЗОВО на версію.
// Локальна реалізація (localStorage); на етапі 2 прапорці переїжджають
// у серверну базу разом із міграціями даних.
const PREFIX = 'crm_migrated_';

function available(): boolean {
  return typeof window !== 'undefined';
}

export function isMigrationApplied(id: string): boolean {
  if (!available()) return true;
  try {
    return !!localStorage.getItem(PREFIX + id);
  } catch {
    // Немає доступу до сховища — не ризикуємо повторним виконанням.
    return true;
  }
}

export function markMigrationApplied(id: string): void {
  if (!available()) return;
  try {
    localStorage.setItem(PREFIX + id, '1');
  } catch {
    // Прапорець не записався — міграція повториться при наступному старті.
  }
}

export function clearMigrationFlags(): void {
  if (!available()) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) doomed.push(key);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch {
    // Не змогли очистити — міграції, можливо, виконаються повторно.
  }
}

export function listAppliedMigrations(): string[] {
  if (!available()) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) out.push(key.slice(PREFIX.length));
    }
  } catch {
    return [];
  }
  return out.sort();
}
