import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Headset, PhoneCall, ShieldAlert, X } from 'lucide-react';
import { collection, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { CourierReturnToStorePanel } from './CourierReturnToStorePanel';
import type { CourierVehicleType } from '../../../shared/deliveryVehicleCompatibility';
import {
  getCourierSupportReason,
  KYRUB_COURIER_SUPPORT_REASONS,
  type CourierSupportStage,
  type CourierSupportGroup,
} from '../../../shared/deliverySupportReasons';

const groupLabels: Record<CourierSupportGroup,string> = {
  safety:'Segurança e emergência',pickup:'Problemas na loja',
  route:'Problemas de trajeto e veículo',delivery:'Problemas com a entrega',
  app:'Aplicativo e localização',other:'Outros assuntos',
};

interface Ticket {
  id:string;
  deliveryId:string;
  status:string;
  priority:string;
  reasonLabel:string;
  lastResponse:string;
  reasonCode:string;
  contactAttemptsCount:number;
  recipientArrivedAtMs:number;
  absenceReviewRequested:boolean;
  createdAtMs:number;
}

export function CourierDeliverySupportDialog({
  deliveryId,stage,pickupAddress,vehicleType,trackingRecentlyConfirmed,recipientArrivalVerified,recipientArrivalAtMs,onClose,
}:{
  deliveryId:string;stage:CourierSupportStage;pickupAddress:string;
  vehicleType:CourierVehicleType|null;trackingRecentlyConfirmed:boolean;
  recipientArrivalVerified:boolean;recipientArrivalAtMs:number;onClose:()=>void;
}) {
  const [reasonCode,setReasonCode]=useState('');
  const [detail,setDetail]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [tickets,setTickets]=useState<Ticket[]>([]);
  const retryId=useRef('');
  const attemptRetry=useRef<Record<string,string>>({});
  const [evidenceBusy,setEvidenceBusy]=useState('');
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{
    const interval=window.setInterval(()=>setClock(Date.now()),15000);
    return ()=>window.clearInterval(interval);
  },[]);
  const selected=getCourierSupportReason(reasonCode,stage);

  const reasons=useMemo(()=>KYRUB_COURIER_SUPPORT_REASONS.filter(
    reason=>reason.stages.includes(stage)
  ),[stage]);

  useEffect(()=>{
    const uid=auth.currentUser?.uid;
    if (!uid) return;
    const unsubscribe=onSnapshot(query(
      collection(db,'deliverySupportTickets'),where('courierId','==',uid),limit(50)
    ),snapshot=>{
      const own=snapshot.docs.map(row=>{
        const data=row.data() as Record<string,unknown>;
        const created=data.createdAt as Timestamp|undefined;
        return {
          id:row.id,
          deliveryId:typeof data.deliveryId==='string'?data.deliveryId:'',
          status:typeof data.status==='string'?data.status:'',
          priority:typeof data.priority==='string'?data.priority:'',
          reasonLabel:typeof data.reasonLabel==='string'?data.reasonLabel:'',
          lastResponse:typeof data.lastResponse==='string'?data.lastResponse:'',
          reasonCode:typeof data.reasonCode==='string'?data.reasonCode:'',
          contactAttemptsCount:typeof data.contactAttemptsCount==='number'
            ?data.contactAttemptsCount:0,
          recipientArrivedAtMs:data.recipientArrivedAt
            && typeof (data.recipientArrivedAt as Timestamp).toMillis==='function'
              ?(data.recipientArrivedAt as Timestamp).toMillis():0,
          absenceReviewRequested:Boolean(data.recipientAbsenceReviewRequestedAt),
          createdAtMs:typeof created?.toMillis==='function'?created.toMillis():0,
        };
      }).filter(row=>row.deliveryId===deliveryId)
        .sort((a,b)=>b.createdAtMs-a.createdAtMs).slice(0,8);
      setTickets(own);
    },()=>setMessage('Não foi possível consultar o histórico de chamados.'));
    return ()=>unsubscribe();
  },[deliveryId]);

  const submit=async()=>{
    if (!selected || loading) return;
    if (selected.code==='other_issue' && detail.trim().length<10) {
      setMessage('Para outro problema, escreva pelo menos 10 caracteres.');return;
    }
    const user=auth.currentUser;
    if (!user) {setMessage('Entre na sua conta para registrar o chamado.');return;}
    setLoading(true);setMessage('');
    try {
      const requestId=retryId.current || crypto.randomUUID();
      retryId.current=requestId;
      const token=await user.getIdToken();
      const response=await fetch(
        `/api/delivery-opportunities/${encodeURIComponent(deliveryId)}/support-tickets`,
        {
          method:'POST',
          headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
          body:JSON.stringify({
            ticketId:requestId,reasonCode:selected.code,detail:detail.trim(),
          }),
        }
      );
      const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
      if (!response.ok) throw new Error(
        typeof payload.error==='string'?payload.error:'Não foi possível abrir o chamado.'
      );
      retryId.current='';
      setMessage(`Chamado registrado: ${String(payload.ticketId).slice(0,12)}… Consulte as respostas abaixo. O pedido continua com você até decisão da logística.`);
      setDetail('');setReasonCode('');
    } catch(error) {
      setMessage(error instanceof Error?error.message:'Não foi possível registrar o chamado.');
    } finally {setLoading(false);}
  };

  const absenceAction=async(
    ticket:Ticket,action:'called_recipient'|'messaged_recipient'|'tried_intercom'|'review'
  )=>{
    if (evidenceBusy || ticket.status==='resolved') return;
    const user=auth.currentUser;
    if(!user){setMessage('Faça login novamente antes de registrar a tentativa.');return;}
    const requestKey=`${ticket.id}:${action}`;
    const attemptId=attemptRetry.current[requestKey]||crypto.randomUUID();
    attemptRetry.current[requestKey]=attemptId;
    setEvidenceBusy(requestKey);setMessage('');
    try{
      const token=await user.getIdToken();
      const path=action==='review'?'request-absence-review':'contact-attempt';
      const r=await fetch(
        `/api/delivery-opportunities/support-tickets/${encodeURIComponent(ticket.id)}/${path}`,
        {
          method:'POST',
          headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
          body:JSON.stringify(action==='review'?{}:{attemptId,method:action}),
        }
      );
      const payload=await r.json().catch(()=>({})) as Record<string,unknown>;
      if(!r.ok)throw new Error(typeof payload.error==='string'?payload.error:
        'Não foi possível registrar esta etapa.');
      delete attemptRetry.current[requestKey];
      setMessage(action==='review'
        ? 'Análise logística solicitada. Nenhuma devolução, reatribuição ou cancelamento foi autorizado.'
        : 'Tentativa declarada e registrada. Isso não comprova que o destinatário recebeu a comunicação.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Não foi possível registrar a tentativa.');
    }finally{setEvidenceBusy('');}
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/80 p-2 sm:items-center"
      role="dialog" aria-modal="true" aria-label="Suporte da entrega"
      onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
      <section className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-cyan-500/30 bg-slate-950 p-4 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black">
              <Headset className="h-5 w-5 text-cyan-300"/>Ajuda durante a entrega
            </h2>
            <p className="mt-1 text-[10px] text-slate-400">
              {stage==='accepted'?'Antes de retirar o pedido':'Depois da coleta'} · entrega {deliveryId.slice(0,12)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar suporte"
            className="rounded-xl border border-slate-700 p-2 text-slate-300">
            <X className="h-4 w-4"/>
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-950/35 p-3">
          <p className="flex items-center gap-2 text-xs font-black text-red-200">
            <ShieldAlert className="h-4 w-4"/>Risco imediato? Acione socorro.
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-red-100/80">
            O Kyrub não chama a polícia, ambulância ou bombeiros automaticamente.
            Priorize sua segurança e use os serviços de emergência quando necessário.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              {phone:'190',label:'Polícia'},
              {phone:'192',label:'SAMU'},
              {phone:'193',label:'Bombeiros'},
            ].map(item=>(
              <a key={item.phone} href={`tel:${item.phone}`}
                className="flex items-center justify-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-center text-[10px] font-black text-red-100">
                <PhoneCall className="h-3 w-3"/>{item.phone} {item.label}
              </a>
            ))}
          </div>
        </div>

        {stage==='delivering' && <CourierReturnToStorePanel
          deliveryId={deliveryId} pickupAddress={pickupAddress} vehicleType={vehicleType}
          trackingRecentlyConfirmed={trackingRecentlyConfirmed} />}

        <label className="mt-4 block text-[11px] font-black text-white" htmlFor="kyrub-help-reason">
          O que aconteceu?
        </label>
        <select id="kyrub-help-reason" value={reasonCode}
          onChange={event=>{setReasonCode(event.target.value);retryId.current='';setMessage('');}}
          className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-sm text-white">
          <option value="">Selecione o motivo</option>
          {(Object.keys(groupLabels) as CourierSupportGroup[]).map(group=>{
            const options=reasons.filter(reason=>reason.group===group);
            return options.length>0?(
              <optgroup key={group} label={groupLabels[group]}>
                {options.map(reason=><option key={reason.code} value={reason.code}>{reason.label}</option>)}
              </optgroup>
            ):null;
          })}
        </select>

        {selected && (
          <div className={`mt-3 rounded-xl border p-3 text-[10px] leading-relaxed ${selected.priority==='safety'
            ? 'border-red-500/25 bg-red-500/10 text-red-200'
            : 'border-amber-500/20 bg-amber-500/5 text-amber-100'}`}>
            <p className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4"/>
              {selected.priority==='safety'?'Segurança primeiro':'Orientação'}
            </p>
            <p className="mt-1">{selected.guidance}</p>
          </div>
        )}

        <label className="mt-3 block text-[11px] font-black text-white" htmlFor="kyrub-help-description">
          Conte o que ocorreu <span className="font-normal text-slate-400">(opcional, exceto “Outro problema”)</span>
        </label>
        <textarea id="kyrub-help-description" rows={3} maxLength={900}
          value={detail}
          onChange={event=>{setDetail(event.target.value);retryId.current='';}}
          placeholder="Descreva o que precisa e o que já tentou. Evite dados pessoais e senhas."
          className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-sm text-white"/>
        {message && (
          <p role="status" className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-[11px] text-cyan-100">
            {message}
          </p>
        )}
        <button type="button" disabled={!selected || loading}
          onClick={()=>void submit()}
          className="mt-3 w-full rounded-xl bg-cyan-500 px-4 py-3 text-[11px] font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
          {loading?'Registrando…':'Registrar chamado de ajuda'}
        </button>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
          O chamado é encaminhado à fila administrativa, sem garantia de atendimento imediato.
          Não cancela, devolve, reatribui ou conclui o pedido automaticamente. Após a coleta,
          permaneça com a encomenda até receber orientação da logística, sempre priorizando sua segurança.
        </p>

        {tickets.length>0 && (
          <section className="mt-4 border-t border-slate-800 pt-3">
            <h3 className="text-[11px] font-black text-cyan-200">Chamados desta entrega</h3>
            <div className="mt-2 space-y-2">
              {tickets.map(ticket=>(
                <article key={ticket.id} className="rounded-xl bg-slate-900 p-3 text-[10px]">
                  <p className="font-semibold text-white">{ticket.reasonLabel}</p>
                  <p className="mt-1 text-slate-400">
                    {ticket.status==='open'?'Recebido, sem atendimento iniciado'
                      :ticket.status==='working'?'Em análise pela operação'
                        :ticket.status==='resolved'?'Respondido e encerrado':ticket.status}
                  </p>
                  {ticket.lastResponse && (
                    <p className="mt-2 rounded-lg bg-cyan-500/10 p-2 text-cyan-100">
                      Resposta da equipe: {ticket.lastResponse}
                    </p>
                  )}
                  {ticket.reasonCode==='recipient_not_found' && ticket.status!=='resolved' && (
                    <div className="mt-3 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-[10px] font-black text-amber-100">
                        Destinatário ausente — registro de tentativas
                      </p>
                      <p className="text-[9px] leading-relaxed text-slate-300">
                        Primeiro informe sua chegada ao cliente no fluxo da corrida.
                        Somente depois, registre as tentativas que você realmente fez.
                        Os registros são declarações suas, não comprovantes de recebimento.
                      </p>
                      {recipientArrivalVerified ? (
                        <p className="text-[10px] text-amber-200">
                          Tempo desde a chegada confirmada:
                          {' '}{Math.max(0,Math.floor((clock-recipientArrivalAtMs)/60000))} min.
                          {' '}Dez minutos são apenas referência de mercado, não autorização de devolução no Kyrub.
                        </p>
                      ) : (
                        <p role="status" className="rounded-lg border border-amber-500/20 bg-slate-950 p-2 text-[10px] text-amber-100">
                          A chegada ao destinatário ainda não foi confirmada pelo servidor.
                          Use a etapa de chegada da corrida com GPS ativo; somente depois registre tentativas reais de contato.
                          Sem conexão confiável, consulte o suporte.
                        </p>
                      )}
                      <p className="text-[9px] text-slate-300">
                        Tentativas declaradas: {ticket.contactAttemptsCount}
                      </p>
                      {!ticket.absenceReviewRequested ? (
                        <div className="flex flex-wrap gap-2">
                          {([
                            ['called_recipient','Registrei ligação'],
                            ['messaged_recipient','Registrei mensagem'],
                            ['tried_intercom','Registrei interfone'],
                          ] as const).map(([action,label])=>(
                            <button key={action} type="button"
                              disabled={Boolean(evidenceBusy)||!recipientArrivalVerified}
                              onClick={()=>void absenceAction(ticket,action)}
                              className="rounded-lg border border-amber-500/25 px-2 py-2 text-[10px] text-amber-100 disabled:opacity-40">
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] font-bold text-amber-200">
                          Revisão logística solicitada; mantenha a encomenda em segurança.
                        </p>
                      )}
                      {!ticket.absenceReviewRequested && (
                        <button type="button"
                          disabled={Boolean(evidenceBusy)||!recipientArrivalVerified||ticket.contactAttemptsCount<1}
                          onClick={()=>void absenceAction(ticket,'review')}
                          className="w-full rounded-lg bg-amber-500 px-3 py-2 text-[10px] font-black text-slate-950 disabled:opacity-40">
                          Solicitar análise da logística — não devolver
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
