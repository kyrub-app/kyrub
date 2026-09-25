export type StoreCashFinanceMovementType =
  | 'sale'
  | 'income'
  | 'expense'
  | 'supply'
  | 'withdrawal'
  | 'adjustment';

export type StoreCashFinanceMovement = {
  id: string;
  sessionId: string;
  type: StoreCashFinanceMovementType;
  direction: 'in' | 'out';
  amountMinor: number;
  description: string;
  category: string;
  reason: string;
  actorName: string;
  source: 'manual' | 'payment' | 'migration';
  paymentId: string;
  occurredAt: string;
};

export type StoreCashFinanceSession = {
  id: string;
  status: 'open' | 'closed';
  operatorName: string;
  openingMinor: number;
  expectedMinor: number;
  countedMinor: number;
  differenceMinor: number;
  openedAt: string;
  closedAt: string;
};

export type StoreCashFinanceSummary = {
  currency: 'BRL';
  incomeMinor: number;
  expenseMinor: number;
  supplyMinor: number;
  withdrawalMinor: number;
  saleMinor: number;
  adjustmentInMinor: number;
  adjustmentOutMinor: number;
  operationalNetMinor: number;
  movementNetMinor: number;
  differenceMinor: number;
  movementCount: number;
  sessionCount: number;
  openSessionCount: number;
  closedSessionCount: number;
};

export type StoreCashFinanceProjection = {
  available: boolean;
  reason: '' | 'cash_store_not_registered' | 'cash_store_ambiguous' | 'cash_projection_unavailable';
  canonicalStoreId: string;
  summary: StoreCashFinanceSummary;
  latestSession: StoreCashFinanceSession | null;
  movements: StoreCashFinanceMovement[];
};

type Props = {
  projection?: StoreCashFinanceProjection;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const dateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : value;
};

const movementLabel = (type: StoreCashFinanceMovementType): string => ({
  sale: 'Venda no caixa',
  income: 'Entrada',
  expense: 'Despesa / saída',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  adjustment: 'Ajuste',
}[type]);

const movementClass = (movement: StoreCashFinanceMovement): string => {
  if (movement.type === 'expense' || movement.type === 'withdrawal' || movement.direction === 'out') {
    return 'text-rose-200';
  }
  if (movement.type === 'supply') return 'text-cyan-200';
  if (movement.type === 'sale') return 'text-emerald-200';
  return 'text-slate-100';
};

const sourceLabel = (source: StoreCashFinanceMovement['source']): string => ({
  manual: 'Operação manual',
  payment: 'Ligada a pagamento',
  migration: 'Registro migrado',
}[source]);

const unavailableMessage = (reason: StoreCashFinanceProjection['reason']): string => {
  if (reason === 'cash_store_not_registered') {
    return 'A loja ainda não possui um vínculo canônico de Caixa. O Financeiro não inventará movimentações até esse cadastro existir.';
  }
  if (reason === 'cash_store_ambiguous') {
    return 'Mais de uma loja canônica corresponde a este Caixa. O vínculo precisa ser corrigido antes da consolidação financeira.';
  }
  return 'O Caixa canônico não pôde ser lido agora. As demais áreas do Financeiro continuam disponíveis.';
};

export default function StoreCashFinanceWorkspace({ projection }: Props) {
  if (!projection) return null;

  if (!projection.available) {
    return (
      <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-5" data-kyrub-store-cash-finance="unavailable">
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Caixa operacional</span>
        <h4 className="mt-1 text-xs font-black uppercase">Integração com o Caixa canônico</h4>
        <p className="mt-3 rounded-2xl border border-dashed border-slate-700 p-4 text-[9px] leading-relaxed text-slate-500">
          {unavailableMessage(projection.reason)}
        </p>
      </section>
    );
  }

  const { summary, latestSession, movements } = projection;

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-slate-900 p-5" data-kyrub-store-cash-finance="canonical-readonly">
      <div className="min-w-0">
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-fuchsia-300">Caixa operacional</span>
        <h4 className="mt-1 text-xs font-black uppercase">Movimentações reais do Caixa canônico</h4>
        <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
          Esta área apenas projeta o Caixa existente dentro do Financeiro. Suprimento e sangria alteram a posição física do caixa, mas não são tratados como receita ou despesa. Vendas registradas no Caixa também não são somadas novamente ao faturamento, cuja autoridade continua sendo pagamentos/economicLedger.
        </p>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Outras entradas</span>
          <strong className="mt-1 block text-sm text-emerald-200">{money(summary.incomeMinor)}</strong>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Despesas / saídas</span>
          <strong className="mt-1 block text-sm text-rose-200">{money(summary.expenseMinor)}</strong>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Suprimentos</span>
          <strong className="mt-1 block text-sm text-cyan-200">{money(summary.supplyMinor)}</strong>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Sangrias</span>
          <strong className="mt-1 block text-sm text-amber-200">{money(summary.withdrawalMinor)}</strong>
        </article>
      </div>

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Vendas observadas no Caixa</span>
          <strong className="mt-1 block text-sm text-emerald-100">{money(summary.saleMinor)}</strong>
          <span className="mt-1 block text-[7px] leading-relaxed text-slate-600">Não é somado novamente ao recebido bruto.</span>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Resultado outras entradas − despesas</span>
          <strong className={`mt-1 block text-sm ${summary.operationalNetMinor >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{money(summary.operationalNetMinor)}</strong>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Ajustes</span>
          <strong className="mt-1 block text-sm text-slate-200">+{money(summary.adjustmentInMinor)} / −{money(summary.adjustmentOutMinor)}</strong>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Diferença em fechamentos</span>
          <strong className={`mt-1 block text-sm ${summary.differenceMinor === 0 ? 'text-slate-200' : summary.differenceMinor > 0 ? 'text-cyan-200' : 'text-rose-200'}`}>{money(summary.differenceMinor)}</strong>
        </article>
      </div>

      {latestSession && (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-[10px] uppercase">Turno mais recente</strong>
                <span className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase ${latestSession.status === 'open' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>
                  {latestSession.status === 'open' ? 'Caixa aberto' : 'Caixa fechado'}
                </span>
              </div>
              <p className="mt-2 max-w-full break-words text-[8px] text-slate-500 [overflow-wrap:anywhere]">
                Operador: {latestSession.operatorName || 'não informado'} · aberto em {dateTime(latestSession.openedAt)}
              </p>
              {latestSession.closedAt && <p className="mt-1 text-[8px] text-slate-600">Fechado em {dateTime(latestSession.closedAt)}</p>}
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-[8px] sm:text-right">
              <span className="text-slate-600">Abertura</span><b>{money(latestSession.openingMinor)}</b>
              <span className="text-slate-600">Esperado</span><b>{money(latestSession.expectedMinor)}</b>
              {latestSession.status === 'closed' && <><span className="text-slate-600">Contado</span><b>{money(latestSession.countedMinor)}</b></>}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h5 className="text-[10px] font-black uppercase text-slate-300">Movimentações recentes do Caixa</h5>
          <span className="text-[8px] text-slate-600">{summary.movementCount} registro(s) lido(s)</span>
        </div>
        {movements.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">Nenhuma movimentação canônica de Caixa encontrada nos turnos lidos.</p>
        ) : (
          <div className="min-w-0 space-y-2">
            {movements.slice(0, 12).map(movement => (
              <article key={movement.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[10px]">{movementLabel(movement.type)}</strong>
                      <span className="rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-500">{sourceLabel(movement.source)}</span>
                    </div>
                    <p className="mt-1 max-w-full break-words text-[8px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">
                      {movement.description || movement.category || 'Sem descrição'}
                    </p>
                    <p className="mt-1 text-[8px] text-slate-600">{dateTime(movement.occurredAt)}{movement.actorName ? ` · ${movement.actorName}` : ''}</p>
                    {movement.reason && <p className="mt-1 max-w-full break-words text-[8px] text-slate-600 [overflow-wrap:anywhere]">Motivo: {movement.reason}</p>}
                  </div>
                  <strong className={`shrink-0 text-left text-sm sm:text-right ${movementClass(movement)}`}>
                    {movement.direction === 'out' ? '−' : '+'}{money(movement.amountMinor)}
                  </strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
