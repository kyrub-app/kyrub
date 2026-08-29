import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  CheckCircle2,
  CirclePause,
  LoaderCircle,
  Play,
  Plus,
  Square,
  Target,
} from 'lucide-react';
import {
  STORE_CHALLENGE_SCHEMA_VERSION,
  type StoreChallengeDefinition,
  type StoreChallengeMetric,
  type StoreChallengeStatus,
} from '../../../shared/storeChallenges';
import { auth } from '../../utils/firebase';
import {
  persistStoreChallenge,
  subscribeToStoreChallenges,
} from '../../utils/storeChallenges';

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const createChallengeId = (): string => {
  try {
    return `challenge-${globalThis.crypto.randomUUID()}`;
  } catch {
    return `challenge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const parsePositiveInteger = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const parseStoreChallengeCurrencyMinor = (
  value: string
): number | null => {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  const minor = Math.round(parsed * 100);
  return parsed > 0 && Number.isSafeInteger(minor) ? minor : null;
};

const metricLabel = (challenge: StoreChallengeDefinition): string =>
  challenge.metric === 'purchase_count'
    ? `${challenge.target} compra${challenge.target === 1 ? '' : 's'}`
    : money.format(challenge.target / 100);

const statusLabel = (status: StoreChallengeStatus): string => {
  if (status === 'draft') return 'Rascunho';
  if (status === 'active') return 'Ativo';
  if (status === 'paused') return 'Pausado';
  if (status === 'ended') return 'Encerrado';
  return 'Cancelado';
};

export function StoreChallengeManager() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [challenges, setChallenges] = useState<StoreChallengeDefinition[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [metric, setMetric] = useState<StoreChallengeMetric>('purchase_count');
  const [target, setTarget] = useState('3');
  const [rewardPoints, setRewardPoints] = useState('50');
  const [durationDays, setDurationDays] = useState('30');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setChallenges([]);
      return;
    }
    return subscribeToStoreChallenges(
      user.uid,
      setChallenges,
      () => setChallenges([])
    );
  }, [user?.uid]);

  const activeCount = useMemo(
    () => challenges.filter(challenge => challenge.status === 'active').length,
    [challenges]
  );

  const resetForm = (): void => {
    setTitle('');
    setDescription('');
    setMetric('purchase_count');
    setTarget('3');
    setRewardPoints('50');
    setDurationDays('30');
  };

  const saveNewChallenge = async (
    status: 'draft' | 'active'
  ): Promise<void> => {
    if (!user || busyId) return;
    const parsedTarget = metric === 'purchase_count'
      ? parsePositiveInteger(target)
      : parseStoreChallengeCurrencyMinor(target);
    const parsedReward = parsePositiveInteger(rewardPoints);
    const parsedDays = parsePositiveInteger(durationDays);

    if (!title.trim()) {
      setSuccess(false);
      setMessage('Informe um nome para o desafio.');
      return;
    }
    if (parsedTarget === null) {
      setSuccess(false);
      setMessage(
        metric === 'purchase_count'
          ? 'A meta de compras precisa ser um inteiro maior que zero.'
          : 'Informe uma meta de gasto válida maior que zero.'
      );
      return;
    }
    if (parsedReward === null) {
      setSuccess(false);
      setMessage('A recompensa precisa ter ao menos 1 Ponto da Loja.');
      return;
    }
    if (parsedDays === null || parsedDays > 365) {
      setSuccess(false);
      setMessage('A duração precisa ficar entre 1 e 365 dias.');
      return;
    }

    const now = new Date();
    const challenge: StoreChallengeDefinition = {
      schemaVersion: STORE_CHALLENGE_SCHEMA_VERSION,
      id: createChallengeId(),
      storeId: user.uid,
      title: title.trim(),
      description: description.trim(),
      metric,
      target: parsedTarget,
      rewardPoints: parsedReward,
      startsAt: now.toISOString(),
      endsAt: new Date(
        now.getTime() + parsedDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      status,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    setBusyId('new');
    setMessage('');
    setSuccess(false);
    try {
      await persistStoreChallenge(user, challenge);
      setSuccess(true);
      setMessage(
        status === 'active'
          ? `Desafio “${challenge.title}” publicado.`
          : `Rascunho “${challenge.title}” salvo.`
      );
      resetForm();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o desafio.'
      );
    } finally {
      setBusyId('');
    }
  };

  const changeStatus = async (
    challenge: StoreChallengeDefinition,
    status: StoreChallengeStatus
  ): Promise<void> => {
    if (!user || busyId) return;
    setBusyId(challenge.id);
    setMessage('');
    setSuccess(false);
    try {
      await persistStoreChallenge(user, {
        ...challenge,
        status,
        updatedAt: new Date().toISOString(),
      });
      setSuccess(true);
      setMessage(
        `“${challenge.title}” agora está ${statusLabel(status).toLowerCase()}.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível alterar o desafio.'
      );
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4" id="store-challenge-manager">
      <section className="rounded-3xl border border-violet-500/20 bg-slate-900 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
            <div>
              <h4 className="text-sm font-black uppercase text-white">
                Criar desafio
              </h4>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                A loja define meta e recompensa; somente pagamentos confirmados
                pelo servidor contam para a conclusão.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[9px] font-black uppercase text-violet-200">
            {activeCount} ativo{activeCount === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">
              Nome
            </span>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              disabled={Boolean(busyId)}
              placeholder="Ex: Cliente fiel do mês"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-400 disabled:opacity-45"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">
              Descrição opcional
            </span>
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              disabled={Boolean(busyId)}
              placeholder="Explique a condição para o cliente"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-400 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">
              Métrica
            </span>
            <select
              value={metric}
              onChange={event => {
                const nextMetric = event.target.value as StoreChallengeMetric;
                setMetric(nextMetric);
                setTarget(nextMetric === 'purchase_count' ? '3' : '100.00');
              }}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-400 disabled:opacity-45"
            >
              <option value="purchase_count">Quantidade de compras</option>
              <option value="spend_minor">Valor gasto</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">
              {metric === 'purchase_count' ? 'Meta de compras' : 'Meta de gasto (R$)'}
            </span>
            <input
              type="number"
              min={metric === 'purchase_count' ? '1' : '0.01'}
              step={metric === 'purchase_count' ? '1' : '0.01'}
              inputMode={metric === 'purchase_count' ? 'numeric' : 'decimal'}
              value={target}
              onChange={event => setTarget(event.target.value)}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-400 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">
              Recompensa em pontos
            </span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={rewardPoints}
              onChange={event => setRewardPoints(event.target.value)}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-400 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">
              Duração (dias)
            </span>
            <input
              type="number"
              min="1"
              max="365"
              step="1"
              inputMode="numeric"
              value={durationDays}
              onChange={event => setDurationDays(event.target.value)}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-400 disabled:opacity-45"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void saveNewChallenge('draft')}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-40"
          >
            {busyId === 'new' ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Salvar rascunho
          </button>
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void saveNewChallenge('active')}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 text-[9px] font-black uppercase text-violet-200 disabled:opacity-40"
          >
            {busyId === 'new' ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Publicar agora
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-xs font-black uppercase text-white">
            Desafios da loja
          </h4>
          <span className="text-[9px] font-bold text-slate-500">
            {challenges.length} registrado{challenges.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="space-y-2">
          {challenges.map(challenge => {
            const busy = busyId === challenge.id;
            return (
              <article
                key={challenge.id}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-xs text-white">
                        {challenge.title}
                      </strong>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-black uppercase text-slate-400">
                        {statusLabel(challenge.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-[9px] text-slate-500">
                      Meta: {metricLabel(challenge)} · Recompensa:{' '}
                      {challenge.rewardPoints} ponto
                      {challenge.rewardPoints === 1 ? '' : 's'} · até{' '}
                      {new Date(challenge.endsAt).toLocaleDateString('pt-BR')}
                    </p>
                    {challenge.description && (
                      <p className="mt-1 text-[9px] text-slate-600">
                        {challenge.description}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {challenge.status === 'draft' && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(challenge, 'active')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 text-[8px] font-black uppercase text-violet-200 disabled:opacity-40"
                      >
                        {busy ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Publicar
                      </button>
                    )}
                    {challenge.status === 'active' && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(challenge, 'paused')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-[8px] font-black uppercase text-amber-200 disabled:opacity-40"
                      >
                        {busy ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <CirclePause className="h-3 w-3" />
                        )}
                        Pausar
                      </button>
                    )}
                    {challenge.status === 'paused' && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(challenge, 'active')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 text-[8px] font-black uppercase text-violet-200 disabled:opacity-40"
                      >
                        {busy ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Reativar
                      </button>
                    )}
                    {(challenge.status === 'active' ||
                      challenge.status === 'paused') && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(challenge, 'ended')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[8px] font-black uppercase text-slate-400 disabled:opacity-40"
                      >
                        <Square className="h-3 w-3" />
                        Encerrar
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {challenges.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-800 px-4 py-7 text-center text-xs text-slate-500">
              Nenhum desafio criado ainda.
            </p>
          )}
        </div>
      </section>

      {message && (
        <div
          className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-[10px] font-bold ${
            success
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {success && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {message}
        </div>
      )}
    </div>
  );
}
