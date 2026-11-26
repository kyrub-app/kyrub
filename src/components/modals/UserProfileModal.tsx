import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  ChartPie,
  Settings,
  LoaderCircle,
  RadioTower,
  Flag,
  Bookmark,
  CircleUserRound,
  ContactRound,
  X,
} from 'lucide-react';
import {
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { buildPublicDestinationPath } from '../../../shared/publicDestinationRoutes';
import { PersonalFinancePlanner } from '../PersonalFinancePlanner';
import { WalletMovementsPanel } from './WalletModal';
import { PitangaAccount } from '../tabs/PitangaAccount';
import { usePlatformChallenges } from '../../hooks/usePlatformChallenges';
import { PlatformChallengeSummary, PlatformChallengesPanel } from '../PlatformChallengesPanel';
import { KyrubCocarIcon } from '../icons/KyrubCocarIcon';
import { KyrubDevicesPanel } from '../KyrubDevicesPanel';
import { createSelection, resolveSavedPublication, setSavedPublicationSelections, subscribeSavedPublications, subscribeSelections, type ResolvedSavedPublication, type SavedPublication, type SavedSelection } from '../../utils/savedLibrary';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletHistory: any[];
  openSavedInitially?: boolean;
  profileName: string;
  setProfileName: React.Dispatch<React.SetStateAction<string>>;
  profileEmail: string;
  profilePhotoUrl: string;
  accountTypeCliente: boolean;
  setAccountTypeCliente: React.Dispatch<React.SetStateAction<boolean>>;
  accountTypeEntregador: boolean;
  setAccountTypeEntregador: React.Dispatch<React.SetStateAction<boolean>>;
  accountTypeLojista: boolean;
  setAccountTypeLojista: React.Dispatch<React.SetStateAction<boolean>>;
  isProfileVisible: boolean;
  setIsProfileVisible: React.Dispatch<React.SetStateAction<boolean>>;
  profileVisibilityReady: boolean;
  biometricsActive: boolean;
  setBiometricsActive: React.Dispatch<React.SetStateAction<boolean>>;
  transactionPin: string;
  setTransactionPin: React.Dispatch<React.SetStateAction<string>>;
  kycDocType: 'bike' | 'motorized' | 'lojista';
  setKycDocType: React.Dispatch<
    React.SetStateAction<'bike' | 'motorized' | 'lojista'>
  >;
  kycStatus: string;
  setKycStatus: React.Dispatch<
    React.SetStateAction<'Pendente' | 'Em Análise' | 'Verificado'>
  >;
  facialValidated: boolean;
  setFacialValidated: React.Dispatch<React.SetStateAction<boolean>>;
  isFacialScanning: boolean;
  setIsFacialScanning: React.Dispatch<React.SetStateAction<boolean>>;
  profileAddress: string;
  setProfileAddress: React.Dispatch<React.SetStateAction<string>>;
  profileWhatsApp: string;
  setProfileWhatsApp: React.Dispatch<React.SetStateAction<string>>;
  kycCpf: string;
  setKycCpf: React.Dispatch<React.SetStateAction<string>>;
  kycCnh: string;
  setKycCnh: React.Dispatch<React.SetStateAction<string>>;
  kycCnpj: string;
  setKycCnpj: React.Dispatch<React.SetStateAction<string>>;
  friends: Array<{ id: string; name: string; avatar?: string; role?: string; favorited?: boolean }>;
  connectionRequests: Array<{ id: string; name: string }>;
  onOpenCommunities: () => void;
  onOpenConnections: () => void;
  triggerToast: (
    msg: string,
    type: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

type PersonalPanel = 'movements' | 'finance' | 'xp' | 'devices' | 'challenges' | null;

const Avatar = ({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className: string;
}) => {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={className}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={`${className} flex items-center justify-center bg-slate-950 text-slate-500`}
      role="img"
      aria-label={`Foto de ${name || 'usuário'} não informada`}
    >
      <CircleUserRound className="h-1/2 w-1/2" />
    </div>
  );
};

export const UserProfileModal: React.FC<UserProfileModalProps> = props => {
  const {
    isOpen,
    onClose,
    profileName,
    profileEmail,
    profilePhotoUrl,
    isProfileVisible,
    setIsProfileVisible,
    profileVisibilityReady,
    walletHistory,
    openSavedInitially = false,
    triggerToast,
  } = props;
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [personalPanel, setPersonalPanel] = useState<PersonalPanel>(null);
  const [savedItems, setSavedItems] = useState<SavedPublication[]>([]);
  const [resolvedSavedItems, setResolvedSavedItems] = useState<ResolvedSavedPublication[]>([]);
  const [selections, setSelections] = useState<SavedSelection[]>([]);
  const [isSavedOpen, setIsSavedOpen] = useState(false);
  const [newSelectionName, setNewSelectionName] = useState('');
  const [isCreatingSelection, setIsCreatingSelection] = useState(false);
  const challengeCatalog = usePlatformChallenges(isOpen && !isSavedOpen);

  const currentUser = auth.currentUser;
  const currentUserId = currentUser?.uid ?? '';
  const displayName =
    profileName.trim() || currentUser?.displayName || profileEmail || 'Você';
  const displayAvatar = profilePhotoUrl || currentUser?.photoURL || '';
  const [identifierState,setIdentifierState] = useState<{uid:string;identifier:string|null;status:'loading'|'ready'|'error'}|null>(null);
  useEffect(()=>{
    if(!isOpen||!currentUserId){setIdentifierState(null);return;}
    const user=auth.currentUser;
    let controller:AbortController|null=null;
    let active=true;
    const load=async()=>{
      controller?.abort();
      const request=new AbortController();controller=request;
      const current=()=>active&&!request.signal.aborted&&auth.currentUser===user;
      setIdentifierState({uid:currentUserId,identifier:null,status:'loading'});
      try{
        if(!user||user.uid!==currentUserId)throw Error('AUTH_REQUIRED');
        const token=await user.getIdToken();
        if(!current())return;
        const res=await fetch('/api/health?transport=manage-public-social-address&kind=profile',{
          headers:{Authorization:'Bearer '+token},cache:'no-store',signal:request.signal});
        if(!res.ok)throw Error('UNAVAILABLE');
        const data=await res.json();
        if(data.identifier!==null&&(typeof data.identifier!=='string'||data.identifier.length<3||!buildPublicDestinationPath('profile',data.identifier)))throw Error('INVALID');
        if(current())setIdentifierState({uid:currentUserId,identifier:data.identifier,status:'ready'});
      }catch{if(current())setIdentifierState({uid:currentUserId,identifier:null,status:'error'});}
    };
    const refresh=(event:Event)=>{
      if((event as CustomEvent<{uid?:string}>).detail?.uid===currentUserId)void load();
    };
    window.addEventListener('kyrub:personal-identifier-reserved',refresh);
    void load();
    return()=>{active=false;controller?.abort();window.removeEventListener('kyrub:personal-identifier-reserved',refresh);};
  },[isOpen,currentUserId]);
  const personalIdentifier=identifierState?.uid===currentUserId?identifierState:null;


  const toggleProfileVisibility = async () => {
    const user = auth.currentUser;
    if (!user || !profileVisibilityReady || visibilityBusy) return;
    const nextVisibility = !isProfileVisible;
    setVisibilityBusy(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        isProfileVisible: nextVisibility,
        updatedAt: serverTimestamp(),
      });
      // The preference is only presented as saved after the cloud write.
      if (auth.currentUser?.uid === user.uid) {
        setIsProfileVisible(nextVisibility);
        triggerToast(
          nextVisibility ? 'Seu perfil está visível para descoberta.' : 'Seu perfil foi ocultado da descoberta.',
          'success'
        );
      }
    } catch (error) {
      console.error('Falha ao atualizar a visibilidade do perfil:', error);
      triggerToast('Não foi possível salvar a visibilidade. Tente novamente.', 'error');
    } finally {
      setVisibilityBusy(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setPersonalPanel(null);
    setIsSavedOpen(openSavedInitially);
  }, [isOpen, openSavedInitially]);

  const financeCards = [
    { id: 'movements', label: 'Movimentações', description: 'Saldo e operações quando disponíveis', icon: ArrowLeftRight },
    { id: 'finance', label: 'Controle financeiro', description: 'Planejamento manual pessoal', icon: ChartPie },
    { id: 'xp', label: 'Conquistas', description: 'XP, Pitangas e recompensas', icon: KyrubCocarIcon },
    { id: 'devices', label: 'Dispositivos', description: 'Smartphone, NFC e LoRa', icon: RadioTower },
    { id: 'challenges', label: 'Desafios da plataforma', description: 'Acompanhe missões e recompensas de XP e Pitangas', icon: Flag },
  ] as const;

  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;
    const unsubscribeSaved = subscribeSavedPublications(setSavedItems, error =>
      console.warn('Não foi possível carregar Salvos.', error)
    );
    const unsubscribeSelections = subscribeSelections(setSelections, error =>
      console.warn('Não foi possível carregar Seleções.', error)
    );
    return () => {
      unsubscribeSaved();
      unsubscribeSelections();
    };
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    Promise.all(savedItems.map(resolveSavedPublication))
      .then(items => { if (active) setResolvedSavedItems(items); })
      .catch(error => console.warn('Não foi possível resolver os Salvos.', error));
    return () => { active = false; };
  }, [savedItems]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-3 backdrop-blur-md animate-fade-in sm:p-4"
        id="modal-user-profile"
        data-kyrub-font-managed="true"
      >
        <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl animate-scale-up">
          <header className="flex items-center justify-between border-b border-slate-900 bg-slate-950/95 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
                Meu espaço
              </span>
              <h2 className="truncate text-base font-black text-white">
                {isSavedOpen ? 'Salvos' : 'Central Pessoal'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-500 hover:text-white"
              aria-label="Fechar meu perfil"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            {!isSavedOpen && (
              <>
            <section className="relative border-b border-slate-900 bg-gradient-to-b from-slate-900/90 to-slate-950 px-4 py-5 sm:px-5" id="personal-profile-identity">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="relative h-20 w-20 shrink-0 sm:h-24 sm:w-24">
                  <Avatar
                    src={displayAvatar}
                    name={displayName}
                    className="h-full w-full rounded-full border-2 border-orange-500 object-cover shadow-lg shadow-orange-500/10"
                  />
                  <button
                    id="personal-profile-settings-trigger"
                    type="button"
                    title="Editar perfil"
                    aria-label="Editar perfil"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(new Event('kyrub:open-unified-profile-editor'));
                    }}
                    className="absolute -bottom-3 -right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-orange-500/60 bg-slate-900 text-orange-300 shadow-lg transition-colors hover:bg-slate-800">
                      <Settings className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="max-w-full truncate text-lg font-black text-white">{displayName}</h3>
                  <button
                    id="personal-profile-visibility"
                    type="button"
                    title={profileVisibilityReady
                      ? (isProfileVisible ? 'Ocultar perfil da descoberta de usuários' : 'Mostrar perfil na descoberta de usuários')
                      : 'Carregando visibilidade do perfil'}
                    aria-label={profileVisibilityReady
                      ? (isProfileVisible ? 'Perfil visível na Praça. Toque para ocultar.' : 'Perfil reservado. Toque para tornar visível na Praça.')
                      : 'Carregando visibilidade do perfil'}
                    aria-pressed={isProfileVisible}
                    aria-describedby="personal-profile-visibility-help"
                    disabled={!profileVisibilityReady || visibilityBusy}
                    onClick={() => void toggleProfileVisibility()}
                    className={`inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 disabled:cursor-wait disabled:opacity-60 ${
                      isProfileVisible
                        ? 'border-teal-500/40 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20'
                        : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {visibilityBusy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    {visibilityBusy
                      ? 'Salvando…'
                      : profileVisibilityReady
                        ? (isProfileVisible ? 'Visível na Praça' : 'Perfil reservado')
                        : 'Consultando…'}
                  </button>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-mono text-slate-500">
                    {personalIdentifier?.status==='ready' ? personalIdentifier.identifier || 'Identificador ainda não definido' : personalIdentifier?.status==='error' ? 'Identificador não confirmado' : 'Consultando identificador…'}
                  </p>
                  <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
                    Seu centro pessoal é privado. Publicações acontecem na Praça e nas Comunidades.
                  </p>
                  <span id="personal-profile-visibility-help" className="sr-only">
                    Esta opção controla apenas a descoberta do perfil por outras pessoas. Não modifica publicações nem comunidades.
                  </span>
                </div>
              </div>
            </section>

            <section className="space-y-4 border-b border-slate-900 bg-slate-950 p-4 sm:p-5" id="profile-personal-center">
              <div>
                <h3 className="text-xs font-black text-white">Carteira Kairube</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  Planejamento, movimentações e evolução pessoal em um só lugar, com saldos separados.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5" aria-label="Áreas da Carteira Kairube">
                {financeCards.map(card => {
                  const Icon = card.icon;
                  return (
                    <button key={card.id} type="button" aria-pressed={personalPanel === card.id}
                      onClick={() => setPersonalPanel(current => current === card.id ? null : card.id)}
                      className={`min-w-0 rounded-2xl border p-3 text-left transition-colors ${card.id === 'challenges' ? 'col-span-2' : ''} ${
                        personalPanel === card.id
                          ? 'border-orange-500/60 bg-orange-500/10'
                          : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                      }`}>
                      <Icon className="h-5 w-5 text-orange-300" aria-hidden="true" />
                      <strong className="mt-2 block text-xs font-bold text-slate-100">{card.label}</strong>
                      <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">{card.description}</span>
                      {card.id === 'challenges' && <PlatformChallengeSummary catalog={challengeCatalog.catalog} loading={challengeCatalog.loading} error={challengeCatalog.error} />}
                    </button>
                  );
                })}
              </div>
              <a href="/?app=1&cardDraft=1" className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"><ContactRound className="h-5 w-5 shrink-0 text-orange-300" aria-hidden="true"/><span>Meu cartão de identificação digital</span></a>
              {personalPanel && (
                <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3 sm:p-4" id="personal-center-active-panel">
                  <h4 className="mb-2 text-base font-black text-white">
                    {financeCards.find(card => card.id === personalPanel)?.label}
                  </h4>
                  {personalPanel === 'movements' && <WalletMovementsPanel walletHistory={walletHistory} />}
                  {personalPanel === 'finance' && <PersonalFinancePlanner userId={currentUserId} />}
                  {personalPanel === 'xp' && <PitangaAccount mode="xp" />}
                  {personalPanel === 'devices' && <KyrubDevicesPanel userId={currentUserId} key={currentUserId} />}
                  {personalPanel === 'challenges' && <PlatformChallengesPanel catalog={challengeCatalog.catalog}
                    loading={challengeCatalog.loading} error={challengeCatalog.error} onRetry={challengeCatalog.retry} />}
                </div>
              )}
            </section>

              </>
            )}

            {isSavedOpen && (
              <section className="space-y-4 border-b border-slate-900 bg-slate-900/45 p-4 sm:p-5" id="profile-saved-library">
                <button type="button" onClick={() => setIsSavedOpen(false)}
                  className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-slate-200">
                  Voltar à Central Pessoal
                </button>
                <div>
                  <h3 className="text-xs font-black uppercase text-slate-100">Salvos</h3>
                  <p className="mt-1 text-[9px] text-slate-500">Biblioteca privada de publicações guardadas na Praça e nas Comunidades.</p>
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={async event => {
                    event.preventDefault();
                    if (!newSelectionName.trim() || isCreatingSelection) return;
                    setIsCreatingSelection(true);
                    try {
                      await createSelection(newSelectionName);
                      setNewSelectionName('');
                      triggerToast('Seleção criada.', 'success');
                    } catch (error) {
                      console.warn('Falha ao criar Seleção.', error);
                      triggerToast('Não foi possível criar a Seleção.', 'error');
                    } finally {
                      setIsCreatingSelection(false);
                    }
                  }}
                >
                  <input value={newSelectionName} onChange={event => setNewSelectionName(event.target.value)} maxLength={80} placeholder="Nova Seleção..." className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500/50" />
                  <button type="submit" disabled={!newSelectionName.trim() || isCreatingSelection} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[9px] font-black uppercase text-amber-300 disabled:opacity-40">Criar</button>
                </form>
                {selections.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selections.map(selection => <span key={selection.id} className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-[9px] text-slate-300">{selection.name}</span>)}
                  </div>
                )}
                {savedItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-[10px] text-slate-500">Quando você salvar uma publicação, ela aparecerá aqui.</div>
                ) : (
                  <div className="space-y-2">
                    {resolvedSavedItems.map(item => (
                      <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[9px] font-black uppercase text-amber-300">{item.sourceKind === 'community' ? 'Comunidade' : 'Praça'}</span>
                          <span className="text-[8px] text-slate-600">{item.selectionIds.length ? `${item.selectionIds.length} Seleções` : 'Sem Seleção'}</span>
                        </div>
                        {item.available ? (
                          <>
                            <strong className="mt-2 block text-[10px] text-slate-200">{item.authorName}</strong>
                            <p className="mt-1 whitespace-pre-line text-[10px] leading-relaxed text-slate-400">{item.content || (item.mediaUrls.length ? 'Publicação com mídia' : 'Publicação')}</p>
                          </>
                        ) : (
                          <p className="mt-2 text-[10px] text-slate-600">Esta publicação não está mais disponível.</p>
                        )}
                        {selections.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-900 pt-3">
                            {selections.map(selection => {
                              const selected = item.selectionIds.includes(selection.id);
                              return (
                                <button
                                  key={selection.id}
                                  type="button"
                                  onClick={async () => {
                                    const next = selected
                                      ? item.selectionIds.filter(id => id !== selection.id)
                                      : [...item.selectionIds, selection.id];
                                    try {
                                      await setSavedPublicationSelections(item, next);
                                    } catch (error) {
                                      console.warn('Falha ao organizar Seleção.', error);
                                      triggerToast('Não foi possível atualizar a Seleção.', 'error');
                                    }
                                  }}
                                  className={`rounded-full border px-2.5 py-1 text-[8px] ${selected ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-slate-800 text-slate-500'}`}
                                >
                                  {selection.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

          </div>
        </div>
      </div>

    </>
  );
};
