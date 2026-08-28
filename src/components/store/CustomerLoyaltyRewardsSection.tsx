import { useEffect, useMemo, useState } from 'react';
import { Gift, LockKeyhole, Sparkles } from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  getBuyerLoyaltyBalance,
  subscribeToStoreLoyaltyLedger,
  type LoyaltyLedgerEvent,
} from '../../utils/loyaltyLedger';
import {
  isLoyaltyRewardAvailable,
  redeemLoyaltyReward,
  subscribeToLoyaltyRewards,
  type LoyaltyReward,
} from '../../utils/loyaltyRewards';

type Props = {
  storeId: string;
};

const rewardLabel = (reward: LoyaltyReward): string => {
  if (reward.type === 'free_product') return reward.productName || 'Produto grátis';
  if (reward.type === 'discount') return reward.benefitValue > 0 ? `${reward.benefitValue}% de desconto` : 'Desconto';
  return 'Voucher / benefício';
};

export function CustomerLoyaltyRewardsSection({ storeId }: Props) {
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [events, setEvents] = useState<LoyaltyLedgerEvent[]>([]);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const user = auth.currentUser;

  useEffect(() => {
    if (!storeId) {
      setRewards([]);
      setEvents([]);
      return;
    }
    const unsubscribeRewards = subscribeToLoyaltyRewards(
      storeId,
      setRewards,
      error => console.warn('Relacionamento: recompensas indisponíveis.', error)
    );
    const unsubscribeLedger = subscribeToStoreLoyaltyLedger(
      storeId,
      setEvents,
      error => console.warn('Relacionamento: ledger indisponível para recompensas.', error)
    );
    return () => {
      unsubscribeRewards();
      unsubscribeLedger();
    };
  }, [storeId]);

  const balance = useMemo(
    () => user ? getBuyerLoyaltyBalance(events, user.uid, user.email ?? '') : 0,
    [events, user?.uid, user?.email]
  );
  const availableRewards = useMemo(
    () => rewards.filter(reward => isLoyaltyRewardAvailable(reward)),
    [rewards]
  );

  const redeem = async (reward: LoyaltyReward) => {
    const currentUser = auth.currentUser;
    if (!currentUser || busyId) return;
    setBusyId(reward.id);
    setMessage('');
    try {
      const result = await redeemLoyaltyReward(currentUser, reward, events);
      setMessage(result.created
        ? `${reward.title} resgatada. ${reward.pointsCost} pontos foram utilizados.`
        : 'Esta recompensa já foi resgatada por você.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível resgatar a recompensa.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="rounded-3xl border border-violet-400/20 bg-slate-900 p-4" id="customer-loyalty-rewards">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-violet-300">
            <Gift className="h-4 w-4" />
            <h4 className="text-xs font-black uppercase text-white">Recompensas</h4>
          </div>
          <p className="mt-1 text-[9px] text-slate-500">
            Troque os pontos conquistados nesta loja por benefícios reais.
          </p>
        </div>
        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[8px] font-black text-amber-300">
          {balance} pts
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {availableRewards.map(reward => {
          const canRedeem = balance >= reward.pointsCost;
          return (
            <article key={reward.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-[10px] text-white">{reward.title}</strong>
                  <span className="mt-1 block text-[8px] font-black uppercase text-violet-300">
                    {rewardLabel(reward)}
                  </span>
                  {reward.description && (
                    <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{reward.description}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[8px] font-black text-amber-300">
                  {reward.pointsCost} pts
                </span>
              </div>
              <button
                type="button"
                disabled={!user || !canRedeem || busyId === reward.id}
                onClick={() => void redeem(reward)}
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[8px] font-black uppercase ${canRedeem ? 'bg-violet-400 text-slate-950' : 'border border-slate-800 bg-slate-900 text-slate-600'} disabled:opacity-50`}
              >
                {canRedeem ? <Sparkles className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
                {busyId === reward.id ? 'Resgatando…' : canRedeem ? 'Resgatar recompensa' : `Faltam ${reward.pointsCost - balance} pts`}
              </button>
            </article>
          );
        })}
        {availableRewards.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-3 py-5 text-center text-[10px] text-slate-500">
            Nenhuma recompensa disponível agora.
          </p>
        )}
      </div>

      {message && (
        <p className="mt-3 rounded-xl border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-[9px] font-bold text-violet-200">
          {message}
        </p>
      )}
    </section>
  );
}
