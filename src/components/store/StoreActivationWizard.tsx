import { useMemo, useState } from 'react';
import { Building2, Globe2, MapPin, Store, Tags } from 'lucide-react';
import type { Store as StoreType } from '../../types';
import { auth } from '../../utils/firebase';
import {
  buildConfiguredStore,
  loadCachedUserStore,
  persistPrivateUserStore,
  saveCachedUserStore,
  setStoreMarketplacePublication,
} from '../../utils/storePersistence';
import {
  GuidedWizard,
  type GuidedWizardStep,
} from '../wizard/GuidedWizard';

interface StoreActivationWizardProps {
  open: boolean;
  onClose: () => void;
  onActivated: (store: StoreType, published: boolean) => void;
}

type Draft = {
  name: string;
  description: string;
  keywords: string;
  address: string;
  contact: string;
  publishNow: boolean;
};

const STEPS: GuidedWizardStep[] = [
  {
    id: 'identity',
    label: 'Identidade',
    title: 'Como sua loja vai se apresentar?',
    prompt: 'Me diga o nome da loja e uma descrição curta. Isso será usado para identificar o negócio dentro do Kyrub.',
  },
  {
    id: 'segment',
    label: 'Segmento',
    title: 'O que as pessoas encontram na sua loja?',
    prompt: 'Informe palavras-chave do seu negócio. Elas ajudam a organizar o catálogo e também melhoram a descoberta da sua vitrine.',
  },
  {
    id: 'contact',
    label: 'Localização e contato',
    title: 'Como o cliente encontra você?',
    prompt: 'Agora preciso do endereço e de um contato comercial. Você poderá editar tudo isso depois nas configurações.',
  },
  {
    id: 'publication',
    label: 'Publicação',
    title: 'Quer aparecer nas Ofertas agora?',
    prompt: 'Ativar a loja cria seu espaço de gestão. Publicar também disponibiliza a vitrine no marketplace. Você pode deixar a publicação para depois.',
  },
  {
    id: 'review',
    label: 'Revisão',
    title: 'Confere tudo antes de ativar?',
    prompt: 'Revise os dados. Quando confirmar, eu salvo a loja no seu perfil e preparo seu espaço de gestão.',
  },
];

const inputClass =
  'w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-500/60';

export function StoreActivationWizard({
  open,
  onClose,
  onActivated,
}: StoreActivationWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>({
    name: '',
    description: '',
    keywords: '',
    address: '',
    contact: '',
    publishNow: false,
  });

  const keywordList = useMemo(
    () => draft.keywords
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 30),
    [draft.keywords]
  );

  const canContinue = useMemo(() => {
    switch (STEPS[stepIndex]?.id) {
      case 'identity':
        return draft.name.trim().length >= 2 && draft.description.trim().length >= 8;
      case 'segment':
        return keywordList.length > 0;
      case 'contact':
        return draft.address.trim().length >= 4 && draft.contact.trim().length >= 4;
      default:
        return true;
    }
  }, [draft, keywordList.length, stepIndex]);

  const close = () => {
    if (busy) return;
    setStepIndex(0);
    setError('');
    onClose();
  };

  const activate = async () => {
    const user = auth.currentUser;
    if (!user) {
      setError('Faça login novamente para ativar sua loja.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const current = loadCachedUserStore(
        localStorage,
        user.uid,
        user.email ?? ''
      );
      const nextStore = buildConfiguredStore(current, user, {
        name: draft.name,
        description: draft.description,
        address: draft.address,
        contact: draft.contact,
        keywords: keywordList,
      });

      saveCachedUserStore(localStorage, user.uid, nextStore, true);
      await persistPrivateUserStore(user, nextStore);
      saveCachedUserStore(localStorage, user.uid, nextStore, false);

      if (draft.publishNow) {
        await setStoreMarketplacePublication(user, nextStore, true);
      }

      onActivated(nextStore, draft.publishNow);
      setStepIndex(0);
      setDraft({
        name: '',
        description: '',
        keywords: '',
        address: '',
        contact: '',
        publishNow: false,
      });
    } catch (activationError) {
      console.error('Falha ao ativar loja pelo wizard:', activationError);
      setError(
        activationError instanceof Error
          ? activationError.message
          : 'Não foi possível ativar a loja agora.'
      );
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    if (!canContinue || busy) return;
    if (stepIndex < STEPS.length - 1) {
      setError('');
      setStepIndex(current => current + 1);
      return;
    }
    void activate();
  };

  const currentStep = STEPS[stepIndex]?.id;

  return (
    <GuidedWizard
      open={open}
      title="Ativar sua loja"
      steps={STEPS}
      activeIndex={stepIndex}
      canGoNext={canContinue}
      busy={busy}
      finishLabel={draft.publishNow ? 'Ativar e publicar' : 'Ativar loja'}
      error={error}
      onBack={() => setStepIndex(current => Math.max(0, current - 1))}
      onNext={advance}
      onClose={close}
    >
      {currentStep === 'identity' && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400"><Store className="h-4 w-4" /> Nome da loja</span>
            <input
              value={draft.name}
              onChange={event => setDraft(value => ({ ...value, name: event.target.value }))}
              className={inputClass}
              placeholder="Ex.: City Chopperia"
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400"><Building2 className="h-4 w-4" /> Descrição</span>
            <textarea
              value={draft.description}
              onChange={event => setDraft(value => ({ ...value, description: event.target.value }))}
              className={`${inputClass} min-h-28 resize-none`}
              placeholder="Conte em poucas palavras o que seu negócio oferece."
            />
          </label>
        </div>
      )}

      {currentStep === 'segment' && (
        <label className="block space-y-2">
          <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400"><Tags className="h-4 w-4" /> Palavras-chave</span>
          <textarea
            value={draft.keywords}
            onChange={event => setDraft(value => ({ ...value, keywords: event.target.value }))}
            className={`${inputClass} min-h-28 resize-none`}
            placeholder="hambúrguer, choperia, porções, delivery"
            autoFocus
          />
          <p className="text-xs text-slate-500">Separe por vírgulas. {keywordList.length} palavra(s) reconhecida(s).</p>
        </label>
      )}

      {currentStep === 'contact' && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400"><MapPin className="h-4 w-4" /> Endereço</span>
            <input
              value={draft.address}
              onChange={event => setDraft(value => ({ ...value, address: event.target.value }))}
              className={inputClass}
              placeholder="Rua, número, bairro, cidade"
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-black uppercase text-slate-400">Contato comercial</span>
            <input
              value={draft.contact}
              onChange={event => setDraft(value => ({ ...value, contact: event.target.value }))}
              className={inputClass}
              placeholder="WhatsApp, telefone ou outro contato"
            />
          </label>
        </div>
      )}

      {currentStep === 'publication' && (
        <button
          type="button"
          onClick={() => setDraft(value => ({ ...value, publishNow: !value.publishNow }))}
          className={`w-full rounded-3xl border p-4 text-left transition-colors ${draft.publishNow ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-slate-800 bg-slate-900'}`}
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${draft.publishNow ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-slate-500'}`}>
              <Globe2 className="h-5 w-5" />
            </div>
            <div>
              <strong className="block text-sm text-white">Publicar nas Ofertas agora</strong>
              <span className="mt-1 block text-xs leading-relaxed text-slate-400">{draft.publishNow ? 'Sua vitrine será publicada ao concluir.' : 'Sua loja será ativada, mas continuará fora do marketplace até você publicar.'}</span>
            </div>
          </div>
        </button>
      )}

      {currentStep === 'review' && (
        <div className="space-y-3">
          {[
            ['Loja', draft.name],
            ['Descrição', draft.description],
            ['Segmento', keywordList.join(' · ')],
            ['Endereço', draft.address],
            ['Contato', draft.contact],
            ['Marketplace', draft.publishNow ? 'Publicar agora' : 'Publicar depois'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
              <span className="block text-[9px] font-black uppercase text-slate-500">{label}</span>
              <strong className="mt-1 block text-sm leading-relaxed text-slate-200">{value}</strong>
            </div>
          ))}
        </div>
      )}
    </GuidedWizard>
  );
}
