import { useState } from 'react';
import type { User } from 'firebase/auth';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import {
  loadNinetyNineFoodE2EStatusProof,
  type NinetyNineFoodE2EProofStep,
  type NinetyNineFoodE2EStatusProofSnapshot,
} from '../../utils/ninetyNineFoodE2EStatusProof';
import type { NinetyNineFoodE2ETestSubject } from '../../utils/ninetyNineFoodE2ETestSubject';

const stateLabel = (step: NinetyNineFoodE2EProofStep): string => {
  switch (step.state) {
    case 'proven': return 'provado';
    case 'attention': return 'atenção';
    case 'blocked': return 'bloqueado';
    default: return 'aguardando';
  }
};

const stateClass = (step: NinetyNineFoodE2EProofStep): string => {
  switch (step.state) {
    case 'proven': return 'border-emerald-500/25 text-emerald-300';
    case 'attention': return 'border-amber-500/25 text-amber-300';
    case 'blocked': return 'border-rose-500/25 text-rose-300';
    default: return 'border-slate-700 text-slate-500';
  }
};

const ProofStep = ({
  index,
  title,
  step,
}: {
  index: number;
  title: string;
  step: NinetyNineFoodE2EProofStep;
}) => (
  <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <strong className="block text-[9px] text-slate-100">
          {index}. {title}
        </strong>
        <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
          {step.note}
        </p>
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-black uppercase ${stateClass(step)}`}>
        {stateLabel(step)}
      </span>
    </div>
    {(step.status || step.orderRevision || step.executionId || step.observedAt) && (
      <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[7px] text-slate-600">
        {step.status && <span>status: {step.status}</span>}
        {step.orderRevision && <span>· revision: {step.orderRevision}</span>}
        {step.executionId && <span>· execution: {step.executionId}</span>}
        {step.observedAt && <span>· observado: {step.observedAt}</span>}
      </div>
    )}
  </article>
);

export default function NinetyNineFoodE2EStatusProofPanel({
  user,
  subject,
}: {
  user: User;
  subject: NinetyNineFoodE2ETestSubject;
}) {
  const [snapshot, setSnapshot] = useState<NinetyNineFoodE2EStatusProofSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await loadNinetyNineFoodE2EStatusProof(user, subject));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível reconsultar a prova de status da cobaia 99Food.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      id="kyrub-99food-e2e-status-proof"
      className="space-y-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.025] p-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <strong className="block text-[8px] font-black uppercase tracking-wide text-violet-200">
            Prova de autoridade de status · cobaia {subject.displayId}
          </strong>
          <p className="mt-1 max-w-3xl text-[8px] leading-relaxed text-slate-500">
            Este medidor só lê a fila pendente autoritativa e as respostas já registradas nesta sessão. Ele não executa transição, não autoriza provider write, não envia status e não reconcilia nada.
          </p>
        </div>
        <button
          id="kyrub-refresh-99food-e2e-status-proof"
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-violet-500/25 px-3 text-[8px] font-black uppercase text-violet-200 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Reconsultar prova
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-3 text-[8px] text-rose-200">
          {error}
        </p>
      )}

      {!snapshot && !error && (
        <p className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[8px] text-slate-500">
          Faça as ações de status pela superfície normal do KDS e pela fila manual 99Food. Depois reconsulte aqui para provar a sequência; nenhum passo é disparado por este painel.
        </p>
      )}

      {snapshot && (
        <div className="space-y-2">
          <ProofStep
            index={1}
            title="Kyrub-only gera pendência de revisão exata"
            step={snapshot.kyrubOnly}
          />
          <ProofStep
            index={2}
            title="Envio manual não repete a transição local"
            step={snapshot.manualSync}
          />
          <ProofStep
            index={3}
            title="Status seguinte usa Kyrub + 99Food"
            step={snapshot.nextDirectSync}
          />

          {snapshot.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.045] p-3">
              <strong className="text-[8px] font-black uppercase text-amber-200">
                Pare e revise
              </strong>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[8px] leading-relaxed text-amber-100/75">
                {snapshot.warnings.map(warning => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}
          <p className="text-right font-mono text-[7px] text-slate-700">
            leitura da prova: {snapshot.observedAt}
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.035] p-3 text-[8px] leading-relaxed text-amber-100/70">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          `orderRevision`, `executionId` e resultados exibidos aqui são somente evidência. Este painel nunca os devolve a uma rota de escrita e nunca faz retry automático.
        </span>
      </div>
    </section>
  );
}
