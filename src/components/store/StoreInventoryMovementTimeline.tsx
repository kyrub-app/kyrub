import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { auth } from '../../utils/firebase';

type MovementKind = 'intake' | 'outflow' | 'loss' | 'correction';
type MovementFilter = 'all' | MovementKind;

type MovementLine = {
  itemId: string;
  name: string;
  unit: string;
  quantityDelta: number;
  previousQuantity: number | null;
  resultingQuantity: number | null;
};

type Movement = {
  id: string;
  kind: MovementKind;
  mode: 'increment' | 'decrement' | 'set' | '';
  reason: string;
  actionType: string;
  sourceKind: string;
  sourceLabel: string;
  origin: string;
  createdAt: string;
  entryCount: number;
  orderId: string;
  purchaseId: string;
  purchaseReceiptId: string;
  supplierId: string;
  lines: MovementLine[];
};

type Payload = {
  movements?: Movement[];
  summary?: {
    total: number;
    intake: number;
    outflow: number;
    loss: number;
    correction: number;
  };
  error?: string;
};

interface Props {
  storeId: string;
}

const FILTERS: Array<{ id: MovementFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'intake', label: 'Entradas' },
  { id: 'outflow', label: 'Saídas' },
  { id: 'loss', label: 'Perdas' },
  { id: 'correction', label: 'Correções' },
];

const kindConfig: Record<MovementKind, { label: string; icon: typeof ArrowDownToLine; className: string }> = {
  intake: {
    label: 'Entrada',
    icon: ArrowDownToLine,
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  },
  outflow: {
    label: 'Saída',
    icon: ArrowUpFromLine,
    className: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200',
  },
  loss: {
    label: 'Perda',
    icon: AlertTriangle,
    className: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
  },
  correction: {
    label: 'Correção',
    icon: RotateCcw,
    className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  },
};

const dateLabel = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
    : value;
};

const movementLabel = (movement: Movement): string => {
  if (movement.sourceLabel) return movement.sourceLabel;
  if (movement.reason === 'order_sale') return `Venda · Pedido ${movement.orderId}`;
  if (movement.reason === 'order_cancellation') return `Cancelamento · Pedido ${movement.orderId}`;
  if (movement.reason === 'order_adjustment') return `Ajuste · Pedido ${movement.orderId}`;
  if (movement.reason === 'purchase_receipt') return `Recebimento · Compra ${movement.purchaseId}`;
  if (movement.kind === 'loss') return 'Perda registrada';
  if (movement.kind === 'correction') return 'Correção de estoque';
  return movement.kind === 'intake' ? 'Entrada de estoque' : 'Saída de estoque';
};

const relationLabel = (movement: Movement): string => {
  const relations = [
    movement.orderId ? `Pedido ${movement.orderId}` : '',
    movement.purchaseId ? `Compra ${movement.purchaseId}` : '',
    movement.purchaseReceiptId ? `Recebimento ${movement.purchaseReceiptId}` : '',
  ].filter(Boolean);
  return relations.join(' · ');
};

export function StoreInventoryMovementTimeline({ storeId }: Props) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [summary, setSummary] = useState<Payload['summary']>();
  const [filter, setFilter] = useState<MovementFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setError('Faça login novamente para consultar as movimentações.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/store-procurement/movements?storeId=${encodeURIComponent(storeId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error('O histórico respondeu em um formato inesperado.');
      }
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as movimentações.');
      setMovements(Array.isArray(payload.movements) ? payload.movements : []);
      setSummary(payload.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as movimentações.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [storeId]);

  const visible = useMemo(
    () => filter === 'all' ? movements : movements.filter(movement => movement.kind === filter),
    [filter, movements]
  );

  return (
    <section
      id="store-inventory-movement-timeline"
      className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Razão físico
          </span>
          <h4 className="mt-1 text-sm font-black uppercase text-white">Movimentações do estoque</h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Linha do tempo única das entradas, saídas, perdas e correções já registradas no estoque canônico. Compra, recebimento e pagamento continuam eventos separados.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Total', summary?.total ?? movements.length],
          ['Entradas', summary?.intake ?? 0],
          ['Saídas', summary?.outflow ?? 0],
          ['Perdas', summary?.loss ?? 0],
          ['Correções', summary?.correction ?? 0],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <span className="text-[8px] font-black uppercase text-slate-600">{label}</span>
            <strong className="mt-1 block text-sm text-slate-200">{value}</strong>
          </article>
        ))}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto" aria-label="Filtrar movimentações">
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-600" />
        {FILTERS.map(option => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={`min-h-9 shrink-0 rounded-xl px-3 text-[8px] font-black uppercase ${
              filter === option.id
                ? 'bg-cyan-400 text-slate-950'
                : 'border border-slate-800 bg-slate-950 text-slate-500'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] text-rose-200" role="status">
          {error}
        </p>
      )}

      {loading ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-[10px] text-slate-500">
          Carregando movimentações…
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 px-5 py-10 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-[10px] font-black uppercase text-slate-400">Nenhuma movimentação neste filtro</p>
          <p className="mt-1 text-[9px] text-slate-600">O Kyrub não cria histórico fictício para preencher esta área.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(movement => {
            const config = kindConfig[movement.kind];
            const Icon = config.icon;
            const relation = relationLabel(movement);
            return (
              <article key={movement.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[8px] font-black uppercase ${config.className}`}>
                        <Icon className="h-3 w-3" /> {config.label}
                      </span>
                      <span className="text-[8px] text-slate-600">{dateLabel(movement.createdAt)}</span>
                    </div>
                    <h5 className="mt-2 break-words text-xs font-black text-white">{movementLabel(movement)}</h5>
                    {relation && <p className="mt-1 break-all text-[8px] text-slate-600">{relation}</p>}
                  </div>
                  <span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-[8px] font-black uppercase text-slate-500">
                    {movement.entryCount} item(ns)
                  </span>
                </div>

                {movement.lines.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                    {movement.lines.map((line, index) => (
                      <div key={`${movement.id}-${line.itemId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-[9px]">
                        <span className="min-w-0 flex-1 truncate text-slate-300">{line.name}</span>
                        <strong className={line.quantityDelta >= 0 ? 'text-emerald-300' : 'text-cyan-300'}>
                          {line.quantityDelta >= 0 ? '+' : ''}{line.quantityDelta} {line.unit}
                        </strong>
                        {line.previousQuantity !== null && line.resultingQuantity !== null && (
                          <span className="text-slate-600">
                            {line.previousQuantity} → {line.resultingQuantity}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
