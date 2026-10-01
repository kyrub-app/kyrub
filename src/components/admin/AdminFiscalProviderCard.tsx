import { CircleAlert, CircleCheck, FileCheck2, LockKeyhole } from 'lucide-react';

export interface AdminFiscalProviderReadinessView {
  providerId: 'focus-nfe';
  providerReady: boolean;
  storeReady: boolean;
  productionTrafficAllowed: false;
  blockers: string[];
}

const blockerLabel = (value: string): string => ({
  provider_not_ready: 'Provider global ainda não está pronto',
  store_not_production_authorized: 'Nenhuma loja selecionada está autorizada para produção',
}[value] ?? value);

/** Read-only backstage projection. It deliberately exposes no token and no emission action. */
export default function AdminFiscalProviderCard({
  readiness,
}: {
  readiness?: AdminFiscalProviderReadinessView | null;
}) {
  const providerReady = readiness?.providerReady === true;
  const storeReady = readiness?.storeReady === true;

  return (
    <article className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-wider text-violet-400">Kyrub Fiscal · backstage</span>
          <h3 className="mt-1 text-sm font-black text-white">Focus NFe · driver fiscal gerenciado</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            A Focus opera como infraestrutura interna. Credenciais e autoridade de produção permanecem no backend; o lojista usa o Emissor Fiscal Kyrub.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase text-slate-300">
          {providerReady ? <CircleCheck className="h-3.5 w-3.5 text-emerald-400" /> : <CircleAlert className="h-3.5 w-3.5 text-amber-400" />}
          {providerReady ? 'Provider pronto' : 'Provider não pronto'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Focus global</p>
          <p className="mt-1 text-xs font-bold text-slate-200">{providerReady ? 'Ready' : 'Bloqueado'}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Loja fiscal</p>
          <p className="mt-1 text-xs font-bold text-slate-200">{storeReady ? 'Produção autorizada' : 'Não autorizada'}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Tráfego produtivo</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-slate-200"><LockKeyhole className="h-3.5 w-3.5 text-amber-400" /> Bloqueado no painel</p>
        </div>
      </div>

      {(readiness?.blockers.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-[9px] font-black uppercase tracking-wider text-amber-300">Pendências de readiness</p>
          <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
            {readiness?.blockers.map(blocker => <li key={blocker}>• {blockerLabel(blocker)}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/35 p-3 text-[10px] leading-relaxed text-slate-500">
        <FileCheck2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
        Esta visão é somente operacional. Ela não recebe token Focus, não cria capability de produção e não possui ação de emissão fiscal.
      </div>
    </article>
  );
}
