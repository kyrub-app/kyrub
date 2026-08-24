import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CheckCircle2,
  LoaderCircle,
  PackagePlus,
  Recycle,
  TriangleAlert,
  X,
} from 'lucide-react';
import type {
  KyrubAiAdjustInventoryProposal,
  KyrubInventoryMovementKind,
} from '../../shared/kyrubActions';
import type { KyrubInventoryTransformationProposal } from '../../shared/kyrubInventoryTransformation';
import { readKyrubInventorySetupWorkflow } from '../../shared/kyrubInventorySetupWorkflow';
import { buildKyrubProductCompositionProposal } from '../../shared/kyrubProductCompositionProposal';
import {
  invalidateKyrubErpContext,
  readKyrubErpContext,
} from '../actions/erpReadActionService';
import { executeInventoryTransformation } from '../actions/inventoryTransformationActionService';
import { executeKyrubAction } from '../actions/kyrubActionService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingMovement = {
  kind: 'movement';
  conversationId: string;
  proposal: KyrubAiAdjustInventoryProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

type PendingTransformation = {
  kind: 'transformation';
  conversationId: string;
  proposal: KyrubInventoryTransformationProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

type PendingInventory = PendingMovement | PendingTransformation;

const withIdempotency = (
  conversationId: string,
  proposal: KyrubAiAdjustInventoryProposal
): KyrubAiAdjustInventoryProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'medium',
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

const withTransformationIdempotency = (
  conversationId: string,
  proposal: KyrubInventoryTransformationProposal
): KyrubInventoryTransformationProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: 'medium',
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

const quantity = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 3,
});

const movementKindFor = (
  proposal: KyrubAiAdjustInventoryProposal
): KyrubInventoryMovementKind => {
  if (proposal.movementKind) return proposal.movementKind;
  if (proposal.mode === 'set') return 'correction';
  if (proposal.mode === 'decrement') {
    return proposal.source.kind === 'loss_report' ? 'loss' : 'outflow';
  }
  return 'intake';
};

const movementCopy = (kind: KyrubInventoryMovementKind) => {
  if (kind === 'loss') {
    return {
      noun: 'perda/desperdício',
      title: 'Confirmar perda de estoque',
      successTitle: 'Perda registrada',
      action: 'Registrar perda',
      working: 'Registrando...',
      explanation:
        'A confirmação reduz as quantidades informadas do estoque privado. O Kyrub recusará a movimentação se algum insumo não existir ou se o saldo for insuficiente.',
      success: 'A perda foi registrada e o saldo dos insumos foi atualizado.',
    };
  }
  if (kind === 'outflow') {
    return {
      noun: 'saída de estoque',
      title: 'Confirmar saída de estoque',
      successTitle: 'Saída registrada',
      action: 'Confirmar saída',
      working: 'Registrando...',
      explanation:
        'A confirmação reduz as quantidades informadas do estoque privado. O Kyrub recusará a movimentação se algum insumo não existir ou se o saldo for insuficiente.',
      success: 'A saída foi registrada e o saldo dos insumos foi atualizado.',
    };
  }
  if (kind === 'correction') {
    return {
      noun: 'correção física',
      title: 'Confirmar correção de estoque',
      successTitle: 'Estoque corrigido',
      action: 'Aplicar correção',
      working: 'Corrigindo...',
      explanation:
        'A confirmação substitui o saldo atual pelos valores contados informados. O Kyrub recusará a correção se algum insumo não existir no estoque privado.',
      success: 'A contagem física foi aplicada e os saldos foram corrigidos.',
    };
  }
  return {
    noun: 'entrada de estoque',
    title: 'Confirmar entrada de estoque',
    successTitle: 'Estoque atualizado',
    action: 'Confirmar entrada',
    working: 'Registrando...',
    explanation:
      'A confirmação soma estas quantidades ao estoque privado. Se um insumo ainda não existir, ele será criado.',
    success: 'A entrada foi registrada e o saldo dos insumos foi atualizado.',
  };
};

const entryQuantityLabel = (
  proposal: KyrubAiAdjustInventoryProposal,
  entry: KyrubAiAdjustInventoryProposal['entries'][number]
): string => {
  const formatted = `${quantity.format(entry.quantity)} ${entry.unit}`;
  if (proposal.mode === 'decrement') return `−${formatted}`;
  if (proposal.mode === 'increment') return `+${formatted}`;
  return `Saldo: ${formatted}`;
};

const transformationSection = (
  title: string,
  tone: 'consume' | 'produce' | 'byproduct' | 'loss',
  items: Array<{ name: string; quantity: number; unit: string }>
) => {
  if (items.length === 0) return null;
  const icon = tone === 'consume'
    ? <ArrowUpFromLine className="h-4 w-4" />
    : tone === 'produce'
      ? <ArrowDownToLine className="h-4 w-4" />
      : tone === 'byproduct'
        ? <Recycle className="h-4 w-4" />
        : <TriangleAlert className="h-4 w-4" />;
  const quantityClass = tone === 'consume'
    ? 'text-amber-300'
    : tone === 'loss'
      ? 'text-red-300'
      : 'text-emerald-300';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
        {icon}
        {title}
      </div>
      {items.map((item, index) => (
        <div
          key={`${tone}-${item.name}-${item.unit}-${index}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"
        >
          <span className="min-w-0 text-sm font-bold text-white">{item.name}</span>
          <span className={`shrink-0 text-sm font-black ${quantityClass}`}>
            {tone === 'consume' || tone === 'loss' ? '−' : '+'}
            {quantity.format(item.quantity)} {item.unit}
          </span>
        </div>
      ))}
    </div>
  );
};

export function KyrubAiInventoryActionBridge() {
  const [pending, setPending] = useState<PendingInventory | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail) return;

      if (detail.proposal.type === 'adjust_inventory') {
        setPending({
          kind: 'movement',
          conversationId: detail.conversationId,
          proposal: withIdempotency(detail.conversationId, detail.proposal),
          state: 'reviewing',
          errorMessage: '',
          alreadyApplied: false,
        });
        return;
      }

      if (detail.proposal.type === 'transform_inventory') {
        setPending({
          kind: 'transformation',
          conversationId: detail.conversationId,
          proposal: withTransformationIdempotency(
            detail.conversationId,
            detail.proposal
          ),
          state: 'reviewing',
          errorMessage: '',
          alreadyApplied: false,
        });
      }
    };

    window.addEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
    return () => window.removeEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
  }, []);

  if (!pending) return null;

  const isWorking = pending.state === 'executing';
  const isSuccess = pending.state === 'success';
  const transformation = pending.kind === 'transformation';
  const setupWorkflow = pending.kind === 'movement'
    ? readKyrubInventorySetupWorkflow(pending.proposal)
    : null;
  const movementKind = pending.kind === 'movement'
    ? movementKindFor(pending.proposal)
    : null;
  const copy = setupWorkflow
    ? {
        noun: 'preparo de estoque e ficha técnica',
        title: `Confirmar preparo de ${setupWorkflow.targetProductName}`,
        successTitle: 'Estoque e ficha técnica atualizados',
        action: 'Confirmar tudo',
        working: 'Executando etapas...',
        explanation:
          'A confirmação executa, nesta ordem, a entrada recebida, a produção do componente intermediário e a ficha técnica do produto usando referências reais do estoque.',
        success:
          `A entrada, a produção de ${setupWorkflow.componentName} e a ficha técnica de ${setupWorkflow.targetProductName} foram concluídas.`,
      }
    : movementKind
      ? movementCopy(movementKind)
      : {
          noun: 'transformação de estoque',
          title: 'Confirmar transformação de estoque',
          successTitle: 'Transformação registrada',
          action: 'Confirmar transformação',
          working: 'Transformando...',
          explanation:
            'A confirmação baixa os insumos consumidos e adiciona os itens produzidos na mesma transação. Perdas são registradas para auditoria e não baixam o estoque uma segunda vez.',
          success:
            'A transformação foi registrada, os saldos foram atualizados e os produtos dependentes foram recalculados.',
        };

  const close = () => {
    if (isWorking) return;
    setPending(null);
  };

  const confirm = async () => {
    if (isWorking) return;
    const current = pending;
    const user = auth.currentUser;
    if (!user) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: 'Faça login novamente antes de confirmar esta operação de estoque.',
      } : value);
      return;
    }

    setPending(value => value ? {
      ...value,
      state: 'executing',
      errorMessage: '',
    } : value);

    try {
      let alreadyApplied = false;

      if (current.kind === 'transformation') {
        const result = await executeInventoryTransformation(user, current.proposal, true);
        alreadyApplied = result.status === 'already_applied';
      } else {
        const intakeResult = await executeKyrubAction(user, current.proposal, true);
        const workflow = readKyrubInventorySetupWorkflow(current.proposal);
        alreadyApplied = intakeResult.status === 'already_applied';

        if (workflow) {
          const transformationResult = await executeInventoryTransformation(
            user,
            withTransformationIdempotency(current.conversationId, workflow.transformation),
            true
          );

          const erpContext = await readKyrubErpContext(user, { force: true });
          const compositionBuild = buildKyrubProductCompositionProposal(
            workflow.compositionMessage,
            current.conversationId,
            erpContext
          );
          if (compositionBuild.kind !== 'proposal') {
            throw new Error(
              'A entrada e a produção foram registradas, mas a ficha técnica não pôde ser vinculada com segurança. Revise os insumos antes de tentar novamente.'
            );
          }

          const compositionProposal = {
            ...compositionBuild.proposal,
            id: `${workflow.id}-composition`,
            idempotencyKey: `kyrubia:set_product_composition:${workflow.id}`,
          };
          const compositionResult = await executeKyrubAction(
            user,
            compositionProposal,
            true
          );
          alreadyApplied =
            alreadyApplied &&
            transformationResult.status === 'already_applied' &&
            compositionResult.status === 'already_applied';
        }
      }

      invalidateKyrubErpContext(user.uid);
      setPending(value => value ? {
        ...value,
        state: 'success',
        errorMessage: '',
        alreadyApplied,
      } : value);
    } catch (error) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: error instanceof Error
          ? error.message
          : 'Não foi possível registrar esta operação de estoque.',
      } : value);
    }
  };

  const supplier = pending.proposal.source.label?.trim() ?? '';

  return (
    <div className="fixed inset-0 z-[122] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={isSuccess ? copy.successTitle : copy.title}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            isSuccess
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-violet-500/15 text-violet-300'
          }`}>
            {isSuccess
              ? <CheckCircle2 className="h-6 w-6" />
              : transformation
                ? <Recycle className="h-6 w-6" />
                : movementKind === 'intake'
                  ? <PackagePlus className="h-6 w-6" />
                  : <Boxes className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {isSuccess ? copy.successTitle : copy.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isWorking}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 disabled:opacity-40"
            aria-label="Fechar confirmação"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {isSuccess ? (
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm leading-relaxed text-emerald-100">
              {pending.alreadyApplied
                ? `Este mesmo ${copy.noun} já havia sido registrado. O Kyrub não duplicou as operações.`
                : copy.success}
            </p>
          ) : transformation ? (
            <>
              <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                {supplier && (
                  <p className="text-xs text-slate-400">
                    Lote: <span className="font-bold text-slate-200">{supplier}</span>
                  </p>
                )}
                {transformationSection('Consome', 'consume', pending.proposal.inputs)}
                {transformationSection(
                  'Produz',
                  'produce',
                  pending.proposal.outputs.filter(item => item.kind !== 'byproduct')
                )}
                {transformationSection(
                  'Subprodutos aproveitáveis',
                  'byproduct',
                  pending.proposal.outputs.filter(item => item.kind === 'byproduct')
                )}
                {transformationSection('Perdas / descarte', 'loss', pending.proposal.losses)}
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                {copy.explanation} Itens intermediários permanecem no estoque privado e não são publicados automaticamente na vitrine.
              </p>
              {pending.state === 'error' && (
                <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {pending.errorMessage}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center gap-2 text-violet-300">
                  <Boxes className="h-4 w-4" />
                  <span className="text-[11px] font-black uppercase tracking-wider">
                    {setupWorkflow ? '1. Entrada recebida' : copy.noun}
                  </span>
                </div>
                {movementKind === 'intake' && supplier && (
                  <p className="mt-2 text-xs text-slate-400">
                    Fornecedor: <span className="font-bold text-slate-200">{supplier}</span>
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {pending.proposal.entries.map((entry, index) => (
                    <div
                      key={`${entry.name}-${entry.unit}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"
                    >
                      <span className="min-w-0 text-sm font-bold text-white">
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-sm font-black text-emerald-300">
                        {entryQuantityLabel(pending.proposal, entry)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {setupWorkflow && (
                <>
                  <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="flex items-center gap-2 text-violet-300">
                      <Recycle className="h-4 w-4" />
                      <span className="text-[11px] font-black uppercase tracking-wider">
                        2. Produção do componente
                      </span>
                    </div>
                    {transformationSection(
                      'Consome',
                      'consume',
                      setupWorkflow.transformation.inputs
                    )}
                    {transformationSection(
                      'Produz',
                      'produce',
                      setupWorkflow.transformation.outputs
                    )}
                    <p className="text-xs leading-relaxed text-slate-400">
                      Dos {quantity.format(setupWorkflow.preview.receivedSourceQuantity)} {setupWorkflow.preview.receivedSourceUnit} recebidos,
                      {' '}{quantity.format(setupWorkflow.preview.allocatedSourceQuantity)} {setupWorkflow.preview.receivedSourceUnit} foram destinados ao preparo.
                      O Kyrub usará {quantity.format(setupWorkflow.preview.consumedSourceQuantity)} {setupWorkflow.preview.receivedSourceUnit} e manterá
                      {' '}{quantity.format(setupWorkflow.preview.allocatedRemainderQuantity)} {setupWorkflow.preview.receivedSourceUnit} como matéria-prima, sem perda implícita.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="flex items-center gap-2 text-violet-300">
                      <Boxes className="h-4 w-4" />
                      <span className="text-[11px] font-black uppercase tracking-wider">
                        3. Ficha técnica de {setupWorkflow.targetProductName}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {setupWorkflow.recipeLines.map((line, index) => (
                        <div
                          key={`${line.name}-${line.unit}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"
                        >
                          <span className="min-w-0 text-sm font-bold text-white">{line.name}</span>
                          <span className="shrink-0 text-sm font-black text-violet-200">
                            {quantity.format(line.quantity)} {line.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <p className="text-xs leading-relaxed text-slate-500">
                {copy.explanation} Nenhum item intermediário será publicado automaticamente e nenhum preço de venda será alterado.
              </p>

              {pending.state === 'error' && (
                <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {pending.errorMessage}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex gap-3 border-t border-slate-800 p-4">
          {isSuccess ? (
            <button
              type="button"
              onClick={() => setPending(null)}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950"
            >
              Concluído
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={isWorking}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={isWorking}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {isWorking ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {copy.working}
                  </>
                ) : copy.action}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}