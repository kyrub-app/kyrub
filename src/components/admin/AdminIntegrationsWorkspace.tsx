import { useEffect, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  KeyRound,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import {
  loadAdminIntegrationReadiness,
  type AdminIntegrationProviderState,
  type AdminIntegrationReadinessSnapshot,
} from '../../utils/adminIntegrationReadiness';

const STATE_LABEL: Record<AdminIntegrationProviderState, string> = {
  configured: 'Configurado',
  partial: 'Atenção',
  'not-configured': 'Não configurado',
  'contract-only': 'Contrato preparado',
};

const formatUpdatedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Ainda não consultado'
    : date.toLocaleString('pt-BR');
};

const detailLabel = (key: string): string => ({
  pixCheckoutConfigured: 'Checkout Pix',
  webhookConfigured: 'Webhook',
  productionActivatedByVault: 'Ativação via Vault',
  connections: 'Conexões',
  connected: 'Conectadas',
  attention: 'Com atenção',
  runtimeConfigured: 'Runtime',
  fallbackActivated: 'Fallback',
}[key] ?? key);

const detailValue = (value: boolean | number | string): string =>
  typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : String(value);

export default function AdminIntegrationsWorkspace({
  authenticatedUser,
  profile,
}: {
  authenticatedUser: User;
  profile: AdminProfile;
}) {
  const [snapshot, setSnapshot] = useState<AdminIntegrationReadinessSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await loadAdminIntegrationReadiness(authenticatedUser, profile);
      setSnapshot(next);
      setError('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível consultar as integrações.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile.role !== 'super_admin' || profile.status !== 'active') return;
    void refresh();
  }, [authenticatedUser.uid, profile.role, profile.status]);

  if (profile.role !== 'super_admin' || profile.status !== 'active') return null;

  return (
    <section
      aria-labelledby="admin-integrations-title"
      className="rounded-[2rem] border border-slate-800 bg-slate-900/70 p-5 sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-300">
            <PlugZap className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-400">
              Integrações da plataforma
            </span>
            <h2 id="admin-integrations-title" className="mt-1 text-lg font-black text-white">
              Providers e cofre de credenciais
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
              Esta visão mostra apenas readiness autoritativo do servidor. Nenhum token, chave,
              ciphertext ou referência privada é devolvido ao navegador.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2 text-slate-200">
            <KeyRound className="h-4 w-4 text-cyan-300" />
            <strong className="text-xs">Vault v1 — envelopes AES</strong>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Compatibilidade necessária para integrações legadas, incluindo 99Food, enquanto a migração controlada não termina.
          </p>
          <span className="mt-3 inline-flex rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-300">
            {snapshot?.vault.legacyEnvelopeConfigured ? 'Chave mestre disponível' : 'Chave mestre indisponível'}
          </span>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2 text-slate-200">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            <strong className="text-xs">Vault v2 — Google Secret Manager</strong>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Adapter seguro disponível no código, mas API, IAM, recursos e migrações reais são etapas separadas.
          </p>
          <span className="mt-3 inline-flex rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-300">
            {snapshot?.vault.googleSecretManagerAdapterEnabled
              ? 'Adapter habilitado — infraestrutura não verificada'
              : 'Adapter desabilitado'}
          </span>
        </article>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {(snapshot?.providers ?? []).map(provider => (
          <article key={provider.id} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                  {provider.category}
                </span>
                <h3 className="mt-1 text-sm font-black text-white">{provider.title}</h3>
              </div>
              {provider.state === 'configured' ? (
                <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" />
              )}
            </div>
            <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
              {STATE_LABEL[provider.state]}
            </p>
            <p className="mt-1 text-[10px] text-slate-600">
              Autoridade: {provider.credentialAuthority}
            </p>
            <dl className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
              {Object.entries(provider.details).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3 text-[10px]">
                  <dt className="text-slate-500">{detailLabel(key)}</dt>
                  <dd className="font-bold text-slate-300">{detailValue(value)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>

      {!snapshot && !error && (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500">
          {loading ? 'Consultando o backend autoritativo…' : 'Nenhum estado carregado.'}
        </div>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-slate-600">
        Última leitura: {formatUpdatedAt(snapshot?.generatedAt ?? '')}. Salvar uma credencial e ativar processamento real continuarão sendo operações distintas.
      </p>
    </section>
  );
}
