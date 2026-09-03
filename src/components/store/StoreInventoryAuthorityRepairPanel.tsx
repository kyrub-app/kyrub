import { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import {
  confirmStoreInventoryAuthorityRepair,
  loadStoreInventoryAuthorityRepairPreview,
  type StoreInventoryAuthorityRepairPreview,
} from '../../utils/storeInventoryAuthorityRepair';

const actionCopy = (
  preview: StoreInventoryAuthorityRepairPreview
): { title: string; detail: string; confirmLabel: string } => {
  switch (preview.action) {
    case 'link_existing_canonical_store':
      return {
        title: 'Vincular a loja canônica já identificada',
        detail: 'O Kyrub encontrou um vínculo canônico explícito já gravado na loja privada e confirmou que a loja canônica pertence ao mesmo owner. A confirmação grava somente esse vínculo no tenant; nenhuma loja será procurada por nome ou criada por aproximação.',
        confirmLabel: 'Confirmar vínculo canônico',
      };
    case 'activate_canonical_owner':
      return {
        title: 'Ativar o owner canônico já declarado',
        detail: 'O owner institucional, o tenant e o ownerId da loja canônica apontam para a mesma identidade. A confirmação ativa somente esse owner na membership canônica; nenhum outro membro será promovido, escolhido ou removido.',
        confirmLabel: 'Confirmar owner canônico',
      };
    case 'initialize_empty_inventory':
      return {
        title: 'Inicializar o documento físico vazio',
        detail: 'Existe exatamente um owner ativo e ele coincide com o ownerId canônico. A confirmação cria apenas a estrutura vazia do inventário físico, sem cadastrar itens e sem inventar qualquer quantidade.',
        confirmLabel: 'Confirmar inventário vazio',
      };
    default:
      return {
        title: 'Nenhuma correção automática segura',
        detail: 'O diagnóstico atual não permite uma alteração canônica segura por esta superfície.',
        confirmLabel: 'Confirmar correção',
      };
  }
};

const blockedCopy = (preview: StoreInventoryAuthorityRepairPreview): string => {
  switch (preview.reason) {
    case 'multiple_active_owners':
      return `Foram encontrados ${preview.activeOwnerCount} owners ativos. Este painel não escolhe nem desativa nenhum deles; use a governança de owners para revisar a autoridade com decisões humanas separadas.`;
    case 'canonical_link_missing':
      return 'Não existe um vínculo canônico explícito suficiente para reparar com segurança. O Kyrub não procurará uma loja por nome e não criará outra loja neste fluxo.';
    case 'canonical_owner_mismatch':
      return 'O único owner ativo não coincide com o ownerId da loja canônica. O Kyrub não trocará a autoridade automaticamente; revise a governança de owners.';
    case 'canonical_owner_identity_conflict':
      return 'A membership localizada no caminho do owner canônico já aponta explicitamente para outra identidade. O Kyrub não substituirá esse userId por merge e não ativará a membership automaticamente.';
    case 'authority_scope_mismatch':
      return 'As autoridades institucionais da loja, tenant e registro canônico não estão alinhadas. Nenhuma correção será aplicada por aproximação.';
    case 'already_resolved':
      return 'A autoridade já está resolvida nesta leitura. Nenhuma correção adicional é necessária.';
    default:
      return 'O estado atual não possui uma correção automática segura.';
  }
};

export default function StoreInventoryAuthorityRepairPanel({
  user,
  storeId,
  onApplied,
}: {
  user: User;
  storeId: string;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<StoreInventoryAuthorityRepairPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const prepare = async (): Promise<void> => {
    setLoading(true);
    setError('');
    setFeedback('');
    try {
      setPreview(await loadStoreInventoryAuthorityRepairPreview(user, storeId));
    } catch (cause) {
      setPreview(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível preparar a correção da autoridade.'
      );
    } finally {
      setLoading(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!preview?.actionable || !preview.action || !preview.repairId) return;
    setApplying(true);
    setError('');
    setFeedback('');
    try {
      await confirmStoreInventoryAuthorityRepair(user, storeId, preview);
      setPreview(null);
      setFeedback(
        'Correção canônica confirmada. O Kyrub vai reconsultar a autoridade, o estoque físico e as pendências; nenhuma reserva ou status externo foi executado.'
      );
      onApplied();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível aplicar a correção da autoridade.'
      );
    } finally {
      setApplying(false);
    }
  };

  const preparedCopy = preview ? actionCopy(preview) : null;

  return (
    <section
      id="kyrub-inventory-authority-repair"
      className="rounded-3xl border border-violet-500/20 bg-violet-500/[0.035] p-5"
      aria-label="Correção da autoridade do estoque"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">
            Autoridade física · correção sob confirmação
          </span>
          <h4 className="mt-1 flex items-center gap-2 text-sm font-black text-white">
            <Wrench className="h-4 w-4 text-violet-300" /> Corrigir autoridade do estoque
          </h4>
          <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
            Primeiro o Kyrub revalida as autoridades e prepara uma correção exata. Nada é alterado nessa leitura. Uma mudança só ocorre no segundo passo, depois da sua confirmação explícita.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={loading || applying}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3 text-[9px] font-black uppercase tracking-wider text-violet-200 disabled:opacity-40"
        >
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {loading ? 'Analisando…' : 'Preparar correção segura'}
        </button>
      </div>

      {preview && (
        <div className={`mt-4 rounded-2xl border p-4 ${preview.actionable ? 'border-violet-500/25 bg-slate-950/55' : 'border-amber-500/25 bg-amber-500/[0.05]'}`} aria-live="polite">
          {preview.actionable && preparedCopy ? (
            <>
              <strong className="block text-xs text-white">{preparedCopy.title}</strong>
              <p className="mt-2 text-[9px] leading-relaxed text-slate-400">{preparedCopy.detail}</p>
              <p className="mt-2 text-[8px] leading-relaxed text-slate-600">
                A confirmação abaixo usa a revisão atual. Se membership, owner, vínculo canônico ou documento físico mudar antes do clique, o servidor recusa a revisão como obsoleta.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={applying || loading}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[9px] font-black uppercase tracking-wider text-emerald-200 disabled:opacity-40"
                >
                  {applying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  {applying ? 'Aplicando…' : preparedCopy.confirmLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  disabled={applying}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase tracking-wider text-slate-400 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" /> Cancelar
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2 text-amber-100">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="block text-xs">Correção automática bloqueada.</strong>
                <p className="mt-1 text-[9px] leading-relaxed text-amber-100/80">{blockedCopy(preview)}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {feedback && (
        <p className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[9px] leading-relaxed text-emerald-200" aria-live="polite">
          {feedback}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-[9px] leading-relaxed text-rose-200" aria-live="polite">
          {error}
        </p>
      )}

      <p className="mt-4 text-[9px] leading-relaxed text-slate-600">
        Este fluxo não seleciona entre múltiplos owners, não substitui uma identidade conflitante, não altera quantidades, não cria itens de estoque, não executa reserva e não envia status a canais externos.
      </p>
    </section>
  );
}
