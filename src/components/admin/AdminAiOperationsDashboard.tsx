import {
  Bot,
  CircleAlert,
  GitBranch,
  ListChecks,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import {
  KYRUB_AGENT_REGISTRY,
  KYRUB_WORKSTREAM_REGISTRY,
} from '../../../shared/aiOps/agentOperations';
import type { AdminProfile } from '../../utils/adminControlPlane';

const CRITICAL_WORKSTREAMS = new Set(['A', 'B', 'E']);

export default function AdminAiOperationsDashboard({
  profile,
}: {
  profile: AdminProfile;
}) {
  if (profile.role !== 'super_admin') return null;

  return (
    <section
      id="admin-ai-operations"
      aria-labelledby="admin-ai-operations-title"
      className="rounded-[2rem] border border-cyan-500/20 bg-slate-900/70 p-5 sm:p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-300">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400">
              AI Operations
            </span>
            <h2 id="admin-ai-operations-title" className="mt-1 text-lg font-black text-white">
              Equipe de IA do Kyrub
            </h2>
            <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
              Visão do Control Plane para agentes, workstreams e autoridade operacional. Esta primeira versão mostra o registry autoritativo do repositório; tarefas e execução ao vivo serão conectadas ao feed de evidências em uma etapa posterior.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <article className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <strong className="block text-lg text-white">{KYRUB_AGENT_REGISTRY.length}</strong>
            <span className="text-[8px] font-black uppercase text-slate-500">Agentes</span>
          </article>
          <article className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <strong className="block text-lg text-white">{KYRUB_WORKSTREAM_REGISTRY.length}</strong>
            <span className="text-[8px] font-black uppercase text-slate-500">Frentes</span>
          </article>
          <article className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <strong className="block text-lg text-amber-200">1</strong>
            <span className="text-[8px] font-black uppercase text-amber-300">Gate atual</span>
          </article>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Workflow className="h-4 w-4 text-cyan-400" />
            <h3 className="text-xs font-black uppercase tracking-wider text-white">Workstreams</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {KYRUB_WORKSTREAM_REGISTRY.map(workstream => (
              <article
                key={workstream.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[8px] font-black uppercase tracking-wider text-slate-600">
                      Frente {workstream.id}
                    </span>
                    <h4 className="mt-1 text-[11px] font-black text-slate-200">
                      {workstream.title}
                    </h4>
                  </div>
                  {CRITICAL_WORKSTREAMS.has(workstream.id) && (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[7px] font-black uppercase text-red-300">
                      crítico
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[9px] text-slate-500">
                  Owner: <strong className="text-slate-400">{workstream.ownerAgent}</strong>
                </p>
                <p className="mt-1 text-[9px] text-slate-600">
                  Dependências: {workstream.dependencies.length ? workstream.dependencies.join(', ') : 'nenhuma'}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-violet-400" />
            <h3 className="text-xs font-black uppercase tracking-wider text-white">Equipe configurada</h3>
          </div>
          <div className="space-y-2">
            {KYRUB_AGENT_REGISTRY.map(agent => (
              <article
                key={agent.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="min-w-0">
                  <h4 className="truncate text-[11px] font-black text-slate-200">{agent.title}</h4>
                  <p className="mt-0.5 truncate text-[8px] uppercase tracking-wider text-slate-600">
                    {agent.id} · {agent.workstream}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[7px] font-black uppercase text-emerald-300">
                  registrado
                </span>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-center gap-2 text-red-300">
            <CircleAlert className="h-4 w-4" />
            <strong className="text-[9px] uppercase tracking-wider">Release gate</strong>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
            #284 continua sendo a referência para sincronização entre main e produção. Merge não equivale a deploy.
          </p>
        </article>
        <article className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
          <div className="flex items-center gap-2 text-violet-300">
            <GitBranch className="h-4 w-4" />
            <strong className="text-[9px] uppercase tracking-wider">Programa atual</strong>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
            #286 coordena a operacionalização da equipe e a bateria de desenvolvimento #1–#67.
          </p>
        </article>
        <article className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-2 text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            <strong className="text-[9px] uppercase tracking-wider">Autoridade</strong>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
            KYC, MFA, credenciais reais, decisões comerciais e publicação jurídica permanecem Owner Gates.
          </p>
        </article>
      </div>
    </section>
  );
}
