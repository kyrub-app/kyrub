import { useEffect, useState } from 'react';
import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { CornerDownLeft, MapPin, ShieldCheck } from 'lucide-react';

interface ReturnProtocol {
  status:string;deliveryId:string;storeId:string;courierId:string;
  receivedCondition:string;receivedByStoreAtMs:number;
}
const txt=(x:unknown):string=>typeof x==='string'?x:'';

export function CourierReturnToStorePanel({deliveryId,pickupAddress}:{
  deliveryId:string;pickupAddress:string;
}) {
  const [protocol,setProtocol]=useState<ReturnProtocol|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>onSnapshot(doc(db,'deliveryReturnProtocols',deliveryId),snapshot=>{
    const data=snapshot.data() as Record<string,unknown>|undefined;
    if(!data){setProtocol(null);return;}
    const at=data.receivedByStoreAt as Timestamp|undefined;
    setProtocol({deliveryId,
      status:txt(data.status),storeId:txt(data.storeId),courierId:txt(data.courierId),
      receivedCondition:txt(data.receivedCondition),
      receivedByStoreAtMs:typeof at?.toMillis==='function'?at.toMillis():0,
    });
  },()=>setMessage('Não foi possível consultar o protocolo de devolução.')), [deliveryId]);

  if(!protocol || protocol.status==='authorization_revoked')return null;
  const goToStore=pickupAddress.trim()
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickupAddress)}`
    : '';

  const declare=async()=>{
    if(busy)return;
    if(!window.confirm(
      'Você está fisicamente na loja e vai apresentar a encomenda? O Kyrub exigirá GPS recente dentro da área da loja. Não declare entrega antes de chegar.'
    ))return;
    const user=auth.currentUser;
    if(!user){setMessage('Entre na sua conta para confirmar.');return;}
    setBusy(true);setMessage('');
    try{
      const token=await user.getIdToken();
      const response=await fetch(
        `/api/delivery-opportunities/${encodeURIComponent(deliveryId)}/return-to-store/declare`,
        {method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'}
      );
      const body=await response.json().catch(()=>({})) as Record<string,unknown>;
      if(!response.ok)throw new Error(txt(body.error)||'A chegada à loja não foi comprovada.');
      setMessage('Apresentação registrada. A loja deverá confirmar o recebimento físico pela conta dela.');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível registrar a apresentação.');}
    finally{setBusy(false);}
  };

  return (
    <section className="mt-3 space-y-2 rounded-2xl border border-amber-500/35 bg-amber-500/5 p-3">
      <h3 className="flex items-center gap-2 text-xs font-black text-amber-200">
        <CornerDownLeft className="h-4 w-4"/>Devolução supervisionada
      </h3>
      {protocol.status==='return_authorized' && (
        <>
          <p className="text-[10px] text-amber-100">
            A logística autorizou o retorno **à loja original**. Leve a encomenda
            ao endereço de coleta e mantenha o rastreamento ativo; o retorno
            ainda não foi confirmado nem cancelou o pedido.
          </p>
          {goToStore && (
            <a href={goToStore} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 px-3 py-2 text-[10px] font-black text-cyan-200">
              <MapPin className="h-4 w-4"/>Navegar até a loja original
            </a>
          )}
          <button type="button" disabled={busy} onClick={()=>void declare()}
            className="w-full rounded-xl bg-amber-500 px-3 py-3 text-[10px] font-black text-slate-950 disabled:opacity-50">
            {busy?'Confirmando…':'Estou na loja com a encomenda'}
          </button>
          <p className="text-[9px] text-slate-400">
            Requer geofence atual e GPS recente; a loja precisa confirmar fisicamente.
          </p>
        </>
      )}
      {protocol.status==='courier_presented_to_store' && (
        <p className="text-[10px] text-amber-100">
          <ShieldCheck className="mr-1 inline h-4 w-4"/>
          Você declarou a apresentação no balcão. Aguarde confirmação pela
          conta da loja antes de considerar a devolução concluída.
        </p>
      )}
      {protocol.status==='returned_to_store_pending_reconciliation' && (
        <p className="text-[10px] text-teal-200">
          A loja confirmou a posse do pacote. A decisão sobre o pedido, reembolso
          e remuneração aguarda conciliação econômica separada.
        </p>
      )}
      {message && <p role="status" className="text-[10px] text-cyan-200">{message}</p>}
    </section>
  );
}
