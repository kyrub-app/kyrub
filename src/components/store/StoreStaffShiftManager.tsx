import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarDays, Plus, RefreshCw, XCircle } from 'lucide-react';
import type { StaffShift, StaffShiftKind } from '../../../shared/staffShifts';
import type { StaffTaskAssignee } from '../../../shared/staffTasks';
import {
  cancelStaffShift, createStaffShift, listStaffShifts, listStaffShiftAssignees,
} from '../../utils/staffShifts';

const showDate=(date:string)=>date.split('-').reverse().join('/');
const clockLabel=(shift:StaffShift)=>shift.kind==='day_off'?'Folga programada':
  shift.startTime+'–'+shift.endTime+(shift.endsNextDay?' (dia seguinte)':'');

export function StoreStaffShiftManager({
  storeId,onBack,
}:{storeId:string;onBack:()=>void}){
  const [shifts,setShifts]=useState<StaffShift[]>([]);
  const [assignees,setAssignees]=useState<StaffTaskAssignee[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [kind,setKind]=useState<StaffShiftKind>('shift');
  const [assignedTo,setAssignedTo]=useState('');
  const [scheduledDate,setScheduledDate]=useState('');
  const [startTime,setStartTime]=useState('09:00');
  const [endTime,setEndTime]=useState('17:00');
  const [endsNextDay,setEndsNextDay]=useState(false);
  const [sector,setSector]=useState('');
  const [notes,setNotes]=useState('');
  const [confirmCancelId,setConfirmCancelId]=useState('');
  const [cancelReason,setCancelReason]=useState('');
  const publishIdRef=useRef('');
  const cancelIdsRef=useRef<Record<string,string>>({});
  const refresh=useCallback(async()=>{
    try{
      const [records,members]=await Promise.all([
        listStaffShifts(storeId),listStaffShiftAssignees(storeId),
      ]);
      setShifts(records);setAssignees(members);setError('');
      setAssignedTo(old=>members.some(member=>member.userId===old)?old:'');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Falha ao carregar escalas.');
    }finally{setLoading(false);}
  },[storeId]);
  useEffect(()=>{setLoading(true);void refresh();},[refresh]);
  const changed=()=>{publishIdRef.current='';};
  const publish=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(busy)return;
    setBusy(true);setError('');
    if(!publishIdRef.current)publishIdRef.current=crypto.randomUUID();
    try{
      await createStaffShift({
        storeId,requestId:publishIdRef.current,
        kind,assignedTo,scheduledDate,
        startTime:kind==='shift'?startTime:'',
        endTime:kind==='shift'?endTime:'',
        endsNextDay:kind==='shift'?endsNextDay:false,
        sector:kind==='shift'?sector:'',
        notes,
      });
      publishIdRef.current='';
      setKind('shift');setAssignedTo('');setScheduledDate('');
      setStartTime('09:00');setEndTime('17:00');setEndsNextDay(false);
      setSector('');setNotes('');
      await refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Não foi possível publicar a escala.');
    }finally{setBusy(false);}
  };
  const cancel=async(shift:StaffShift)=>{
    if(busy)return;
    setBusy(true);setError('');
    const key=shift.id+'@'+shift.version;
    if(!cancelIdsRef.current[key])cancelIdsRef.current[key]=crypto.randomUUID();
    try{
      await cancelStaffShift({
        storeId,shiftId:shift.id,expectedVersion:shift.version,
        requestId:cancelIdsRef.current[key],reason:cancelReason,
      });
      delete cancelIdsRef.current[key];
      setConfirmCancelId('');setCancelReason('');
      await refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Não foi possível cancelar a escala.');
    }finally{setBusy(false);}
  };
  const assigneeLabel=(uid:string)=>assignees.find(member=>member.userId===uid)?.label||
    'Colaborador '+uid.slice(0,8);

  return <section data-kyrub-staff-shifts-manager className="space-y-4 text-slate-100">
    <button type="button" onClick={onBack}
      className="inline-flex items-center gap-2 py-2 text-sm font-bold text-orange-300">
      <ArrowLeft className="h-4 w-4"/> Central do Staff
    </button>
    <header className="space-y-1">
      <h2 className="flex items-center gap-2 text-lg font-black">
        <CalendarDays className="h-5 w-5 text-orange-300"/> Escalas de trabalho
      </h2>
      <p className="text-xs leading-relaxed text-slate-400">
        Planeje turnos, folgas e setores para cada integrante da equipe, sem alterar o Registro de Ponto.
      </p>
    </header>
    <form onSubmit={event=>void publish(event)}
      className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
      <h3 className="text-sm font-black">Novo registro de escala</h3>
      <label htmlFor="staff-shift-kind" className="block text-xs font-bold">Tipo</label>
      <select id="staff-shift-kind" value={kind}
        onChange={event=>{setKind(event.target.value as StaffShiftKind);changed();}}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white">
        <option value="shift">Turno de trabalho</option>
        <option value="day_off">Folga programada</option>
      </select>
      <label htmlFor="staff-shift-assignee" className="block text-xs font-bold">Colaborador</label>
      <select id="staff-shift-assignee" required value={assignedTo}
        onChange={event=>{setAssignedTo(event.target.value);changed();}}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white">
        <option value="" disabled>Selecione um integrante ativo</option>
        {assignees.map(member=><option key={member.userId} value={member.userId}>{member.label}</option>)}
      </select>
      <label htmlFor="staff-shift-date" className="block text-xs font-bold">Data da escala</label>
      <input id="staff-shift-date" required type="date" value={scheduledDate}
        onChange={event=>{setScheduledDate(event.target.value);changed();}}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white"/>
      {kind==='shift'&&<>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="staff-shift-start" className="mb-2 block text-xs font-bold">Entrada prevista</label>
            <input id="staff-shift-start" required type="time" value={startTime}
              onChange={event=>{setStartTime(event.target.value);changed();}}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white"/>
          </div>
          <div>
            <label htmlFor="staff-shift-end" className="mb-2 block text-xs font-bold">Saída prevista</label>
            <input id="staff-shift-end" required type="time" value={endTime}
              onChange={event=>{setEndTime(event.target.value);changed();}}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white"/>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={endsNextDay}
            onChange={event=>{setEndsNextDay(event.target.checked);changed();}}
            className="h-4 w-4 accent-orange-500"/>
          Saída no dia seguinte (turno noturno)
        </label>
        <label htmlFor="staff-shift-sector" className="block text-xs font-bold">Setor ou posto</label>
        <input id="staff-shift-sector" required maxLength={80} value={sector}
          onChange={event=>{setSector(event.target.value);changed();}}
          placeholder="Ex.: Atendimento, caixa, produção"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white"/>
      </>}
      <label htmlFor="staff-shift-notes" className="block text-xs font-bold">Observações (opcional)</label>
      <textarea id="staff-shift-notes" maxLength={1000} rows={2} value={notes}
        onChange={event=>{setNotes(event.target.value);changed();}}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white"/>
      <p className="text-xs leading-relaxed text-slate-400">
        Horários civis da loja (sem conversão de fuso). Turnos de até 16 horas.
        Horários sobrepostos e folgas conflitantes são bloqueados no servidor.
      </p>
      <button type="submit"
        disabled={busy||!assignedTo||!scheduledDate||(kind==='shift'&&(!sector.trim()||!startTime||!endTime))}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 p-3 text-xs font-black text-slate-950 disabled:opacity-50">
        <Plus className="h-4 w-4"/>{busy?'Publicando...':'Publicar escala'}
      </button>
    </form>
    {error&&<p role="alert" className="rounded-xl border border-red-500/30 p-3 text-xs text-red-300">{error}</p>}
    <button type="button" onClick={()=>void refresh()}
      className="inline-flex items-center gap-2 text-xs font-bold text-orange-300">
      <RefreshCw className="h-4 w-4"/> Atualizar escalas
    </button>
    <div aria-live="polite" className="space-y-3">
      <h3 className="text-sm font-black">Escalas publicadas</h3>
      {loading&&<p className="text-xs text-slate-400">Carregando escalas...</p>}
      {!loading&&!shifts.length&&<p className="text-xs text-slate-400">Ainda não há escalas cadastradas.</p>}
      {shifts.map(shift=><article key={shift.id} className="space-y-2 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-black">
            {shift.kind==='day_off'?'Folga programada':shift.sector}
          </h4>
          <span className={shift.status==='cancelled'?'text-xs text-slate-400':'text-xs text-emerald-300'}>
            {shift.status==='cancelled'?'Cancelada':'Publicada'}
          </span>
        </div>
        <p className="text-xs text-slate-300">{assigneeLabel(shift.assignedTo)}</p>
        <p className="text-xs font-semibold text-slate-200">
          {showDate(shift.scheduledDate)} · {clockLabel(shift)}
        </p>
        {shift.notes&&<p className="whitespace-pre-wrap text-xs text-slate-400">{shift.notes}</p>}
        {shift.status==='cancelled'&&<p className="text-xs text-slate-400">
          Cancelada em {new Date(shift.cancelledAt).toLocaleString('pt-BR')}
          {shift.cancelReason?' · '+shift.cancelReason:''}
        </p>}
        {shift.status==='published'&&(confirmCancelId!==shift.id?
          <button type="button" disabled={busy} onClick={()=>{setConfirmCancelId(shift.id);setCancelReason('');}}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200">
            <XCircle className="h-4 w-4"/> Cancelar escala
          </button>:
          <div className="space-y-2 rounded-xl border border-orange-500/30 p-3">
            <p className="text-xs text-orange-300">
              Cancelar libera este período. Para substituição, publique um novo turno para a pessoa que fará a cobertura.
            </p>
            <label htmlFor={'cancel-shift-'+shift.id} className="block text-xs font-bold">Motivo (opcional)</label>
            <input id={'cancel-shift-'+shift.id} maxLength={500} value={cancelReason}
              onChange={event=>setCancelReason(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm"/>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={()=>void cancel(shift)}
                className="min-h-10 rounded-xl bg-orange-500 px-3 text-xs font-black text-slate-950">
                {busy?'Cancelando...':'Confirmar cancelamento'}
              </button>
              <button type="button" disabled={busy} onClick={()=>setConfirmCancelId('')}
                className="min-h-10 rounded-xl border border-slate-600 px-3 text-xs font-bold">Voltar</button>
            </div>
          </div>
        )}
      </article>)}
      <p className="text-xs text-slate-500">
        Mostrando até 100 registros recentes. Escalas não substituem marcações de ponto nem calculam folha de pagamento.
      </p>
    </div>
  </section>;
}
