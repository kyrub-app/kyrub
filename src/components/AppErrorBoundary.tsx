import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  incidentId: string;
}

const createIncidentId = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `KYR-${timestamp}-${random}`;
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    incidentId: '',
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      error,
      incidentId: createIncidentId(),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const incidentId = this.state.incidentId || createIncidentId();
    const diagnostic = {
      incidentId,
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
      occurredAt: new Date().toISOString(),
    };

    console.error('[Kyrub Client Error]', diagnostic);

    window.dispatchEvent(
      new CustomEvent('kyrub:client-error', {
        detail: diagnostic,
      })
    );
  }

  private reload = (): void => {
    window.location.reload();
  };

  private returnHome = (): void => {
    window.location.assign('/');
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <section
          className="w-full max-w-lg rounded-[2rem] border border-red-500/20 bg-slate-900 p-6 shadow-2xl shadow-black/30 sm:p-8"
          role="alert"
          aria-live="assertive"
        >
          <span className="text-[10px] font-black uppercase tracking-[0.22em] text-red-300">
            Recuperação do Kyrub
          </span>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
            Algo inesperado interrompeu esta tela
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Seus dados já sincronizados continuam preservados. Recarregue o
            aplicativo para tentar recuperar a sessão ou volte ao início.
          </p>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-500">
              Código do incidente
            </span>
            <code className="mt-1 block break-all text-xs text-slate-300">
              {this.state.incidentId}
            </code>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={this.reload}
              className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-orange-400"
            >
              Recarregar o Kyrub
            </button>
            <button
              type="button"
              onClick={this.returnHome}
              className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-black text-slate-100 transition hover:bg-slate-700"
            >
              Voltar ao início
            </button>
          </div>
        </section>
      </main>
    );
  }
}
