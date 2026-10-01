import { CircleAlert, CircleCheck } from 'lucide-react';
import type { AdminIntegrationProviderState, AdminIntegrationReadinessSnapshot } from '../../utils/adminIntegrationReadiness';

const STATE_LABEL: Record<AdminIntegrationProviderState, string> = {
  configured: 'Configurado',
  partial: 'Atenção',
  'not-configured': 'Não configurado',
  'contract-only': 'Contrato preparado',
};

const detailLabel = (key: string): string => ({
  pixCheckoutConfigured: 'Checkout Pix', webhookConfigured: 'Webhook', productionActivatedByVault: 'Ativação via Vault',
  apiKeyConfigured: 'API Key', geocodingConfigured: 'Geocoding', connections: 'Conexões', connected: 'Conectadas',
  attention: 'Com atenção', runtimeConfigured: 'Runtime', fallbackActivated: 'Fallback',
}[key] ?? key);
const detailValue = (value: boolean | number | string): string => typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : String(value);

type Provider = AdminIntegrationReadinessSnapshot['providers'][number];

export default function AdminProviderCatalogGrid({ providers }: { providers: Provider[] }) {
  return <div className="mt-5 grid gap-3 lg:grid-cols-3">{providers.map(provider => <article key={provider.id} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
    <div className="flex items-start justify-between gap-3"><div><span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{provider.category}</span><h3 className="mt-1 text-sm font-black text-white">{provider.title}</h3></div>{provider.state === 'configured' ? <CircleCheck className="h-4 w-4 text-emerald-400" /> : <CircleAlert className="h-4 w-4 text-amber-400" />}</div>
    <p className="mt-3 text-[10px] font-black uppercase text-slate-400">{STATE_LABEL[provider.state]}</p>
    <dl className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">{Object.entries(provider.details).map(([key, value]) => <div key={key} className="flex justify-between text-[10px]"><dt className="text-slate-500">{detailLabel(key)}</dt><dd className="font-bold text-slate-300">{detailValue(value)}</dd></div>)}</dl>
  </article>)}</div>;
}