import { useEffect, useMemo, useState } from 'react';
import { BadgePercent, Gift, Sparkles, Ticket } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  benefitMatchesBuyer,
  isPersonalizedBenefitAvailable,
  subscribeToPersonalizedBenefits,
  type PersonalizedBenefit,
} from '../../utils/personalizedBenefits';

type Props = { storeId: string };

const labelFor = (benefit: PersonalizedBenefit): string => {
  if (benefit.type === 'discount') return benefit.value > 0 ? `${benefit.value}% de desconto` : 'Desconto exclusivo';
  if (benefit.type === 'free_product') return benefit.productName || 'Produto grátis';
  return 'Benefício exclusivo';
};

const BenefitIcon = ({ type }: { type: PersonalizedBenefit['type'] }) => {
  if (type === 'discount') return <BadgePercent className="h-4 w-4" />;
  if (type === 'free_product') return <Gift className="h-4 w-4" />;
  return <Ticket className="h-4 w-4" />;
};

export function CustomerPersonalizedBenefitsSection({ storeId }: Props) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [benefits, setBenefits] = useState<PersonalizedBenefit[]>([]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!storeId || !user) {
      setBenefits([]);
      return;
    }
    return subscribeToPersonalizedBenefits(
      user.uid,
      storeId,
      setBenefits,
      error => console.warn('Relacionamento: benefícios personalizados indisponíveis.', error)
    );
  }, [storeId, user?.uid]);

  const visible = useMemo(() => {
    if (!user) return [];
    return benefits.filter(benefit =>
      benefitMatchesBuyer(benefit, user.uid, user.email ?? '') &&
      isPersonalizedBenefitAvailable(benefit)
    );
  }, [benefits, user]);

  if (visible.length === 0) return null;

  return (
    <section className="rounded-3xl border border-fuchsia-400/20 bg-fuchsia-400/5 p-4" id="customer-personalized-benefits">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-fuchsia-300"><Sparkles className="h-4 w-4" /><h4 className="text-xs font-black uppercase text-white">Exclusivos para você</h4></div>
          <p className="mt-1 text-[9px] text-slate-500">Benefícios privados que esta loja direcionou especificamente ao seu relacionamento.</p>
        </div>
        <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2 py-1 text-[8px] font-black text-fuchsia-300">{visible.length}</span>
      </div>
      <div className="mt-3 space-y-2">
        {visible.map(benefit => (
          <article key={benefit.id} className="rounded-2xl border border-fuchsia-400/15 bg-slate-950 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-400/10 text-fuchsia-300"><BenefitIcon type={benefit.type} /></div>
              <div className="min-w-0 flex-1">
                <strong className="block text-[10px] text-white">{benefit.title}</strong>
                <span className="mt-1 block text-[8px] font-black uppercase text-fuchsia-300">{labelFor(benefit)}</span>
                {benefit.description && <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{benefit.description}</p>}
                {benefit.code && <span className="mt-2 inline-block rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/5 px-2 py-1 font-mono text-[8px] font-black text-fuchsia-200">CÓDIGO: {benefit.code}</span>}
                {benefit.endsAt && <span className="mt-2 block text-[8px] text-slate-600">Válido até {new Intl.DateTimeFormat('pt-BR').format(new Date(`${benefit.endsAt}T12:00:00`))}</span>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
