import { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  DELIVERY_RETURN_LIABILITY_CAUSES,
  type DeliveryReturnLiabilityCause,
} from '../../../shared/deliveryReturnLiabilityPolicy';

const CAUSES:Record<DeliveryReturnLiabilityCause,string>={
  store_failure:'Falha da loja (com evidências)',
  platform_failure:'Falha comprovada da plataforma',
  recipient_absent:'Destinatário ausente',
  safety_incident:'Segurança, acidente ou ameaça',
  courier_conduct_alleged:'Conduta do entregador sob apuração',
  damage_or_missing:'Avaria, divergência ou extravio',
  undetermined:'Causa não comprovada',
};
const FUNDING:Record<string,string>={
  store:'Lojista/contratante (inicial)',
  kyrub:'Kyrub (inicial)',
  contingency:'Contingência operacional',
  disputed:'Em disputa / sem atribuição',
};
interface ResponseState {
  deliveryId:string;status:string;cause?:DeliveryReturnLiabilityCause;
  initialFunding?:string;damageReviewRequired?:boolean;
  proposedBy?:string;reviewerId?:string;
  justification?:string;reviewReason?:string;revision?:number;
  financialExecutionAuthorized:false;
}
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';

export function AdminDeliveryReturnLiabilityPanel({
  user,deliveryId,
}: {user:User;deliveryId:string}) {
  const [item,setItem]=useState<ResponseState|null>(null);
  const [cause,setCause]=useState<DeliveryReturnLiabilityCause>('recipient_absent');
  const [justification,setJustification]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const request=async(method:'GET'|'POST',path:string,payload?:object)=>{
    const token=await user.getIdToken();
    const response=await fetch(
      '/api/delivery-opportunities/admin/returns/'+encodeURIComponent(deliveryId)+'/liability-review'+path,
      {method,cache:'no-store',
        headers:{authorization:'Bearer '+token,...(method==='POST'?{'content-type':'application/json'}:{})},
        ...(method==='POST'?{body:JSON.stringify(payload??{})}:{})}
    );
    const result=await response.json().catch(()=>({})) as ResponseState&{error?:string};
    if(!response.ok)throw new Error(clean(result.error)||'Classificação indisponível.');
    return result;
  };
  const run=async(action:'load'|'propose'|'approve'|'request_evidence')=>{
    if(busy)return;
    if(action==='propose' && (justification.trim().length<20 || justification.trim().length>500)){
      setMessage('Descreva as evidências e a causa em 20 a 500 caracteres.');return;
    }
    let reason='';
    if (action==='approve'||action==='request_evidence'){
      reason=window.prompt(
        action==='approve'
          ?'Revisão independente: descreva as evidências (20–500 caracteres). Isto NÃO libera pagamentos ou cobranças.'
          :'Explique quais evidências ainda faltam (20–500 caracteres):'
      )?.trim()??'';
      if(!reason)return;
      if(reason.length<20 || reason.length>500){
        setMessage('A justificativa precisa de 20 a 500 caracteres.');return;
      }
    }
    setBusy(true);setMessage('');
    try{
      const result=action==='load'
        ?await request('GET','')
        :action==='propose'
          ?await request('POST','/propose',{cause,justification:justification.trim()})
          :await request('POST','/decision',{decision:action==='approve'?'approve':'request_evidence',reviewReason:reason});
      setItem(result);
      if(action!=='load')setMessage('Decisão auditada. Nenhuma obrigação, cobrança, repasse ou reembolso foi movimentado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível atualizar a classificação.');}
    finally{setBusy(false);}
  };
  const canPropose=item?.status==='not_classified'||item?.status==='needs_more_evidence';
  const canReview=item?.status==='awaiting_independent_review'&&item.proposedBy!==user.uid;
  return <section className="rounded-xl border border-slate-700 p-3">
    <h4 className="text-[10px] font-bold text-slate-200">Responsabilidade inicial — decisão humana</h4>
    <p className="mt-1 text-[9px] text-slate-400">
      Classificação preliminar para custeio, não atribuição definitiva de culpa.
      Sem desconto de ganhos ou cobrança ao comprador.
    </p>
    <button type="button" disabled={busy} onClick={()=>void run('load')}
      className="mt-2 rounded-lg border border-slate-600 px-3 py-2 text-[10px] text-slate-200 disabled:opacity-50">
      {busy?'Acessando…':'Consultar classificação'}
    </button>
    {message && <p role="status" className="mt-2 text-[10px] text-amber-200">{message}</p>}
    {item && <div className="mt-3 space-y-2 text-[10px]">
      <p className="text-slate-300">
        Situação: <strong>{item.status==='not_classified'?'Sem classificação':
          item.status==='awaiting_independent_review'?'Aguardando revisão independente':
            item.status==='needs_more_evidence'?'Evidências adicionais solicitadas':
              'Revisada, sem execução financeira'}</strong>
        {item.revision?' · Versão '+item.revision:''}
      </p>
      {item.cause && <p className="text-slate-300">
        Causa proposta: {CAUSES[item.cause]} · Custeio sugerido: {FUNDING[item.initialFunding??'']??'Não definido'}
      </p>}
      {item.damageReviewRequired && <p className="text-amber-200">Avaria ou divergência: custeio permanece em disputa.</p>}
      {item.reviewReason && <p className="text-slate-400">Revisão: {item.reviewReason}</p>}
      {canPropose && <div className="space-y-2">
        <label className="block text-slate-300">Causa a examinar
          <select value={cause} onChange={e=>setCause(e.target.value as DeliveryReturnLiabilityCause)}
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2">
            {DELIVERY_RETURN_LIABILITY_CAUSES.map(k=><option key={k} value={k}>{CAUSES[k]}</option>)}
          </select>
        </label>
        <textarea value={justification} maxLength={500} rows={3}
          onChange={e=>setJustification(e.target.value)}
          placeholder="Evidências verificadas, relato da loja, suporte e motivo de custeio..."
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white"/>
        <button type="button" disabled={busy} onClick={()=>void run('propose')}
          className="rounded-lg border border-cyan-500/30 px-3 py-2 text-cyan-200 disabled:opacity-50">
          Propor classificação — sem cobrança
        </button>
      </div>}
      {canReview && <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={()=>void run('approve')}
          className="rounded-lg border border-teal-500/30 px-3 py-2 text-teal-200 disabled:opacity-50">
          Revisar independentemente
        </button>
        <button type="button" disabled={busy} onClick={()=>void run('request_evidence')}
          className="rounded-lg border border-amber-500/30 px-3 py-2 text-amber-200 disabled:opacity-50">
          Solicitar evidências
        </button>
      </div>}
    </div>}
  </section>;
}
