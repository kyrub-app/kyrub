import {
  BadgeCheck,
  FileText,
  Network,
  PlugZap,
  ShoppingBag,
  UtensilsCrossed,
} from 'lucide-react';
import type {
  StoreIntegrationId,
  StoreIntegrationPlans,
} from '../../utils/storeOperationalSettings';
import { STORE_INTEGRATION_IDS } from '../../utils/storeOperationalSettings';

interface StoreIntegrationsPanelProps {
  value: StoreIntegrationPlans;
  onChange: (value: StoreIntegrationPlans) => void;
  disabled?: boolean;
}

type IntegrationDefinition = {
  name: string;
  category: string;
  description: string;
  icon: typeof PlugZap;
  accent: string;
};

const INTEGRATIONS: Record<StoreIntegrationId, IntegrationDefinition> = {
  'open-delivery': {
    name: 'Open Delivery — Abrasel',
    category: 'Padrão de interoperabilidade',
    description:
      'Base recomendada para padronizar cardápio, pedidos e logística entre o Kyrub e canais de delivery compatíveis.',
    icon: Network,
    accent: 'text-cyan-300',
  },
  sefaz: {
    name: 'SEFAZ — NF-e / NFC-e',
    category: 'Fiscal',
    description:
      'Preparação para emissão fiscal, certificados, numeração, ambiente de homologação e autorização estadual.',
    icon: FileText,
    accent: 'text-amber-300',
  },
  ifood: {
    name: 'iFood',
    category: 'Marketplace de alimentação',
    description:
      'Canal planejado para receber pedidos no KDS e sincronizar disponibilidade e cardápio conforme a API homologada.',
    icon: UtensilsCrossed,
    accent: 'text-red-300',
  },
  '99food': {
    name: '99Food',
    category: 'Marketplace de alimentação',
    description:
      'Canal planejado para centralização de pedidos, preferencialmente pelo padrão Open Delivery quando disponível.',
    icon: UtensilsCrossed,
    accent: 'text-yellow-300',
  },
  'mercado-livre': {
    name: 'Mercado Livre',
    category: 'Marketplace de produtos',
    description:
      'Preparação para catálogo, estoque, pedidos e expedição de produtos físicos dentro do ERP Kyrub.',
    icon: ShoppingBag,
    accent: 'text-yellow-300',
  },
  shopee: {
    name: 'Shopee',
    category: 'Marketplace de produtos',
    description:
      'Preparação para sincronizar catálogo, estoque, pedidos e expedição sem duplicar a operação da loja.',
    icon: ShoppingBag,
    accent: 'text-orange-300',
  },
};

export function StoreIntegrationsPanel({
  value,
  onChange,
  disabled = false,
}: StoreIntegrationsPanelProps) {
  const updateIntegration = (
    integrationId: StoreIntegrationId,
    patch: Partial<StoreIntegrationPlans[StoreIntegrationId]>
  ): void => {
    onChange({
      ...value,
      [integrationId]: {
        ...value[integrationId],
        ...patch,
      },
    });
  };

  return (
    <div className="space-y-4 animate-fade-in" id="store-integrations-tab-content">
      <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10">
            <PlugZap className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h4 className="text-[10px] font-black uppercase tracking-wide text-cyan-200">
              Central de integrações omnichannel
            </h4>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              Marque os canais que a loja pretende conectar. Nesta etapa o Kyrub registra o plano de integração; conexão real exigirá API oficial, OAuth, homologação ou certificado no backend.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p className="text-[9px] leading-relaxed text-amber-200">
          Nunca informe senha, token, chave privada ou certificado neste painel. Credenciais fiscais e de marketplaces serão tratadas em fluxo seguro no servidor quando cada conector for habilitado.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {STORE_INTEGRATION_IDS.map(integrationId => {
          const definition = INTEGRATIONS[integrationId];
          const plan = value[integrationId];
          const Icon = definition.icon;
          const planned = plan.status === 'planned';

          return (
            <article
              key={integrationId}
              className={`space-y-3 rounded-2xl border p-4 ${
                planned
                  ? 'border-emerald-500/25 bg-emerald-500/5'
                  : 'border-slate-800 bg-slate-950/55'
              }`}
              data-integration-id={integrationId}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900">
                    <Icon className={`h-4 w-4 ${definition.accent}`} />
                  </span>
                  <div className="min-w-0">
                    <span className="block text-[8px] font-black uppercase tracking-wide text-slate-500">
                      {definition.category}
                    </span>
                    <strong className="mt-0.5 block text-xs text-white">
                      {definition.name}
                    </strong>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-black uppercase ${
                    planned
                      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-500'
                  }`}
                >
                  {planned ? 'Planejada' : 'Não configurada'}
                </span>
              </div>

              <p className="text-[9px] leading-relaxed text-slate-500">
                {definition.description}
              </p>

              {planned && (
                <label className="block text-[8px] font-black uppercase text-slate-500">
                  Ambiente pretendido
                  <select
                    value={plan.environment}
                    onChange={event =>
                      updateIntegration(integrationId, {
                        environment:
                          event.target.value === 'production'
                            ? 'production'
                            : 'sandbox',
                      })
                    }
                    disabled={disabled}
                    className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white outline-none focus:border-cyan-500 disabled:opacity-45"
                  >
                    <option value="sandbox">Homologação / sandbox</option>
                    <option value="production">Produção</option>
                  </select>
                </label>
              )}

              <button
                type="button"
                onClick={() =>
                  updateIntegration(integrationId, {
                    status: planned ? 'not-configured' : 'planned',
                    environment: planned ? 'sandbox' : plan.environment,
                  })
                }
                disabled={disabled}
                className={`flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[8px] font-black uppercase disabled:opacity-40 ${
                  planned
                    ? 'border border-slate-700 bg-slate-900 text-slate-300'
                    : 'bg-cyan-500 text-slate-950'
                }`}
                id={`toggle-store-integration-${integrationId}`}
              >
                {planned ? (
                  <>
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Remover do plano
                  </>
                ) : (
                  <>
                    <PlugZap className="h-3.5 w-3.5" />
                    Adicionar ao plano
                  </>
                )}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
