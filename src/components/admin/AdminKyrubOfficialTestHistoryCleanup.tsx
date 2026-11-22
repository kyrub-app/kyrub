import {useState} from 'react';
import type {User} from 'firebase/auth';
import {KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION,KYRUB_OFFICIAL_TEST_HISTORY_STORE,validKyrubOfficialTestHistoryRequest} from '../../../shared/kyrubOfficialTestHistoryCleanup';

type ProviderCheck={
 checkedAt:string;storeId:string;account:'verified'|'mismatch'|'unavailable';
 referencedRecords:{intents:number;payments:number};
 uniquePaymentReferences:number;unsupportedReferences:number;
 providerStatuses:Record<'pending'|'approved'|'refunded'|'cancelled'|'rejected'|'expired'|'other'|'unverified',number>;
 metadataMismatches:number;lookupFailures:number;unlinkedProviderLabels:number;
 requiresManualReview:true;allowsCleanup:false;
};
type HistoricalClassification={
 states:{open:number;recordedPaid:number;closedOrReversed:number;unknown:number};
 providerReferenceShape?:{numeric:number;nonNumeric:number;missing:number};
};
type EvidenceRow={kind:string;scope:'canonical'|'legacy';count:number;complete:boolean;explicitLinks:number;classification?:HistoricalClassification};
type Report={
 storeId:string;counts:{orders:number;intents:number;payments:number};
 blocked:string[];canExecute:boolean;digest:string;archived:boolean;
 evidence?:EvidenceRow[];
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
 REGISTROS_LEGADOS_FORA_DO_ESCOPO:'Há pagamentos, intenções ou pedidos antigos no cadastro legado fora dos 11 registros selecionados. A limpeza parcial deixaria dados para trás.',
 LIMPEZA_ANTERIOR:'Já existe execução anterior.'
};
const evidenceLabels:Record<string,string>={
 economicLedger:'Razão financeiro',
 storePointLedger:'Livro de pontos',
 paymentRefunds:'Estornos/reembolsos',
 economicObligations:'Obrigações econômicas',
 economicSettlements:'Liquidações',
 paymentWebhookEvents:'Notificações de pagamento',
 paymentProviderBindings:'Vínculos com pagamentos externos',
 paymentIntents:'Intenções antigas',
 payments:'Pagamentos antigos',
 inventoryOrderReservations:'Reservas de estoque',
 orderCommercialSnapshots:'Fotografias comerciais',
 otherOrders:'Outros pedidos antigos'
};
const endpoint='/api/admin/operations/health?transport=mercado-pago-test-history-cleanup';
const providerEndpoint='/api/admin/operations/health?transport=mercado-pago-test-history-provider-audit';
export function AdminKyrubOfficialTestHistoryCleanup({user,storeId}:{user:User;storeId:string}){
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false);
 const [confirm,setConfirm]=useState(''),[ack,setAck]=useState(false),[notice,setNotice]=useState('');
 const [provider,setProvider]=useState<ProviderCheck|null>(null),[checking,setChecking]=useState(false),[providerError,setProviderError]=useState('');
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
 async function checkProvider(){
  if(checking||busy)return;
  setChecking(true);setProvider(null);setProviderError('');
  try{
   const token=await user.getIdToken(true);
   const response=await fetch(providerEndpoint,{headers:{authorization:'Bearer '+token},cache:'no-store'});
   const value=await response.json().catch(()=>({})) as Partial<ProviderCheck> & {error?:string};
   if(!response.ok||value.storeId!==KYRUB_OFFICIAL_TEST_HISTORY_STORE||!value.providerStatuses||value.allowsCleanup!==false)throw Error(value.error||'Consulta ao provedor indisponível.');
   setProvider(value as ProviderCheck);
  }catch(e){setProviderError(e instanceof Error?e.message:'Não foi possível consultar o Mercado Pago.');}
  finally{setChecking(false);}
 }
 async function preview(){
  if(busy)return;
  setBusy(true);setNotice('');setReport(null);setProvider(null);setProviderError('');setConfirm('');setAck(false);
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
   {!!report.evidence?.length&&<div className="space-y-2 border-t border-slate-700 pt-3">
    <strong className="block text-sm text-slate-100">Detalhamento dos registros que impedem a limpeza</strong>
    {report.evidence.map((entry,index)=><p key={entry.kind+entry.scope+index}>
      {evidenceLabels[entry.kind]??'Referências operacionais'} ({entry.scope==='canonical'?'loja oficial':'cadastro legado'}):
      {' '}{entry.complete?entry.count:'pelo menos '+entry.count} registro(s),
      {' '}{entry.explicitLinks} vínculo(s) explícito(s) com os 11 documentos selecionados.
      {entry.classification&&['economicObligations','paymentIntents','payments','paymentWebhookEvents'].includes(entry.kind)&&
       <span className="mt-1 block text-slate-400">
        Estados registrados: abertos {entry.classification.states.open};
        pagos/liquidados {entry.classification.states.recordedPaid};
        encerrados/revertidos {entry.classification.states.closedOrReversed};
        sem classificação conclusiva {entry.classification.states.unknown}.
        {entry.classification.providerReferenceShape&&<>
         {' '}Referências no provedor: numéricas {entry.classification.providerReferenceShape.numeric},
         não numéricas {entry.classification.providerReferenceShape.nonNumeric},
         ausentes {entry.classification.providerReferenceShape.missing}.
        </>}
       </span>}
    </p>)}
    <p className="text-amber-200">A ausência de vínculo explícito não prova independência. Registros com históricos financeiros ou recebimentos reais são preservados. Nenhuma exclusão é autorizada por este detalhamento.</p>
   </div>}
   {report.blocked.includes('REFERENCIA_EXTERNA')&&<div className="space-y-2 border-t border-slate-700 pt-3">
    <button type="button" disabled={checking||busy} onClick={()=>void checkProvider()} className="rounded-xl border border-sky-500/40 p-3 font-bold text-sky-200 disabled:opacity-40">
      {checking?'Consultando o Mercado Pago…':'Conferir situação das cobranças no Mercado Pago (somente consulta)'}
    </button>
    {providerError&&<p role="alert" className="text-amber-200">{providerError}</p>}
    {provider&&<div className="space-y-1 rounded-xl border border-slate-700 p-3">
      <strong className="block text-sm">Conciliação externa · Kyrub Oficial</strong>
      <p>Conta recebedora: {provider.account==='verified'?'Identidade confirmada':provider.account==='mismatch'?'Divergente — revisão obrigatória':'Não foi possível confirmar a identidade'}.</p>
      <p>Referências encontradas: {provider.referencedRecords.intents} em intenções e {provider.referencedRecords.payments} em pagamentos; {provider.uniquePaymentReferences} IDs distintos consultáveis; {provider.unsupportedReferences} em formato não reconhecido.</p>
      <p>Situação no provedor: pendentes {provider.providerStatuses.pending}; aprovados {provider.providerStatuses.approved}; estornados/contestados {provider.providerStatuses.refunded}; cancelados {provider.providerStatuses.cancelled}; rejeitados {provider.providerStatuses.rejected}; expirados {provider.providerStatuses.expired}; outros {provider.providerStatuses.other}; não verificados {provider.providerStatuses.unverified}.</p>
      <p>Divergências de identidade/metadados: {provider.metadataMismatches}; falhas de consulta: {provider.lookupFailures}; registros com indicação do provedor, mas sem ID consultável: {provider.unlinkedProviderLabels}.</p>
      <p className="text-amber-200">Consulta sem nova cobrança, cancelamento ou estorno. Mesmo cobranças encerradas exigem preservar comprovantes e conferir os lançamentos internos. Esta análise não libera a exclusão automaticamente.</p>
    </div>}
   </div>}
   {report.canExecute&&<><label className="flex gap-2"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>Confirmo que todos os 11 registros selecionados foram usados exclusivamente em testes e autorizo a limpeza desta loja.</label>
    <label className="block">Digite exatamente <strong>{KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION}</strong><input value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm" autoComplete="off"/></label>
    <button type="button" disabled={busy||!ack||confirm!==KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION} onClick={()=>void execute()} className="w-full rounded-xl bg-red-700 px-3 py-3 font-bold text-white disabled:opacity-40">Arquivar e limpar histórico de testes</button>
   </>}
  </div>}
  {notice&&<p role="status" className="text-amber-200">{notice}</p>}
 </section>;
}
