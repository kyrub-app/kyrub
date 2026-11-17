import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  collection, getDocs, limit, onSnapshot, query, where, type Timestamp,
} from 'firebase/firestore';
import { AlertTriangle, ClipboardList, Headset } from 'lucide-react';
import { db } from '../../utils/firebase';

interface Ticket {
  id:string;deliveryId:string;courierId:string;status:string;
  reasonLabel:string;reasonCode:string;priority:string;stage:string;
  detail:string;lastResponse:string;assignedTo:string;createdAtMs:number;
}
interface Event {id:string;action:string;actorId:string;createdAtMs:number;}

const clean=(value:unknown):string=>typeof value==='string'?value.trim():'';

export function AdminDeliverySupportQueue({user}:{user:User}) {
  const [tickets,setTickets]=useState<Ticket[]>([]);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [audit,setAudit]=useState<Record<string,Event[]>>({});
  const [auditBusy,setAuditBusy]=useState('');

  useEffect(()=>onSnapshot(
    query(collection(db,'deliverySupportTickets'),limit(100)),
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
      };
    })),()=>setMessage('Fila de suporte indisponível para este perfil administrativo.')
  ),[]);

  const ordered=useMemo(()=>[...tickets].sort((a,b)=>{
    const p=(t:Ticket)=>t.status==='resolved'?3:
      t.priority==='safety'?0:t.priority==='urgent'?1:2;
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
        Fila limitada a 100 chamados. É necessário ampliar a paginação antes da operação comercial.
      </p>}
    </section>
  );
}
