import {FreelaNegotiationPreview} from './FreelaNegotiationPreview';
import {useCallback,useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {applyToHiringVacancy,decideHiringApplication,editHiringVacancy,listHiringApplications,listHiringVacancies,openHiringSupportCase,publishHiringVacancy,retireHiringVacancy,submitHiringCancellation,transitionHiringCompletion,type HiringApplication,type HiringVacancy} from '../../utils/freelanceHiringCloud';

export function FreelaCloudPreview({mode,onClose}:{mode:'employer'|'employee';onClose:()=>void}){
 const employer=mode==='employer';
 const [actor,setActor]=useState(auth.currentUser?.uid||'');
 const [vacancies,setVacancies]=useState<HiringVacancy[]>([]);
 const [applications,setApplications]=useState<HiringApplication[]>([]);
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[payment,setPayment]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [openNegotiation,setOpenNegotiation]=useState('');
 const [editingId,setEditingId]=useState('');
 const [retiringId,setRetiringId]=useState('');
 const [cancelId,setCancelId]=useState(''),[cancelReason,setCancelReason]=useState('');
 useEffect(()=>onAuthStateChanged(auth,user=>{setActor(user?.uid||'');setVacancies([]);setApplications([]);setNotice('');setOpenNegotiation('');setCancelId('');setCancelReason('');setRetiringId('');setEditingId('');setTitle('');setDescription('');setPayment('');}),[]);
 const refresh=useCallback(async()=>{
   if(!actor)return;
   const [v,a]=await Promise.all([listHiringVacancies(employer),listHiringApplications(employer)]);
   if(auth.currentUser?.uid===actor){setVacancies(v);setApplications(a);}
 },[actor,employer]);
 useEffect(()=>{setVacancies([]);setApplications([]);void refresh().catch(()=>{if(auth.currentUser?.uid===actor)setNotice('Não foi possível consultar o servidor.');});},[refresh,actor]);
 const perform=async(action:()=>Promise<string>)=>{
   if(busy||!actor)return;
   setBusy(true);setNotice('');
   try{
     const result=await action();
     if(auth.currentUser?.uid===actor){
       setNotice(result);
       try{await refresh();}catch{if(auth.currentUser?.uid===actor)setNotice(result+' Não foi possível atualizar a consulta.');}
     }
   }
   catch{if(auth.currentUser?.uid===actor)setNotice('Operação não confirmada. Confira sua elegibilidade, identidade e conexão.');}
   finally{setBusy(false);}
 };
 return <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
   <section className="bg-slate-900 border border-slate-800 w-full max-w-lg p-5 rounded-3xl space-y-4 max-h-[85vh] overflow-y-auto text-sm text-slate-100">
    <header className="flex justify-between gap-3"><h3 className="text-base font-bold">Freelas — homologação local</h3><button type="button" onClick={onClose}>Fechar</button></header>
    <p>Vagas e candidaturas registradas no emulador isolado. Não há intermediação de pagamento.</p>
    {employer&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void perform(async()=>{const input={title,description,payment:Number(payment)};if(editingId)await editHiringVacancy(editingId,input);else await publishHiringVacancy(input);if(auth.currentUser?.uid===actor){setEditingId('');setTitle('');setDescription('');setPayment('');}return editingId?'Oferta atualizada.':'Vaga registrada no servidor de testes.';});}}>
      <label className="block">Título<input className="block w-full bg-slate-950 rounded-lg p-2" required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="block">Descrição<textarea className="block w-full bg-slate-950 rounded-lg p-2" required maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label className="block">Valor combinado (R$)<input className="block w-full bg-slate-950 rounded-lg p-2" type="number" required min="0.01" step="0.01" value={payment} onChange={e=>setPayment(e.target.value)}/></label>
      <button disabled={busy||!actor} className="bg-teal-500 text-slate-950 rounded-lg p-2 font-bold">{editingId?'Salvar edição':'Publicar vaga de teste'}</button>
      {editingId&&<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setEditingId('');setTitle('');setDescription('');setPayment('');}}>Cancelar edição</button>}
    </form>}
    <h4 className="font-bold">{employer?'Minhas vagas':'Vagas disponíveis'}</h4>
    {vacancies.filter(v=>employer||v.ownerId!==actor).map(v=><article key={v.id} className="border border-slate-700 rounded-xl p-3 space-y-2">
      <strong>{v.title}</strong><p>{v.description}</p><p>R$ {v.payment.toFixed(2)} · {v.employer}</p>
      {employer&&v.status==='open'&&(v.termsLocked===false&&v.hasAccepted===false?<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setEditingId(v.id);setTitle(v.title);setDescription(v.description);setPayment(String(v.payment));}}>Editar oferta</button>:<p className="text-xs text-slate-300">Condições bloqueadas para edição.</p>)}
      {employer&&v.status==='open'&&v.hasAccepted===false&&<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>setRetiringId(v.id)}>Retirar oferta</button>}
      {employer&&retiringId===v.id&&v.status==='open'&&<div className="border border-amber-500/40 rounded-lg p-2 space-y-2"><p>A oferta sairá do catálogo. Candidaturas pendentes serão encerradas e os interessados avisados. O histórico será preservado.</p><button type="button" disabled={busy} className="border border-amber-500 rounded-lg p-2" onClick={()=>void perform(async()=>{const result=await retireHiringVacancy(v.id);if(auth.currentUser?.uid===actor){setRetiringId('');if(editingId===v.id){setEditingId('');setTitle('');setDescription('');setPayment('');}}return result.complete?'Oferta retirada.':'Oferta retirada do catálogo; avisos pendentes de processamento.';})}>Confirmar retirada</button><button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>setRetiringId('')}>Cancelar retirada</button></div>}
      {employer&&v.status==='closed'&&<p className="text-xs text-slate-300">Oferta retirada.</p>}
      {employer&&v.retirementPending&&<button type="button" disabled={busy} className="border border-amber-500 rounded-lg p-2" onClick={()=>void perform(async()=> (await retireHiringVacancy(v.id)).complete?'Encerramento concluído.':'Ainda há avisos pendentes. Continue o encerramento.')}>Continuar encerramento</button>}
      {employer&&v.status==='closed'&&!v.retirementPending&&<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setEditingId('');setTitle(v.title);setDescription(v.description);setPayment(String(v.payment));}}>Criar nova oferta</button>}
      {!employer&&<button disabled={busy||applications.some(a=>a.vagaId===v.id)} className="bg-teal-500 text-slate-950 rounded-lg p-2" onClick={()=>void perform(async()=>await applyToHiringVacancy(v.id,v)==='created'?'Candidatura registrada.':'Candidatura já registrada.')}>Candidatar-se</button>}
    </article>)}
    <h4 className="font-bold">{employer?'Candidaturas recebidas':'Minhas candidaturas'}</h4>
    {applications.map(a=><article key={a.id} className="border border-slate-700 rounded-xl p-3 space-y-2">
      <p>Vaga: {a.terms?.title||vacancies.find(v=>v.id===a.vagaId)?.title||a.vagaId}</p>
      {a.terms&&<div className="rounded-lg border border-slate-600 p-2 space-y-1"><strong>Condições registradas na candidatura</strong><p>{a.terms.description}</p><p>Valor informado: R$ {(a.terms.paymentCents/100).toFixed(2)}</p><p className="text-xs text-slate-300">O aceite se refere a estas condições. Mensagens não alteram este registro.</p></div>}<p>Status: {({pending:'Pendente',accepted:'Aceita',rejected:'Recusada',withdrawn:'Retirada',offer_withdrawn:'Oferta retirada pelo contratante',completion_requested:'Aguardando confirmação de conclusão',completed:'Concluído — pagamento não verificado pelo Kyrub',cancelled:'Cancelado por acordo entre as partes'})[a.status]}</p>
      {a.status==='pending'&&(employer?(['accepted','rejected'] as const):(['withdrawn'] as const)).map(status=><button key={status} disabled={busy} className="mr-2 border border-teal-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await decideHiringApplication(a.id,status,a.terms);return 'Situação atualizada no servidor.';})}>{({accepted:'Aceitar',rejected:'Recusar',withdrawn:'Retirar'})[status]}</button>)}
      {!employer&&a.status==='accepted'&&a.cancellation?.state!=='requested'&&<button disabled={busy} className="border border-teal-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await transitionHiringCompletion(a.id,'completion_requested');return 'Conclusão informada. Aguarde a confirmação do contratante.';})}>Informar conclusão</button>}
      {employer&&a.status==='completion_requested'&&a.cancellation?.state!=='requested'&&<>
        <button disabled={busy} className="mr-2 border border-teal-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await transitionHiringCompletion(a.id,'completed');return 'Serviço concluído pelas partes. Nenhum pagamento confirmado.';})}>Confirmar conclusão</button>
        <button disabled={busy} className="border border-slate-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await transitionHiringCompletion(a.id,'accepted');return 'Serviço devolvido para revisão.';})}>Solicitar revisão</button>
      </>}
      {a.cancellation&&<div className="border border-slate-600 rounded-lg p-2 space-y-2">
        <strong>{({requested:'Cancelamento solicitado',confirmed:'Cancelamento confirmado',declined:'Cancelamento não acordado',retracted:'Solicitação retirada'})[a.cancellation.state]}</strong>
        <p className="whitespace-pre-wrap break-words">{a.cancellation.reason}</p>
        {['accepted','completion_requested'].includes(a.status)&&['requested','declined'].includes(a.cancellation.state)&&<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>void perform(async()=>{if(!a.cancellation)throw Error('Solicitação indisponível.');const result=await openHiringSupportCase(a.id,a.cancellation.requestId);return (result.created?'Ocorrência registrada.':'Ocorrência já registrada.')+' Protocolo: '+result.caseId;})}>Solicitar atendimento</button>}
        {a.cancellation.state==='requested'&&<><p className="text-xs text-slate-300">Nenhuma multa, pagamento ou estorno é automático. Em caso de desacordo, procure atendimento; a solicitação não obriga ninguém a continuar trabalhando.</p>
         {a.cancellation.requestedBy===actor?<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>void perform(async()=>{await submitHiringCancellation(a.id,'retract',a.cancellation?.requestId);return 'Solicitação retirada.';})}>Retirar solicitação</button>:<>
          <button type="button" disabled={busy} className="border border-amber-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await submitHiringCancellation(a.id,'confirm',a.cancellation?.requestId);return 'Cancelamento confirmado pelas partes.';})}>Concordar com cancelamento</button>
          <button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>void perform(async()=>{await submitHiringCancellation(a.id,'decline',a.cancellation?.requestId);return 'Cancelamento não acordado.';})}>Não concordo</button>
         </>}
        </>}
      </div>}
      {['accepted','completion_requested'].includes(a.status)&&a.cancellation?.state!=='requested'&&<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setCancelId(a.id);setCancelReason('');}}>Solicitar cancelamento</button>}
      {cancelId===a.id&&['accepted','completion_requested'].includes(a.status)&&a.cancellation?.state!=='requested'&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void perform(async()=>{await submitHiringCancellation(a.id,'request',undefined,cancelReason);if(auth.currentUser?.uid===actor){setCancelId('');setCancelReason('');}return 'Cancelamento solicitado. Aguarde a resposta da outra parte.';});}}>
        <label className="block">Motivo do cancelamento<textarea className="block w-full bg-slate-950 rounded-lg p-2" required maxLength={1000} value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label>
        <button type="submit" disabled={busy||!cancelReason.trim()} className="border border-amber-500 rounded-lg p-2">Enviar solicitação</button>
        <button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setCancelId('');setCancelReason('');}}>Voltar</button>
      </form>}
      <button type="button" className="block border border-slate-600 rounded-lg p-2" onClick={()=>setOpenNegotiation(current=>current===a.id?'':a.id)}>{openNegotiation===a.id?'Fechar conversa':'Conversar / ver negociação'}</button>
      {openNegotiation===a.id&&actor&&<FreelaNegotiationPreview key={actor+':'+a.id} application={a} actor={actor}/>}
    </article>)}
    <button disabled={busy} className="border border-slate-700 rounded-lg p-2" onClick={()=>void perform(async()=> 'Consulta atualizada.')}>Atualizar</button>
    <p role="status">{notice}</p>
   </section>
 </div>;
}
