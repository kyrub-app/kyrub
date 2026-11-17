import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  collection, getDocs, limit, onSnapshot, orderBy, query, where, type Timestamp,
} from 'firebase/firestore';
import { AlertTriangle, ClipboardList, Headset } from 'lucide-react';
import { db } from '../../utils/firebase';
import { AdminDeliveryReturnEconomicsPreview } from './AdminDeliveryReturnEconomicsPreview';

interface Ticket {
  id:string;deliveryId:string;courierId:string;status:string;
  reasonLabel:string;reasonCode:string;priority:string;stage:string;
  detail:string;lastResponse:string;assignedTo:string;createdAtMs:number;
  contactAttemptsCount:number;recipientArrivedAtMs:number;absenceReviewRequestedAtMs:number;
}
interface Event {id:string;action:string;actorId:string;createdAtMs:number;}

const clean=(value:unknown):string=>typeof value==='string'?value.trim():'';

export function AdminDeliverySupportQueue({user}:{user:User}) {
  const [tickets,setTickets]=useState<Ticket[]>([]);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [audit,setAudit]=useState<Record<string,Event[]>>({});
  const [auditBusy,setAuditBusy]=useState('');
  const [returns,setReturns]=useState<Record<string,string>>({});

  useEffect(()=>onSnapshot(
    query(collection(db,'deliverySupportTickets'),orderBy('createdAt','desc'),limit(100)),
    snapshot=>setTickets(snapshot.docs.map(row=>{
      const entry=row.data() as Record<string,unknown>;
      const created=entry.createdAt as Timestamp|undefined;
      return {
        id:row.id,deliveryId:clean(entry.deliveryId),courierId:clean(entry.courierId),
        status:clean(entry.status),reasonLabel:clean(entry.reasonLabel),
        reasonCode:clean(entry.reasonCode),priority:clean(entry.priority),
        stage:clean(entry.stage),detail:clean(entry.detail),
        lastResponse:clean(entry.lastResponse),assignedTo:clean(entry.assignedTo),
        createdAtMs:typeof created?.toMillis==='function'?created.toMillis():0,
        contactAttemptsCount:typeof entry.contactAttemptsCount==='number'?entry.contactAttemptsCount:0,
        recipientArrivedAtMs:entry.recipientArrivedAt
          && typeof (entry.recipientArrivedAt as Timestamp).toMillis==='function'
            ?(entry.recipientArrivedAt as Timestamp).toMillis():0,
        absenceReviewRequestedAtMs:entry.recipientAbsenceReviewRequestedAt
          && typeof (entry.recipientAbsenceReviewRequestedAt as Timestamp).toMillis==='function'
            ?(entry.recipientAbsenceReviewRequestedAt as Timestamp).toMillis():0,
      };
    })),()=>setMessage('Fila de suporte indisponível para este perfil administrativo.')
  ),[]);

  useEffect(()=>onSnapshot(
    query(collection(db,'deliveryReturnProtocols'),limit(100)),
    snap=>setReturns(Object.fromEntries(snap.docs.map(row=>{
      const data=row.data() as Record<string,unknown>;
      return [row.id,clean(data.status)];
    }))),
    ()=>setMessage('Protocolo de devolução temporariamente indisponível.')
  ),[]);

  const decideReturn=async(ticket:Ticket,action:'authorize'|'revoke')=>{
    if(busy)return;
    if(action==='authorize' && ticket.assignedTo!==user.uid){
      setMessage('Assuma o atendimento com sua conta antes de autorizar o retorno.');return;
    }
    const reason=window.prompt(action==='authorize'
      ? 'Justifique o retorno à loja original, considerando as tentativas de contato e a segurança física (10–500 caracteres). Isto não autoriza reembolso ou pagamento:'
      : 'Justifique a revogação da autorização ANTES da entrega física à loja (10–500 caracteres):'
    )?.trim();
    if(!reason)return;
    if(reason.length<10 || reason.length>500){
      setMessage('Justificativa precisa ter de 10 a 500 caracteres.');return;
    }
    if(!window.confirm(action==='authorize'
      ? 'Confirmar autorização de RETORNO, mas não cancelamento? O entregador continua responsável até a loja confirmar a posse.'
      : 'Revogar esta autorização antes da entrega física?'))return;
    setBusy(ticket.id);setMessage('');
    try{
      const token=await user.getIdToken();
      const endpoint=action==='authorize'
        ? `/api/delivery-opportunities/admin/support-tickets/${encodeURIComponent(ticket.id)}/authorize-return`
        : `/api/delivery-opportunities/admin/returns/${encodeURIComponent(ticket.deliveryId)}/revoke`;
      const result=await fetch(endpoint,{
        method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
        body:JSON.stringify({reason}),
      });
      const data=await result.json().catch(()=>({})) as Record<string,unknown>;
      if(!result.ok)throw new Error(clean(data.error)||'Decisão de retorno recusada.');
      setMessage(action==='authorize'
        ? 'Retorno autorizado. Encomenda permanece com entregador até apresentação no perímetro da loja e recebimento independente.'
        : 'Autorização revogada. A logística poderá retomar a análise da entrega.');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível registrar a decisão.');}
    finally{setBusy('');}
  };

  const ordered=useMemo(()=>[...tickets].sort((a,b)=>{
    const p=(t:Ticket)=>t.status==='resolved'?4:
      t.priority==='safety'?0:
      t.absenceReviewRequestedAtMs>0?1:t.priority==='urgent'?2:3;
    return p(a)-p(b)||b.createdAtMs-a.createdAtMs;
  }),[tickets]);

  const act=async(ticket:Ticket,action:'take'|'reply'|'resolve')=>{
    if (busy) return;
    const response=action==='take'?'':window.prompt(action==='resolve'
      ? 'Descreva a solução, decisão da logística e próximos passos (10–900 caracteres). A conclusão deste chamado NÃO cancela o pedido:'
      : 'Escreva uma resposta objetiva para o entregador (10–900 caracteres):')?.trim();
    if (action!=='take' && (!response || response.length<10 || response.length>900)){
      if (response) setMessage('A resposta deve ter entre 10 e 900 caracteres.');
      return;
    }
    setBusy(ticket.id);setMessage('');
    try {
      const token=await user.getIdToken();
      const r=await fetch(
        `/api/delivery-opportunities/admin/support-tickets/${encodeURIComponent(ticket.id)}/respond`,
        {method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
          body:JSON.stringify({action,response:response||''})}
      );
      const data=await r.json().catch(()=>({})) as Record<string,unknown>;
      if (!r.ok)throw new Error(clean(data.error)||'Atualização recusada.');
      setMessage(action==='resolve'
        ? 'Chamado encerrado. O status do pedido e sua custódia não foram alterados.'
        : 'Atendimento registrado. O entregador verá a atualização no aplicativo.');
      setAudit(previous=>{const next={...previous};delete next[ticket.id];return next;});
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível atualizar o atendimento.');}
    finally{setBusy('');}
  };

  const loadAudit=async(ticketId:string)=>{
    if (auditBusy) return;
    setAuditBusy(ticketId);setMessage('');
    try{
      const snapshot=await getDocs(query(
        collection(db,'deliverySupportTicketEvents'),
        where('ticketId','==',ticketId),limit(50)
      ));
      setAudit(previous=>({...previous,[ticketId]:snapshot.docs.map(row=>{
        const data=row.data() as Record<string,unknown>;
        const created=data.createdAt as Timestamp|undefined;
        return {
          id:row.id,action:clean(data.action),actorId:clean(data.actorId),
          createdAtMs:typeof created?.toMillis==='function'?created.toMillis():0,
        };
      }).sort((a,b)=>a.createdAtMs-b.createdAtMs)}));
    }catch{setMessage('Não foi possível consultar o histórico auditável.');}
    finally{setAuditBusy('');}
  };

  return (
    <section className="mt-5 rounded-3xl border border-cyan-500/20 bg-slate-950 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black">
            <Headset className="h-5 w-5 text-cyan-300"/>Suporte às entregas
          </h2>
          <p className="mt-1 text-[10px] text-slate-400">
            Chamados enviados pelo entregador, priorizados por segurança.
            Não são cancelamentos nem autorizam alterar custódia ou pagamento.
          </p>
        </div>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-[10px] text-slate-300">
          {tickets.filter(ticket=>ticket.status!=='resolved').length} pendentes
        </span>
      </div>
      {message && <p role="status" className="mt-3 rounded-xl border border-cyan-500/25 p-3 text-[11px] text-cyan-100">{message}</p>}
      <div className="mt-3 max-h-[65vh] space-y-3 overflow-y-auto">
        {ordered.length===0 && <p className="rounded-xl bg-slate-900 p-3 text-[11px] text-slate-400">Nenhum chamado registrado nesta fila.</p>}
        {ordered.map(ticket=>(
          <article key={ticket.id} className={`rounded-xl border p-3 ${ticket.priority==='safety'
            ? 'border-red-500/35 bg-red-500/5':'border-slate-800 bg-slate-900/60'}`}>
            <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
              {ticket.priority==='safety' && <AlertTriangle className="h-4 w-4 text-red-300"/>}
              {ticket.reasonLabel}
              <span className={ticket.priority==='safety'?'text-red-300':'text-cyan-300'}>
                {ticket.priority==='safety'?'SEGURANÇA':ticket.priority==='urgent'?'URGENTE':'NORMAL'}
              </span>
            </p>
            <p className="mt-1 break-all text-[9px] text-slate-400">
              Entrega {ticket.deliveryId} · Entregador {ticket.courierId}
              {' · '}{ticket.stage==='accepted'?'antes da coleta':'após a coleta'}
            </p>
            <p className="mt-1 text-[10px] text-slate-300">
              {ticket.status==='open'?'Novo chamado'
                :ticket.status==='working'?'Em atendimento':'Resolvido'}
              {ticket.assignedTo?' · responsável '+ticket.assignedTo:''}
            </p>
            {ticket.detail && <p className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-200">{ticket.detail}</p>}
            {ticket.reasonCode==='recipient_not_found' && (
              <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-[10px] text-amber-100">
                <p className="font-bold">
                  Destinatário ausente · {ticket.contactAttemptsCount} tentativa(s) declarada(s)
                </p>
                {ticket.recipientArrivedAtMs>0 && (
                  <p className="mt-1 text-slate-300">
                    Chegada informada pelo entregador, com rastreio ativo:
                    {' '}{new Date(ticket.recipientArrivedAtMs).toLocaleString('pt-BR')}
                  </p>
                )}
                {ticket.absenceReviewRequestedAtMs>0 && (
                  <p className="mt-1 font-bold text-amber-200">
                    Revisão solicitada em {' '}
                    {new Date(ticket.absenceReviewRequestedAtMs).toLocaleString('pt-BR')}.
                    Nenhum retorno ou cancelamento foi autorizado por essa solicitação.
                  </p>
                )}
              </div>
            )}
            {ticket.reasonCode==='recipient_not_found' && returns[ticket.deliveryId] && (
              <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-[10px] text-amber-200">
                Custódia de retorno: {returns[ticket.deliveryId]}.
                {' '}A confirmação física da loja é obrigatória e os valores continuam em análise.
              </p>
            )}
            {ticket.reasonCode==='recipient_not_found'
              && returns[ticket.deliveryId]==='returned_to_store_pending_reconciliation' && (
              <AdminDeliveryReturnEconomicsPreview user={user} deliveryId={ticket.deliveryId} />
            )}
            {ticket.lastResponse && <p className="mt-2 rounded-lg bg-slate-950 p-2 text-[10px] text-cyan-200">Última resposta: {ticket.lastResponse}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {ticket.status!=='resolved' && (
                <>
                  <button type="button" disabled={busy===ticket.id} onClick={()=>void act(ticket,'take')}
                    className="rounded-lg border border-amber-500/30 px-3 py-2 text-[10px] text-amber-200 disabled:opacity-50">
                    Assumir atendimento
                  </button>
                  <button type="button" disabled={busy===ticket.id} onClick={()=>void act(ticket,'reply')}
                    className="rounded-lg border border-cyan-500/30 px-3 py-2 text-[10px] text-cyan-200 disabled:opacity-50">
                    Responder
                  </button>
                  <button type="button" disabled={busy===ticket.id} onClick={()=>void act(ticket,'resolve')}
                    className="rounded-lg border border-teal-500/30 px-3 py-2 text-[10px] text-teal-200 disabled:opacity-50">
                    Encerrar chamado
                  </button>
                </>
              )}
              {ticket.reasonCode==='recipient_not_found'
                && ticket.absenceReviewRequestedAtMs>0
                && ticket.status!=='resolved'
                && !returns[ticket.deliveryId]
                && ticket.assignedTo===user.uid && (
                <button type="button" disabled={busy===ticket.id}
                  onClick={()=>void decideReturn(ticket,'authorize')}
                  className="rounded-lg border border-orange-500/35 px-3 py-2 text-[10px] text-orange-200 disabled:opacity-50">
                  Autorizar retorno à loja — sem cancelamento
                </button>
              )}
              {ticket.reasonCode==='recipient_not_found'
                && returns[ticket.deliveryId]==='return_authorized' && (
                <button type="button" disabled={busy===ticket.id}
                  onClick={()=>void decideReturn(ticket,'revoke')}
                  className="rounded-lg border border-red-500/35 px-3 py-2 text-[10px] text-red-200 disabled:opacity-50">
                  Revogar autorização de retorno
                </button>
              )}
              <button type="button" disabled={auditBusy===ticket.id}
                onClick={()=>void loadAudit(ticket.id)}
                className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-[10px] text-slate-300 disabled:opacity-50">
                <ClipboardList className="h-3.5 w-3.5"/>Ver histórico
              </button>
            </div>
            {audit[ticket.id] && (
              <div className="mt-2 rounded-lg bg-slate-950 p-2">
                {audit[ticket.id].map(event=>(
                  <p key={event.id} className="text-[9px] text-slate-400">
                    {event.createdAtMs?new Date(event.createdAtMs).toLocaleString('pt-BR'):''}
                    {' · '}{event.actorId}{' · '}{event.action}
                  </p>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      {tickets.length>=100 && <p className="mt-3 text-[10px] text-amber-200">
        Mostrando apenas os 100 chamados mais recentes. Chamados antigos podem ficar fora da fila; é necessário ampliar a paginação antes da operação comercial.
      </p>}
    </section>
  );
}
