import { useState } from 'react';
import type { User } from 'firebase/auth';
import { ArrowDownCircle } from 'lucide-react';
import FiscalHomologationExecutionWorkspace from './FiscalHomologationExecutionWorkspace';

export default function FiscalHomologationManualExecutionWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [orderId, setOrderId] = useState('');
  const normalizedOrderId = orderId.trim();
  const validOrderId = /^[a-zA-Z0-9:_-]{1,240}$/.test(normalizedOrderId);

  return (
    <div className="space-y-3" id="fiscal-homologation-manual-execution-bridge">
      <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
        <div className="flex items-start gap-3">
          <ArrowDownCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-emerald-300">
              Etapa final · somente após pré-flight pronto
            </span>
            <h4 className="mt-1 text-sm font-black uppercase text-white">Pedido para homologação NFC-e</h4>
            <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
              Use aqui o mesmo ID canônico que foi analisado no pré-flight desta aba. O servidor repetirá todas as validações antes de preparar qualquer tentativa; digitar o ID não concede autoridade de emissão.
            </p>
            <input
              id="fiscal-homologation-execution-order-id"
              value={orderId}
              onChange={event => setOrderId(event.target.value)}
              placeholder="ID canônico do pedido já validado no pré-flight"
              autoComplete="off"
              className="mt-3 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-emerald-500"
            />
            {normalizedOrderId && !validOrderId && (
              <p className="mt-2 text-[8px] text-red-200">O ID informado contém caracteres inválidos.</p>
            )}
          </div>
        </div>
      </section>

      <FiscalHomologationExecutionWorkspace
        user={user}
        storeId={storeId}
        orderId={validOrderId ? normalizedOrderId : ''}
        enabled={validOrderId}
        documentFamily="nfce"
      />
    </div>
  );
}
