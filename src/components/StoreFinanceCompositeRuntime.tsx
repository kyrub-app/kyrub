import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ChartNoAxesCombined, ChartPie, ClipboardCheck, FileChartColumn, HandCoins, History, Receipt } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { StoreFinanceRuntime } from './StoreFinanceRuntime';
import StoreFinanceHistoryWorkspace from './store/StoreFinanceHistoryWorkspace';
import StoreFinancePeriodRuntime from './store/StoreFinancePeriodRuntime';
import StoreMercadoPagoPeriodSummaryWorkspace from './store/StoreMercadoPagoPeriodSummaryWorkspace';
import StoreResultsMarginsWorkspace from './store/StoreResultsMarginsWorkspace';

const modules=[
  {id:'overview',label:'Visão geral',detail:'Recebimentos e indicadores',icon:ChartPie},
  {id:'payables',label:'Contas a pagar',detail:'Despesas e lançamentos',icon:Receipt},
  {id:'receivables',label:'Contas a receber',detail:'Recebimentos e repasses',icon:HandCoins},
  {id:'cash',label:'Fluxo de caixa',detail:'Entradas e saídas do caixa',icon:ArrowLeftRight},
  {id:'results',label:'Resultados e margens',detail:'Rentabilidade da operação',icon:ChartNoAxesCombined},
  {id:'reconciliation',label:'Conciliação',detail:'Pagamentos e liquidações',icon:ClipboardCheck},
  {id:'history',label:'Histórico financeiro',detail:'Movimentações e documentos fiscais',icon:History},
  {id:'reports',label:'Relatórios',detail:'Períodos e centros de custo',icon:FileChartColumn},
] as const;
type ModuleId=typeof modules[number]['id'];

export function StoreFinanceCompositeRuntime({storeId}:{storeId:string}){
  const [session,setSession]=useState(()=>({user:auth.currentUser,epoch:0}));
  useEffect(()=>onAuthStateChanged(auth,user=>setSession(old=>old.user===user?old:{user,epoch:old.epoch+1})),[]);
  if(!session.user||session.user!==auth.currentUser||session.user.uid!==storeId)return <p className="text-sm text-slate-400">Acesso ao financeiro reservado ao proprietário da loja.</p>;
  return <FinanceNavigation key={storeId+':'+session.epoch} storeId={storeId}/>;
}
function FinanceNavigation({storeId}:{storeId:string}){
  const [active,setActive]=useState<ModuleId|null>(null);
  const [historyTab,setHistoryTab]=useState<'history'|'movements'>('history');
  const anchor=useRef<HTMLDivElement>(null);
  const selected=modules.find(m=>m.id===active);
  const navigate=(id:ModuleId|null)=>{setHistoryTab('history');setActive(id);};
  useEffect(()=>{if(anchor.current)anchor.current.scrollIntoView({block:'start',behavior:'auto'});},[active,historyTab]);
  return <div ref={anchor} className="min-w-0 space-y-3 scroll-mt-20" data-kyrub-finance-navigation="modules">
    {!active?<section className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <h2 className="text-base font-bold text-white">Financeiro</h2>
      <p className="mt-1 text-sm text-slate-400">Selecione uma área da gestão financeira da loja.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {modules.map(m=><button key={m.id} type="button" onClick={()=>navigate(m.id)} className="flex min-w-0 min-h-28 flex-col items-start gap-2 rounded-xl border border-slate-700 bg-slate-950 p-3 text-left hover:border-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
          <m.icon aria-hidden="true" className="h-6 w-6 shrink-0 text-[#F27429]"/>
          <span className="break-words text-sm font-semibold leading-snug text-white">{m.label}</span>
          <span className="break-words text-xs leading-snug text-slate-400">{m.detail}</span>
        </button>)}
      </div>
    </section>:<>
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2">
        <button type="button" onClick={()=>navigate(null)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm text-slate-200"><ArrowLeft className="h-4 w-4"/>Financeiro</button>
        <h2 className="min-w-0 flex-1 break-words text-base font-bold text-white">{selected?.label}</h2>
      </div>
      {active==='overview'&&<StoreFinanceRuntime storeId={storeId} section="overview"/>}
      {active==='payables'&&<StoreFinanceRuntime storeId={storeId} section="payables"/>}
      {active==='receivables'&&<StoreFinanceRuntime storeId={storeId} section="receivables"/>}
      {active==='cash'&&<StoreFinanceRuntime storeId={storeId} section="cash"/>}
      {active==='results'&&<StoreResultsMarginsWorkspace storeId={storeId}/>}
      {active==='reconciliation'&&<StoreMercadoPagoPeriodSummaryWorkspace storeId={storeId}/>}
      {active==='reports'&&<StoreFinancePeriodRuntime storeId={storeId}/>}
      {active==='history'&&<>
        <div className="grid grid-cols-2 gap-2" aria-label="Consulta de movimentações">
          <button type="button" aria-pressed={historyTab==='history'} onClick={()=>setHistoryTab('history')} className={`min-h-10 rounded-lg border p-2 text-sm ${historyTab==='history'?'border-amber-500 text-amber-200':'border-slate-700 text-slate-300'}`}>Histórico completo</button>
          <button type="button" aria-pressed={historyTab==='movements'} onClick={()=>setHistoryTab('movements')} className={`min-h-10 rounded-lg border p-2 text-sm ${historyTab==='movements'?'border-amber-500 text-amber-200':'border-slate-700 text-slate-300'}`}>Recentes e fiscal</button>
        </div>
        {historyTab==='history'?<StoreFinanceHistoryWorkspace storeId={storeId}/>:<StoreFinanceRuntime storeId={storeId} section="movements"/>}
      </>}
    </>}
  </div>;
}
