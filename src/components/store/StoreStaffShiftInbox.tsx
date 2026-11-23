import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import type { StaffShift } from '../../../shared/staffShifts';
import { listStaffShifts } from '../../utils/staffShifts';
import { auth } from '../../utils/firebase';

const showDate=(date:string)=>date.split('-').reverse().join('/');
const clockLabel=(shift:StaffShift)=>shift.kind==='day_off'?'Folga programada':
  shift.startTime+'–'+shift.endTime+(shift.endsNextDay?' (dia seguinte)':'');

export function StoreStaffShiftInbox({storeId}:{storeId:string}){
  const [shifts,setShifts]=useState<StaffShift[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{
    try{
      const rows=await listStaffShifts(storeId);
      setShifts(rows.filter(item=>item.assignedTo===auth.currentUser?.uid));
      setError('');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Não foi possível carregar suas escalas.');
    }finally{setLoading(false);}
  },[storeId]);
  useEffect(()=>{setLoading(true);void refresh();},[refresh]);
  return <section aria-label="Minhas escalas de trabalho" data-kyrub-staff-shifts-inbox
    className="mx-auto max-w-md space-y-3 text-slate-100">
    <header className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <h3 className="flex items-center gap-2 text-sm font-black">
        <CalendarDays className="h-4 w-4 text-orange-300"/> Minhas escalas
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        Consulte os turnos e as folgas publicados pela gestão.
        Os horários são os da loja e não substituem seu registro de ponto.
      </p>
      <button type="button" onClick={()=>void refresh()}
        className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-orange-300">
        <RefreshCw className="h-4 w-4"/> Atualizar
      </button>
    </header>
    {loading&&<p className="text-xs text-slate-400">Carregando escalas...</p>}
    {error&&<p role="alert" className="rounded-xl border border-red-500/30 p-3 text-xs text-red-300">{error}</p>}
    {!loading&&!shifts.length&&
      <p className="text-xs text-slate-400">Nenhuma escala atribuída a você nesta loja.</p>}
    {shifts.map(shift=><article key={shift.id}
      className="space-y-2 rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-black">
          {shift.kind==='day_off'?'Folga programada':shift.sector}
        </h4>
        <span className={shift.status==='cancelled'?'text-xs text-slate-400':'text-xs text-emerald-300'}>
          {shift.status==='cancelled'?'Cancelada':'Confirmada na escala'}
        </span>
      </div>
      <p className="text-xs font-semibold text-slate-200">
        {showDate(shift.scheduledDate)} · {clockLabel(shift)}
      </p>
      {shift.notes&&<p className="whitespace-pre-wrap text-xs text-slate-300">{shift.notes}</p>}
      {shift.status==='cancelled'&&<p className="text-xs text-slate-400">
        Cancelada pela gestão
        {shift.cancelReason?' · '+shift.cancelReason:''}
      </p>}
    </article>)}
  </section>;
}
