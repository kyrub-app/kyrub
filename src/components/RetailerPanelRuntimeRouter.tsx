import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { RetailerPanel as ModernRetailerPanel } from './RetailerPanel';
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
  produtos: { title: 'Produtos & Estoque', description: 'Catálogo, publicação, estoque e edição dos itens da loja.', status: 'native' },
  vendas: { title: 'Vendas & Analytics', description: 'Indicadores e leitura operacional das vendas da loja.', status: 'migration' },
  financeiro: { title: 'Financeiro Interno', description: 'Custos, entradas, obrigações e projeções financeiras da operação.', status: 'migration' },
  rh: { title: 'Recursos Humanos', description: 'Equipe, cargos, acessos e rotinas da loja única do usuário.', status: 'migration' },
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
const LazyPromotionalRuntime = lazy(async () => { const module = await import('./store/PromotionalDirectRuntime'); return { default: module.PromotionalDirectRuntime }; });
const LazyCrmRelationshipPanel = lazy(async () => { const module = await import('./store/StoreCrmRelationshipPanel'); return { default: module.StoreCrmRelationshipPanel }; });

function Loading({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-[10px] text-cyan-100">{children}</div>;
}

function DirectManagementModule({ moduleId, retailerProps, onBackToPdv }: { moduleId: ErpManagementModule; retailerProps: RetailerPanelProps; onBackToPdv: () => void }) {
  const definition = MANAGEMENT_MODULES[moduleId];
  return <section id={`kyrub-management-module-${moduleId}`} data-kyrub-management-module={moduleId} className="space-y-5">
    <header className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-300">Módulo direto</span><h2 className="mt-1 text-lg font-black">{definition.title}</h2><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">{definition.description}</p></div><button type="button" onClick={onBackToPdv} className="min-h-10 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950">Voltar ao PDV</button></div></header>
    {moduleId === 'integracoes' ? <Suspense fallback={<Loading>Carregando Integrações & Sandbox…</Loading>}><LazyIntegrationsRuntime triggerToast={retailerProps.triggerToast} /></Suspense>
      : moduleId === 'produtos' ? <Suspense fallback={<Loading>Carregando Produtos & Estoque…</Loading>}><LazyProductInventoryRuntime activeRetailerId={retailerProps.activeRetailerId} activeStore={retailerProps.activeStore} products={retailerProps.products} setProducts={retailerProps.setProducts} triggerToast={retailerProps.triggerToast} /></Suspense>
      : moduleId === 'vouchers' ? <Suspense fallback={<Loading>Carregando Promocionais…</Loading>}><LazyPromotionalRuntime /></Suspense>
      : moduleId === 'crm' ? <Suspense fallback={<Loading>Carregando CRM…</Loading>}><LazyCrmRelationshipPanel storeId={retailerProps.activeRetailerId} /></Suspense>
      : <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white"><span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">{definition.status === 'development' ? 'Em desenvolvimento' : 'Migração nativa'}</span><p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-slate-400">{definition.status === 'development' ? 'Este módulo já tem destino próprio no menu e será implementado sem depender do antigo painel Gerencial.' : 'Este módulo já tem destino próprio no menu. Sua funcionalidade será reativada diretamente aqui, sem restaurar estados locais ou bridges do antigo Gerencial.'}</p></div>}
  </section>;
}

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  const [managementModule, setManagementModule] = useState<ErpManagementModule | null>(() => mercadoLivreOAuthReturnModule());
  const previousActiveSubTabRef = useRef(props.activeSubTab);

  useEffect(() => {
    const handleManagementNavigation = (event: Event): void => {
      // Clear the retained request when the live listener receives it so a later
      // remount cannot replay an already-applied selection.
      consumePendingErpManagementNavigation();
      setManagementModule(
        (event as CustomEvent<ErpManagementNavigationRequest>).detail?.module ?? null
      );
    };

    window.addEventListener(
      KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
      handleManagementNavigation
    );

    // If the mobile dialog committed its selection before this effect existed,
    // apply that one retained intent now. This closes the first-tap race without
    // persisting navigation across reloads.
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
  return <ModernRetailerPanel {...props} />;
};
