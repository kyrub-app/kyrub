import {
  useCallback, useEffect, useRef, useState, type FormEvent,
} from 'react';
import { ArrowLeft, BookOpenCheck, Download, FilePlus2, History, Upload } from 'lucide-react';
import type { StaffNoticeAudienceRole } from '../../../shared/staffNotices';
import type { StaffProcedureView, StaffProcedureRevision, StaffPopReadReceipt } from '../../../shared/staffProcedures';
import {
  downloadStaffProcedureFile, getStaffProcedureHistory, listStaffProcedures,
  publishStaffProcedure, uploadStaffProcedureFile, getStaffPopReceipts,
} from '../../utils/staffProcedures';
import { STAFF_POP_ACCEPT, STAFF_POP_MAX_ATTACHMENT_BYTES } from '../../../shared/staffProcedures';

const audienceLabel: Record<string, string> = {
  all: 'Toda a equipe ativa', manager: 'Gerentes', cashier: 'Caixa',
  seller: 'Vendedores', production: 'Produção',
};

export function StoreStaffPopManager({
  storeId, onBack,
}: { storeId: string; onBack: () => void }) {
  const [items, setItems] = useState<StaffProcedureView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<StaffProcedureView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | StaffNoticeAudienceRole>('all');
  const [file, setFile] = useState<File | null>(null);
  const [retainAttachment, setRetainAttachment] = useState(true);
  const [historyId, setHistoryId] = useState('');
  const [history, setHistory] = useState<StaffProcedureRevision[]>([]);
  const [receiptsId, setReceiptsId] = useState('');
  const [receipts, setReceipts] = useState<StaffPopReadReceipt[]>([]);
  const requestIdRef = useRef('');
  const procedureIdRef = useRef('');

  const refresh = useCallback(async () => {
    try {
      setItems(await listStaffProcedures(storeId));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os manuais.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);

  const reset = () => {
    setEditing(null);
    setFormOpen(false);
    setTitle('');
    setBody('');
    setAudience('all');
    setFile(null);
    setRetainAttachment(true);
    requestIdRef.current = '';
    procedureIdRef.current = '';
  };
  const newManual = () => { reset(); setFormOpen(true); setError(''); };
  const editManual = (current: StaffProcedureView) => {
    reset();
    setEditing(current);
    setFormOpen(true);
    setTitle(current.revision.title);
    setBody(current.revision.body);
    setAudience(current.audienceRoles[0] || 'all');
  };
  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (file && (!STAFF_POP_ACCEPT.split(',').includes(file.type) ||
          file.size <= 0 || file.size > STAFF_POP_MAX_ATTACHMENT_BYTES)) {
        throw Error('O arquivo precisa ser PDF ou imagem de até 1,25 MB.');
      }
      if (!procedureIdRef.current) procedureIdRef.current = editing?.id || crypto.randomUUID();
      if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
      const attachment = file ? await uploadStaffProcedureFile({
        storeId, procedureId: procedureIdRef.current,
        requestId: requestIdRef.current, file,
      }) : null;
      await publishStaffProcedure({
        storeId,
        procedureId: procedureIdRef.current,
        requestId: requestIdRef.current,
        expectedVersion: editing?.currentVersion || 0,
        title, body,
        audienceRoles: audience === 'all' ? [] : [audience],
        attachment,
        retainAttachment: Boolean(editing?.revision.attachment) && !file && retainAttachment,
      });
      reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao publicar o manual.');
    } finally {
      setBusy(false);
    }
  };
  const showHistory = async (id: string) => {
    if (historyId === id) { setHistoryId(''); return; }
    setError('');
    try {
      setHistory(await getStaffProcedureHistory(storeId, id));
      setHistoryId(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar versões.');
    }
  };
  const showReceipts = async (pop: StaffProcedureView) => {
    if (receiptsId === pop.id) { setReceiptsId(''); return; }
    setError('');
    try {
      setReceipts(await getStaffPopReceipts(storeId, pop.id, pop.currentVersion));
      setReceiptsId(pop.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao consultar confirmações.');
    }
  };
  const download = async (id: string, revision: StaffProcedureRevision) => {
    if (!revision.attachment) return;
    setError('');
    try {
      await downloadStaffProcedureFile(
        storeId, id, revision.version, revision.attachment.name
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao baixar o arquivo.');
    }
  };

  return (
    <section data-kyrub-staff-pops-manager className="space-y-4 text-slate-100">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 py-2 text-sm font-bold text-orange-300">
        <ArrowLeft className="h-4 w-4" /> Central do Staff
      </button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-black"><BookOpenCheck className="h-5 w-5 text-orange-300" /> Manuais POP</h2>
        <p className="text-xs leading-relaxed text-slate-400">
          Publique procedimentos internos, mantenha histórico de versões e solicite confirmação de leitura à equipe.
        </p>
      </header>
      {!formOpen && (
        <button type="button" onClick={newManual}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-slate-950">
          <FilePlus2 className="h-4 w-4" /> Criar manual POP
        </button>
      )}
      {formOpen && (
        <form onSubmit={event => void publish(event)}
          className="space-y-3 rounded-2xl border border-orange-500/30 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black">
              {editing ? 'Publicar versão ' + (editing.currentVersion + 1) : 'Novo manual'}
            </h3>
            <button type="button" disabled={busy} onClick={reset} className="text-xs font-bold text-slate-400">Cancelar</button>
          </div>
          <label htmlFor="staff-pop-title" className="block text-xs font-bold">Título do procedimento</label>
          <input id="staff-pop-title" required maxLength={120} value={title}
            onChange={event => {setTitle(event.target.value); requestIdRef.current = '';}}
            placeholder="Ex.: Abertura de caixa"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
          <label htmlFor="staff-pop-body" className="block text-xs font-bold">Instruções do POP</label>
          <textarea id="staff-pop-body" value={body} rows={6} maxLength={8000}
            onChange={event => {setBody(event.target.value); requestIdRef.current = '';}}
            placeholder="Etapas, materiais, cuidados e responsável..."
            className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
          <label htmlFor="staff-pop-audience" className="block text-xs font-bold">Destinatários</label>
          <select id="staff-pop-audience" value={audience}
            onChange={event => {setAudience(event.target.value as typeof audience); requestIdRef.current = '';}}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white">
            {Object.entries(audienceLabel).map(([value, name]) =>
              <option value={value} key={value}>{name}</option>)}
          </select>
          <label htmlFor="staff-pop-file" className="block text-xs font-bold">Anexo PDF ou imagem (opcional)</label>
          <input id="staff-pop-file" type="file" accept={STAFF_POP_ACCEPT}
            onChange={event => {setFile(event.target.files?.[0] || null); requestIdRef.current = '';}}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 file:mr-2 file:rounded-lg file:border-0 file:bg-orange-500/15 file:px-3 file:py-2 file:text-orange-200" />
          <p className="text-xs text-slate-400">
            Até 1,25 MB por arquivo. O anexo é privado e só pode ser baixado por quem tiver acesso autorizado.
          </p>
          {editing?.revision.attachment && !file && (
            <label className="flex items-start gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={retainAttachment}
                onChange={event => {setRetainAttachment(event.target.checked); requestIdRef.current = '';}} />
              Manter o anexo da versão anterior ({editing.revision.attachment.name})
            </label>
          )}
          <button type="submit" disabled={busy || !title.trim() || (!body.trim() && !file && !(editing?.revision.attachment && retainAttachment))}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 p-3 text-xs font-black text-slate-950 disabled:opacity-50">
            <Upload className="h-4 w-4" /> {busy ? 'Publicando...' : editing ? 'Publicar nova versão' : 'Publicar manual POP'}
          </button>
          <p className="text-xs text-slate-400">Versões publicadas são imutáveis. A nova versão exige uma nova confirmação de leitura.</p>
        </form>
      )}
      {error && <p role="alert" className="rounded-xl border border-red-500/30 p-3 text-sm text-red-300">{error}</p>}
      <div aria-live="polite" className="space-y-3">
        <h3 className="text-sm font-black">Procedimentos publicados</h3>
        {loading && <p className="text-xs text-slate-400">Carregando manuais...</p>}
        {!loading && !items.length && <p className="text-xs text-slate-400">Nenhum manual POP cadastrado nesta loja.</p>}
        {items.map(pop => (
          <article key={pop.id} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-black">{pop.title}</h4>
              <span className="shrink-0 rounded-full border border-orange-500/30 px-2 py-1 text-[10px] text-orange-300">v{pop.currentVersion}</span>
            </div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{pop.revision.body}</p>
            <p className="text-xs text-slate-400">
              {audienceLabel[pop.audienceRoles[0] || 'all']} · {new Date(pop.publishedAt).toLocaleString('pt-BR')}
            </p>
            {pop.revision.attachment && (
              <button type="button" onClick={() => void download(pop.id, pop.revision)}
                className="inline-flex items-center gap-2 text-xs font-bold text-orange-300">
                <Download className="h-4 w-4" /> {pop.revision.attachment.name}
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => editManual(pop)}
                className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold">Nova versão</button>
              <button type="button" onClick={() => void showHistory(pop.id)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold">
                <History className="h-3.5 w-3.5" /> Histórico
              </button>
              <button type="button" onClick={() => void showReceipts(pop)}
                className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold">
                Confirmações de leitura
              </button>
            </div>
            {receiptsId === pop.id && (
              <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs">
                <p className="font-bold">{receipts.length} confirmações na versão {pop.currentVersion}</p>
                {!receipts.length && <p className="text-slate-400">Nenhuma confirmação registrada ainda.</p>}
                {receipts.map(item => <p key={item.userId} className="text-slate-300">
                  Colaborador {item.userId.slice(0, 12)} · {new Date(item.readAt).toLocaleString('pt-BR')}
                </p>)}
              </div>
            )}
            {historyId === pop.id && (
              <div className="space-y-3 border-t border-slate-700 pt-3">
                {history.map(v => <div key={v.version} className="rounded-xl bg-slate-900 p-3 text-xs">
                  <p className="font-bold">Versão {v.version} · {new Date(v.publishedAt).toLocaleString('pt-BR')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-300">{v.body}</p>
                  {v.attachment && <button type="button" onClick={() => void download(pop.id, v)}
                    className="mt-2 inline-flex items-center gap-1 text-orange-300">
                    <Download className="h-3.5 w-3.5" /> {v.attachment.name}
                  </button>}
                </div>)}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
