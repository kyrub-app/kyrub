import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ListChecks, Plus, RefreshCw } from 'lucide-react';
import type { StaffChecklistTask, StaffTaskAssignee } from '../../../shared/staffTasks';
import {
  createStaffChecklistTask, listStaffChecklistTasks, listStaffTaskAssignees,
} from '../../utils/staffTasks';

export function StoreStaffTasksManager({
  storeId, onBack,
}: { storeId: string; onBack: () => void }) {
  const [tasks, setTasks] = useState<StaffChecklistTask[]>([]);
  const [assignees, setAssignees] = useState<StaffTaskAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [stepsText, setStepsText] = useState('');
  const requestId = useRef('');
  const refresh = useCallback(async () => {
    try {
      const [rows, members] = await Promise.all([
        listStaffChecklistTasks(storeId), listStaffTaskAssignees(storeId),
      ]);
      setTasks(rows); setAssignees(members); setError('');
      setAssignedTo(previous => members.some(member => member.userId === previous)
        ? previous : (members[0]?.userId || ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar tarefas.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {setLoading(true); void refresh();}, [refresh]);
  const changed = () => {requestId.current = '';};
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const steps = stepsText.split('\n').map(step => step.trim()).filter(Boolean);
    if (!steps.length || steps.length > 20) {
      setError('Informe de 1 a 20 etapas, uma por linha.');
      return;
    }
    setBusy(true); setError('');
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      await createStaffChecklistTask({
        storeId, requestId: requestId.current, title, details,
        assignedTo, dueDate, steps,
      });
      requestId.current = '';
      setTitle(''); setDetails(''); setDueDate(''); setStepsText('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atribuir tarefa.');
    } finally {
      setBusy(false);
    }
  };
  const labelFor = (uid: string) =>
    assignees.find(member => member.userId === uid)?.label || ('Colaborador ' + uid.slice(0, 8));

  return (
    <section data-kyrub-staff-tasks-manager className="space-y-4 text-slate-100">
      <button type="button" onClick={onBack}
        className="inline-flex items-center gap-2 py-2 text-sm font-bold text-orange-300">
        <ArrowLeft className="h-4 w-4" /> Central do Staff
      </button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-black">
          <ListChecks className="h-5 w-5 text-orange-300" /> Tarefas e checklists
        </h2>
        <p className="text-xs text-slate-400">
          Organize rotinas da loja, atribua a um colaborador ativo e acompanhe a conclusão de cada etapa.
        </p>
      </header>
      <form onSubmit={event => void create(event)}
        className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
        <h3 className="text-sm font-black">Nova tarefa</h3>
        <label htmlFor="staff-task-title" className="block text-xs font-bold">Título</label>
        <input id="staff-task-title" required maxLength={120} value={title}
          onChange={e => {setTitle(e.target.value); changed();}}
          placeholder="Ex.: Conferir abertura da loja"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
        <label htmlFor="staff-task-details" className="block text-xs font-bold">Orientações (opcional)</label>
        <textarea id="staff-task-details" maxLength={2000} rows={2} value={details}
          onChange={e => {setDetails(e.target.value); changed();}}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
        <label htmlFor="staff-task-assignee" className="block text-xs font-bold">Responsável</label>
        <select id="staff-task-assignee" value={assignedTo} required
          onChange={e => {setAssignedTo(e.target.value); changed();}}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white">
          {assignees.map(member => (
            <option key={member.userId} value={member.userId}>{member.label}</option>
          ))}
        </select>
        <label htmlFor="staff-task-due" className="block text-xs font-bold">Prazo (opcional)</label>
        <input id="staff-task-due" type="date" value={dueDate}
          onChange={e => {setDueDate(e.target.value); changed();}}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
        <label htmlFor="staff-task-steps" className="block text-xs font-bold">Checklist (uma etapa por linha)</label>
        <textarea id="staff-task-steps" required rows={5} value={stepsText}
          onChange={e => {setStepsText(e.target.value); changed();}}
          placeholder={'Verificar equipamentos\nOrganizar o balcão\nConferir materiais'}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
        <p className="text-xs text-slate-400">De 1 a 20 etapas, até 200 caracteres por etapa. O responsável recebe uma notificação.</p>
        <button type="submit" disabled={busy || !title.trim() || !assignedTo || !stepsText.trim()}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 p-3 text-xs font-black text-slate-950 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {busy ? 'Atribuindo...' : 'Atribuir tarefa'}
        </button>
      </form>
      {error && <p role="alert" className="rounded-xl border border-red-500/30 p-3 text-xs text-red-300">{error}</p>}
      <button type="button" onClick={() => void refresh()}
        className="inline-flex items-center gap-2 text-xs font-bold text-orange-300">
        <RefreshCw className="h-4 w-4" /> Atualizar tarefas
      </button>
      <div aria-live="polite" className="space-y-3">
        <h3 className="text-sm font-black">Tarefas atribuídas</h3>
        {loading && <p className="text-xs text-slate-400">Carregando tarefas...</p>}
        {!loading && !tasks.length && <p className="text-xs text-slate-400">Nenhuma tarefa atribuída ainda.</p>}
        {tasks.map(task => {
          const done = task.steps.filter(step => Boolean(step.completedAt)).length;
          return <article key={task.id} className="space-y-2 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-black">{task.title}</h4>
              <span className={task.status === 'done' ? 'text-xs text-emerald-300' : 'text-xs text-orange-300'}>
                {task.status === 'done' ? 'Concluída' : 'Em andamento'}
              </span>
            </div>
            {task.details && <p className="whitespace-pre-wrap text-xs text-slate-300">{task.details}</p>}
            <p className="text-xs text-slate-400">
              {labelFor(task.assignedTo)} · {done}/{task.steps.length} etapas
              {task.dueDate ? ' · Prazo ' + task.dueDate.split('-').reverse().join('/') : ''}
            </p>
            <ol className="space-y-1">
              {task.steps.map(step => <li key={step.id} className="text-xs text-slate-300">
                {step.completedAt ? '✓ ' : '○ '}{step.label}
              </li>)}
            </ol>
          </article>;
        })}
      </div>
    </section>
  );
}
