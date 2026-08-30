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
  saveAdminGoogleMapsCredentials,
  saveAdminMercadoPagoCredentials,
  testAdminGoogleMapsConnection,
  testAdminMercadoPagoConnection,
  type AdminGoogleMapsCredentialStatus,
  type AdminIntegrationProviderState,
  type AdminIntegrationReadinessSnapshot,
  type AdminMercadoPagoCredentialStatus,
} from '../../utils/adminIntegrationReadiness';
import AdminCustomerArrivalPolicyCard from './AdminCustomerArrivalPolicyCard';

const STATE_LABEL: Record<AdminIntegrationProviderState, string> = {
  configured: 'Configurado',
  partial: 'Atenção',
  'not-configured': 'Não configurado',
  'contract-only': 'Contrato preparado',
};

const formatUpdatedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Ainda não consultado' : date.toLocaleString('pt-BR');
};

const detailLabel = (key: string): string => ({
  pixCheckoutConfigured: 'Checkout Pix',
  webhookConfigured: 'Webhook',
  productionActivatedByVault: 'Ativação via Vault',
  apiKeyConfigured: 'API Key',
  geocodingConfigured: 'Geocoding',
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
  const [accessToken, setAccessToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<AdminMercadoPagoCredentialStatus | null>(null);
  const [credentialMessage, setCredentialMessage] = useState('');
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState('');
  const [googleMapsSaving, setGoogleMapsSaving] = useState(false);
  const [googleMapsTesting, setGoogleMapsTesting] = useState(false);
  const [googleMapsStatus, setGoogleMapsStatus] = useState<AdminGoogleMapsCredentialStatus | null>(null);
  const [googleMapsMessage, setGoogleMapsMessage] = useState('');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      setSnapshot(await loadAdminIntegrationReadiness(authenticatedUser, profile));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível consultar as integrações.');
    } finally {
      setLoading(false);
    }
  };

  const saveMercadoPago = async (): Promise<void> => {
    if (!accessToken.trim()) {
      setCredentialMessage('Informe o Access Token antes de salvar.');
      return;
    }
    setSaving(true);
    setCredentialMessage('');
    try {
      const status = await saveAdminMercadoPagoCredentials(authenticatedUser, profile, { accessToken, webhookSecret });
      setCredentialStatus(status);
      setAccessToken('');
      setWebhookSecret('');
      setCredentialMessage('Credencial protegida no cofre. O valor completo não será exibido novamente.');
      await refresh();
    } catch (caught) {
      setCredentialMessage(caught instanceof Error ? caught.message : 'Não foi possível salvar a credencial.');
    } finally {
      setSaving(false);
    }
  };

  const testMercadoPago = async (): Promise<void> => {
    setTesting(true);
    setCredentialMessage('');
    try {
      const result = await testAdminMercadoPagoConnection(authenticatedUser, profile);
      setCredentialStatus(result.credential);
      setCredentialMessage(result.ok ? 'Conexão com o Mercado Pago validada pelo backend.' : `A conexão não foi validada (${result.code || 'erro desconhecido'}).`);
      await refresh();
    } catch (caught) {
      setCredentialMessage(caught instanceof Error ? caught.message : 'Não foi possível testar a conexão.');
    } finally {
      setTesting(false);
    }
  };

  const saveGoogleMaps = async (): Promise<void> => {
    if (!googleMapsApiKey.trim()) {
      setGoogleMapsMessage('Informe a API Key do Google Maps antes de salvar.');
      return;
    }
    setGoogleMapsSaving(true);
    setGoogleMapsMessage('');
    try {
      const status = await saveAdminGoogleMapsCredentials(authenticatedUser, profile, { apiKey: googleMapsApiKey });
      setGoogleMapsStatus(status);
      setGoogleMapsApiKey('');
      setGoogleMapsMessage('API Key protegida no cofre. O valor completo não será exibido novamente.');
      await refresh();
    } catch (caught) {
      setGoogleMapsMessage(caught instanceof Error ? caught.message : 'Não foi possível salvar a API Key.');
    } finally {
      setGoogleMapsSaving(false);
    }
  };

  const testGoogleMaps = async (): Promise<void> => {
    setGoogleMapsTesting(true);
    setGoogleMapsMessage('');
    try {
      const result = await testAdminGoogleMapsConnection(authenticatedUser, profile);
      setGoogleMapsStatus(result.credential);
      setGoogleMapsMessage(result.ok ? 'Google Maps Geocoding validado pelo backend.' : `A conexão não foi validada (${result.code || 'erro desconhecido'}).`);
      await refresh();
    } catch (caught) {
      setGoogleMapsMessage(caught instanceof Error ? caught.message : 'Não foi possível testar o Google Maps.');
    } finally {
      setGoogleMapsTesting(false);
    }
  };

  useEffect(() => {
    if (profile.role !== 'super_admin' || profile.status !== 'active') return;
    void refresh();
  }, [authenticatedUser.uid, profile.role, profile.status]);

  if (profile.role !== 'super_admin' || profile.status !== 'active') return null;

  const mercadoPago = snapshot?.providers.find(provider => provider.id === 'mercado_pago');
  const googleMaps = snapshot?.providers.find(provider => provider.id === 'google_maps');

  return (
    <section aria-labelledby="admin-integrations-title" className="rounded-[2rem] border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-300"><PlugZap className="h-5 w-5" /></div>
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-400">Integrações da plataforma</span>
            <h2 id="admin-integrations-title" className="mt-1 text-lg font-black text-white">Providers, credenciais e políticas operacionais</h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
              Credenciais ficam sob autoridade do backend. Políticas operacionais versionadas são administradas separadamente e congeladas no nascimento de cada entrega.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 hover:bg-slate-700 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {error && <div className="mt-4 flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2 text-slate-200"><KeyRound className="h-4 w-4 text-cyan-300" /><strong className="text-xs">Vault v1 — envelopes AES</strong></div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Autoridade criptográfica ativa para integrações enquanto a migração controlada ao Secret Manager não termina.</p>
          <span className="mt-3 inline-flex rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-300">{snapshot?.vault.legacyEnvelopeConfigured ? 'Chave mestre disponível' : 'Chave mestre indisponível'}</span>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2 text-slate-200"><ShieldCheck className="h-4 w-4 text-emerald-300" /><strong className="text-xs">Vault v2 — Google Secret Manager</strong></div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Adapter disponível no código; API, IAM e migração de secrets reais continuam sendo etapas separadas.</p>
          <span className="mt-3 inline-flex rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-300">{snapshot?.vault.googleSecretManagerAdapterEnabled ? 'Adapter habilitado — infraestrutura não verificada' : 'Adapter desabilitado'}</span>
        </article>
      </div>

      <article className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div><span className="text-[9px] font-black uppercase tracking-wider text-cyan-400">Mercado Pago · produção</span><h3 className="mt-1 text-sm font-black text-white">Configurar credenciais</h3><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">Após salvar, o navegador recebe apenas metadados mascarados.</p></div>
          <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase text-slate-300">{mercadoPago ? STATE_LABEL[mercadoPago.state] : 'Aguardando leitura'}</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="text-[10px] font-bold text-slate-400">Access Token<input type="password" autoComplete="off" value={accessToken} onChange={event => setAccessToken(event.target.value)} placeholder={credentialStatus?.accessTokenLast4 ? `Salvo ·••••${credentialStatus.accessTokenLast4}` : 'Cole o Access Token'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500" /></label>
          <label className="text-[10px] font-bold text-slate-400">Webhook Secret<input type="password" autoComplete="off" value={webhookSecret} onChange={event => setWebhookSecret(event.target.value)} placeholder={credentialStatus?.webhookSecretLast4 ? `Salvo ·••••${credentialStatus.webhookSecretLast4}` : 'Opcional nesta primeira gravação'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500" /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void saveMercadoPago()} disabled={saving || testing || !snapshot?.vault.legacyEnvelopeConfigured} className="rounded-xl bg-cyan-500 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-40">{saving ? 'Salvando…' : 'Salvar no cofre'}</button>
          <button type="button" onClick={() => void testMercadoPago()} disabled={saving || testing || mercadoPago?.state === 'not-configured'} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 disabled:opacity-40">{testing ? 'Testando…' : 'Testar conexão'}</button>
        </div>
        {credentialMessage && <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] leading-relaxed text-slate-300" aria-live="polite">{credentialMessage}</p>}
      </article>

      <article className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div><span className="text-[9px] font-black uppercase tracking-wider text-emerald-400">Google Maps Platform · produção</span><h3 className="mt-1 text-sm font-black text-white">Geocodificação e destino canônico</h3><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">A chave fica no backend e resolve endereços do checkout em coordenadas e Place ID. Abrir o Maps por URL continua independente desta chave.</p></div>
          <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase text-slate-300">{googleMaps ? STATE_LABEL[googleMaps.state] : 'Aguardando leitura'}</span>
        </div>
        <label className="mt-4 block text-[10px] font-bold text-slate-400">Google Maps API Key<input type="password" autoComplete="off" value={googleMapsApiKey} onChange={event => setGoogleMapsApiKey(event.target.value)} placeholder={googleMapsStatus?.apiKeyLast4 ? `Salva ·••••${googleMapsStatus.apiKeyLast4}` : 'Cole a API Key do projeto Google Cloud'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-500" /></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void saveGoogleMaps()} disabled={googleMapsSaving || googleMapsTesting || !snapshot?.vault.legacyEnvelopeConfigured} className="rounded-xl bg-emerald-500 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-40">{googleMapsSaving ? 'Salvando…' : 'Salvar no cofre'}</button>
          <button type="button" onClick={() => void testGoogleMaps()} disabled={googleMapsSaving || googleMapsTesting || googleMaps?.state === 'not-configured'} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 disabled:opacity-40">{googleMapsTesting ? 'Testando…' : 'Testar Geocoding'}</button>
        </div>
        {googleMapsMessage && <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] leading-relaxed text-slate-300" aria-live="polite">{googleMapsMessage}</p>}
      </article>

      <AdminCustomerArrivalPolicyCard authenticatedUser={authenticatedUser} profile={profile} />

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {(snapshot?.providers ?? []).map(provider => (
          <article key={provider.id} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{provider.category}</span><h3 className="mt-1 text-sm font-black text-white">{provider.title}</h3></div>
              {provider.state === 'configured' ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" /> : <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" />}
            </div>
            <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-400">{STATE_LABEL[provider.state]}</p>
            <p className="mt-1 text-[10px] text-slate-600">Autoridade: {provider.credentialAuthority}</p>
            <dl className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
              {Object.entries(provider.details).map(([key, value]) => <div key={key} className="flex items-center justify-between gap-3 text-[10px]"><dt className="text-slate-500">{detailLabel(key)}</dt><dd className="font-bold text-slate-300">{detailValue(value)}</dd></div>)}
            </dl>
          </article>
        ))}
      </div>

      {!snapshot && !error && <div className="mt-5 rounded-2xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500">{loading ? 'Consultando o backend autoritativo…' : 'Nenhum estado carregado.'}</div>}
      <p className="mt-4 text-[10px] leading-relaxed text-slate-600">Última leitura: {formatUpdatedAt(snapshot?.generatedAt ?? '')}. Credenciais, políticas operacionais e ativação do runtime continuam sendo controles distintos.</p>
    </section>
  );
}
