import {useState} from 'react';
import type {User} from 'firebase/auth';
import {KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION,KYRUB_OFFICIAL_TEST_HISTORY_STORE,validKyrubOfficialTestHistoryRequest} from '../../../shared/kyrubOfficialTestHistoryCleanup';

type Report={
 storeId:string;counts:{orders:number;intents:number;payments:number};
 blocked:string[];canExecute:boolean;digest:string;archived:boolean;
};
const messages:Record<string,string>={
 CONTAGEM_DIVERGENTE:'A contagem mudou; nenhuma exclusão é autorizada.',
 LEITURA_INCOMPLETA:'O volume ultrapassa o limite de segurança.',
 REFERENCIA_EXTERNA:'Há referência a pagamento externo; conferir com o provedor.',
 PAGAMENTO_FINANCEIRO:'Existe registro financeiro pago, estornado ou contestado.',
 INTENCAO_FINANCEIRA:'Existe intenção marcada paga.',
 LOJA_DIVERGENTE:'Identidade da loja divergente.',
 HISTORICO_FINANCEIRO_ASSOCIADO:'Existem eventos, razão financeiro ou vínculo do provedor.',
 RESERVA_ESTOQUE_ASSOCIADA:'Existem reservas de estoque vinculadas.',
 SNAPSHOT_COMERCIAL_ASSOCIADO:'Há fotografia comercial de pedido a preservar.',
 LIMPEZA_ANTERIOR:'Já existe execução anterior.'
};
const endpoint='/api/admin/operations/health?transport=mercado-pago-test-history-cleanup';
export function AdminKyrubOfficialTestHistoryCleanup({user,storeId}:{user:User;storeId:string}){
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false);
 const [confirm,setConfirm]=useState(''),[ack,setAck]=useState(false),[notice,setNotice]=useState('');
 if(storeId!==KYRUB_OFFICIAL_TEST_HISTORY_STORE)return null;
 async function request(body?:unknown){
  const token=await user.getIdToken(true);
  const response=await fetch(endpoint,{method:body?'POST':'GET',headers:{
   authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})
  },cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({})) as Report&{error?:string};
  if(!response.ok)throw Error(data.error||'Operação indisponível.');
  if(!data||data.storeId!==KYRUB_OFFICIAL_TEST_HISTORY_STORE||!Array.isArray(data.blocked)||typeof data.canExecute!=='boolean'||!data.counts)throw Error('Resposta inesperada.');
  return data;
 }
 async function preview(){
  if(busy)return;
  setBusy(true);setNotice('');setReport(null);setConfirm('');setAck(false);
  try{setReport(await request());}
  catch(e){setNotice(e instanceof Error?e.message:'Não foi possível examinar os registros.');}
  finally{setBusy(false);}
 }
 async function execute(){
  if(busy||!report?.canExecute||!ack||confirm!==KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION)return;
  const body={action:'archive-and-clear',storeId,digest:report.digest,confirmation:confirm};
  if(!validKyrubOfficialTestHistoryRequest(body))return;
  setBusy(true);setNotice('');
  try{
   const done=await request(body);setReport(done);setNotice('Histórico operacional arquivado e removido. O arquivo de auditoria permanece preservado.');
  }catch(e){setNotice(e instanceof Error?e.message:'Limpeza recusada. Atualize a análise antes de tentar novamente.');}
  finally{setBusy(false);setConfirm('');setAck(false);}
 }
 return <section className="mt-3 space-y-3 rounded-xl border border-amber-600/40 bg-slate-950/60 p-4 text-xs text-slate-200">
  <strong className="block text-sm text-amber-200">Histórico de testes · Kyrub Oficial</strong>
  <p>Operação excepcional, restrita a esta loja. Nenhum pagamento do Mercado Pago será cancelado. Todos os registros elegíveis serão arquivados antes de sair dos históricos operacionais.</p>
  <button type="button" disabled={busy} onClick={()=>void preview()} className="rounded-xl border border-sky-500/40 px-3 py-3 font-bold text-sky-200 disabled:opacity-40">{busy?'Conferindo…':'Analisar se os 11 registros de teste podem ser limpos'}</button>
  {report&&<div className="space-y-2 border-t border-slate-700 pt-3">
   <p>Pedidos {report.counts.orders}, intenções {report.counts.intents}, pagamentos {report.counts.payments}.</p>
   {report.archived?<p>Limpeza já arquivada; não repetir.</p>:report.blocked.length?<><strong className="text-amber-200">Bloqueada sem excluir dados:</strong>{report.blocked.map(key=><p key={key}>• {messages[key]??'Condição de segurança não atendida.'}</p>)}</>:<p className="text-emerald-300">Pré-requisitos técnicos atendidos. A confirmação abaixo arquivará os registros e os removerá das coleções operacionais.</p>}
   {report.canExecute&&<><label className="flex gap-2"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>Confirmo que todos os 11 registros selecionados foram usados exclusivamente em testes e autorizo a limpeza desta loja.</label>
    <label className="block">Digite exatamente <strong>{KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION}</strong><input value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm" autoComplete="off"/></label>
    <button type="button" disabled={busy||!ack||confirm!==KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION} onClick={()=>void execute()} className="w-full rounded-xl bg-red-700 px-3 py-3 font-bold text-white disabled:opacity-40">Arquivar e limpar histórico de testes</button>
   </>}
  </div>}
  {notice&&<p role="status" className="text-amber-200">{notice}</p>}
 </section>;
}
