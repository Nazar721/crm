import { appendFile } from 'fs/promises';

// Тимчасовий дебаг-ендпоінт: пишеться у /tmp/crm-debug.log
export async function POST(req: Request) {
  try {
    const body = await req.text();
    const ua = (req.headers.get('user-agent') || '').slice(0, 120);
    await appendFile('/tmp/crm-debug.log', `--- ${new Date().toISOString()} UA: ${ua}\n${body}\n`);
  } catch {}
  return new Response('ok');
}
