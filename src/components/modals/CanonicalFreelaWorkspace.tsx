import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {Briefcase,X} from 'lucide-react';
import {auth} from '../../utils/firebase';
import FreelaFinancialPanel from './FreelaFinancialPanel';
import {personalFinanceCandidateEnabled} from './PersonalPixSettings';
import {parseFreelancePlanningMoney} from '../../../shared/freelanceEarningsPlanning';
import type {FreelanceOfferInput} from '../../../shared/freelanceLifecycle';
import {createDirectPaymentTerms,type DirectPaymentTiming,type DirectPaymentTerms} from '../../../shared/directPaymentTerms';

export function useLocalFreelaCandidate(){
 return import.meta.env.DEV&&import.meta.env.VITE_KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&
 import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'&&auth.app.options.projectId==='kyrub-security-test'&&
 typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname);
}
type Application={applicantUid:string;status:string;createdAt:string;publicName?:string|null};
type Item=FreelanceOfferInput&{id:string;status:string;isOwner:boolean;isSelected:boolean;application?:Application};
type Detail={item:Item;applications:Application[];nextApplicationCursor?:string|null;occurrence?:{id:string;kind:string;openedByMe:boolean;response:string|null}|null};
type Action={action:string;offerId:string;confirmed?:boolean;applicantUid?:string;terms?:FreelanceOfferInput;expectedPaymentTerms?:DirectPaymentTerms;kind?:string;occurrenceId?:string;position?:string};
const labels:Record<string,string>={open:'Aberta',pending:'Candidatura pendente',selected:'Selecionado',contracted:'Contratado',in_progress:'Em execução',completion_requested:'Conclusão solicitada',completed:'Concluído',cancelled:'Cancelado',under_review:'Em análise',withdrawn:'Desistência',released:'Seleção liberada',not_selected:'Não selecionado'};
const errors:Record<string,string>={FREELANCE_DISABLED:'Ambiente isolado ainda não habilitado.',AUTH_REQUIRED:'Entre novamente para continuar.',IDENTITY_VERIFICATION_REQUIRED:'Verificação documental necessária.',FREELANCE_FUNDING_REQUIRED:'Financiamento ainda não confirmado.',FREELANCE_DIRECT_PAYMENT_NOT_ENABLED:'Esta modalidade ainda não está habilitada para execução.',FREELANCE_FORBIDDEN:'Operação não autorizada.',FREELANCE_CONFLICT:'O registro mudou. Atualize a consulta.',FREELANCE_FINANCIAL_RESTRICTION:'Novas contratações temporariamente indisponíveis por divergência financeira.'};
const money=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const paymentDescription=(terms:DirectPaymentTerms|undefined)=>terms?((terms.method==='external_pix'?'Pix externo':'Mercado Pago')+' · '+(terms.timing==='advance'?'Pagamento antecipado':'Pagamento na conclusão')+' · Comissão Kyrub: R$ 0,00'):'Modalidade anterior de homologação';
const field='w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-white';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
export function CanonicalFreelaWorkspace({mode,onClose}:{mode:'employer'|'employee';onClose:()=>void}){
 const [user,setUser]=useState<User|null>(null);
 const [tab,setTab]=useState(mode==='employer'?'publish':'open');
 const [items,setItems]=useState<Item[]|null>(null),[detail,setDetail]=useState<Detail|null>(null);
 const [nextCursor,setNextCursor]=useState<string|null>(null);
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[requirements,setRequirements]=useState(''),[payment,setPayment]=useState('');
 const [method,setMethod]=useState<'external_pix'|'legacy_fixture'>('external_pix'),[timing,setTiming]=useState<DirectPaymentTiming>('on_completion');
 const directCandidate=personalFinanceCandidateEnabled();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [pending,setPending]=useState<{label:string;body:Action}|null>(null);
 const [kind,setKind]=useState('service_disputed');
 const ticket=useRef(0),lock=useRef(false),publishId=useRef('');
 useEffect(()=>{
  const unsub=onAuthStateChanged(auth,next=>{
   ticket.current++;lock.current=false;setUser(next);setItems(null);setNextCursor(null);setDetail(null);setPending(null);setBusy(false);setError('');setMessage('');
   setTitle('');setDescription('');setRequirements('');setPayment('');setMethod('external_pix');setTiming('on_completion');publishId.current='';
  });
  return()=>{ticket.current++;unsub();};
 },[]);
 useEffect(()=>{const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn);},[onClose]);
 const request=async(view?:string,offerId?:string,body?:Action,cursor?:string)=>{
  if(lock.current||!user||auth.currentUser?.uid!==user.uid)return;
  lock.current=true;const id=++ticket.current;
  const active=()=>ticket.current===id&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');
  if(!body){setPending(null);if(view==='detail')setDetail(null);else{setItems(null);setNextCursor(null);setDetail(null);}}
  try{
   const token=await user.getIdToken();if(!active())return;
   const query=body?'':'?view='+encodeURIComponent(view??'')+(offerId?'&offerId='+encodeURIComponent(offerId):'')+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   const res=await fetch('/api/freelance/workspace'+query,{method:body?'POST':'GET',cache:'no-store',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=await res.json().catch(()=>null);if(!active())return;
   if(!res.ok)throw Error(errors[data?.code]??'Não foi possível confirmar a operação.');
   if(body){
    if(data?.confirmed!==true)throw Error('Operação sem confirmação do servidor.');
    setMessage('Operação confirmada pelo servidor. Atualize a consulta.');
    setPending(null);setItems(null);setNextCursor(null);setDetail(null);
    if(body.action==='publish'){setTitle('');setDescription('');setRequirements('');setPayment('');setMethod('external_pix');setTiming('on_completion');publishId.current='';setTab('owner');}
   }else if(view==='detail'){
    if(data?.item?.id!==offerId||!Array.isArray(data?.applications))throw Error('Detalhes não confirmados.');
    setDetail(data);
   }else{
    if(!Array.isArray(data?.items))throw Error('Consulta não confirmada.');
    setItems(data.items);setNextCursor(typeof data.nextCursor==='string'?data.nextCursor:null);
   }
  }catch(e){if(active()){setError(e instanceof Error?e.message:'Operação indisponível.');if(body){setDetail(null);setItems(null);setPending(null);}}}
  finally{if(active()){lock.current=false;setBusy(false);}}
 };
 const ask=(label:string,body:Action)=>setPending({label,body});
 const actions=(d:Detail)=>{
  const o=d.item,a=d.applications[0],id=o.id;
  const act=(label:string,action:string,extra:Partial<Action>={})=><button key={label+':'+(extra.applicantUid??'')} type="button" disabled={busy} className={btn} onClick={()=>ask(label,{action,offerId:id,confirmed:true,...extra})}>{label}</button>;
  return <div className="flex flex-wrap gap-2">
   {o.isOwner&&o.status==='open'&&act('Cancelar vaga','cancel_open')}
   {o.isOwner&&o.status==='open'&&d.applications.filter(x=>x.status==='pending').map((x,i)=>act('Selecionar '+(x.publicName??'Candidato '+(i+1)),'select',{applicantUid:x.applicantUid,confirmed:undefined}))}
   {o.isOwner&&o.status==='selected'&&d.applications.filter(x=>x.status==='selected').map(x=>act('Liberar seleção','release',{applicantUid:x.applicantUid}))}
   {!o.isOwner&&o.status==='open'&&!a&&act('Candidatar-se','apply',{confirmed:undefined,expectedPaymentTerms:o.paymentTerms})}
   {!o.isOwner&&a?.status==='pending'&&act('Retirar candidatura','withdraw')}
   {!o.isOwner&&o.isSelected&&o.status==='selected'&&<>{act('Confirmar contratação','confirm',{expectedPaymentTerms:o.paymentTerms})}{act('Desistir da seleção','release',{applicantUid:a?.applicantUid})}</>}
   {o.isSelected&&o.status==='contracted'&&act('Iniciar serviço','start')}
   {o.isSelected&&o.status==='in_progress'&&act('Solicitar conclusão','request_completion')}
   {o.isOwner&&o.status==='completion_requested'&&act('Confirmar conclusão','confirm_completion')}
   {(o.isOwner||o.isSelected)&&['contracted','in_progress','completion_requested'].includes(o.status)&&<>
    <select aria-label="Motivo da ocorrência" className={field} value={kind} onChange={e=>setKind(e.target.value)} disabled={busy}><option value="service_disputed">Divergência de serviço</option><option value="cancellation_requested">Pedido de cancelamento</option><option value="safety_or_force_majeure">Segurança ou força maior</option></select>
    {act('Registrar ocorrência','report',{kind,occurrenceId:crypto.randomUUID()})}
   </>}
   {d.occurrence&&<><p className="w-full">Ocorrência em análise. {d.occurrence.response?'Manifestação registrada.':'Aguardando manifestação.'}</p>
    {!d.occurrence.openedByMe&&!d.occurrence.response&&<>{act('Concordar','respond',{position:'agree',occurrenceId:d.occurrence.id})}{act('Discordar','respond',{position:'disagree',occurrenceId:d.occurrence.id})}</>}
   </>}
  </div>;
 };
 const visible=user&&auth.currentUser?.uid===user.uid;
 return <div role="dialog" aria-modal="true" aria-label={mode==='employer'?'Solicitar Freelas':'Fazer Freelas'} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3">
  <section className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300 space-y-3">
   <header className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-teal-400"/><h3 className="flex-1 text-base font-bold text-white">{mode==='employer'?'Gestão de Freelas Kyrub':'Painel Freelancer Kyrub'}</h3><button type="button" aria-label="Fechar" onClick={onClose}><X className="h-5 w-5"/></button></header>
   <p className="text-xs text-amber-300">Homologação local. Nenhum pagamento real.</p>
   {!visible?<p>Entre com uma conta de teste para continuar.</p>:<>
    <nav className="flex flex-wrap gap-2">{(mode==='employer'?[['publish','Solicitar serviço'],['owner','Publicados'],['history','Histórico']]:[['open','Solicitações'],['applications','Fazendo'],['history','Histórico']]).map(([key,label])=><button key={key} type="button" aria-pressed={tab===key} className={btn} disabled={busy} onClick={()=>{setTab(key);setItems(null);setNextCursor(null);setDetail(null);setPending(null);setError('');setMessage('');}}>{label}</button>)}</nav>
    {error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status" className="text-emerald-300">{message}</p>}
    {tab==='publish'?<form className="space-y-3" onSubmit={e=>{e.preventDefault();const amount=parseFreelancePlanningMoney(payment);if(!amount){setError('Informe um valor válido.');return;}publishId.current ||=crypto.randomUUID();ask('Publicar freela',{action:'publish',offerId:publishId.current,terms:{title,description,requirements,paymentMinor:amount,...(directCandidate&&method==='external_pix'?{paymentTerms:createDirectPaymentTerms({method:'external_pix',timing,amountMinor:amount})}:{})}});}}>
     <label className="block">Título<input className={field} required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy||!!pending}/></label>
     <label className="block">Descrição<textarea className={field} required maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)} disabled={busy||!!pending}/></label>
     <label className="block">Requisitos<input className={field} maxLength={1000} value={requirements} onChange={e=>setRequirements(e.target.value)} disabled={busy||!!pending}/></label>
     <label className="block">Valor acordado (R$)<input className={field} required inputMode="decimal" value={payment} onChange={e=>setPayment(e.target.value)} disabled={busy||!!pending}/></label>
     {directCandidate&&<>
      <label className="block">Forma de pagamento<select className={field} value={method} disabled={busy||!!pending} onChange={e=>setMethod(e.target.value as typeof method)}><option value="external_pix">Pix externo</option><option value="legacy_fixture">Modalidade anterior (somente teste)</option><option disabled value="mercado_pago">Mercado Pago (em preparação)</option></select></label>
      {method==='external_pix'&&<><label className="block">Momento do pagamento<select className={field} value={timing} disabled={busy||!!pending} onChange={e=>setTiming(e.target.value as DirectPaymentTiming)}><option value="on_completion">Na conclusão do serviço</option><option value="advance">Antecipado</option></select></label><p>Comissão Kyrub: R$ 0,00. Pagamento direto entre as partes, sem custódia. Eventuais tarifas do provedor são de responsabilidade de quem contrata o serviço financeiro.</p><p className="text-amber-300">Execução de contratos diretos ainda em preparação. Somente dados fictícios.</p></>}
     </>}
     <button className={btn} disabled={busy||!!pending} type="submit">Publicar freela</button>
    </form>:<>
     <button type="button" className={btn} disabled={busy} onClick={()=>void request(tab==='history'?(mode==='employer'?'owner':'applications'):tab)}>Atualizar consulta</button>
     {busy&&<p role="status">Consultando servidor…</p>}
     {items&&items.filter(o=>tab==='history'?['completed','cancelled','withdrawn','released','not_selected'].includes(o.application?.status??o.status):!['completed','cancelled','withdrawn','released','not_selected'].includes(o.application?.status??o.status)).map(o=><article key={o.id} className="rounded-xl border border-slate-800 p-3 space-y-2"><h4 className="font-bold text-white break-words">{o.title}</h4><p>{labels[o.application?.status??o.status]??'Estado não reconhecido'} · {money(o.paymentMinor)}</p><p>{paymentDescription(o.paymentTerms)}</p><button type="button" className={btn} disabled={busy} onClick={()=>void request('detail',o.id)}>Ver detalhes</button></article>)}
     {items&&items.filter(o=>tab==='history'?['completed','cancelled','withdrawn','released','not_selected'].includes(o.application?.status??o.status):!['completed','cancelled','withdrawn','released','not_selected'].includes(o.application?.status??o.status)).length===0&&<p>Nenhum registro correspondente nesta página.</p>}
     {nextCursor&&<button type="button" className={btn} disabled={busy} onClick={()=>void request(tab==='history'?(mode==='employer'?'owner':'applications'):tab,undefined,undefined,nextCursor)}>Próxima página</button>}
     {detail&&<article className="space-y-3 rounded-xl border border-slate-700 p-3"><h4 className="font-bold text-white">{detail.item.title}</h4><p className="break-words whitespace-pre-wrap">{detail.item.description}</p><p className="break-words">{detail.item.requirements}</p><p>{money(detail.item.paymentMinor)} · {labels[detail.item.status]}</p><p>{paymentDescription(detail.item.paymentTerms)}</p>{detail.item.paymentTerms&&<p>As condições financeiras permanecem vinculadas à candidatura e à contratação. Não representam pagamento confirmado.</p>}{detail.item.isOwner&&detail.applications.map((a,i)=><p key={a.applicantUid} className="break-words text-xs">{a.publicName??'Candidato '+(i+1)+' (perfil reservado)'}: {labels[a.status]??a.status}</p>)}{actions(detail)}{personalFinanceCandidateEnabled()&&detail.item.paymentTerms?.method==='external_pix'&&(detail.item.isOwner||detail.item.isSelected)&&['contracted','in_progress','completion_requested','completed'].includes(detail.item.status)&&<FreelaFinancialPanel key={user.uid+':'+detail.item.id} user={user} offerId={detail.item.id} role={detail.item.isOwner?'requester':'freelancer'}/>}{detail.nextApplicationCursor&&<button type="button" className={btn} disabled={busy} onClick={()=>void request('detail',detail.item.id,undefined,detail.nextApplicationCursor!)}>Mais candidaturas</button>}</article>}
    </>}
    {pending&&<div className="space-y-2 rounded-xl border border-teal-700 p-3"><p>Confirma: {pending.label}?</p>{(pending.body.terms?.paymentTerms??pending.body.expectedPaymentTerms)&&<p>{paymentDescription(pending.body.terms?.paymentTerms??pending.body.expectedPaymentTerms)} · {money((pending.body.terms?.paymentTerms??pending.body.expectedPaymentTerms)!.amountMinor)}</p>}<button type="button" className={btn} disabled={busy} onClick={()=>void request(undefined,undefined,pending.body)}>Confirmar</button>{' '}<button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
   </>}
  </section>
 </div>;
}
