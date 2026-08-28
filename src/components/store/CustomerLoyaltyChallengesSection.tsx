import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Target } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  isLoyaltyChallengeAvailable,
  subscribeToLoyaltyChallenges,
  type LoyaltyChallenge,
} from '../../utils/loyaltyChallenges';
import {
  subscribeToStoreLoyaltyLedger,
  type LoyaltyLedgerEvent,
} from '../../utils/loyaltyLedger';

type Props = {
  storeId: string;
};

const normalizedEmail = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const matchesBuyer = (event: LoyaltyLedgerEvent, user: User): boolean =>
  event.buyerId === user.uid ||
  (!!user.email && normalizedEmail(event.buyerEmail) === normalizedEmail(user.email));

const inWindow = (createdAt: string, challenge: LoyaltyChallenge): boolean => {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const start = challenge.startsAt ? new Date(`${challenge.startsAt}T00:00:00`).getTime() : 0;
  const end = challenge.endsAt ? new Date(`${challenge.endsAt}T23:59:59.999`).getTime() : 0;
  if (start && timestamp < start) return false;
  if (end && timestamp > end) return false;
  return true;
};

const progressFor = (
  challenge: LoyaltyChallenge,
  ledger: LoyaltyLedgerEvent[],
  user: User
): number => {
  const earned = ledger.filter(event =>
    matchesBuyer(event, user) &&
    event.type === 'earn' &&
    inWindow(event.createdAt, challenge)
  );

  if (challenge.metric === 'paid_orders') {
    return new Set(earned.map(event => event.orderId).filter(Boolean)).size;
  }

  return earned.reduce(
    (sum, event) => sum + Math.max(0, event.points),
    0
  );
};

export function CustomerLoyaltyChallengesSection({ storeId }: Props) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [challenges, setChallenges] = useState<LoyaltyChallenge[]>([]);
  const [ledger, setLedger] = useState<LoyaltyLedgerEvent[]>([]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!storeId) {
      setChallenges([]);
      setLedger([]);
      return;
    }
    const unsubscribeChallenges = subscribeToLoyaltyChallenges(
      storeId,
      setChallenges,
      () => setChallenges([])
    );
    const unsubscribeLedger = subscribeToStoreLoyaltyLedger(
      storeId,
      setLedger,
      () => setLedger([])
    );
    return () => {
      unsubscribeChallenges();
      unsubscribeLedger();
    };
  }, [storeId]);

  const visible = useMemo(
    () => challenges.filter(challenge => isLoyaltyChallengeAvailable(challenge)),
    [challenges]
  );

  const calculated = useMemo(() => {
    if (!user) return [];
    return visible.map(challenge => {
      const value = progressFor(challenge, ledger, user);
      const capped = Math.min(value, challenge.target);
      return {
        challenge,
        value,
        capped,
        percent: Math.min(100, Math.round((capped / Math.max(1, challenge.target)) * 100)),
        completed: value >= challenge.target,
      };
    });
  }, [ledger, user, visible]);

  return (
    <section className="rounded-3xl border border-teal-400/20 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-teal-300">
            <Target className="h-4 w-4" />
            <h4 className="text-xs font-black uppercase text-white">Desafios</h4>
          </div>
          <p className="mt-1 text-[9px] text-slate-500">
            Metas reais desta loja, atualizadas pelas suas compras e pontos.
          </p>
        </div>
        <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-1 text-[8px] font-black text-teal-300">
          {calculated.length} ativo(s)
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {calculated.length > 0 ? calculated.map(({ challenge, capped, percent, completed }) => (
          <article key={challenge.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block text-[10px] text-white">{challenge.title}</strong>
                {challenge.description && (
                  <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">
                    {challenge.description}
                  </span>
                )}
              </div>
              {completed && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[7px] font-black uppercase text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> concluído
                </span>
              )}
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-teal-400" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[8px] text-slate-500">
              <span>
                {capped}/{challenge.target} {challenge.metric === 'paid_orders' ? 'compras' : 'pontos'}
              </span>
              {challenge.rewardPoints > 0 && (
                <strong className="text-amber-300">+{challenge.rewardPoints} pts ao concluir</strong>
              )}
            </div>
          </article>
        )) : (
          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-3 py-5 text-center text-[10px] text-slate-500">
            Esta loja não tem desafios ativos agora.
          </p>
        )}
      </div>
    </section>
  );
}
