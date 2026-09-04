import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, BadgeCheck, CircleHelp, RefreshCw, TestTube2 } from 'lucide-react';
import {
  loadOmnichannelE2EReadiness,
  type OmnichannelE2EGate,
  type OmnichannelE2EReadiness,
} from '../../utils/omnichannelE2EReadiness';

const gatePresentation = (gate: OmnichannelE2EGate): {
  label: string;
  className: string;
  icon: typeof BadgeCheck;
} => {
  switch (gate.state) {
    case 'ready':
      return {
        label: 'Pronto',
        className: 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200',
        icon: BadgeCheck,
      };
    case 'blocked':
      return {
        label: 'Bloqueado',
        className: 'border-rose-500/20 bg-rose-500/[0.06] text-rose-200',
        icon: AlertTriangle,
      };
    case 'attention':
      return {
        label: 'Atenção',
        className: 'border-amber-500/20 bg-amber-500/[0.06] text-amber-200',
        icon: AlertTriangle,
      };
    default:
      return {
        label: 'Leitura parcial',
        className: 'border-slate-700 bg-slate-950/60 text-slate-300',
        icon: CircleHelp,
      };
  }
};

const overallText = (readiness: OmnichannelE2EReadiness): string => {
  switch (readiness.overall) {
    case 'ready':
      return 'A leitura atual não encontrou bloqueios prévios. As bancadas provider-specific podem ser executadas na ordem controlada, mantendo cada write atrás da sua autorização explícita.';
    case 'attention':
      return 'As conexões estruturais estão disponíveis, mas existem pendências prévias que podem contaminar a evidência de um novo ciclo. Revise-as antes do E2E amplo.';
    case 'blocked':
      return 'Existe pelo menos um pré-requisito estrutural bloqueado. O Kyrub não deve iniciar o ciclo amplo enquanto essa autoridade/conexão não estiver resolvida.';
    default:
      return 'Uma ou mais fontes não puderam ser lidas. Esta tela não interpreta ausência de dados como prontidão.';
  }
};

const scrollTo = (elementId: string): void => {
  document.getElementById(elementId)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
};

export default function OmnichannelE2EReadinessPanel({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [readiness, setReadiness] = useState<OmnichannelE2EReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    if (user.uid !== storeId) {
      setReadiness(null);
      setError('A prontidão E2E só pode ser consultada pelo owner autenticado desta loja.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setReadiness(await loadOmnichannelE2EReadiness(user, storeId));
    } catch (cause) {
      setReadiness(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível montar a leitura de prontidão E2E.'
      );
    } finally {
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      id="kyrub-omnichannel-e2e-readiness"
      className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-300">
            <TestTube2 className="h-3.5 w-3.5" />
            E2E omnichannel · prontidão
          </span>
          <h3 className="mt-1 text-sm font-black text-white">
            Uma leitura antes de qualquer teste real
          </h3>
          <p className="mt-2 max-w-3xl text-[9px] leading-relaxed text-slate-400">
            Este painel agrega somente leituras autoritativas já existentes. Ele não cria anúncio, não altera estoque, não reserva pedido, não muda status e não envia nada a Mercado Livre ou 99Food.
          </p>
        </div>
        <button
          id="kyrub-refresh-omnichannel-e2e-readiness"
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyan-500/25 bg-slate-950 px-3 text-[8px] font-black uppercase text-cyan-200 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar leitura
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-3 text-[9px] leading-relaxed text-rose-200">
          {error}
        </p>
      )}

      {!error && !readiness && (
        <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[9px] text-slate-400">
          {loading ? 'Consultando fontes autoritativas…' : 'Nenhuma leitura de prontidão disponível.'}
        </p>
      )}

      {readiness && (
        <>
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/55 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[8px] font-black uppercase text-slate-500">Estado geral</span>
              <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
                readiness.overall === 'ready'
                  ? 'border-emerald-500/25 text-emerald-300'
                  : readiness.overall === 'blocked'
                    ? 'border-rose-500/25 text-rose-300'
                    : readiness.overall === 'attention'
                      ? 'border-amber-500/25 text-amber-300'
                      : 'border-slate-700 text-slate-300'
              }`}>
                {readiness.overall}
              </span>
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-slate-300">
              {overallText(readiness)}
            </p>
            <p className="mt-2 text-[8px] text-slate-600">
              Leitura pontual: {readiness.checkedAt}
            </p>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {readiness.gates.map(item => {
              const presentation = gatePresentation(item);
              const Icon = presentation.icon;
              return (
                <article
                  key={item.id}
                  className={`rounded-xl border p-3 ${presentation.className}`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-[9px] text-current">{item.label}</strong>
                        <span className="text-[7px] font-black uppercase opacity-70">
                          {presentation.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[8px] leading-relaxed opacity-80">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {readiness.sourceErrors.length > 0 && (
            <p className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-[8px] leading-relaxed text-slate-400">
              Fontes parciais: {readiness.sourceErrors.join(' · ')}. O painel mantém o estado parcial em vez de concluir “sem pendências”.
            </p>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              id="kyrub-open-mercado-livre-e2e-bench"
              type="button"
              onClick={() => scrollTo('kyrub-mercado-livre-channel-detail')}
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-300"
            >
              Ir para bancada Mercado Livre
            </button>
            <button
              id="kyrub-open-99food-e2e-bench"
              type="button"
              onClick={() => scrollTo('kyrub-99food-channel-detail')}
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-300"
            >
              Ir para bancada 99Food
            </button>
          </div>

          <p className="mt-3 text-[8px] leading-relaxed text-slate-500">
            “Pronto” aqui significa apenas que os pré-requisitos lidos não bloquearam o início. Cada bancada continua exigindo suas próprias revisões, autorizações one-time e reconciliações antes/depois de qualquer write real.
          </p>
        </>
      )}
    </section>
  );
}
