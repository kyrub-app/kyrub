import type React from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';

export type GuidedWizardStep = {
  id: string;
  label: string;
  title: string;
  prompt: string;
};

interface GuidedWizardProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  steps: GuidedWizardStep[];
  activeIndex: number;
  canGoNext: boolean;
  busy?: boolean;
  nextLabel?: string;
  finishLabel?: string;
  error?: string;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function GuidedWizard({
  open,
  title,
  eyebrow = 'Kyrubia · Assistente guiada',
  steps,
  activeIndex,
  canGoNext,
  busy = false,
  nextLabel = 'Continuar',
  finishLabel = 'Concluir',
  error = '',
  onBack,
  onNext,
  onClose,
  children,
}: GuidedWizardProps) {
  if (!open) return null;

  const current = steps[activeIndex];
  const finished = activeIndex === steps.length - 1;
  const progress = Math.round(((activeIndex + 1) / steps.length) * 100);

  return (
    <div className="fixed inset-0 z-[180] flex items-end justify-center bg-slate-950/90 backdrop-blur-sm sm:items-center sm:p-6">
      <section className="flex max-h-[96dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[32px] border border-violet-500/20 bg-slate-950 shadow-2xl sm:rounded-[32px]">
        <header className="border-b border-slate-800 px-4 pb-4 pt-4 sm:px-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-violet-300">
                {eyebrow}
              </span>
              <h2 className="mt-1 text-xl font-black text-white">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 disabled:opacity-40"
              aria-label="Fechar assistente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-violet-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[9px] font-bold text-slate-500">
              {activeIndex + 1}/{steps.length}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="rounded-3xl border border-violet-500/20 bg-violet-500/[0.07] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[9px] font-black uppercase tracking-wider text-violet-300">
                {current.label}
              </span>
              <span className="rounded-full border border-violet-500/20 bg-slate-950 px-2 py-1 text-[8px] font-bold uppercase text-violet-200">
                Kyrubia
              </span>
            </div>
            <h3 className="mt-2 text-lg font-black text-white">{current.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{current.prompt}</p>
          </div>

          <div className="mt-4 space-y-4">{children}</div>

          {error && (
            <p className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        <footer className="grid grid-cols-[auto_1fr] gap-3 border-t border-slate-800 p-4 sm:p-5">
          <button
            type="button"
            onClick={onBack}
            disabled={activeIndex === 0 || busy}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-300 disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canGoNext || busy}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 text-sm font-black text-white disabled:opacity-40"
          >
            {busy ? 'Salvando...' : finished ? finishLabel : nextLabel}
            {finished ? <Check className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </footer>
      </section>
    </div>
  );
}
