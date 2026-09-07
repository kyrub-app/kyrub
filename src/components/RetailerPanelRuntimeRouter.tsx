import React from 'react';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { RetailerPanel as ModernRetailerPanel } from './RetailerPanel';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

const GERENCIAL_MODULES = [
  ['Produtos & Estoque', 'Catálogo, publicação, estoque e edição dos itens da loja.'],
  ['Vendas & Analytics', 'Indicadores e leitura operacional das vendas da loja.'],
  ['Financeiro Interno', 'Custos, entradas, obrigações e projeções financeiras da operação.'],
  ['Recursos Humanos', 'Equipe, cargos, acessos e rotinas da loja única do usuário.'],
  ['CRM', 'Relacionamento, segmentação, histórico e inteligência sobre clientes.'],
  ['Marketing', 'Aquisição, conversão, retenção, canais e inteligência de crescimento.'],
  ['Integrações & Sandbox', 'Conexões externas, OAuth, sincronização e testes controlados dos canais.'],
  ['Cupons & Vouchers', 'Incentivos promocionais separados de CRM e Marketing.'],
] as const;

const GerencialInlineShell: React.FC<{
  onBackToPdv: () => void;
}> = ({ onBackToPdv }) => (
  <section
    id="kyrub-gerencial-inline-shell"
    data-kyrub-gerencial-runtime="inline-shell"
    className="space-y-5"
  >
    <header className="rounded-3xl border border-emerald-500/25 bg-slate-900 p-5 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">
            Painel Gerencial
          </span>
          <h2 className="mt-1 text-lg font-black">Gestão da loja</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">
            Shell direto do runtime. Nenhum módulo, bridge, listener ou integração é carregado nesta entrada.
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

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" id="kyrub-gerencial-inline-module-grid">
      {GERENCIAL_MODULES.map(([title, description]) => (
        <button
          key={title}
          type="button"
          className="min-h-32 rounded-3xl border border-slate-800 bg-slate-900 p-5 text-left text-white"
          aria-label={title}
        >
          <h3 className="text-xs font-black uppercase">{title}</h3>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{description}</p>
        </button>
      ))}
    </div>
  </section>
);

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  if (props.activeSubTab === 'gerencial') {
    return (
      <GerencialInlineShell
        onBackToPdv={() => props.setActiveSubTab('clientes')}
      />
    );
  }

  return <ModernRetailerPanel {...props} />;
};
