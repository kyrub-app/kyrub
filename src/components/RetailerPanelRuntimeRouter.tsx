import React from 'react';
import { GerencialPanel } from './GerencialPanelRuntime';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { RetailerPanel as ModernRetailerPanel } from './RetailerPanel';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

type GerencialPanelErrorBoundaryProps = {
  children: React.ReactNode;
  onRecover: () => void;
};

type GerencialPanelErrorBoundaryState = {
  error: Error | null;
};

class GerencialPanelErrorBoundary extends React.Component<
  GerencialPanelErrorBoundaryProps,
  GerencialPanelErrorBoundaryState
> {
  state: GerencialPanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): GerencialPanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Falha contida no Painel Gerencial.', error, info.componentStack);
  }

  private recover = (): void => {
    this.setState({ error: null });
    this.props.onRecover();
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <section
        id="erp-gerencial-recovery-boundary"
        className="rounded-3xl border border-red-500/25 bg-slate-900 p-6 text-white"
        role="alert"
      >
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-red-300">
          Painel Gerencial isolado
        </span>
        <h3 className="mt-2 text-base font-black">Não foi possível abrir o Gerencial.</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          A falha ficou contida nesta área. As demais funções do Kyrub continuam disponíveis.
        </p>
        <button
          type="button"
          onClick={this.recover}
          className="mt-4 min-h-11 rounded-xl bg-orange-500 px-4 text-xs font-black uppercase text-slate-950"
        >
          Voltar ao PDV
        </button>
      </section>
    );
  }
}

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  if (props.activeSubTab === 'gerencial') {
    return (
      <GerencialPanelErrorBoundary
        key={`${props.activeRetailerId}-gerencial-native`}
        onRecover={() => props.setActiveSubTab('clientes')}
      >
        <GerencialPanel
          activeRetailerId={props.activeRetailerId}
          activeStore={props.activeStore}
          products={props.products}
          orders={props.orders}
          setProducts={props.setProducts}
          setNewProductModal={props.setNewProductModal}
          triggerToast={props.triggerToast}
          setActiveSubTab={props.setActiveSubTab}
        />
      </GerencialPanelErrorBoundary>
    );
  }

  return <ModernRetailerPanel {...props} />;
};
