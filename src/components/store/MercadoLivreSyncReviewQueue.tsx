import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Check, FileDown, RefreshCw, X } from 'lucide-react';
import {
  applyApprovedMercadoLivreSyncProposalToDraft,
  decideMercadoLivreSyncProposal,
  loadApprovedMercadoLivreSyncProposals,
  loadMercadoLivreSyncReviewQueue,
  type MercadoLivreSyncReviewItem,
} from '../../utils/storeConnections';

const money = (value: number | null): string =>
  value === null
    ? 'Preço não informado'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function MercadoLivreSyncReviewQueue({
  user,
  storeId,
  notify,
}: {
  user: User;
  storeId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [items, setItems] = useState<MercadoLivreSyncReviewItem[]>([]);
  const [approvedItems, setApprovedItems] = useState<MercadoLivreSyncReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [decidingId, setDecidingId] = useState('');
  const [applyingId, setApplyingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [review, approved] = await Promise.all([
        loadMercadoLivreSyncReviewQueue(user, storeId, 50),
        loadApprovedMercadoLivreSyncProposals(user, storeId, 50),
      ]);
      setItems(review.items);
      setApprovedItems(approved.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as propostas de sincronização.');
    } finally {
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (
    item: MercadoLivreSyncReviewItem,
    decision: 'approve' | 'reject'
  ): Promise<void> => {
    setDecidingId(item.proposal.id);
    setError('');
    try {
      await decideMercadoLivreSyncProposal(user, storeId, item.proposal.id, decision);
      setItems(current => current.filter(entry => entry.proposal.id !== item.proposal.id));
      if (decision === 'approve') {
        await load();
      }
      notify(
        decision === 'approve'
          ? 'Proposta aprovada. Ela ainda precisa ser aplicada ao rascunho antes de qualquer promoção a produto Kyrub.'
          : 'Proposta rejeitada. Nenhuma alteração foi aplicada ao catálogo Kyrub.',
        'success'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar sua decisão.');
    } finally {
      setDecidingId('');
    }
  };

  const applyToDraft = async (item: MercadoLivreSyncReviewItem): Promise<void> => {
    setApplyingId(item.proposal.id);
    setError('');
    try {
      const result = await applyApprovedMercadoLivreSyncProposalToDraft(
        user,
        storeId,
        item.proposal.id
      );
      setApprovedItems(current => current.filter(entry => entry.proposal.id !== item.proposal.id));
      notify(
        `Mudança aplicada ao rascunho ${result.draftId}. Produto, estoque e publicação canônicos continuam inalterados.`,
        'success'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível aplicar a proposta ao rascunho.');
    } finally {
      setApplyingId('');
    }
  };

  const busy = Boolean(decidingId || applyingId);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Revisão manual</span>
            <h4 className="mt-1 text-sm font-black text-white">Mudanças detectadas no Mercado Livre</h4>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
              Estes dados foram reconsultados pela API oficial depois da notificação. Aprovar registra sua autoridade sobre este snapshot, mas ainda não altera produto, preço, estoque ou publicação canônicos no Kyrub.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar filas
          </button>
        </div>

        {loading && items.length === 0 ? (
          <p className="mt-4 text-[10px] text-slate-500">Consultando propostas pendentes…</p>
        ) : items.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-[10px] text-slate-500">
            Nenhuma mudança do Mercado Livre está aguardando sua revisão.
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {items.map(item => (
              <div key={item.proposal.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-white">{item.snapshot.item.title}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      ML {item.snapshot.item.externalId} · {money(item.snapshot.item.price)}
                    </p>
                    <p className="mt-1 text-[9px] text-slate-600">
                      Disponível no Mercado Livre: {item.snapshot.item.availableQuantity ?? 'não informado'} · status: {item.snapshot.item.status || 'não informado'}
                    </p>
                    <p className="mt-2 text-[9px] leading-relaxed text-slate-600">
                      Origem confirmada por re-fetch da API · proposta {item.proposal.id}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void decide(item, 'reject')}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-rose-300 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" /> Rejeitar
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(item, 'approve')}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-emerald-300 disabled:opacity-40"
                    >
                      <Check className="h-3.5 w-3.5" /> Aprovar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {approvedItems.length > 0 && (
        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <span className="text-[9px] font-black uppercase tracking-wider text-emerald-300">Aprovadas, ainda não aplicadas</span>
          <h4 className="mt-1 text-sm font-black text-white">Aplicar ao rascunho de importação</h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Esta etapa atualiza apenas o rascunho ligado ao item do Mercado Livre. Se o rascunho foi editado manualmente depois da última sincronização, o Kyrub bloqueia a aplicação para evitar sobrescrita silenciosa.
          </p>
          <div className="mt-4 grid gap-3">
            {approvedItems.map(item => (
              <div key={item.proposal.id} className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-white">{item.snapshot.item.title}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    ML {item.snapshot.item.externalId} · {money(item.snapshot.item.price)}
                  </p>
                  <p className="mt-1 text-[9px] text-slate-600">Snapshot aprovado em revisão humana; destino: rascunho de importação.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void applyToDraft(item)}
                  disabled={busy}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-emerald-300 disabled:opacity-40"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {applyingId === item.proposal.id ? 'Aplicando…' : 'Aplicar ao rascunho'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-[10px] text-rose-200" aria-live="polite">
          {error}
        </div>
      )}
    </div>
  );
}
