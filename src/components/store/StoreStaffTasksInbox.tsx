import { useCallback, useEffect, useRef, useState } from 'react';
import { ListChecks, RefreshCw } from 'lucide-react';
import type { StaffChecklistTask } from '../../../shared/staffTasks';
import { listStaffChecklistTasks, setStaffChecklistStep } from '../../utils/staffTasks';
import { auth } from '../../utils/firebase';

export function StoreStaffTasksInbox({ storeId }: { storeId: string }) {
  const [tasks, setTasks] = useState<StaffChecklistTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef('');
  const refresh = useCallback(async () => {
    try {
      const rows = await listStaffChecklistTasks(storeId);
      // A manager can see all delegated checklists, but this personal inbox
      // only offers completion controls for tasks assigned to this identity.
      setTasks(rows.filter(task => task.assignedTo === auth.currentUser?.uid));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao consultar tarefas.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {setLoading(true); void refresh();}, [refresh]);

  const toggle = async (task: StaffChecklistTask, stepId: string, completed: boolean) => {
    if (busy) return;
    const key = task.id + ':' + stepId;
    setBusy(key); setError('');
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const updated = await setStaffChecklistStep({
        storeId, requestId: requestId.current, taskId: task.id,
        stepId, completed, expectedVersion: task.version,
      });
      requestId.current = '';
      setTasks(items => items.map(item => item.id === task.id ? updated : item));
    } catch (cause) {
      requestId.current = '';
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar etapa.');
      await refresh();
    } finally {
      setBusy('');
    }
  };

  return (
    <section data-kyrub-staff-tasks-inbox aria-label="Minhas tarefas da loja"
      className="mx-auto max-w-md space-y-3 text-slate-100">
      <header className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="flex items-center gap-2 text-sm font-black">
          <ListChecks className="h-4 w-4 text-orange-300" /> Minhas tarefas
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Marque cada etapa quando estiver concluída. Alterações ficam registradas para a gestão.
        </p>
        <button type="button" onClick={() => void refresh()}
          className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-orange-300">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </button>
      </header>
      {loading && <p className="text-xs text-slate-400">Carregando tarefas...</p>}
      {error && <p role="alert" className="rounded-xl border border-red-500/30 p-3 text-xs text-red-300">{error}</p>}
      {!loading && tasks.length === 0 &&
        <p className="text-xs text-slate-400">Nenhuma tarefa atribuída a você nesta loja.</p>}
      {tasks.map(task => {
        const done = task.steps.filter(step => Boolean(step.completedAt)).length;
        return <article key={task.id} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-black">{task.title}</h4>
            <span className={task.status === 'done' ? 'text-xs text-emerald-300' : 'text-xs text-orange-300'}>
              {task.status === 'done' ? 'Concluída' : 'Pendente'}
            </span>
          </div>
          {task.details && <p className="whitespace-pre-wrap text-sm text-slate-300">{task.details}</p>}
          <p className="text-xs text-slate-400">
            {done}/{task.steps.length} etapas
            {task.dueDate ? ' · Prazo ' + task.dueDate.split('-').reverse().join('/') : ''}
          </p>
          <div className="space-y-2">
            {task.steps.map(step => {
              const checked = Boolean(step.completedAt);
              return <label key={step.id} className="flex min-h-10 items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm">
                <input type="checkbox" checked={checked} disabled={Boolean(busy)}
                  onChange={() => void toggle(task, step.id, !checked)}
                  className="h-4 w-4 shrink-0 accent-orange-500" />
                <span className={checked ? 'text-slate-400 line-through' : 'text-slate-100'}>{step.label}</span>
              </label>;
            })}
          </div>
        </article>;
      })}
    </section>
  );
}
