import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { CornerDownLeft, PackageCheck, ShieldAlert } from 'lucide-react';
import { auth, db } from '../../utils/firebase';

type CourierReturnHistoryRow = {
  deliveryId: string;
  status: string;
  condition: string;
  receivedAtMs: number;
};

const RETURN_HISTORY_LIMIT = 100;
const RETURN_HISTORY_VISIBLE = 20;

const conditionLabel = (condition: string): string =>
  condition === 'intact' ? 'Intacta'
    : condition === 'damaged' ? 'Danos identificados'
      : condition === 'disputed' ? 'Divergência registrada'
        : 'Condição não informada';

/**
 * Operational return receipts for the assigned courier.
 * No financial settlement, refund, buyer address or payment status is inferred.
 */
export function CourierReturnHistory() {
  const [rows, setRows] = useState<CourierReturnHistoryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribeReturns: () => void = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeReturns();
      unsubscribeReturns = () => undefined;
      setRows([]);
      setLoaded(false);
      setOffline(false);
      setHistoryTruncated(false);
      setError('');
      if (!user) {
        setLoaded(true);
        return;
      }
      unsubscribeReturns = onSnapshot(query(
        collection(db, 'deliveryReturnProtocols'),
        where('courierId', '==', user.uid),
        limit(RETURN_HISTORY_LIMIT)
      ), { includeMetadataChanges: true }, snapshot => {
        setOffline(snapshot.metadata.fromCache);
        setHistoryTruncated(snapshot.size >= RETURN_HISTORY_LIMIT);
        setLoaded(true);
        setError('');
        setRows(snapshot.docs.flatMap(doc => {
          const value = doc.data() as Record<string, unknown>;
          const status = typeof value.status === 'string' ? value.status : '';
          if (status !== 'returned_to_store_pending_reconciliation'
            && status !== 'courier_presented_to_store') return [];
          const receivedAt = value.receivedByStoreAt as Timestamp | undefined;
          return [{
            deliveryId: doc.id,
            status,
            condition: typeof value.receivedCondition === 'string' ? value.receivedCondition : '',
            receivedAtMs: typeof receivedAt?.toMillis === 'function' ? receivedAt.toMillis() : 0,
          }];
        }));
      }, () => {
        setRows([]);
        setLoaded(true);
        setOffline(true);
        setHistoryTruncated(false);
        setError('Não foi possível consultar o histórico de devoluções.');
      });
    });
    return () => {
      unsubscribeAuth();
      unsubscribeReturns();
    };
  }, []);

  const recent = useMemo(() => [...rows]
    .sort((a, b) => b.receivedAtMs - a.receivedAtMs)
    .slice(0, RETURN_HISTORY_VISIBLE), [rows]);

  return (
    <section className="space-y-2 border-t border-slate-800 pt-3" aria-label="Histórico de devoluções">
      <h3 className="flex items-center gap-2 text-xs font-black text-amber-200">
        <CornerDownLeft className="h-4 w-4" />Devoluções ao estabelecimento
      </h3>
      <p className="text-[10px] leading-relaxed text-slate-400">
        Comprovantes operacionais de apresentação e recebimento. Não representam entrega ao comprador,
        remuneração liquidada ou reembolso autorizado.
      </p>
      {offline && (
        <p role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-[10px] text-amber-200">
          Dados locais ou conexão indisponível: os registros abaixo podem não estar atualizados.
        </p>
      )}
      {error && <p role="status" className="text-[10px] text-amber-200">{error}</p>}
      {!loaded && <p className="text-[10px] text-slate-400">Consultando devoluções…</p>}
      {loaded && recent.length === 0 && !error && (
        <p className="rounded-xl bg-slate-900 p-3 text-[10px] text-slate-400">
          {offline
            ? 'Não há registros locais para exibir. Conecte-se para consultar o histórico.'
            : 'Nenhuma devolução registrada entre os protocolos consultados.'}
        </p>
      )}
      {recent.map(row => (
        <article key={row.deliveryId} className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <p className="break-all text-[10px] font-bold text-white">Entrega {row.deliveryId}</p>
          {row.status === 'courier_presented_to_store' ? (
            <p className="flex items-start gap-2 text-[10px] text-amber-200">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              Apresentação declarada. A loja ainda precisa confirmar o recebimento físico.
            </p>
          ) : (
            <>
              <p className="flex items-start gap-2 text-[10px] text-teal-200">
                <PackageCheck className="h-4 w-4 shrink-0" />
                Recebimento físico confirmado pela loja — conciliação econômica pendente.
              </p>
              <p className="text-[10px] text-slate-300">Condição declarada pela loja: {conditionLabel(row.condition)}</p>
              {row.receivedAtMs > 0 && (
                <p className="text-[9px] text-slate-400">
                  Registrado em {new Date(row.receivedAtMs).toLocaleString('pt-BR')}
                </p>
              )}
            </>
          )}
        </article>
      ))}
      {(recent.length === RETURN_HISTORY_VISIBLE || historyTruncated) && (
        <p className="text-[9px] text-amber-200">
          Exibindo no máximo 20 devoluções entre até 100 protocolos consultados.
          A consulta pode estar incompleta; consulte o suporte para registros antigos.
        </p>
      )}
    </section>
  );
}
