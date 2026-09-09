import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

export async function hasMXRecord(domain: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('MX timeout')), 5000);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Aborted')); }, { once: true });
      }),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

export async function resolveMX(emails: string[], signal?: AbortSignal): Promise<string[]> {
  const byDomain = new Map<string, boolean>();
  const verified: string[] = [];

  for (const email of emails) {
    const domain = email.split('@')[1];
    if (!domain) continue;
    if (!byDomain.has(domain)) {
      byDomain.set(domain, await hasMXRecord(domain, signal));
    }
    if (byDomain.get(domain)) verified.push(email);
  }

  return verified;
}
