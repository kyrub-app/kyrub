import { useState } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  FileText,
  FlaskConical,
  Network,
  PlugZap,
  Send,
  ShoppingBag,
  UtensilsCrossed,
  WifiOff,
} from 'lucide-react';
import type {
  StoreIntegrationId,
  StoreIntegrationPlan,
  StoreIntegrationPlans,
  StoreIntegrationStatus,
} from '../../utils/storeOperationalSettings';
import {
  STORE_INTEGRATION_IDS,
  createEmptyStoreIntegrationPlan,
  persistStoreIntegrationPlans,
  validateStoreIntegrationSetup,
} from '../../utils/storeOperationalSettings';
import { auth } from '../../utils/firebase';
import { INTEGRATION_TEST_ORDER_EVENT } from '../../utils/integrationTestOrders';

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
  orderCapable: boolean;
  catalogCapable: boolean;
  inventoryCapable: boolean;
  accountLabel: string;
  accountPlaceholder: string;
  externalIdLabel: string;
  externalIdPlaceholder: string;
  activationNote: string;
};

type FeedbackState = {
  integrationId: StoreIntegrationId;
  message: string;
  type: 'success' | 'error';
} | null;

const STATUS_META: Record<
  StoreIntegrationStatus,
  { label: string; className: string }
> = {
  'not-configured': {
    label: 'Não configurada',
    className: 'border-slate-700 bg-slate-900 text-slate-500',
  },
  draft: {
    label: 'Rascunho',
    className: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
  },
  'awaiting-authorization': {
    label: 'Aguardando autorização',
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  },
  'sandbox-ready': {
    label: 'Teste interno aprovado',
    className: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300',
  },
  attention: {
    label: 'Requer atenção',
    className: 'border-red-500/25 bg-red-500/10 text-red-300',
  },
};

const INTEGRATIONS: Record<StoreIntegrationId, IntegrationDefinition> = {
  'open-delivery': {
    name: 'Open Delivery — Abrasel',
    category: 'Padrão de interoperabilidade',
    description:
      'Estrutura preferencial para transformar cardápios e pedidos de parceiros compatíveis em uma fila operacional única no Kyrub.',
    icon: Network,
    accent: 'text-cyan-300',
    orderCapable: true,
    catalogCapable: true,
    inventoryCapable: true,
    accountLabel: 'Nome da unidade no integrador',
    accountPlaceholder: 'Ex.: Loja Centro',
    externalIdLabel: 'Merchant ID / identificador externo',
    externalIdPlaceholder: 'Identificador fornecido pelo parceiro',
    activationNote:
      'A ativação real dependerá do integrador Open Delivery escolhido, credenciais OAuth e homologação dos endpoints.',
  },
  sefaz: {
    name: 'SEFAZ — NF-e / NFC-e',
    category: 'Fiscal',
    description:
      'Cadastro inicial da unidade fiscal. Emissão real continuará isolada dos canais de pedidos e dependerá de certificado, credenciamento e provedor seguro.',
    icon: FileText,
    accent: 'text-amber-300',
    orderCapable: false,
    catalogCapable: false,
    inventoryCapable: false,
    accountLabel: 'Razão social ou unidade fiscal',
    accountPlaceholder: 'Ex.: Restaurante Exemplo Ltda.',
    externalIdLabel: 'CNPJ / identificador fiscal',
    externalIdPlaceholder: 'Somente o identificador público da empresa',
    activationNote:
      'Certificados, CSC, senhas e chaves privadas nunca serão digitados nesta tela. O conector fiscal deverá usar cofre de segredos no backend.',
  },
  ifood: {
    name: 'iFood',
    category: 'Marketplace de alimentação',
    description:
      'Prepara a unidade para autorização pelo Portal do Parceiro, recebimento de pedidos e sincronização gradual de catálogo e disponibilidade.',
    icon: UtensilsCrossed,
    accent: 'text-red-300',
    orderCapable: true,
    catalogCapable: true,
    inventoryCapable: true,
    accountLabel: 'Nome da loja no iFood',
    accountPlaceholder: 'Ex.: Restaurante Centro',
    externalIdLabel: 'Merchant ID do iFood',
    externalIdPlaceholder: 'ID exibido no Portal do Parceiro',
    activationNote:
      'O Kyrub precisará concluir o fluxo OAuth, armazenar tokens no servidor e passar pela homologação dos módulos usados.',
  },
  '99food': {
    name: '99Food',
    category: 'Marketplace de alimentação',
    description:
      'Organiza o onboarding da unidade e o roteamento dos pedidos, com preferência pelo padrão Open Delivery quando o parceiro disponibilizar.',
    icon: UtensilsCrossed,
    accent: 'text-yellow-300',
    orderCapable: true,
    catalogCapable: true,
    inventoryCapable: true,
    accountLabel: 'Nome da loja na 99Food',
    accountPlaceholder: 'Ex.: Restaurante Centro',
    externalIdLabel: 'Identificador da unidade na 99Food',
    externalIdPlaceholder: 'ID fornecido durante o credenciamento',
    activationNote:
      'A produção dependerá de cadastro aprovado, sandbox ou homologação e credenciais emitidas para o Kyrub ou integrador parceiro.',
  },
  'mercado-livre': {
    name: 'Mercado Livre',
    category: 'Marketplace de produtos',
    description:
      'Direciona pedidos de produtos físicos para separação, expedição ou outra equipe, sem obrigar que tudo seja tratado como cozinha.',
    icon: ShoppingBag,
    accent: 'text-yellow-300',
    orderCapable: true,
    catalogCapable: true,
    inventoryCapable: true,
    accountLabel: 'Apelido da conta vendedora',
    accountPlaceholder: 'Ex.: Loja Oficial Centro',
    externalIdLabel: 'Seller ID do Mercado Livre',
    externalIdPlaceholder: 'Identificador público do vendedor',
    activationNote:
      'A autorização real usará OAuth no backend, notificações oficiais e reconciliação periódica de pedidos e estoque.',
  },
  shopee: {
    name: 'Shopee',
    category: 'Marketplace de produtos',
    description:
      'Prepara catálogo, estoque e pedidos para uma fila de separação ou expedição, mantendo o KDS como painel operacional multissetorial.',
    icon: ShoppingBag,
    accent: 'text-orange-300',
    orderCapable: true,
    catalogCapable: true,
    inventoryCapable: true,
    accountLabel: 'Nome da conta vendedora',
    accountPlaceholder: 'Ex.: Loja Centro',
    externalIdLabel: 'Shop ID da Shopee',
    externalIdPlaceholder: 'Identificador fornecido pela Open Platform',
    activationNote:
      'A ativação ficará bloqueada até o Kyrub possuir acesso oficial à Open Platform, credenciais e ambiente de homologação.',
  },
};

const formatLastTest = (value: string): string => {
  if (!value) return 'Nenhum teste realizado';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Nenhum teste realizado';
  return new Date(timestamp).toLocaleString('pt-BR');
};

export function StoreIntegrationsPanel({
  value,
  onChange,
  disabled = false,
}: StoreIntegrationsPanelProps) {
  const [expandedId, setExpandedId] = useState<StoreIntegrationId | null>(null);
  const [busyId, setBusyId] = useState<StoreIntegrationId | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const replaceIntegration = (
    integrationId: StoreIntegrationId,
    plan: StoreIntegrationPlan
  ): StoreIntegrationPlans => {
    const nextValue = { ...value, [integrationId]: plan };
    onChange(nextValue);
    return nextValue;
  };

  const updateIntegration = (
    integrationId: StoreIntegrationId,
    patch: Partial<StoreIntegrationPlan>
  ): void => {
    const current = value[integrationId];
    const nextStatus = patch.status ?? (
      current.status === 'not-configured' ? 'draft' :
      current.status === 'draft' ? 'draft' :
      'draft'
    );

    replaceIntegration(integrationId, {
      ...current,
      ...patch,
      status: nextStatus,
    });
    setFeedback(null);
  };

  const startConfiguration = (integrationId: StoreIntegrationId): void => {
    replaceIntegration(integrationId, {
      ...createEmptyStoreIntegrationPlan(),
      status: 'draft',
    });
    setExpandedId(integrationId);
    setFeedback(null);
  };

  const removeConfiguration = (integrationId: StoreIntegrationId): void => {
    replaceIntegration(integrationId, createEmptyStoreIntegrationPlan());
    setExpandedId(null);
    setFeedback(null);
  };

  const requestConnection = async (
    integrationId: StoreIntegrationId
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setFeedback({
        integrationId,
        message: 'Faça login novamente para registrar a solicitação.',
        type: 'error',
      });
      return;
    }

    try {
      validateStoreIntegrationSetup(integrationId, value[integrationId]);
      setBusyId(integrationId);
      const nextValue = replaceIntegration(integrationId, {
        ...value[integrationId],
        status: 'awaiting-authorization',
      });
      await persistStoreIntegrationPlans(user, nextValue);
      setFeedback({
        integrationId,
        message:
          'Solicitação salva. A conexão externa continuará bloqueada até o backend e o parceiro confirmarem a autorização.',
        type: 'success',
      });
    } catch (error) {
      setFeedback({
        integrationId,
        message: error instanceof Error
          ? error.message
          : 'Não foi possível registrar a solicitação.',
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const sendTestOrder = async (
    integrationId: StoreIntegrationId
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setFeedback({
        integrationId,
        message: 'Faça login novamente para testar o roteamento.',
        type: 'error',
      });
      return;
    }

    try {
      const plan = value[integrationId];
      validateStoreIntegrationSetup(integrationId, plan, { forOrderTest: true });
      setBusyId(integrationId);
      const createdAt = new Date().toISOString();
      const nextValue = replaceIntegration(integrationId, {
        ...plan,
        status: 'sandbox-ready',
        lastTestAt: createdAt,
      });
      await persistStoreIntegrationPlans(user, nextValue);

      const definition = INTEGRATIONS[integrationId];
      window.dispatchEvent(
        new CustomEvent(INTEGRATION_TEST_ORDER_EVENT, {
          detail: {
            requestId: `integration-test-${integrationId}-${Date.now()}`,
            providerId: integrationId,
            providerLabel: definition.name,
            storeId: user.uid,
            routingTarget: plan.routingTarget,
            accountLabel: plan.accountLabel,
            externalStoreId: plan.externalStoreId,
            createdAt,
          },
        })
      );
    } catch (error) {
      setFeedback({
        integrationId,
        message: error instanceof Error
          ? error.message
          : 'Não foi possível enviar o pedido de teste.',
        type: 'error',
      });
      setBusyId(null);
    }
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
              Cadastre cada unidade, escolha o destino operacional e teste como um pedido será entregue ao Kyrub. O mesmo painel pode encaminhar demandas para cozinha, bar, expedição, agenda, oficina ou qualquer outra equipe.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <div className="flex items-start gap-2">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <p className="text-[9px] leading-relaxed text-amber-200">
            O teste interno valida o roteamento para o painel operacional, mas não comprova conexão com o parceiro. Senhas, tokens, certificados e chaves privadas nunca devem ser informados aqui.
          </p>
        </div>
      </section>

      <div className="space-y-3">
        {STORE_INTEGRATION_IDS.map(integrationId => {
          const definition = INTEGRATIONS[integrationId];
          const plan = value[integrationId];
          const Icon = definition.icon;
          const configured = plan.status !== 'not-configured';
          const expanded = expandedId === integrationId;
          const statusMeta = STATUS_META[plan.status];
          const busy = busyId === integrationId;
          const integrationFeedback = feedback?.integrationId === integrationId
            ? feedback
            : null;

          return (
            <article
              key={integrationId}
              className={`rounded-2xl border p-4 ${
                configured
                  ? 'border-slate-700 bg-slate-950/75'
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
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-black uppercase ${statusMeta.className}`}>
                  {statusMeta.label}
                </span>
              </div>

              <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
                {definition.description}
              </p>

              {!configured ? (
                <button
                  type="button"
                  onClick={() => startConfiguration(integrationId)}
                  disabled={disabled}
                  className="mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-cyan-500 px-3 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"
                  id={`configure-store-integration-${integrationId}`}
                >
                  <PlugZap className="h-3.5 w-3.5" />
                  Configurar integração
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : integrationId)}
                    className="mt-3 flex min-h-9 w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-3 text-[8px] font-black uppercase text-slate-300"
                    aria-expanded={expanded}
                  >
                    <span>Dados e roteamento</span>
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {expanded && (
                    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                      <label className="block text-[8px] font-black uppercase text-slate-500">
                        {definition.accountLabel}
                        <input
                          type="text"
                          value={plan.accountLabel}
                          onChange={event =>
                            updateIntegration(integrationId, {
                              accountLabel: event.target.value,
                            })
                          }
                          disabled={disabled || busy}
                          placeholder={definition.accountPlaceholder}
                          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-cyan-500 disabled:opacity-45"
                        />
                      </label>

                      <label className="block text-[8px] font-black uppercase text-slate-500">
                        {definition.externalIdLabel}
                        <input
                          type="text"
                          value={plan.externalStoreId}
                          onChange={event =>
                            updateIntegration(integrationId, {
                              externalStoreId: event.target.value,
                            })
                          }
                          disabled={disabled || busy}
                          placeholder={definition.externalIdPlaceholder}
                          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-cyan-500 disabled:opacity-45"
                        />
                      </label>

                      <label className="block text-[8px] font-black uppercase text-slate-500">
                        Ambiente desejado
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
                          disabled={disabled || busy}
                          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white outline-none focus:border-cyan-500 disabled:opacity-45"
                        >
                          <option value="sandbox">Homologação / sandbox</option>
                          <option value="production">Produção</option>
                        </select>
                      </label>

                      {definition.orderCapable && (
                        <label className="block text-[8px] font-black uppercase text-slate-500">
                          Destino dos pedidos no Kyrub
                          <input
                            type="text"
                            value={plan.routingTarget}
                            onChange={event =>
                              updateIntegration(integrationId, {
                                routingTarget: event.target.value,
                              })
                            }
                            disabled={disabled || busy}
                            placeholder="Ex.: COZINHA, EXPEDIÇÃO, AGENDA ou OFICINA"
                            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-cyan-500 disabled:opacity-45"
                          />
                        </label>
                      )}

                      {(definition.orderCapable || definition.catalogCapable || definition.inventoryCapable) && (
                        <div className="grid gap-2 sm:grid-cols-3">
                          {definition.orderCapable && (
                            <label className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[8px] font-bold text-slate-300">
                              <input
                                type="checkbox"
                                checked={plan.receiveOrders}
                                onChange={event =>
                                  updateIntegration(integrationId, {
                                    receiveOrders: event.target.checked,
                                  })
                                }
                                disabled={disabled || busy}
                              />
                              Receber pedidos
                            </label>
                          )}
                          {definition.catalogCapable && (
                            <label className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[8px] font-bold text-slate-300">
                              <input
                                type="checkbox"
                                checked={plan.syncCatalog}
                                onChange={event =>
                                  updateIntegration(integrationId, {
                                    syncCatalog: event.target.checked,
                                  })
                                }
                                disabled={disabled || busy}
                              />
                              Sincronizar catálogo
                            </label>
                          )}
                          {definition.inventoryCapable && (
                            <label className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[8px] font-bold text-slate-300">
                              <input
                                type="checkbox"
                                checked={plan.syncInventory}
                                onChange={event =>
                                  updateIntegration(integrationId, {
                                    syncInventory: event.target.checked,
                                  })
                                }
                                disabled={disabled || busy}
                              />
                              Sincronizar estoque
                            </label>
                          )}
                        </div>
                      )}

                      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
                        <p className="text-[8px] leading-relaxed text-slate-400">
                          {definition.activationNote}
                        </p>
                        {definition.orderCapable && (
                          <p className="mt-1.5 text-[8px] font-bold text-cyan-300">
                            Último teste: {formatLastTest(plan.lastTestAt)}
                          </p>
                        )}
                      </div>

                      {integrationFeedback && (
                        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${
                          integrationFeedback.type === 'success'
                            ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                            : 'border-red-500/20 bg-red-500/5 text-red-300'
                        }`}>
                          {integrationFeedback.type === 'success' ? (
                            <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="text-[8px] leading-relaxed">
                            {integrationFeedback.message}
                          </span>
                        </div>
                      )}

                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => void requestConnection(integrationId)}
                          disabled={disabled || busy}
                          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 text-[8px] font-black uppercase text-amber-300 disabled:opacity-40"
                          id={`request-store-integration-${integrationId}`}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {plan.status === 'awaiting-authorization'
                            ? 'Atualizar solicitação'
                            : 'Solicitar conexão'}
                        </button>

                        {definition.orderCapable && (
                          <button
                            type="button"
                            onClick={() => void sendTestOrder(integrationId)}
                            disabled={disabled || busy}
                            className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-cyan-500 px-3 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"
                            id={`test-store-integration-${integrationId}`}
                          >
                            <FlaskConical className="h-3.5 w-3.5" />
                            {busy ? 'Testando...' : 'Enviar pedido de teste'}
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeConfiguration(integrationId)}
                        disabled={disabled || busy}
                        className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[8px] font-black uppercase text-slate-400 disabled:opacity-40"
                        id={`remove-store-integration-${integrationId}`}
                      >
                        <WifiOff className="h-3.5 w-3.5" />
                        Remover configuração
                      </button>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}