import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, Link2, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
  createKyrubiaBridgeSession,
  kyrubiaBridgeMcpUrl,
  revokeKyrubiaBridgeSession,
  type KyrubiaBridgeSession,
} from '../utils/kyrubiaBridge';

type Notice = { type: 'success' | 'error' | 'info'; message: string } | null;

const formatExpiration = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const copyText = async (value: string): Promise<void> => {
  if (!navigator.clipboard?.writeText) throw new Error('A cópia automática não está disponível neste navegador.');
  await navigator.clipboard.writeText(value);
};

export function KyrubiaExternalBridgeControls() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'create' | 'revoke' | null>(null);
  const [session, setSession] = useState<KyrubiaBridgeSession | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState<'url' | 'token' | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    let currentWorkspace: HTMLElement | null = null;
    let currentHost: HTMLDivElement | null = null;
    const sync = () => {
      const workspace = document.getElementById('kyrub-ai-workspace');
      if (workspace === currentWorkspace && currentHost?.isConnected) return;
      currentHost?.remove();
      currentHost = null;
      currentWorkspace = workspace;
      setHost(null);
      if (!workspace) return;
      const nextHost = document.createElement('div');
      nextHost.id = 'kyrubia-external-bridge-host';
      const providerHost = workspace.querySelector('#kyrub-ai-provider-settings-host');
      if (providerHost?.nextSibling) workspace.insertBefore(nextHost, providerHost.nextSibling);
      else workspace.insertBefore(nextHost, workspace.firstChild);
      currentHost = nextHost;
      setHost(nextHost);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(sync, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  useEffect(() => {
    if (user) return;
    setOpen(false);
    setSession(null);
    setNotice(null);
  }, [user]);

  const create = async () => {
    if (!user) return;
    setBusy('create');
    setNotice(null);
    try {
      const next = await createKyrubiaBridgeSession(user, { ttlMinutes: 120, label: 'ChatGPT bridge' });
      setSession(next);
      setNotice({ type: 'success', message: 'Conexão temporária criada. O token aparece somente nesta tela e expira automaticamente.' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível criar a conexão temporária.' });
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!session) return;
    setBusy('revoke');
    setNotice(null);
    try {
      await revokeKyrubiaBridgeSession(session.token);
      setSession(null);
      setNotice({ type: 'success', message: 'Conexão revogada. A credencial anterior não pode mais acessar a Kyrubia.' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível revogar a conexão.' });
    } finally {
      setBusy(null);
    }
  };

  const copy = async (kind: 'url' | 'token', value: string) => {
    try {
      await copyText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(current => current === kind ? null : current), 1600);
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível copiar.' });
    }
  };

  if (!host) return null;
  const mcpUrl = typeof window !== 'undefined' ? kyrubiaBridgeMcpUrl() : '';
  const noticeClass = notice?.type === 'success'
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
    : notice?.type === 'error'
      ? 'border-red-500/25 bg-red-500/10 text-red-100'
      : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-100';

  return createPortal(<>
    <div className="mb-3 flex justify-end">
      <button type="button" onClick={() => setOpen(true)} disabled={!user} className="flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-200 disabled:opacity-40">
        <Link2 className="h-4 w-4" /> Conectar ChatGPT
      </button>
    </div>

    {open && <div className="fixed inset-0 z-[365] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Conexão temporária com ChatGPT">
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-950 p-4 shadow-2xl sm:rounded-3xl sm:p-5">
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-300"><Link2 className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Kyrubia Bridge API v0</span>
            <h2 className="mt-1 text-xl font-black text-white">Conectar ChatGPT temporariamente</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Cria uma credencial curta e revogável para o ChatGPT conversar diretamente com sua Kyrubia e consultar um snapshot limitado dos seus dados.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400" aria-label="Fechar conexão externa"><X className="h-4 w-4" /></button>
        </header>

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Modo seguro v0:</strong> a ponte pode ler o snapshot autorizado e conversar com a Kyrubia, mas não pode editar produtos, alterar estoque, publicar no Mercado Livre ou executar outras mutações. Qualquer ação continua voltando ao fluxo de confirmação do Kyrub.</span>
        </div>

        {!session ? <section className="mt-4 rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-black text-white">Sessão de 2 horas</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">A credencial expira automaticamente. Você também pode revogá-la a qualquer momento. Ela não substitui sua senha e não dá acesso geral à conta.</p>
          <button type="button" onClick={() => void create()} disabled={busy !== null || !user} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-black text-slate-950 disabled:opacity-40">
            {busy === 'create' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Criar conexão temporária
          </button>
        </section> : <section className="mt-4 space-y-3 rounded-3xl border border-cyan-500/25 bg-cyan-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-[9px] font-black uppercase tracking-wide text-cyan-300">Sessão ativa</span><p className="mt-1 text-xs text-slate-300">Expira em {formatExpiration(session.expiresAt)}</p></div><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase text-emerald-200">proposal only</span></div>

          <div><label className="text-[9px] font-black uppercase tracking-wide text-slate-500">Endpoint MCP</label><div className="mt-1.5 flex gap-2"><input readOnly value={mcpUrl} className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[10px] text-slate-300" /><button type="button" onClick={() => void copy('url', mcpUrl)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-300" aria-label="Copiar endpoint">{copied === 'url' ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}</button></div></div>

          <div><label className="text-[9px] font-black uppercase tracking-wide text-slate-500">Token temporário · exibido uma vez</label><div className="mt-1.5 flex gap-2"><input readOnly type="password" value={session.token} className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-[10px] text-slate-300" /><button type="button" onClick={() => void copy('token', session.token)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-300" aria-label="Copiar token temporário">{copied === 'token' ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}</button></div></div>

          <p className="text-[10px] leading-relaxed text-amber-200">Não recarregue esta tela antes de copiar o token. O servidor guarda apenas o hash e não consegue mostrar essa credencial novamente.</p>
          <button type="button" onClick={() => void revoke()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-2 text-[10px] font-black text-red-200 disabled:opacity-40">{busy === 'revoke' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Revogar conexão</button>
        </section>}

        {notice && <div className={`mt-3 rounded-2xl border px-3 py-2.5 text-xs ${noticeClass}`}>{notice.message}</div>}

        <div className="mt-4 border-t border-slate-800 pt-4 text-[10px] leading-relaxed text-slate-500">Depois de copiar o endpoint e o token, a conexão com um cliente compatível precisa ser iniciada explicitamente por você. A ponte não conecta serviços externos sozinha.</div>
      </div>
    </div>}
  </>, host);
}
