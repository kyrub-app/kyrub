import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  CheckCircle2,
  CirclePause,
  Gift,
  LoaderCircle,
  Play,
  Plus,
  Square,
} from 'lucide-react';
import {
  STORE_REWARD_SCHEMA_VERSION,
  type StoreRewardDefinition,
  type StoreRewardDiscountType,
  type StoreRewardStatus,
} from '../../../shared/storeRewards';
import { auth } from '../../utils/firebase';
import type { PublicProduct } from '../../utils/publicProducts';
import {
  persistStoreReward,
  subscribeToStoreRewards,
} from '../../utils/storeRewards';

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const createRewardId = (): string => {
  try {
    return `reward-${globalThis.crypto.randomUUID()}`;
  } catch {
    return `reward-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const positiveInteger = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const positiveDecimal = (value: string): number | null => {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const statusLabel = (status: StoreRewardStatus): string => {
  if (status === 'draft') return 'Rascunho';
  if (status === 'active') return 'Ativa';
  if (status === 'paused') return 'Pausada';
  return 'Encerrada';
};

const benefitLabel = (reward: StoreRewardDefinition): string =>
  reward.discountType === 'percentage'
    ? `${reward.discountValue}% OFF`
    : `${money.format(reward.discountValue)} OFF`;

export function StoreRewardManager({
  products,
}: {
  products: PublicProduct[];
}) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [rewards, setRewards] = useState<StoreRewardDefinition[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [costPoints, setCostPoints] = useState('100');
  const [discountType, setDiscountType] =
    useState<StoreRewardDiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState('10.00');
  const [voucherValidityHours, setVoucherValidityHours] = useState('168');
  const [durationDays, setDurationDays] = useState('90');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setRewards([]);
      return;
    }
    return subscribeToStoreRewards(user.uid, setRewards, () => setRewards([]));
  }, [user?.uid]);

  useEffect(() => {
    const validIds = new Set(products.map(product => product.id));
    setSelectedProductIds(current => current.filter(id => validIds.has(id)));
  }, [products]);

  const activeCount = useMemo(
    () => rewards.filter(reward => reward.status === 'active').length,
    [rewards]
  );

  const reset = (): void => {
    setTitle('');
    setDescription('');
    setCostPoints('100');
    setDiscountType('fixed');
    setDiscountValue('10.00');
    setVoucherValidityHours('168');
    setDurationDays('90');
    setSelectedProductIds([]);
  };

  const saveNewReward = async (
    status: 'draft' | 'active'
  ): Promise<void> => {
    if (!user || busyId) return;
    const parsedCost = positiveInteger(costPoints);
    const parsedDiscount = positiveDecimal(discountValue);
    const parsedValidity = positiveInteger(voucherValidityHours);
    const parsedDuration = positiveInteger(durationDays);

    if (!title.trim()) {
      setSuccess(false);
      setMessage('Informe um nome para a recompensa.');
      return;
    }
    if (parsedCost === null) {
      setSuccess(false);
      setMessage('O custo precisa ter ao menos 1 Ponto da Loja.');
      return;
    }
    if (
      parsedDiscount === null ||
      (discountType === 'percentage' && parsedDiscount >= 100)
    ) {
      setSuccess(false);
      setMessage(
        discountType === 'percentage'
          ? 'O desconto percentual precisa ser maior que zero e menor que 100%.'
          : 'Informe um valor de desconto maior que zero.'
      );
      return;
    }
    if (parsedValidity === null || parsedValidity > 2160) {
      setSuccess(false);
      setMessage('A validade do voucher precisa ficar entre 1 e 2160 horas.');
      return;
    }
    if (parsedDuration === null || parsedDuration > 365) {
      setSuccess(false);
      setMessage('A recompensa precisa ficar disponível entre 1 e 365 dias.');
      return;
    }
    if (selectedProductIds.length === 0) {
      setSuccess(false);
      setMessage('Escolha pelo menos um produto para o voucher.');
      return;
    }

    const now = new Date();
    const reward: StoreRewardDefinition = {
      schemaVersion: STORE_REWARD_SCHEMA_VERSION,
      id: createRewardId(),
      storeId: user.uid,
      title: title.trim(),
      description: description.trim(),
      costPoints: parsedCost,
      discountType,
      discountValue: parsedDiscount,
      productIds: [...new Set(selectedProductIds)],
      voucherValidityHours: parsedValidity,
      startsAt: now.toISOString(),
      endsAt: new Date(
        now.getTime() + parsedDuration * 24 * 60 * 60 * 1000
      ).toISOString(),
      status,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    setBusyId('new');
    setMessage('');
    setSuccess(false);
    try {
      await persistStoreReward(user, reward);
      setSuccess(true);
      setMessage(
        status === 'active'
          ? `Recompensa “${reward.title}” publicada.`
          : `Rascunho “${reward.title}” salvo.`
      );
      reset();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar a recompensa.'
      );
    } finally {
      setBusyId('');
    }
  };

  const changeStatus = async (
    reward: StoreRewardDefinition,
    status: StoreRewardStatus
  ): Promise<void> => {
    if (!user || busyId) return;
    setBusyId(reward.id);
    setMessage('');
    setSuccess(false);
    try {
      await persistStoreReward(user, {
        ...reward,
        status,
        updatedAt: new Date().toISOString(),
      });
      setSuccess(true);
      setMessage(
        `“${reward.title}” agora está ${statusLabel(status).toLowerCase()}.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível alterar a recompensa.'
      );
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4" id="store-reward-manager">
      <section className="rounded-3xl border border-emerald-500/20 bg-slate-900 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Gift className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <h4 className="text-sm font-black uppercase text-white">
                Criar recompensa
              </h4>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                O cliente troca Pontos da Loja por um voucher privado, válido
                somente para a conta que realizou o resgate.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase text-emerald-200">
            {activeCount} ativa{activeCount === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">Nome</span>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              disabled={Boolean(busyId)}
              placeholder="Ex: R$ 10 de desconto"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-45"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">Descrição opcional</span>
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              disabled={Boolean(busyId)}
              placeholder="Explique o benefício"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">Custo em pontos</span>
            <input
              type="number"
              min="1"
              step="1"
              value={costPoints}
              onChange={event => setCostPoints(event.target.value)}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">Tipo de benefício</span>
            <select
              value={discountType}
              onChange={event => {
                const next = event.target.value as StoreRewardDiscountType;
                setDiscountType(next);
                setDiscountValue(next === 'percentage' ? '10' : '10.00');
              }}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-45"
            >
              <option value="fixed">Desconto em R$</option>
              <option value="percentage">Desconto percentual</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">
              {discountType === 'percentage' ? 'Desconto (%)' : 'Desconto (R$)'}
            </span>
            <input
              type="number"
              min="0.01"
              step={discountType === 'percentage' ? '1' : '0.01'}
              value={discountValue}
              onChange={event => setDiscountValue(event.target.value)}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-45"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">Validade do voucher (h)</span>
            <input
              type="number"
              min="1"
              max="2160"
              step="1"
              value={voucherValidityHours}
              onChange={event => setVoucherValidityHours(event.target.value)}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-45"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block font-mono text-[9px] font-black uppercase text-slate-400">Disponível por (dias)</span>
            <input
              type="number"
              min="1"
              max="365"
              step="1"
              value={durationDays}
              onChange={event => setDurationDays(event.target.value)}
              disabled={Boolean(busyId)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-45"
            />
          </label>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <strong className="text-[10px] uppercase text-white">Produtos válidos</strong>
            <button
              type="button"
              disabled={Boolean(busyId) || products.length === 0}
              onClick={() =>
                setSelectedProductIds(current =>
                  current.length === products.length
                    ? []
                    : products.map(product => product.id)
                )
              }
              className="text-[8px] font-black uppercase text-emerald-300 disabled:opacity-40"
            >
              {selectedProductIds.length === products.length && products.length > 0
                ? 'Limpar'
                : 'Selecionar todos'}
            </button>
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {products.map(product => {
              const checked = selectedProductIds.includes(product.id);
              return (
                <label
                  key={product.id}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-800 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={Boolean(busyId)}
                    onChange={() =>
                      setSelectedProductIds(current =>
                        checked
                          ? current.filter(id => id !== product.id)
                          : [...current, product.id]
                      )
                    }
                    className="accent-emerald-500"
                  />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-300">
                    {product.name}
                  </span>
                  <span className="text-[9px] text-slate-600">
                    {money.format(product.price)}
                  </span>
                </label>
              );
            })}
            {products.length === 0 && (
              <p className="py-4 text-center text-xs text-slate-500">
                Publique produtos antes de criar uma recompensa.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void saveNewReward('draft')}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-40"
          >
            {busyId === 'new' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Salvar rascunho
          </button>
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void saveNewReward('active')}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 text-[9px] font-black uppercase text-emerald-200 disabled:opacity-40"
          >
            {busyId === 'new' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Publicar agora
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-xs font-black uppercase text-white">Recompensas da loja</h4>
          <span className="text-[9px] font-bold text-slate-500">
            {rewards.length} registrada{rewards.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="space-y-2">
          {rewards.map(reward => {
            const busy = busyId === reward.id;
            return (
              <article key={reward.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-xs text-white">{reward.title}</strong>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-black uppercase text-slate-400">
                        {statusLabel(reward.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-[9px] text-slate-500">
                      {reward.costPoints} pontos · {benefitLabel(reward)} · {reward.productIds.length} produto{reward.productIds.length === 1 ? '' : 's'}
                    </p>
                    {reward.description && (
                      <p className="mt-1 text-[9px] text-slate-600">{reward.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {reward.status === 'draft' && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(reward, 'active')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[8px] font-black uppercase text-emerald-200 disabled:opacity-40"
                      >
                        {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Publicar
                      </button>
                    )}
                    {reward.status === 'active' && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(reward, 'paused')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-[8px] font-black uppercase text-amber-200 disabled:opacity-40"
                      >
                        <CirclePause className="h-3 w-3" />
                        Pausar
                      </button>
                    )}
                    {reward.status === 'paused' && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(reward, 'active')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[8px] font-black uppercase text-emerald-200 disabled:opacity-40"
                      >
                        <Play className="h-3 w-3" />
                        Reativar
                      </button>
                    )}
                    {(reward.status === 'active' || reward.status === 'paused') && (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void changeStatus(reward, 'ended')}
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
          {rewards.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-800 px-4 py-7 text-center text-xs text-slate-500">
              Nenhuma recompensa criada ainda.
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
