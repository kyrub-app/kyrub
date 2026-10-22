import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  section: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  version: number;
}

/**
 * An admin submodule must never take down the complete Control Plane.
 * Backend fetch failures remain handled locally by each workspace.
 */
export default class AdminWorkspaceRecoveryBoundary extends Component<Props, State> {
  state: State = { error: null, version: 0 };

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser's console supplies the actual component stack. Do not
    // send authentication tokens or error payloads to a telemetry endpoint.
    console.error('[Kyrub Admin Workspace Error]', {
      section: this.props.section,
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  private reset = (): void => {
    this.setState(previous => ({ error: null, version: previous.version + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <section role="alert" className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-slate-100">
          <strong className="block text-sm font-black">Falha isolada em {this.props.section}</strong>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            Esta área não pôde ser exibida. As outras seções continuam disponíveis.
            Nenhuma integração financeira foi alterada por esta mensagem.
          </p>
          <button type="button" onClick={this.reset}
            className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-100">
            Tentar abrir esta seção novamente
          </button>
          <details className="mt-3 text-[10px] text-slate-400">
            <summary className="cursor-pointer">Detalhes para diagnóstico</summary>
            <code className="mt-2 block break-words">{this.state.error.name}</code>
          </details>
        </section>
      );
    }
    return <div key={this.state.version}>{this.props.children}</div>;
  }
}
