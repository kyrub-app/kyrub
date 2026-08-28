import { BadgePercent, Sparkles } from 'lucide-react';
import { CustomerLoyaltyChallengesSection } from './CustomerLoyaltyChallengesSection';
import { CustomerLoyaltyRewardsSection } from './CustomerLoyaltyRewardsSection';
import { CustomerPersonalizedBenefitsSection } from './CustomerPersonalizedBenefitsSection';
import { CustomerRelationshipNotificationPreference } from './CustomerRelationshipNotificationPreference';

export function CustomerPersonalBenefitsGroup({ storeId }: { storeId: string }) {
  return (
    <section className="space-y-3" aria-labelledby="customer-personal-benefits-title">
      <div className="rounded-3xl border border-violet-400/20 bg-violet-400/5 p-4">
        <div className="flex items-center gap-2 text-violet-300">
          <Sparkles className="h-4 w-4" />
          <span className="text-[9px] font-black uppercase tracking-[.16em]">Para você</span>
        </div>
        <h4 id="customer-personal-benefits-title" className="mt-1 text-sm font-black text-white">
          Benefícios do seu relacionamento
        </h4>
        <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
          Esta área depende do seu histórico, saldo, progresso e benefícios direcionados pela loja. Não é a mesma coisa que uma promoção pública da vitrine.
        </p>
      </div>
      <CustomerRelationshipNotificationPreference storeId={storeId} />
      <CustomerPersonalizedBenefitsSection storeId={storeId} />
      <CustomerLoyaltyChallengesSection storeId={storeId} />
      <CustomerLoyaltyRewardsSection storeId={storeId} />
    </section>
  );
}

export function CustomerPublicPromotionsGroupHeader() {
  return (
    <div className="rounded-3xl border border-orange-400/20 bg-orange-400/5 p-4" aria-labelledby="customer-public-promotions-title">
      <div className="flex items-center gap-2 text-orange-300">
        <BadgePercent className="h-4 w-4" />
        <span className="text-[9px] font-black uppercase tracking-[.16em]">Em promoção</span>
      </div>
      <h4 id="customer-public-promotions-title" className="mt-1 text-sm font-black text-white">
        Ofertas públicas da loja
      </h4>
      <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
        Cupons e preços promocionais publicados para a vitrine. Eles podem ser vistos por qualquer cliente elegível da loja.
      </p>
    </div>
  );
}
