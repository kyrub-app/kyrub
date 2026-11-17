import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { PackageCheck, ShieldAlert, Truck } from 'lucide-react';
import { auth, db } from '../../utils/firebase';

interface ReturnRow {
  id:string;courierId:string;orderId:string;
  status:string;ticketId:string;
  authorizedAtMs:number;courierPresentedAtMs:number;
  receivedCondition:string;
}
const clean=(v:unknown):string=>typeof v==='string'?v.trim():'';
const parseTime=(v:unknown):number =>
  v && typeof v==='object' && 'toMillis' in v
    && typeof (v as Timestamp).toMillis==='function'
    ? (v as Timestamp).toMillis() : 0;

export function StoreDeliveryReturnQueue({storeId}:{storeId:string}) {
  const [rows,setRows]=useState<ReturnRow[]>([]);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [queryState,setQueryState]=useState<'waiting'|'live'|'offline'|'error'>('waiting');
  const [sessionAuthorized,setSessionAuthorized]=useState(false);
  const [reviewingId,setReviewingId]=useState('');
  const [receiptCondition,setReceiptCondition]=useState<''|'intact'|'damaged'|'disputed'>('');
  const [receiptNote,setReceiptNote]=useState('');
  const [receiptAcknowledged,setReceiptAcknowledged]=useState(false);

  useEffect(()=>{
    let unsubscribeReturns:()=>void=()=>undefined;
    const unsubscribeAuth=onAuthStateChanged(auth,user=>{
      unsubscribeReturns();
      unsubscribeReturns=()=>undefined;
      setRows([]);
      setMessage('');
      setQueryState('waiting');
      setReviewingId('');
      setReceiptCondition('');
      setReceiptNote('');
      setReceiptAcknowledged(false);
      const authorized=Boolean(user && user.uid===storeId);
      setSessionAuthorized(authorized);
      if(!authorized)return;
      unsubscribeReturns=onSnapshot(
        query(collection(db,'deliveryReturnProtocols'),where('storeId','==',storeId),limit(100)),
        {includeMetadataChanges:true},
        snap=>{
          setQueryState(snap.metadata.fromCache?'offline':'live');
          setMessage(old=>old==='Não foi possível consultar devoluções sob revisão.'?'':old);
          setRows(snap.docs.map(item=>{
            const data=item.data() as Record<string,unknown>;
            return {
              id:item.id,courierId:clean(data.courierId),orderId:clean(data.orderId),
              ticketId:clean(data.ticketId),status:clean(data.status),
              authorizedAtMs:parseTime(data.authorizedAt),
              courierPresentedAtMs:parseTime(data.courierPresentedAt),
              receivedCondition:clean(data.receivedCondition),
            };
          }));
        },
        ()=>{
          setRows([]);
          setQueryState('error');
          setMessage('Não foi possível consultar devoluções sob revisão.');
        }
      );
    });
    return ()=>{unsubscribeAuth();unsubscribeReturns();};
  },[storeId]);

  const visible=useMemo(()=>rows
    .filter(row=>row.status!=='authorization_revoked')
    .sort((a,b)=>b.authorizedAtMs-a.authorizedAtMs).slice(0,40),[rows]);

  const confirm=async(row:ReturnRow)=>{
    if(busy || row.status!=='courier_presented_to_store' || reviewingId!==row.id)return;
    if(queryState!=='live'){
      setMessage('Consulta da loja sem confirmação atual. Reconecte-se antes de registrar recebimento.');
      return;
    }
    const note=receiptNote.trim();
    if(!receiptCondition || note.length<10 || note.length>500 || !receiptAcknowledged){
      setMessage('Escolha a condição, descreva a conferência (10 a 500 caracteres) e confirme a posse física.');
      return;
    }
    setBusy(row.id);setMessage('');
    try{
      const user=auth.currentUser;
      if(!user||user.uid!==storeId)throw new Error('A conta deve corresponder à loja.');
      const token=await user.getIdToken();
      const r=await fetch(
        `/api/delivery-opportunities/${encodeURIComponent(row.id)}/return-to-store/confirm-receipt`,
        {method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
          body:JSON.stringify({condition:receiptCondition,note})}
      );
      const payload=await r.json().catch(()=>({})) as Record<string,unknown>;
      if(!r.ok)throw new Error(clean(payload.error)||'Recebimento não autorizado.');
      setReviewingId('');
      setReceiptCondition('');
      setReceiptNote('');
      setReceiptAcknowledged(false);
      setMessage('Posse da loja registrada. O pedido, eventual reembolso e os valores do entregador aguardam conciliação independente.');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível registrar o recebimento.');}
    finally{setBusy('');}
  };

  if(!sessionAuthorized)return null;
  if(!visible.length && queryState==='live' && !message)return null;
  return (
    <section className="mb-4 rounded-3xl border border-amber-500/25 bg-amber-500/5 p-4">
      <h3 className="flex items-center gap-2 text-sm font-black text-amber-200">
        <PackageCheck className="h-5 w-5"/>Devoluções em conferência
      </h3>
      <p className="mt-1 text-[10px] text-slate-400">
        Devolução só é reconhecida depois da confirmação física pela loja.
        Ela não conclui pedido, repasse, cancelamento ou reembolso.
      </p>
      {message && <p role="status" className="mt-2 text-[10px] text-amber-200">{message}</p>}
      {queryState==='waiting' && (
        <p role="status" className="mt-2 text-[10px] text-slate-300">Consultando protocolos de devolução…</p>
      )}
      {(queryState==='offline'||queryState==='error') && (
        <p role="alert" className="mt-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[10px] text-amber-100">
          {queryState==='offline'
            ? 'Sem confirmação atual do servidor. Os dados exibidos podem estar desatualizados.'
            : 'Não foi possível confirmar os protocolos de devolução.'}
          {' '}Não confirme recebimentos até restabelecer a consulta.
        </p>
      )}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {visible.map(row=>(
          <article key={row.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-white">
            <p className="text-[11px] font-black">Pedido {row.orderId}</p>
            <p className="mt-1 text-[9px] text-slate-400">
              Entregador: {row.courierId} · ID {row.id}
            </p>
            {row.status==='return_authorized' && (
              <p className="mt-2 flex gap-2 text-[10px] text-amber-100">
                <Truck className="h-4 w-4 shrink-0"/>
                Logística autorizou o retorno; pacote ainda está com o entregador.
                NÃO confirme recebimento antes de conferir fisicamente.
              </p>
            )}
            {row.status==='courier_presented_to_store' && (
              <>
                <p className="mt-2 flex gap-2 text-[10px] text-amber-100">
                  <ShieldAlert className="h-4 w-4 shrink-0"/>
                  Entregador declarou chegada no perímetro da loja. Confira
                  quem trouxe e o conteúdo físico; GPS sozinho não prova devolução.
                </p>
                {reviewingId===row.id ? (
                  <div className="mt-3 space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                    <label htmlFor={`return-condition-${row.id}`} className="block text-[10px] font-black text-amber-100">
                      Condição da encomenda conferida
                    </label>
                    <select id={`return-condition-${row.id}`} value={receiptCondition}
                      onChange={event=>setReceiptCondition(event.target.value as typeof receiptCondition)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-xs text-white">
                      <option value="">Selecione a condição</option>
                      <option value="intact">Intacta</option>
                      <option value="damaged">Danificada</option>
                      <option value="disputed">Divergente</option>
                    </select>
                    <label htmlFor={`return-note-${row.id}`} className="block text-[10px] font-black text-amber-100">
                      Descrição da conferência (10 a 500 caracteres)
                    </label>
                    <textarea id={`return-note-${row.id}`} value={receiptNote}
                      onChange={event=>setReceiptNote(event.target.value)}
                      maxLength={500} rows={3}
                      placeholder="Descreva embalagem, lacres e eventuais divergências; não inclua senhas nem dados pessoais."
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-xs text-white"/>
                    <label className="flex items-start gap-2 text-[10px] leading-relaxed text-amber-100">
                      <input type="checkbox" checked={receiptAcknowledged}
                        onChange={event=>setReceiptAcknowledged(event.target.checked)}
                        className="mt-0.5"/>
                      Confirmei pessoalmente a posse física desta encomenda.
                      Sei que isso não cancela o pedido nem autoriza reembolso ou remuneração.
                    </label>
                    <div className="flex gap-2">
                      <button type="button" disabled={Boolean(busy)}
                        onClick={()=>{setReviewingId('');setMessage('');}}
                        className="flex-1 rounded-lg border border-slate-700 px-3 py-3 text-[10px] text-slate-300 disabled:opacity-50">
                        Voltar
                      </button>
                      <button type="button"
                        disabled={Boolean(busy)||queryState!=='live'||!receiptCondition
                          ||receiptNote.trim().length<10||!receiptAcknowledged}
                        onClick={()=>void confirm(row)}
                        className="flex-1 rounded-lg bg-amber-500 px-3 py-3 text-[10px] font-black text-slate-950 disabled:opacity-50">
                        {busy===row.id?'Registrando…':'Confirmar recebimento físico na loja'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" disabled={Boolean(busy)||queryState!=='live'}
                    onClick={()=>{setReviewingId(row.id);setReceiptCondition('');
                      setReceiptNote('');setReceiptAcknowledged(false);setMessage('');}}
                    className="mt-3 w-full rounded-lg bg-amber-500 px-3 py-3 text-[10px] font-black text-slate-950 disabled:opacity-50">
                    Conferir devolução no balcão
                  </button>
                )}
              </>
            )}
            {row.status==='returned_to_store_pending_reconciliation' && (
              <p className="mt-2 text-[10px] text-emerald-200">
                Loja confirmou a devolução ({row.receivedCondition}).
                Decisão econômica e do pedido ainda pendente.
              </p>
            )}
          </article>
        ))}
      </div>
      {(visible.length>=40||rows.length>=100) && <p className="mt-3 text-[9px] text-amber-200">
        Exibindo até 40 ocorrências entre no máximo 100 protocolos consultados.
        A consulta pode omitir devoluções recentes quando houver mais registros; a paginação será necessária em escala.
      </p>}
    </section>
  );
}
