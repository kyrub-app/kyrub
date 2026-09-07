import React from 'react';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { RetailerPanel as ModernRetailerPanel } from './RetailerPanel';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

const GerencialStaticProbe: React.FC<{
  onBackToPdv: () => void;
}> = ({ onBackToPdv }) => (
  <section
    data-kyrub-gerencial-runtime="static-probe"
    className="space-y-4 rounded-3xl border border-emerald-500/30 bg-slate-900 p-6 text-white"
  >
    <div>
      <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">
        Diagnóstico Gerencial
      </span>
      <h3 className="mt-2 text-lg font-black">Gerencial runtime OK</h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Esta tela não monta o Gerencial legado, não cria #erp-gerencial-tab e não ativa bridges de DOM do painel.
      </p>
    </div>

    <button
      type="button"
      onClick={onBackToPdv}
      className="min-h-11 rounded-xl bg-orange-500 px-4 text-xs font-black uppercase text-slate-950"
    >
      Voltar ao PDV
    </button>
  </section>
);

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  if (props.activeSubTab === 'gerencial') {
    return (
      <GerencialStaticProbe
        onBackToPdv={() => props.setActiveSubTab('clientes')}
      />
    );
  }

  return <ModernRetailerPanel {...props} />;
};
