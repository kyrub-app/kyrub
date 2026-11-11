import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import { createGlobalChallengeAdminClient, GlobalChallengeApiError } from '../../utils/adminGlobalChallenges';
import { GLOBAL_CHALLENGE_MODES, GLOBAL_CHALLENGE_STATUSES, type GlobalChallengePage } from '../../../shared/globalChallengeAdmin';
import { assertKyrubChallengeDefinition, type KyrubChallengeDefinition, type KyrubChallengeStatus } from '../../../shared/gamification';

const statusLabels: Record<KyrubChallengeStatus, string> = { draft: 'Rascunho', published: 'Publicado', active: 'Ativo', ended: 'Encerrado', cancelled: 'Cancelado' };
const modeLabels = { deterministic: 'Evento verificável', user_evidence: 'Evidência do usuário', feed_post: 'Publicação no feed', external_integration: 'Integração externa', community_review: 'Revisão da comunidade', manual_review: 'Revisão manual', kyrubia_assisted: 'Assistida pela Kyrubia' };
const inputClass = 'mt-1 min-w-0 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
const buttonClass = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50';
const emptyForm = () => ({ id: `challenge_${crypto.randomUUID()}`, title: '', description: '', validationMode: 'deterministic', rewardXp: '0', rewardKCoins: '0', maxCompletionsPerUser: '1', maxCompletions: '', startsAt: '', endsAt: '' });
const formatDate = (value?: string) => value ? new Date(value).toLocaleString('pt-BR') : 'Sem limite de data';

export default function AdminGlobalChallengesWorkspace({ user, profile }: { user: Pick<User, 'uid' | 'getIdToken'>; profile: Pick<AdminProfile, 'role' | 'status'> }) {
  if (profile.role !== 'super_admin' || profile.status !== 'active') return <p role="alert" className="text-sm text-amber-200">Acesso restrito a Super Admin ativo.</p>;
  return <ChallengeWorkspace key={user.uid} user={user} />;
}

function ChallengeWorkspace({ user }: { user: Pick<User, 'uid' | 'getIdToken'> }) {
  const api = useMemo(() => createGlobalChallengeAdminClient(user), [user]);
  const [filter, setFilter] = useState<KyrubChallengeStatus | ''>('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<GlobalChallengePage | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<KyrubChallengeDefinition | null>(null);
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const errorRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (detail && !detailLoading) {
      detailHeadingRef.current?.focus();
      detailHeadingRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [detail, detailLoading]);
  const cursor = cursors.at(-1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mutation.current?.abort(); }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const report = (caught: unknown) => {
    if (!mounted.current || (caught instanceof Error && caught.name === 'AbortError')) return;
    setError(caught instanceof GlobalChallengeApiError ? caught.message : 'Não foi possível concluir a operação. Verifique os dados e tente novamente.');
    if (caught instanceof GlobalChallengeApiError && [401, 403].includes(caught.status)) {
      setPage(null); setDetail(null); setBlocked(true);
    }
  };
  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    setLoading(true); setPage(null); setError('');
    void api.list({ status: filter || undefined, cursor, limit: 20 }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setPage(result); })
      .catch(caught => { if (!controller.signal.aborted) report(caught); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, filter, cursor, revision, blocked]);
  useEffect(() => {
    setDetail(null);
    if (!selectedId || blocked) return;
    const controller = new AbortController(); setDetailLoading(true);
    void api.get(selectedId, controller.signal).then(result => { if (!controller.signal.aborted) setDetail(result.challenge); })
      .catch(caught => { if (!controller.signal.aborted) report(caught); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [api, selectedId, revision, blocked]);
  const mutate = async (operation: (signal: AbortSignal) => Promise<{ challenge: KyrubChallengeDefinition }>, message: string) => {
    if (mutation.current || blocked) return;
    const controller = new AbortController(); mutation.current = controller; setBusy(true); setError(''); setNotice('');
    try {
      const result = await operation(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setSelectedId(result.challenge.id); setNotice(message); setRevision(value => value + 1);
      if (result.challenge.status === 'draft') { setShowForm(false); setForm(emptyForm()); setFilter('draft'); setCursors([undefined]); }
    } catch (caught) { report(caught); }
    finally { mutation.current = null; if (mounted.current) setBusy(false); }
  };
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const challenge = assertKyrubChallengeDefinition({ id: form.id, title: form.title, description: form.description,
        status: 'draft', sponsorType: 'kyrub', validationMode: form.validationMode as KyrubChallengeDefinition['validationMode'],
        rewardXp: Number(form.rewardXp), rewardKCoins: Number(form.rewardKCoins), maxCompletionsPerUser: Number(form.maxCompletionsPerUser),
        ...(form.maxCompletions ? { maxCompletions: Number(form.maxCompletions) } : {}),
        ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}), ...(form.endsAt ? { endsAt: new Date(form.endsAt).toISOString() } : {}) });
      void mutate(signal => api.create(challenge, signal), 'Rascunho criado com sucesso.');
    } catch { setError('Revise os campos obrigatórios, as quantidades e o período do desafio.'); }
  };
  const publish = () => {
    if (!detail || busy || mutation.current || !window.confirm(`Publicar o desafio “${detail.title}”? Seu estado será alterado para Publicado.`)) return;
    void mutate(signal => api.publish(detail.id, signal), 'Desafio publicado com sucesso.');
  };
  if (blocked) return <div role="alert" ref={errorRef} tabIndex={-1} className="rounded-xl border border-amber-500/30 p-4 text-sm text-amber-200">{error}</div>;
  const field = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  return <section aria-label="Gerenciar desafios globais" className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className="text-xs text-slate-300">Estado do desafio<select aria-label="Filtrar por estado" value={filter} disabled={busy} onChange={event => { setFilter(event.target.value as typeof filter); setCursors([undefined]); setSelectedId(''); }} className={inputClass}>
        <option value="">Todos os estados</option>{GLOBAL_CHALLENGE_STATUSES.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || loading} className={buttonClass} onClick={() => setRevision(value => value + 1)}>Atualizar</button>
        <button type="button" disabled={busy} className={`${buttonClass} border-cyan-500/40 text-cyan-200`} aria-expanded={showForm} aria-controls="global-challenge-form" onClick={() => setShowForm(value => !value)}>Novo rascunho</button></div>
    </div>
    {error && <div role="alert" ref={errorRef} tabIndex={-1} className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
    <p role="status" aria-live="polite" className="text-sm text-emerald-300">{notice || (busy ? 'Salvando…' : '')}</p>
    {showForm && <form id="global-challenge-form" onSubmit={create} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
      <h3 className="mb-4 text-sm font-bold text-white">Criar rascunho global</h3><fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-xs text-slate-300">Identificador<input className={inputClass} required maxLength={128} pattern="[A-Za-z0-9_\-]+" value={form.id} onChange={event => field('id', event.target.value)} /></label>
        <label className="text-xs text-slate-300">Título<input className={inputClass} required maxLength={200} value={form.title} onChange={event => field('title', event.target.value)} /></label>
        <label className="text-xs text-slate-300 sm:col-span-2">Descrição<textarea className={inputClass} required maxLength={5000} rows={3} value={form.description} onChange={event => field('description', event.target.value)} /></label>
        <label className="text-xs text-slate-300">Validação<select className={inputClass} value={form.validationMode} onChange={event => field('validationMode', event.target.value)}>{GLOBAL_CHALLENGE_MODES.map(mode => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select></label>
        {(['rewardXp', 'rewardKCoins', 'maxCompletionsPerUser', 'maxCompletions'] as const).map(key => <label key={key} className="text-xs text-slate-300">{{ rewardXp: 'XP previsto', rewardKCoins: 'K-Coins previstos', maxCompletionsPerUser: 'Conclusões por usuário', maxCompletions: 'Conclusões totais (opcional)' }[key]}<input className={inputClass} type="number" step="1" min={key.startsWith('reward') ? 0 : 1} max={Number.MAX_SAFE_INTEGER} required={key !== 'maxCompletions'} value={form[key]} onChange={event => field(key, event.target.value)} /></label>)}
        {(['startsAt', 'endsAt'] as const).map(key => <label key={key} className="text-xs text-slate-300">{key === 'startsAt' ? 'Início (horário local, opcional)' : 'Fim (horário local, opcional)'}<input type="datetime-local" className={inputClass} value={form[key]} onChange={event => field(key, event.target.value)} /></label>)}
        <div className="flex gap-2 sm:col-span-2"><button type="submit" className={`${buttonClass} bg-cyan-500/15`}>Salvar rascunho</button><button type="button" className={buttonClass} onClick={() => setShowForm(false)}>Cancelar</button></div>
      </fieldset>
    </form>}
    <div aria-busy={loading} aria-label="Lista de desafios" className="space-y-2">
      {loading && <p role="status" className="text-sm text-slate-400">Carregando desafios…</p>}
      {!loading && page?.items.length === 0 && <p className="text-sm text-slate-400">Nenhum desafio encontrado neste filtro.</p>}
      <ul className="space-y-2">{page?.items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="min-w-0"><strong className="block break-words text-sm text-white">{item.title}</strong><span className="text-xs text-cyan-300">{statusLabels[item.status]}</span><p className="break-all text-xs text-slate-500">{item.id}</p></div>
        <button type="button" disabled={busy} aria-label={`Ver detalhes de ${item.title}`} className={buttonClass} onClick={() => setSelectedId(item.id)}>Ver detalhes</button>
      </li>)}</ul>
      <nav aria-label="Paginação dos desafios" className="flex items-center gap-3 pt-2"><button type="button" disabled={busy || loading || cursors.length === 1} className={buttonClass} onClick={() => setCursors(previous => previous.slice(0, -1))}>Anterior</button><span className="text-xs text-slate-400">Página {cursors.length}</span><button type="button" disabled={busy || loading || !page?.nextCursor} className={buttonClass} onClick={() => { if (page?.nextCursor) setCursors(previous => [...previous, page.nextCursor!]); }}>Próxima</button></nav>
    </div>
    {selectedId && <section aria-label="Detalhes do desafio" aria-busy={detailLoading} className="rounded-2xl border border-slate-700 p-4">
      {detailLoading && <p role="status" className="text-sm text-slate-400">Carregando detalhes…</p>}
      {detail && <><h3 ref={detailHeadingRef} tabIndex={-1} className="scroll-mt-24 break-words text-base font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">{detail.title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-300">{detail.description}</p>
        <dl className="my-4 grid gap-3 text-xs text-slate-300 sm:grid-cols-2">{[['Identificador', detail.id], ['Estado', statusLabels[detail.status]], ['Validação', modeLabels[detail.validationMode]], ['XP previsto', detail.rewardXp], ['K-Coins previstos', detail.rewardKCoins], ['Conclusões por usuário', detail.maxCompletionsPerUser], ['Conclusões totais', detail.maxCompletions ?? 'Sem limite'], ['Início', formatDate(detail.startsAt)], ['Fim', formatDate(detail.endsAt)]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl>
        {detail.status === 'draft' && <button type="button" disabled={busy} className={`${buttonClass} border-emerald-500/40 text-emerald-200`} onClick={publish}>Publicar desafio</button>}
      </>}
    </section>}
  </section>;
}
