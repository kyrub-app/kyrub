import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import {
  loadAdminMercadoLivrePlatformStatus,
  saveAdminMercadoLivrePlatformCredentials,
  validateAdminMercadoLivrePlatformConfiguration,
} from '../../utils/adminMercadoLivrePlatform';
import type { MercadoLivrePlatformCredentialStatus } from '../../../shared/mercadoLivrePlatformCredential';

export default function AdminMercadoLivrePlatformCard({
  authenticatedUser,
  profile,
}: {
  authenticatedUser: User;
  profile: AdminProfile;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [status, setStatus] = useState<MercadoLivrePlatformCredentialStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      setStatus(await loadAdminMercadoLivrePlatformStatus(authenticatedUser, profile));
      setMessage('');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível consultar a configuração.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile.role !== 'super_admin' || profile.status !== 'active') return;
    void refresh();
  }, [authenticatedUser.uid, profile.role, profile.status]);

  const save = async (): Promise<void> => {
    if (!clientId.trim() || !clientSecret.trim() || !redirectUri.trim()) {
      setMessage('Informe Client ID, Client Secret e Redirect URI antes de salvar.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const next = await saveAdminMercadoLivrePlatformCredentials(authenticatedUser, profile, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        redirectUri: redirectUri.trim(),
      });
      setStatus(next);
      setClientId('');
      setClientSecret('');
      setRedirectUri('');
      setMessage('Credenciais da aplicação Mercado Livre protegidas no cofre. O Client Secret completo não será exibido novamente.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível salvar a configuração.');
    } finally {
      setSaving(false);
    }
  };

  const validate = async (): Promise<void> => {
    setValidating(true);
    setMessage('');
    try {
      const result = await validateAdminMercadoLivrePlatformConfiguration(authenticatedUser, profile);
      setStatus(result.credential);
      setMessage(result.ok
        ? 'Configuração OAuth validada no backend. A autorização real do seller será validada quando um lojista clicar em Conectar Mercado Livre.'
        : `A configuração não foi validada (${result.code}).`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível validar a configuração.');
    } finally {
      setValidating(false);
    }
  };

  if (profile.role !== 'super_admin' || profile.status !== 'active') return null;

  return (
    <article className="mt-5 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-wider text-yellow-400">Mercado Livre Platform · produção</span>
          <h3 className="mt-1 flex items-center gap-2 text-sm font-black text-white"><KeyRound className="h-4 w-4" /> Aplicação OAuth do Kyrub</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Estas credenciais identificam o Kyrub perante o Mercado Livre. Elas pertencem à plataforma, não ao lojista. O lojista verá apenas “Conectar Mercado Livre” e os tokens do seller continuarão isolados no cofre da própria loja.
          </p>
        </div>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase text-slate-300">
          {loading ? 'Carregando' : status?.validated ? 'Validada' : status?.configured ? 'Configurada' : 'Não configurada'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <label className="text-[10px] font-bold text-slate-400">Client ID
          <input type="text" autoComplete="off" value={clientId} onChange={event => setClientId(event.target.value)} placeholder={status?.clientIdLast4 ? `Salvo ·••••${status.clientIdLast4}` : 'Client ID da aplicação Kyrub - Mercado Livre'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-yellow-500" />
        </label>
        <label className="text-[10px] font-bold text-slate-400">Client Secret
          <input type="password" autoComplete="off" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder={status?.clientSecretLast4 ? `Salvo ·••••${status.clientSecretLast4}` : 'Cole diretamente do Mercado Livre Developers'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-yellow-500" />
        </label>
        <label className="text-[10px] font-bold text-slate-400">Redirect URI
          <input type="url" autoComplete="off" value={redirectUri} onChange={event => setRedirectUri(event.target.value)} placeholder="https://kyrub.com/api/store-connections/mercado-livre/oauth/callback" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-yellow-500" />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={saving || validating || loading} className="rounded-xl bg-yellow-400 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-40">
          {saving ? 'Salvando…' : 'Salvar no cofre'}
        </button>
        <button type="button" onClick={() => void validate()} disabled={saving || validating || loading || !status?.configured} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 disabled:opacity-40">
          <ShieldCheck className="h-3.5 w-3.5" /> {validating ? 'Validando…' : 'Validar configuração OAuth'}
        </button>
        <button type="button" onClick={() => void refresh()} disabled={saving || validating || loading} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 disabled:opacity-40">Recarregar</button>
      </div>

      {message && <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] leading-relaxed text-slate-300" aria-live="polite">{message}</p>}
    </article>
  );
}
