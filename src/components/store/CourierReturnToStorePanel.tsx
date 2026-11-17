import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { CornerDownLeft, MapPin, ShieldCheck } from 'lucide-react';
import type { CourierVehicleType } from '../../../shared/deliveryVehicleCompatibility';
import { decideCourierRoute } from '../../utils/googleMapsDirections';

interface ReturnProtocol {
  status:string;deliveryId:string;storeId:string;courierId:string;
  receivedCondition:string;receivedByStoreAtMs:number;
}
const txt=(x:unknown):string=>typeof x==='string'?x:'';

export function CourierReturnToStorePanel({deliveryId,pickupAddress,vehicleType,trackingRecentlyConfirmed}:{
  deliveryId:string;pickupAddress:string;vehicleType:CourierVehicleType|null;
  trackingRecentlyConfirmed:boolean;
}) {
  const [protocol,setProtocol]=useState<ReturnProtocol|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    const uid=auth.currentUser?.uid;
    setProtocol(null);
    setMessage('');
    if(!uid)return;
    // A query authorized for this courier also works when no return protocol exists.
    // Directly reading a nonexistent document can be denied by the per-document rules.
    return onSnapshot(query(
      collection(db,'deliveryReturnProtocols'),where('courierId','==',uid),limit(100)
    ),{includeMetadataChanges:true},snapshot=>{
      if(snapshot.metadata.fromCache){
        setProtocol(null);
        setMessage('Sem confirmação atual da logística. Consulte o suporte antes de retornar.');
        return;
      }
      const own=snapshot.docs.find(row=>row.id===deliveryId);
      if(!own){
        setProtocol(null);
        setMessage(snapshot.size>=100?'Histórico de devoluções indisponível; consulte o suporte.':'');
        return;
      }
      const data=own.data() as Record<string,unknown>;
      const at=data.receivedByStoreAt as Timestamp|undefined;
      setMessage('');
      setProtocol({deliveryId,
        status:txt(data.status),storeId:txt(data.storeId),courierId:txt(data.courierId),
        receivedCondition:txt(data.receivedCondition),
        receivedByStoreAtMs:typeof at?.toMillis==='function'?at.toMillis():0,
      });
    },()=>{setProtocol(null);setMessage('Não foi possível consultar o protocolo de devolução.');});
  },[deliveryId]);

  if(!protocol) {
    // Cached/failed lookup cannot be interpreted as permission to return.
    // Keep the warning visible instead of silently hiding the return panel.
    return message ? (
      <section role="status" className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/5 p-3 text-[10px] text-amber-100">
        <p className="font-black">Orientação de devolução indisponível</p>
        <p className="mt-1">{message}</p>
        <p className="mt-1">Não inicie o retorno por conta própria. Procure o suporte da corrida.</p>
      </section>
    ) : null;
  }
  const goToStore = decideCourierRoute({
    status:'delivering',vehicleType,pickup:pickupAddress,dropoff:'',
    returnStatus:protocol.status==='return_authorized'?'return_authorized':'unavailable',
  });

  const declare=async()=>{
    if(busy)return;
    if(!trackingRecentlyConfirmed){
      setMessage('GPS sem confirmação recente. Ative ou reconecte o rastreio antes de declarar a apresentação.');
      return;
    }
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
      {protocol.status==='authorization_revoked' && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-[11px] text-red-100">
          <p className="font-black">Retorno à loja revogado pela logística</p>
          <p className="mt-1 leading-relaxed">
            Não prossiga com a devolução nem entregue a encomenda sem nova autorização.
            Pare em local seguro, mantenha a guarda do pacote e solicite orientação pelo suporte.
            A revogação não conclui o pedido nem libera qualquer pagamento.
          </p>
        </div>
      )}
      {protocol.status==='return_authorized' && (
        <>
          <p className="text-[10px] text-amber-100">
            A logística autorizou o retorno à loja original. Leve a encomenda
            ao endereço de coleta e mantenha o rastreamento ativo; o retorno
            ainda não foi confirmado nem cancelou o pedido.
          </p>
          {goToStore.url && (
            <a href={goToStore.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 px-3 py-2 text-[10px] font-black text-cyan-200">
              <MapPin className="h-4 w-4"/>Navegar até a loja original
            </a>
          )}
          {!trackingRecentlyConfirmed && (
            <p role="status" className="rounded-lg border border-amber-500/30 p-2 text-[10px] text-amber-100">
              GPS sem confirmação recente. Ative ou reconecte o rastreio para declarar a apresentação à loja.
            </p>
          )}
          <button type="button" disabled={busy||!trackingRecentlyConfirmed} onClick={()=>void declare()}
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
