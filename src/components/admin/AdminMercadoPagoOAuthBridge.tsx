import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';

interface OAuthStatus {
  configured: boolean;
  clientIdLast4: string;
  clientSecretLast4: string;
  redirectUriConfigured: boolean;
}

const request = async <T,>(user: User, init?: RequestInit): Promise<T> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/admin/integrations/mercado-pago/oauth', {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Não foi possível operar a aplicação OAuth do Mercado Pago.');
  return payload;
};

function Card({ user }: { user: User }) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('https://kyrub.com/api/store-connections/mercado-pago/callback');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async (): Promise<void> => {
    try { setStatus(await request<OAuthStatus>(user)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao consultar OAuth.'); }
  };

  useEffect(() => { void refresh(); }, [user.uid]);

  const save = async (): Promise<void> => {
    if (!clientId.trim() || !clientSecret.trim() || !redirectUri.trim()) {
      setMessage('Informe Client ID, Client Secret e Redirect URI.');
      return;
    }
    try {
      setBusy(true);
      setMessage('');
      setStatus(await request<OAuthStatus>(user, {
        method: 'POST',
        body: JSON.stringify({ clientId, clientSecret, redirectUri }),
      }));
      setClientId('');
      setClientSecret('');
      setMessage('Aplicação OAuth Mercado Pago protegida no cofre. Agora os lojistas podem autorizar a própria conta.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar OAuth.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article id="admin-mercado-pago-oauth-card" className="mt-5 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[9px] font-black uppercase tracking-wider text-sky-400">Mercado Pago · OAuth de lojistas</span>
          <h3 className="mt-1 text-sm font-black text-white">Aplicação para Recebimentos por loja</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">Estas credenciais pertencem ao Kyrub como aplicação OAuth. Os Access Tokens obtidos depois pertencem a cada loja e ficam segregados no backend.</p>
        </div>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase text-slate-300">{status?.configured ? 'Configurada' : 'Não configurada'}</span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <label className="text-[10px] font-bold text-slate-400">Client ID<input value={clientId} onChange={event => setClientId(event.target.value)} placeholder={status?.clientIdLast4 ? `Salvo ·••••${status.clientIdLast4}` : 'Client ID'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white" /></label>
        <label className="text-[10px] font-bold text-slate-400">Client Secret<input type="password" autoComplete="off" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder={status?.clientSecretLast4 ? `Salvo ·••••${status.clientSecretLast4}` : 'Client Secret'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white" /></label>
        <label className="text-[10px] font-bold text-slate-400">Redirect URI<input value={redirectUri} onChange={event => setRedirectUri(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white" /></label>
      </div>
      <button type="button" onClick={() => void save()} disabled={busy} className="mt-4 rounded-xl bg-sky-400 px-4 py-2.5 text-[10px] font-black uppercase text-slate-950 disabled:opacity-40">{busy ? 'Salvando…' : 'Salvar aplicação OAuth'}</button>
      {message && <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] text-slate-300" role="status">{message}</p>}
    </article>
  );
}

export function AdminMercadoPagoOAuthBridge() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let created: HTMLDivElement | null = null;
    const sync = (): void => {
      if (cancelled) return;
      if (created && !created.isConnected) { created = null; setHost(null); }
      const title = document.getElementById('admin-integrations-title');
      const root = title?.closest('section[aria-labelledby="admin-integrations-title"]');
      if (!created && root) {
        created = document.createElement('div');
        created.id = 'admin-mercado-pago-oauth-host';
        root.appendChild(created);
        setHost(created);
      }
      timer = window.setTimeout(sync, 160);
    };
    sync();
    return () => { cancelled = true; window.clearTimeout(timer); created?.remove(); };
  }, []);
  return host && user ? createPortal(<Card user={user} />, host) : null;
}
