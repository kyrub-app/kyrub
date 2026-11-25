import {useCallback,useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {applyToHiringVacancy,decideHiringApplication,listHiringApplications,listHiringVacancies,publishHiringVacancy,transitionHiringCompletion,type HiringApplication,type HiringVacancy} from '../../utils/freelanceHiringCloud';

export function FreelaCloudPreview({mode,onClose}:{mode:'employer'|'employee';onClose:()=>void}){
 const employer=mode==='employer';
 const [actor,setActor]=useState(auth.currentUser?.uid||'');
 const [vacancies,setVacancies]=useState<HiringVacancy[]>([]);
 const [applications,setApplications]=useState<HiringApplication[]>([]);
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[payment,setPayment]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>onAuthStateChanged(auth,user=>{setActor(user?.uid||'');setVacancies([]);setApplications([]);setNotice('');}),[]);
 const refresh=useCallback(async()=>{
   if(!actor)return;
   const [v,a]=await Promise.all([listHiringVacancies(employer),listHiringApplications(employer)]);
   if(auth.currentUser?.uid===actor){setVacancies(v);setApplications(a);}
 },[actor,employer]);
 useEffect(()=>{setVacancies([]);setApplications([]);void refresh().catch(()=>{if(auth.currentUser?.uid===actor)setNotice('Não foi possível consultar o servidor.');});},[refresh,actor]);
 const perform=async(action:()=>Promise<string>)=>{
   if(busy||!actor)return;
   setBusy(true);setNotice('');
   try{const result=await action();if(auth.currentUser?.uid===actor){setNotice(result);await refresh();}}
   catch{if(auth.currentUser?.uid===actor)setNotice('Operação não confirmada. Confira sua elegibilidade, identidade e conexão.');}
   finally{setBusy(false);}
 };
 return <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
   <section className="bg-slate-900 border border-slate-800 w-full max-w-lg p-5 rounded-3xl space-y-4 max-h-[85vh] overflow-y-auto text-sm text-slate-100">
    <header className="flex justify-between gap-3"><h3 className="text-base font-bold">Freelas — homologação local</h3><button type="button" onClick={onClose}>Fechar</button></header>
    <p>Vagas e candidaturas registradas no emulador isolado. Não há intermediação de pagamento.</p>
    {employer&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void perform(async()=>{await publishHiringVacancy({title,description,payment:Number(payment)});setTitle('');setDescription('');setPayment('');return 'Vaga registrada no servidor de testes.';});}}>
      <label className="block">Título<input className="block w-full bg-slate-950 rounded-lg p-2" required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="block">Descrição<textarea className="block w-full bg-slate-950 rounded-lg p-2" required maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label className="block">Valor combinado (R$)<input className="block w-full bg-slate-950 rounded-lg p-2" type="number" required min="0.01" step="0.01" value={payment} onChange={e=>setPayment(e.target.value)}/></label>
      <button disabled={busy||!actor} className="bg-teal-500 text-slate-950 rounded-lg p-2 font-bold">Publicar vaga de teste</button>
    </form>}
    <h4 className="font-bold">{employer?'Minhas vagas':'Vagas disponíveis'}</h4>
    {vacancies.filter(v=>employer||v.ownerId!==actor).map(v=><article key={v.id} className="border border-slate-700 rounded-xl p-3 space-y-2">
      <strong>{v.title}</strong><p>{v.description}</p><p>R$ {v.payment.toFixed(2)} · {v.employer}</p>
      {!employer&&<button disabled={busy||applications.some(a=>a.vagaId===v.id)} className="bg-teal-500 text-slate-950 rounded-lg p-2" onClick={()=>void perform(async()=>await applyToHiringVacancy(v.id)==='created'?'Candidatura registrada.':'Candidatura já registrada.')}>Candidatar-se</button>}
    </article>)}
    <h4 className="font-bold">{employer?'Candidaturas recebidas':'Minhas candidaturas'}</h4>
    {applications.map(a=><article key={a.id} className="border border-slate-700 rounded-xl p-3 space-y-2">
      <p>Vaga: {vacancies.find(v=>v.id===a.vagaId)?.title||a.vagaId}</p><p>Status: {({pending:'Pendente',accepted:'Aceita',rejected:'Recusada',withdrawn:'Retirada',completion_requested:'Aguardando confirmação de conclusão',completed:'Concluído — pagamento não verificado pelo Kyrub'})[a.status]}</p>
      {a.status==='pending'&&(employer?(['accepted','rejected'] as const):(['withdrawn'] as const)).map(status=><button key={status} disabled={busy} className="mr-2 border border-teal-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await decideHiringApplication(a.id,status);return 'Situação atualizada no servidor.';})}>{({accepted:'Aceitar',rejected:'Recusar',withdrawn:'Retirar'})[status]}</button>)}
      {!employer&&a.status==='accepted'&&<button disabled={busy} className="border border-teal-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await transitionHiringCompletion(a.id,'completion_requested');return 'Conclusão informada. Aguarde a confirmação do contratante.';})}>Informar conclusão</button>}
      {employer&&a.status==='completion_requested'&&<>
        <button disabled={busy} className="mr-2 border border-teal-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await transitionHiringCompletion(a.id,'completed');return 'Serviço concluído pelas partes. Nenhum pagamento confirmado.';})}>Confirmar conclusão</button>
        <button disabled={busy} className="border border-slate-500 rounded-lg p-2" onClick={()=>void perform(async()=>{await transitionHiringCompletion(a.id,'accepted');return 'Serviço devolvido para revisão.';})}>Solicitar revisão</button>
      </>}
    </article>)}
    <button disabled={busy} className="border border-slate-700 rounded-lg p-2" onClick={()=>void perform(async()=> 'Consulta atualizada.')}>Atualizar</button>
    <p role="status">{notice}</p>
   </section>
 </div>;
}
