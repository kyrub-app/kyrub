import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { RetailerPanel as ModernRetailerPanel } from './RetailerPanel';
import { KdsScopedRejectionController } from './store/KdsScopedRejectionController';
import { PaidOrderRefundBridge } from './store/PaidOrderRefundBridge';
import {
  consumePendingErpManagementNavigation,
  KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
  requestErpManagementNavigation,
  type ErpManagementModule,
  type ErpManagementNavigationRequest,
} from '../utils/erpManagementNavigation';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;
type ModuleDefinition = { title: string; description: string; status: 'native' | 'migration' | 'development' };

const MANAGEMENT_MODULES: Record<ErpManagementModule, ModuleDefinition> = {
  produtos: { title: 'Produtos', description: 'Catálogo, publicação, composição e edição dos itens da loja.', status: 'native' },
  estoque: { title: 'Estoque', description: 'Posição física, reposição, movimentações e evolução operacional do estoque.', status: 'native' },
  vendas: { title: 'Vendas & Analytics', description: 'Indicadores e leitura operacional das vendas da loja.', status: 'native' },
  assinaturas: { title: 'Assinaturas', description: 'Assinantes, situação de cobrança e contratos recorrentes da loja.', status: 'native' },
  financeiro: { title: 'Financeiro Interno', description: 'Custos, entradas, obrigações e projeções financeiras da operação.', status: 'native' },
  fiscal: { title: 'Fiscal', description: 'Dados fiscais, prontidão, emissão e histórico de documentos fiscais da loja.', status: 'native' },
  rh: { title: 'Equipe & Permissões', description: 'Equipe, cargos, acessos, remuneração e folha da operação.', status: 'native' },
  crm: { title: 'CRM', description: 'Relacionamento, segmentação, histórico e inteligência sobre clientes.', status: 'native' },
  marketing: { title: 'Marketing', description: 'Aquisição, conversão, retenção, canais e inteligência de crescimento.', status: 'development' },
  integracoes: { title: 'Integrações & Sandbox', description: 'Conexões externas, OAuth, sincronização e testes controlados dos canais.', status: 'native' },
  vouchers: { title: 'Promocionais', description: 'Cupons, pontos, desafios e recompensas em uma única central.', status: 'native' },
};

const mercadoLivreOAuthReturnModule = (): ErpManagementModule | null => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('integration') === 'mercado_livre' ? 'integracoes' : null;
};

const LazyIntegrationsRuntime = lazy(async () => { const module = await import('./GerencialIntegrationsRuntime'); return { default: module.GerencialIntegrationsRuntime }; });
const LazyProductInventoryRuntime = lazy(async () => { const module = await import('./store/ProductInventoryDirectRuntime'); return { default: module.ProductInventoryDirectRuntime }; });
const LazyStockRuntime = lazy(async () => { const module = await import('./store/StockDirectRuntime'); return { default: module.StockDirectRuntime }; });
const LazySalesAnalyticsRuntime = lazy(async () => { const module = await import('./store/StoreSalesAnalyticsRuntime'); return { default: module.StoreSalesAnalyticsRuntime }; });
const LazySubscriptionsRuntime = lazy(async () => { const module = await import('./store/StoreSubscriptionsRuntime'); return { default: module.default }; });
const LazyFinanceRuntime = lazy(async () => { const module = await import('./StoreFinanceCompositeRuntime'); return { default: module.StoreFinanceCompositeRuntime }; });
const LazyFiscalWorkspace = lazy(async () => { const module = await import('./store/FiscalWorkspace'); return { default: module.FiscalWorkspace }; });
const LazyStoreTeamWorkspace = lazy(async () => { const module = await import('./store/StoreTeamWorkspace'); return { default: module.StoreTeamWorkspace }; });
const LazyStorePayrollWorkspace = lazy(async () => { const module = await import('./store/StorePayrollWorkspace'); return { default: module.default }; });
const LazyPromotionalRuntime = lazy(async () => { const module = await import('./store/PromotionalDirectRuntime'); return { default: module.PromotionalDirectRuntime }; });
const LazyCrmRelationshipPanel = lazy(async () => { const module = await import('./store/StoreCrmRelationshipPanel'); return { default: module.StoreCrmRelationshipPanel }; });

function Loading({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-[10px] text-cyan-100">{children}</div>;
}

function DirectManagementModule({ moduleId, retailerProps, onBackToPdv }: { moduleId: ErpManagementModule; retailerProps: RetailerPanelProps; onBackToPdv: () => void }) {
  const definition = MANAGEMENT_MODULES[moduleId];
  return <section id={`kyrub-management-module-${moduleId}`} data-kyrub-management-module={moduleId} className="space-y-5">
    {moduleId !== 'rh' && <header className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-300">Módulo direto</span><h2 className="mt-1 text-lg font-black">{definition.title}</h2><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">{definition.description}</p></div><button type="button" onClick={onBackToPdv} className="min-h-10 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950">Voltar ao PDV</button></div></header>}
    {moduleId === 'integracoes' ? <Suspense fallback={<Loading>Carregando Integrações & Sandbox…</Loading>}><LazyIntegrationsRuntime triggerToast={retailerProps.triggerToast} /></Suspense>
      : moduleId === 'produtos' ? <Suspense fallback={<Loading>Carregando Produtos…</Loading>}><LazyProductInventoryRuntime activeRetailerId={retailerProps.activeRetailerId} activeStore={retailerProps.activeStore} products={retailerProps.products} setProducts={retailerProps.setProducts} triggerToast={retailerProps.triggerToast} /></Suspense>
      : moduleId === 'estoque' ? <Suspense fallback={<Loading>Carregando Estoque…</Loading>}><LazyStockRuntime storeId={retailerProps.activeRetailerId} /></Suspense>
      : moduleId === 'vendas' ? <Suspense fallback={<Loading>Carregando Vendas & Analytics…</Loading>}><LazySalesAnalyticsRuntime storeId={retailerProps.activeRetailerId} /></Suspense>
      : moduleId === 'assinaturas' ? <Suspense fallback={<Loading>Carregando Assinaturas…</Loading>}><LazySubscriptionsRuntime storeId={retailerProps.activeRetailerId} triggerToast={retailerProps.triggerToast} /></Suspense>
      : moduleId === 'financeiro' ? <Suspense fallback={<Loading>Carregando Financeiro Interno…</Loading>}><LazyFinanceRuntime storeId={retailerProps.activeRetailerId} /></Suspense>
      : moduleId === 'fiscal' ? <Suspense fallback={<Loading>Carregando Fiscal…</Loading>}><LazyFiscalWorkspace storeName={retailerProps.activeStore.name} canonicalStoreId={retailerProps.activeRetailerId} /></Suspense>
      : moduleId === 'rh' ? <Suspense fallback={<Loading>Carregando Equipe & Permissões…</Loading>}><div className="space-y-5"><LazyStoreTeamWorkspace legacyStore={retailerProps.activeStore} legacyStoreId={retailerProps.activeRetailerId} notify={retailerProps.triggerToast} /><LazyStorePayrollWorkspace legacyStoreId={retailerProps.activeRetailerId} notify={retailerProps.triggerToast} /></div></Suspense>
      : moduleId === 'vouchers' ? <Suspense fallback={<Loading>Carregando Promocionais…</Loading>}><LazyPromotionalRuntime storeId={retailerProps.activeRetailerId} /></Suspense>
      : moduleId === 'crm' ? <Suspense fallback={<Loading>Carregando CRM…</Loading>}><LazyCrmRelationshipPanel storeId={retailerProps.activeRetailerId} /></Suspense>
      : <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white"><span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">{definition.status === 'development' ? 'Em desenvolvimento' : 'Migração nativa'}</span><p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-slate-400">{definition.status === 'development' ? 'Este módulo já tem destino próprio no menu e será implementado sem depender do antigo painel Gerencial.' : 'Este módulo já tem destino próprio no menu. Sua funcionalidade será reativada diretamente aqui, sem restaurar estados locais ou bridges do antigo Gerencial.'}</p></div>}
  </section>;
}

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  const [managementModule, setManagementModule] = useState<ErpManagementModule | null>(() => mercadoLivreOAuthReturnModule());
  const previousActiveSubTabRef = useRef(props.activeSubTab);

  useEffect(() => {
    const handleManagementNavigation = (event: Event): void => {
      consumePendingErpManagementNavigation();
      setManagementModule(
        (event as CustomEvent<ErpManagementNavigationRequest>).detail?.module ?? null
      );
    };

    window.addEventListener(
      KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
      handleManagementNavigation
    );

    const pending = consumePendingErpManagementNavigation();
    if (pending) setManagementModule(pending.module);

    return () =>
      window.removeEventListener(
        KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
        handleManagementNavigation
      );
  }, []);

  useEffect(() => {
    if (previousActiveSubTabRef.current === props.activeSubTab) return;
    previousActiveSubTabRef.current = props.activeSubTab;
    setManagementModule(mercadoLivreOAuthReturnModule());
  }, [props.activeSubTab]);

  const backToPdv = (): void => { requestErpManagementNavigation(null); props.setActiveSubTab('clientes'); };
  if (managementModule) return <DirectManagementModule moduleId={managementModule} retailerProps={props} onBackToPdv={backToPdv} />;
  if (props.activeSubTab === 'gerencial') return <section className="rounded-3xl border border-amber-500/25 bg-slate-900 p-5 text-white"><span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">Rota desativada</span><h2 className="mt-2 text-base font-black">Gerencial foi removido.</h2><p className="mt-2 text-[11px] leading-relaxed text-slate-400">Os módulos de gestão agora são destinos diretos do menu. Esta rota antiga permanece apenas como proteção temporária para links legados e não monta o painel anterior.</p><button type="button" onClick={backToPdv} className="mt-4 min-h-10 rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase text-slate-950">Voltar ao PDV</button></section>;
  return <>
    <ModernRetailerPanel {...props} />
    {props.activeSubTab === 'pedidos' && (
      <>
        <KdsScopedRejectionController
          storeId={props.activeRetailerId}
          notify={props.triggerToast}
        />
        <PaidOrderRefundBridge
          storeId={props.activeRetailerId}
          notify={props.triggerToast}
        />
      </>
    )}
  </>;
};