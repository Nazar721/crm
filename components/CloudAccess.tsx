'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { cloudEnabled, supabase } from '@/lib/supabase/client';
export default function CloudAccess({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!cloudEnabled());
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cloudEnabled()) return;
    let live = true;
    const client = supabase();
    void client.auth.getSession().then(({ data, error }) => {
      if (live) { setSignedIn(!!data.session); setError(error ? 'Не вдалося перевірити вхід' : ''); setReady(true); }
    }).catch(() => { if (live) { setError('Не вдалося перевірити вхід. Спробуй увійти повторно.'); setReady(true); } });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (live) { setSignedIn(!!session); setReady(true); }
    });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);
  if (!cloudEnabled()) return children;
  if (!ready) return <div className="app-shell-state cloud-access">Перевірка входу…</div>;
  if (signedIn) return children;
  return <main className="app-shell-state cloud-access"><form className="cloud-access-form" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const result = await supabase().auth.signInWithPassword({email:email.trim(),password});
      if (result.error) setError('Не вдалося увійти. Перевір email і пароль облікового запису CRM.');
      else setPassword('');
    } catch { setError('Немає з’єднання. Спробуй ще раз.'); } finally { setBusy(false); }
  }}><h1>Вхід у CRM</h1><p>Твої дані на ноутбуці та iPhone</p>
    <label className="form-group"><span className="form-label">Email</span><input className="form-input" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label className="form-group"><span className="form-label">Пароль</span><input className="form-input" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error && <p className="cloud-access-error" role="alert">{error}</p>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Вхід…':'Увійти'}</button>
  </form></main>;
}
