import React, { lazy, Suspense, useEffect, useState } from 'react';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { RetailerPanel as ModernRetailerPanel } from './RetailerPanel';
import {
  KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
  requestErpManagementNavigation,
  type ErpManagementModule,
  type ErpManagementNavigationRequest,
} from '../utils/erpManagementNavigation';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

type ModuleDefinition = {
  title: string;
  description: string;
  status: 'native' | 'migration' | 'development';
};

const MANAGEMENT_MODULES: Record<ErpManagementModule, ModuleDefinition> = {
  produtos: {
    title: 'Produtos & Estoque',
    description: 'Catálogo, publicação, estoque e edição dos itens da loja.',
    status: 'migration',
  },
  vendas: {
    title: 'Vendas & Analytics',
    description: 'Indicadores e leitura operacional das vendas da loja.',
    status: 'migration',
  },
  financeiro: {
    title: 'Financeiro Interno',
    description: 'Custos, entradas, obrigações e projeções financeiras da operação.',
    status: 'migration',
  },
  rh: {
    title: 'Recursos Humanos',
    description: 'Equipe, cargos, acessos e rotinas da loja única do usuário.',
    status: 'migration',
  },
  crm: {
    title: 'CRM',
    description: 'Relacionamento, segmentação, histórico e inteligência sobre clientes.',
    status: 'development',
  },
  marketing: {
    title: 'Marketing',
    description: 'Aquisição, conversão, retenção, canais e inteligência de crescimento.',
    status: 'development',
  },
  integracoes: {
    title: 'Integrações & Sandbox',
    description: 'Conexões externas, OAuth, sincronização e testes controlados dos canais.',
    status: 'native',
  },
  vouchers: {
    title: 'Cupons & Vouchers',
    description: 'Incentivos promocionais separados de CRM e Marketing.',
    status: 'migration',
  },
};

const mercadoLivreOAuthReturnModule = (): ErpManagementModule | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('integration') === 'mercado_livre' ? 'integracoes' : null;
};

const LazyIntegrationsRuntime = lazy(async () => {
  const module = await import('./GerencialIntegrationsRuntime');
  return { default: module.GerencialIntegrationsRuntime };
});

function DirectManagementModule({
  moduleId,
  triggerToast,
  onBackToPdv,
}: {
  moduleId: ErpManagementModule;
  triggerToast: RetailerPanelProps['triggerToast'];
  onBackToPdv: () => void;
}) {
  const definition = MANAGEMENT_MODULES[moduleId];

  return (
    <section
      id={`kyrub-management-module-${moduleId}`}
      data-kyrub-management-module={moduleId}
      className="space-y-5"
    >
      <header className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-300">
              Módulo direto
            </span>
            <h2 className="mt-1 text-lg font-black">{definition.title}</h2>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">
              {definition.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToPdv}
            className="min-h-10 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950"
          >
            Voltar ao PDV
          </button>
        </div>
      </header>

      {moduleId === 'integracoes' ? (
        <Suspense
          fallback={
            <div className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-[10px] text-cyan-100">
              Carregando Integrações & Sandbox…
            </div>
          }
        >
          <LazyIntegrationsRuntime triggerToast={triggerToast} />
        </Suspense>
      ) : (
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
            {definition.status === 'development'
              ? 'Em desenvolvimento'
              : 'Migração nativa'}
          </span>
          <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-slate-400">
            {definition.status === 'development'
              ? 'Este módulo já tem destino próprio no menu e será implementado sem depender do antigo painel Gerencial.'
              : 'Este módulo já tem destino próprio no menu. Sua funcionalidade será reativada diretamente aqui, sem restaurar estados locais ou bridges do antigo Gerencial.'}
          </p>
        </div>
      )}
    </section>
  );
}

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  const [managementModule, setManagementModule] =
    useState<ErpManagementModule | null>(() => mercadoLivreOAuthReturnModule());

  useEffect(() => {
    const handleManagementNavigation = (event: Event): void => {
      const detail = (event as CustomEvent<ErpManagementNavigationRequest>).detail;
      setManagementModule(detail?.module ?? null);
    };

    window.addEventListener(
      KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
      handleManagementNavigation
    );
    return () => {
      window.removeEventListener(
        KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
        handleManagementNavigation
      );
    };
  }, []);

  useEffect(() => {
    setManagementModule(mercadoLivreOAuthReturnModule());
  }, [props.activeSubTab]);

  const backToPdv = (): void => {
    requestErpManagementNavigation(null);
    props.setActiveSubTab('clientes');
  };

  if (managementModule) {
    return (
      <DirectManagementModule
        moduleId={managementModule}
        triggerToast={props.triggerToast}
        onBackToPdv={backToPdv}
      />
    );
  }

  if (props.activeSubTab === 'gerencial') {
    return (
      <section className="rounded-3xl border border-amber-500/25 bg-slate-900 p-5 text-white">
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">
          Rota desativada
        </span>
        <h2 className="mt-2 text-base font-black">Gerencial foi removido.</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Os módulos de gestão agora são destinos diretos do menu. Esta rota antiga permanece apenas como proteção temporária para links legados e não monta o painel anterior.
        </p>
        <button
          type="button"
          onClick={backToPdv}
          className="mt-4 min-h-10 rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase text-slate-950"
        >
          Voltar ao PDV
        </button>
      </section>
    );
  }

  return <ModernRetailerPanel {...props} />;
};