import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let client: SupabaseClient | null = null;
export function cloudEnabled(): boolean { return process.env.NEXT_PUBLIC_CRM_STORAGE === 'supabase'; }
export function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Не задано налаштування Supabase');
  client = createClient(url, key);
  return client;
}
