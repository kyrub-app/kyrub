import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Headset, PhoneCall, ShieldAlert, X } from 'lucide-react';
import { collection, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
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
  createdAtMs:number;
}

export function CourierDeliverySupportDialog({deliveryId,stage,onClose}:{
  deliveryId:string;stage:CourierSupportStage;onClose:()=>void;
}) {
  const [reasonCode,setReasonCode]=useState('');
  const [detail,setDetail]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [tickets,setTickets]=useState<Ticket[]>([]);
  const retryId=useRef('');
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
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
