import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { ClipboardCheck, Eraser, ShieldAlert } from 'lucide-react';
import {
  clearOmnichannelE2EEvidence,
  KYRUB_OMNICHANNEL_E2E_EVIDENCE_CHANGED_EVENT,
  readOmnichannelE2EEvidence,
  type OmnichannelE2EEvidenceKind,
  type OmnichannelE2EEvidenceRecord,
} from '../../utils/omnichannelE2EEvidence';

const kindLabel = (kind: OmnichannelE2EEvidenceKind): string => {
  switch (kind) {
    case 'mercado_livre_publication': return 'Mercado Livre · publicação';
    case 'mercado_livre_stock': return 'Mercado Livre · estoque';
    case '99food_availability': return '99Food · disponibilidade';
    case '99food_order_observation': return '99Food · pedido real / reserva';
    case '99food_status_decision': return '99Food · decisão de status';
    case '99food_manual_status_sync': return '99Food · envio manual de status';
    case '99food_status_reconciliation': return '99Food · reconciliação de status';
  }
};

const sourceLabel = (record: OmnichannelE2EEvidenceRecord): string => {
  if (record.source === 'provider_readback') return 'readback do provedor';
  if (record.source === 'canonical_readback') return 'readback canônico do Kyrub';
  return 'resultado autoritativo da execução';
};

const detailText = (record: OmnichannelE2EEvidenceRecord): string[] =>
  Object.entries(record.details)
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${value === null ? 'null' : String(value)}`);

export default function OmnichannelE2EEvidencePanel({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [items, setItems] = useState<OmnichannelE2EEvidenceRecord[]>(() =>
    user.uid === storeId ? readOmnichannelE2EEvidence(storeId) : []
  );

  useEffect(() => {
    const sync = (): void => {
      setItems(user.uid === storeId ? readOmnichannelE2EEvidence(storeId) : []);
    };
    const handleChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ storeId?: string }>).detail;
      if (detail?.storeId?.trim() !== storeId) return;
      sync();
    };
    sync();
    window.addEventListener(
      KYRUB_OMNICHANNEL_E2E_EVIDENCE_CHANGED_EVENT,
      handleChanged
    );
    return () => {
      window.removeEventListener(
        KYRUB_OMNICHANNEL_E2E_EVIDENCE_CHANGED_EVENT,
        handleChanged
      );
    };
  }, [storeId, user.uid]);

  const groupedCount = useMemo(
    () => new Set(items.map(item => item.kind)).size,
    [items]
  );

  if (user.uid !== storeId) return null;

  return (
    <section
      id="kyrub-omnichannel-e2e-evidence"
      className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.025] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300">
            <ClipboardCheck className="h-3.5 w-3.5" />
            E2E omnichannel · evidências desta sessão
          </span>
          <h3 className="mt-1 text-sm font-black text-white">
            Retornos autoritativos observados, não autoridade reutilizável
          </h3>
          <p className="mt-2 max-w-4xl text-[9px] leading-relaxed text-slate-400">
            Este diário é somente memória da aba/sessão e registra respostas que já foram obtidas das superfícies autoritativas. Ele não libera etapa, não recria token, não autoriza write, não substitui provider readback e desaparece com o reload da página.
          </p>
        </div>
        <button
          id="kyrub-clear-omnichannel-e2e-evidence"
          type="button"
          onClick={() => {
            clearOmnichannelE2EEvidence(storeId);
            setItems([]);
          }}
          disabled={items.length === 0}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-35"
        >
          <Eraser className="h-3.5 w-3.5" />
          Limpar diário local
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[8px] text-slate-500">
        <span>{items.length} evidência(s)</span>
        <span>·</span>
        <span>{groupedCount} tipo(s) observado(s)</span>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/55 p-3 text-[9px] leading-relaxed text-slate-500">
          Nenhuma evidência autoritativa foi registrada nesta sessão ainda. Isso não significa que o ambiente esteja limpo; use o painel de prontidão para essa conclusão.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map(item => (
            <article
              key={item.id}
              className="rounded-xl border border-slate-800 bg-slate-950/65 p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[9px] text-slate-100">
                      {kindLabel(item.kind)}
                    </strong>
                    <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[7px] font-black uppercase text-emerald-300">
                      {item.outcome}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[8px] leading-relaxed text-slate-400">
                    {item.summary}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[7px] text-slate-600">
                  {item.observedAt}
                </span>
              </div>

              <div className="mt-2 text-[7px] text-slate-600">
                fonte: {sourceLabel(item)} · referência: {item.referenceId}
              </div>
              {detailText(item).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detailText(item).map(detail => (
                    <span
                      key={detail}
                      className="rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1 font-mono text-[7px] text-slate-500"
                    >
                      {detail}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.035] p-3 text-[8px] leading-relaxed text-amber-100/70">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          O diário é observabilidade. Nenhum código de autorização, orderRevision, executionId ou resultado mostrado aqui pode ser consumido por este painel para disparar uma operação.
        </span>
      </div>
    </section>
  );
}
