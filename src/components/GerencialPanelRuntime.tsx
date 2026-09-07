import { lazy, Suspense, useState } from 'react';
import type React from 'react';
import type { Order, Product, Store } from '../types';

type GerencialModule =
  | 'produtos'
  | 'vendas'
  | 'financeiro'
  | 'rh'
  | 'integracoes'
  | 'vouchers';

type ToastType = 'success' | 'error' | 'info';

interface GerencialPanelProps {
  activeRetailerId: string;
  activeStore: Store;
  products: Product[];
  orders: Order[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setNewProductModal: (value: boolean) => void;
  triggerToast: (message: string, type?: ToastType) => void;
  setActiveSubTab: (
    tab: 'clientes' | 'caixa' | 'pedidos' | 'reservas' | 'ponto' | 'gerencial'
  ) => void;
}

const LazyIntegrationsRuntime = lazy(async () => {
  const module = await import('./GerencialIntegrationsRuntime');
  return { default: module.GerencialIntegrationsRuntime };
});

const MODULES: Array<{
  id: GerencialModule | 'crm' | 'marketing';
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
}> = [
  {
    id: 'produtos',
    title: 'Produtos & Estoque',
    description: 'Catálogo, publicação, estoque e edição dos itens da loja.',
    badge: 'Próximo corte',
  },
  {
    id: 'vendas',
    title: 'Vendas & Analytics',
    description: 'Indicadores e leitura operacional das vendas da loja.',
    badge: 'Próximo corte',
  },
  {
    id: 'financeiro',
    title: 'Financeiro Interno',
    description: 'Custos, entradas, obrigações e projeções financeiras da operação.',
    badge: 'Migração nativa',
  },
  {
    id: 'rh',
    title: 'Recursos Humanos',
    description: 'Equipe, cargos, acessos e rotinas da loja única do usuário.',
    badge: 'Migração nativa',
  },
  {
    id: 'crm',
    title: 'CRM',
    description: 'Relacionamento, segmentação, histórico e inteligência sobre clientes.',
    badge: 'Em desenvolvimento',
    disabled: true,
  },
  {
    id: 'marketing',
    title: 'Marketing',
    description: 'Aquisição, conversão, retenção, canais e inteligência de crescimento.',
    badge: 'Em desenvolvimento',
    disabled: true,
  },
  {
    id: 'integracoes',
    title: 'Integrações & Sandbox',
    description: 'Conexões externas, OAuth, sincronização e testes controlados dos canais.',
  },
  {
    id: 'vouchers',
    title: 'Cupons & Vouchers',
    description: 'Incentivos promocionais separados de CRM e Marketing.',
    badge: 'Migração nativa',
  },
];

const TITLES: Record<GerencialModule, string> = {
  produtos: 'Produtos & Estoque',
  vendas: 'Vendas & Analytics',
  financeiro: 'Financeiro Interno',
  rh: 'Recursos Humanos',
  integracoes: 'Integrações & Sandbox',
  vouchers: 'Cupons & Vouchers',
};

function MigrationNotice({ title }: { title: string }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white">
      <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-300">
        Runtime isolado
      </span>
      <h3 className="mt-2 text-sm font-black">{title}</h3>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        Este módulo ainda não foi reativado neste runtime. Ele será ligado em um corte próprio, sem reintroduzir o painel legado que congelava a aplicação.
      </p>
    </section>
  );
}

export function GerencialPanel({
  triggerToast,
  setActiveSubTab,
}: GerencialPanelProps) {
  const [activeModule, setActiveModule] = useState<GerencialModule | null>(null);

  return (
    <div
      id="kyrub-gerencial-native-runtime"
      data-kyrub-gerencial-runtime="lazy-shell"
      className="space-y-5"
    >
      <header className="rounded-3xl border border-emerald-500/25 bg-slate-900 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">
              Painel Gerencial
            </span>
            <h2 className="mt-1 text-lg font-black">
              {activeModule ? TITLES[activeModule] : 'Gestão da loja'}
            </h2>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">
              A raiz do Gerencial não carrega Firebase, catálogo, pedidos, Mercado Livre ou bridges. Cada módulo nasce somente depois do clique.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {activeModule && (
              <button
                type="button"
                onClick={() => setActiveModule(null)}
                className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300"
              >
                Menu Gerencial
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveSubTab('clientes')}
              className="min-h-10 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950"
            >
              Voltar ao PDV
            </button>
          </div>
        </div>
      </header>

      {!activeModule && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" id="kyrub-gerencial-module-grid">
          {MODULES.map(module => (
            <button
              key={module.id}
              type="button"
              disabled={module.disabled}
              onClick={() => {
                if (!module.disabled && module.id !== 'crm' && module.id !== 'marketing') {
                  setActiveModule(module.id);
                }
              }}
              className={`relative min-h-32 rounded-3xl border border-slate-800 bg-slate-900 p-5 text-left text-white ${
                module.disabled
                  ? 'cursor-not-allowed opacity-65'
                  : 'cursor-pointer hover:border-orange-500/35'
              }`}
            >
              {module.badge && (
                <span className="absolute right-4 top-4 rounded-full border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[8px] font-black uppercase tracking-wider text-slate-400">
                  {module.badge}
                </span>
              )}
              <h3 className="pr-24 text-xs font-black uppercase">{module.title}</h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                {module.description}
              </p>
            </button>
          ))}
        </div>
      )}

      {activeModule === 'integracoes' && (
        <Suspense
          fallback={
            <div className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-[10px] text-cyan-100">
              Carregando Integrações & Sandbox…
            </div>
          }
        >
          <LazyIntegrationsRuntime triggerToast={triggerToast} />
        </Suspense>
      )}

      {activeModule && activeModule !== 'integracoes' && (
        <MigrationNotice title={TITLES[activeModule]} />
      )}
    </div>
  );
}
