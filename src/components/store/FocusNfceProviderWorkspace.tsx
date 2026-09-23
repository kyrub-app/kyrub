import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  CircleAlert,
  KeyRound,
  Loader2,
  Power,
  PowerOff,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

interface FocusNfceProviderReadiness {
  schemaVersion: 1;
  provider: 'Focus NFe';
  adapterId: 'focus-nfe';
  adapterVersion: '1';
  documentFamily: 'nfce';
  environment: 'sandbox';
  configured: boolean;
  active: boolean;
  credentialPresent: boolean;
  credentialVersion: string | null;
  verificationStatus: 'not_configured' | 'configured_unverified';
  credentialUpdatedAt: string | null;
}

const formatTimestamp = (value: string | null): string => {
  if (!value) return 'Ainda não configurada';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Data indisponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(parsed);
};

const readError = async (response: Response, fallback: string): Promise<string> => {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : fallback;
};

export default function FocusNfceProviderWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [readiness, setReadiness] = useState<FocusNfceProviderReadiness | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const endpoint = `/api/store-connections/fiscal-provider/focus-nfce/${encodeURIComponent(storeId)}`;

  const loadReadiness = useCallback(async (): Promise<void> => {
    setLoading(true);
    setNotice(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { authorization: `Bearer ${idToken}` },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await readError(response, `Não foi possível consultar a Focus (${response.status}).`));
      }
      const payload = await response.json() as FocusNfceProviderReadiness;
      setReadiness(payload);
    } catch (cause) {
      setNotice({
        type: 'error',
        message: cause instanceof Error
          ? cause.message
          : 'Não foi possível consultar a configuração da Focus.',
      });
    } finally {
      setLoading(false);
    }
  }, [endpoint, user]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const configureOrRotate = async (): Promise<void> => {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setNotice({ type: 'error', message: 'Informe o token de homologação da Focus.' });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${idToken}`,
          'content-type': 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ token: normalizedToken }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, `Não foi possível salvar a credencial (${response.status}).`));
      }
      const payload = await response.json() as FocusNfceProviderReadiness;
      setReadiness(payload);
      setToken('');
      setNotice({
        type: 'success',
        message: readiness?.configured
          ? 'Credencial de homologação rotacionada com segurança.'
          : 'Focus NFC-e conectada em homologação. Nenhum documento foi enviado.',
      });
    } catch (cause) {
      setNotice({
        type: 'error',
        message: cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a credencial protegida.',
      });
    } finally {
      setBusy(false);
    }
  };

  const changeActivation = async (action: 'deactivate' | 'reactivate'): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`${endpoint}/${action}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}` },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await readError(response, `Não foi possível atualizar a conexão (${response.status}).`));
      }
      const payload = await response.json() as FocusNfceProviderReadiness;
      setReadiness(payload);
      setNotice({
        type: 'success',
        message: action === 'deactivate'
          ? 'Conexão Focus desativada. O histórico fiscal foi preservado.'
          : 'Conexão Focus reativada para homologação.',
      });
    } catch (cause) {
      setNotice({
        type: 'error',
        message: cause instanceof Error
          ? cause.message
          : 'Não foi possível atualizar a conexão da Focus.',
      });
    } finally {
      setBusy(false);
    }
  };

  const configured = readiness?.configured === true;
  const active = readiness?.active === true;
  const credentialPresent = readiness?.credentialPresent === true;

  return (
    <section
      className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4"
      id="focus-nfce-provider-workspace"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <KeyRound className="h-5 w-5 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-cyan-300">
              Provedor fiscal · NFC-e · homologação
            </span>
            <h4 className="mt-1 text-sm font-black uppercase text-white">Focus NFC-e</h4>
            <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
              Conecte somente a credencial de homologação da Focus. Esta conexão prepara o transporte fiscal seguro, mas não envia documento e não habilita produção.
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase ${
          active && credentialPresent
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
            : configured
              ? 'border-amber-500/25 bg-amber-500/10 text-amber-200'
              : 'border-slate-700 bg-slate-900 text-slate-300'
        }`}>
          {active && credentialPresent
            ? 'Conectada · homologação'
            : configured
              ? 'Configurada · inativa'
              : 'Não configurada'}
        </span>
      </div>

      {loading ? (
        <div className="mt-4 flex min-h-20 items-center justify-center gap-2 text-[9px] text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Consultando conexão protegida...
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
              <span className="text-[8px] font-black uppercase text-slate-500">Ambiente</span>
              <p className="mt-1 text-[9px] font-bold text-white">Homologação</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
              <span className="text-[8px] font-black uppercase text-slate-500">Credencial</span>
              <p className={`mt-1 text-[9px] font-bold ${credentialPresent ? 'text-emerald-200' : 'text-amber-200'}`}>
                {credentialPresent ? 'Protegida no cofre' : 'Ausente'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
              <span className="text-[8px] font-black uppercase text-slate-500">Última atualização</span>
              <p className="mt-1 text-[9px] font-bold text-white">
                {formatTimestamp(readiness?.credentialUpdatedAt ?? null)}
              </p>
            </div>
          </div>

          {configured && (
            <div className="flex items-start gap-2 rounded-xl border border-cyan-500/15 bg-cyan-500/[0.03] px-3 py-2.5 text-[9px] leading-relaxed text-cyan-100/85">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Credencial armazenada com proteção. O status permanece “configurada, ainda não verificada” até uma futura homologação explicitamente autorizada; o Kyrub não envia uma nota apenas para testar o token.
              </span>
            </div>
          )}

          <label className="block text-[8px] font-black uppercase text-slate-500">
            {configured ? 'Novo token de homologação para rotação' : 'Token de homologação da Focus'}
            <input
              type="password"
              value={token}
              onChange={event => setToken(event.target.value)}
              disabled={busy}
              autoComplete="new-password"
              maxLength={8192}
              placeholder={configured ? 'Deixe vazio para manter a credencial atual' : 'Cole o token de homologação'}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] normal-case text-white outline-none focus:border-cyan-500 disabled:opacity-45"
              id="focus-nfce-sandbox-token"
            />
          </label>

          {notice && (
            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[9px] leading-relaxed ${
              notice.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-100'
                : 'border-red-500/20 bg-red-500/[0.05] text-red-100'
            }`} role="status">
              {notice.type === 'success'
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{notice.message}</span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void configureOrRotate()}
              disabled={busy || !token.trim()}
              id="configure-focus-nfce-sandbox"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 text-[9px] font-black uppercase text-cyan-100 disabled:opacity-45"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : configured ? <RefreshCw className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {configured ? 'Rotacionar credencial' : 'Conectar Focus'}
            </button>

            {configured && (
              <button
                type="button"
                onClick={() => void changeActivation(active ? 'deactivate' : 'reactivate')}
                disabled={busy || (!active && !credentialPresent)}
                id={active ? 'deactivate-focus-nfce-sandbox' : 'reactivate-focus-nfce-sandbox'}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-[9px] font-black uppercase text-slate-200 disabled:opacity-45"
              >
                {busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : active
                    ? <PowerOff className="h-3.5 w-3.5" />
                    : <Power className="h-3.5 w-3.5" />}
                {active ? 'Desativar conexão' : 'Reativar conexão'}
              </button>
            )}
          </div>

          <p className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2.5 text-[8px] leading-relaxed text-amber-100/80">
            Conectar a Focus não altera a política fiscal da loja, não escolhe CFOP, CST ou classificação IBS/CBS e não cria autoridade de produção. Essas decisões permanecem explícitas e separadas.
          </p>
        </div>
      )}
    </section>
  );
}
