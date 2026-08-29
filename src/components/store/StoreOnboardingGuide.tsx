import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, CircleAlert, Sparkles } from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  clearStoreOnboardingDraft,
  createStoreOnboardingDraft,
  getStoreOnboardingProgress,
  loadStoreOnboardingDraft,
  saveStoreOnboardingDraft,
  shouldOfferStoreOnboarding,
  type StoreOnboardingField,
  type StoreOnboardingProfile,
} from '../../utils/smartStoreOnboarding';
import { loadCachedStoreOperationalSettings } from '../../utils/storeOperationalSettings';
import {
  buildStoreActivationPlan,
  getStoreActivationWarnings,
} from '../../utils/storeActivationPlan';

interface StoreOnboardingGuideProps {
  profile: StoreOnboardingProfile;
}

const FIELD_SELECTORS: Record<StoreOnboardingField, string> = {
  name: '[data-store-profile-field="name"]',
  description: '[data-store-profile-field="description"]',
  address: '[data-store-profile-field="address"]',
  coordinates: '[data-store-profile-field="latitude"]',
  contact: '[data-store-profile-field="contact"]',
  keywords: '[data-store-profile-field="keywords"]',
};

const CHANNEL_LABELS: Record<string, string> = {
  'open-delivery': 'Open Delivery',
  sefaz: 'SEFAZ',
  ifood: 'iFood',
  '99food': '99Food',
  'mercado-livre': 'Mercado Livre',
  shopee: 'Shopee',
};

const focusProfileField = (field: StoreOnboardingField): void => {
  const target = document.querySelector<HTMLElement>(FIELD_SELECTORS[field]);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => target?.focus(), 250);
};

export const StoreOnboardingGuide: React.FC<StoreOnboardingGuideProps> = ({
  profile,
}) => {
  const progress = useMemo(() => getStoreOnboardingProgress(profile), [profile]);
  const [expanded, setExpanded] = useState(false);
  const [showActivationReview, setShowActivationReview] = useState(false);
  const userId = auth.currentUser?.uid ?? '';

  const activationPlan = useMemo(() => {
    if (!userId) return null;
    return buildStoreActivationPlan(
      loadCachedStoreOperationalSettings(localStorage, userId).integrations
    );
  }, [userId, showActivationReview]);

  const activationWarnings = useMemo(
    () => activationPlan ? getStoreActivationWarnings(activationPlan) : [],
    [activationPlan]
  );

  useEffect(() => {
    if (!userId) return;
    const draft = loadStoreOnboardingDraft(localStorage, userId);
    if (draft?.lastField && shouldOfferStoreOnboarding(profile)) setExpanded(true);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    if (!shouldOfferStoreOnboarding(profile)) clearStoreOnboardingDraft(localStorage, userId);
  }, [profile, userId]);

  if (!shouldOfferStoreOnboarding(profile)) return null;

  const continueWith = (field: StoreOnboardingField): void => {
    if (userId) {
      saveStoreOnboardingDraft(
        localStorage,
        userId,
        createStoreOnboardingDraft(field)
      );
    }
    setExpanded(true);
    focusProfileField(field);
  };

  return (
    <section id="store-smart-onboarding" className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-orange-300">
            <Sparkles className="h-4 w-4" />
            Completar loja
          </span>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            A Kyrub aproveita o que já está preenchido e mostra somente o que falta. Você pode sair e continuar depois.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[9px] font-black text-slate-300">{progress.percent}%</span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progress.percent}%` }} />
      </div>

      {!expanded ? (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            if (progress.nextField) continueWith(progress.nextField);
          }}
          className="flex min-h-10 w-full items-center justify-between rounded-xl border border-orange-500/20 bg-slate-950/70 px-3 text-left text-[10px] font-black uppercase text-orange-200 hover:border-orange-500/40"
        >
          Continuar configuração
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {progress.steps.map(step => (
            <button
              key={step.id}
              type="button"
              disabled={step.complete}
              onClick={() => continueWith(step.id)}
              className={`flex min-h-10 items-center justify-between rounded-xl border px-3 text-left text-[10px] font-bold transition ${step.complete ? 'cursor-default border-emerald-500/15 bg-emerald-500/5 text-emerald-300' : 'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-orange-500/30 hover:text-white'}`}
            >
              <span>{step.label}{step.required && !step.complete ? ' · necessário' : ''}</span>
              {step.complete ? <Check className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}

      {progress.readyForReview && (
        <div className="space-y-2 rounded-xl border border-teal-500/20 bg-teal-500/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] font-bold uppercase tracking-wide text-teal-300">Dados mínimos prontos. Revise a ativação antes de publicar.</p>
            <button
              type="button"
              onClick={() => setShowActivationReview(current => !current)}
              className="shrink-0 rounded-lg border border-teal-500/20 bg-slate-950 px-2.5 py-1.5 text-[9px] font-black uppercase text-teal-200"
            >
              {showActivationReview ? 'Ocultar revisão' : 'Revisar ativação'}
            </button>
          </div>

          {showActivationReview && activationPlan && (
            <div id="store-activation-review" className="space-y-2 text-[10px] text-slate-300">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                  <span className="block text-[8px] font-black uppercase text-slate-500">Origem do catálogo salva</span>
                  <strong className="mt-1 block text-slate-200">{activationPlan.catalogOrigin === 'integration' ? 'Integração externa' : 'Kyrub'}</strong>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                  <span className="block text-[8px] font-black uppercase text-slate-500">Canais configurados</span>
                  <strong className="mt-1 block text-slate-200">
                    {activationPlan.configuredChannelIds.length > 0 ? activationPlan.configuredChannelIds.map(id => CHANNEL_LABELS[id] ?? id).join(', ') : 'Nenhum canal externo'}
                  </strong>
                </div>
              </div>

              <p className="text-[9px] leading-relaxed text-slate-500">Esta revisão usa o último plano operacional salvo. Alterações ainda não salvas nas integrações só entram aqui depois de salvar.</p>

              {activationWarnings.map(warning => (
                <div key={warning} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-amber-200">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
