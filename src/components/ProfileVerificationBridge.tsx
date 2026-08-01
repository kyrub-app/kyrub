import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck,
  Bike,
  BriefcaseBusiness,
  Camera,
  Check,
  CircleAlert,
  FileBadge,
  Fingerprint,
  IdCard,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Send,
  ShieldCheck,
  Store,
  Upload,
  UserRoundCheck,
  X,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../utils/firebase';
import {
  IDENTITY_CONSENT_VERSION,
  IDENTITY_VERIFICATION_COLLECTION,
  IDENTITY_VERIFICATION_OPEN_EVENT,
  emptyIdentityVerification,
  formatCpf,
  isValidCpf,
  mapIdentityVerification,
  verificationRequirements,
  workEligibility,
  type IdentityDocumentType,
  type IdentityVerificationRecord,
  type VerificationProfile,
  type WorkAction,
} from '../utils/identityVerification';

type Tab = 'conta' | 'dados' | 'seguranca' | 'documentos' | 'validacao';
type ToastType = 'success' | 'error' | 'info' | 'warning';

const PROFILE_OPTIONS: Array<{
  id: VerificationProfile;
  label: string;
  icon: typeof Store;
}> = [
  { id: 'requester', label: 'Contratante', icon: Store },
  { id: 'freelancer', label: 'Freelancer', icon: BriefcaseBusiness },
  { id: 'bicycle_courier', label: 'Entregador bike', icon: Bike },
  { id: 'motorized_courier', label: 'Entregador motorizado', icon: IdCard },
];

const TABS: Array<{ id: Tab; label: string; icon: typeof ShieldCheck }> = [
  { id: 'conta', label: 'Conta', icon: UserRoundCheck },
  { id: 'dados', label: 'Dados', icon: IdCard },
  { id: 'seguranca', label: 'Segurança', icon: LockKeyhole },
  { id: 'documentos', label: 'Documentos', icon: FileBadge },
  { id: 'validacao', label: 'Validação', icon: Camera },
];

const safeFileName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(-100);

const actionFromEvent = (event: Event): WorkAction | null => {
  if (event.type === 'submit') {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (form?.closest('#modal-solicitar-freela')) return 'request_freelance';
    if (form?.closest('#modal-solicitar-entrega')) return 'request_delivery';
    return null;
  }

  const button = event.target instanceof Element
    ? event.target.closest('button')
    : null;
  if (!(button instanceof HTMLButtonElement)) return null;
  const label = button.textContent?.trim().toLocaleLowerCase('pt-BR') ?? '';

  if (
    button.closest('#modal-fazer-freelas')
    && /candidatar|candidatura|aceitar freela|assumir/.test(label)
  ) {
    return 'apply_freelance';
  }
  if (
    button.closest('#modal-fazer-entregas')
    && /aceitar|assumir|iniciar entrega/.test(label)
  ) {
    return 'accept_delivery';
  }
  return null;
};

const statusLabel = (status: IdentityVerificationRecord['status']): string => {
  if (status === 'approved') return 'Aprovado';
  if (status === 'under_review') return 'Em análise';
  if (status === 'submitted') return 'Enviado';
  if (status === 'rejected') return 'Correção necessária';
  return 'Pendente';
};

const inputClass =
  'w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-teal-500/60';

export function ProfileVerificationBridge() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('conta');
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [record, setRecord] = useState<IdentityVerificationRecord | null>(null);
  const [draft, setDraft] = useState<IdentityVerificationRecord | null>(null);
  const [profileVisible, setProfileVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'document' | 'selfie' | null>(null);
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [pinConfigured, setPinConfigured] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => onAuthStateChanged(auth, nextUser => {
    setUser(nextUser);
    if (!nextUser) {
      setOpen(false);
      setRecord(null);
      setDraft(null);
    }
  }), []);

  useEffect(() => {
    if (!user) return;
    const unsubscribeVerification = onSnapshot(
      doc(db, IDENTITY_VERIFICATION_COLLECTION, user.uid),
      snapshot => {
        const next = snapshot.exists()
          ? mapIdentityVerification(
              user.uid,
              snapshot.data() as Record<string, unknown>,
              user.displayName || ''
            )
          : emptyIdentityVerification(user.uid, user.displayName || '');
        setRecord(next);
        setDraft(current => current && open ? current : next);
      },
      () => showToast('Não foi possível carregar sua verificação agora.', 'error')
    );
    const unsubscribeUser = onSnapshot(doc(db, 'users', user.uid), snapshot => {
      setProfileVisible(snapshot.data()?.isProfileVisible !== false);
    });
    return () => {
      unsubscribeVerification();
      unsubscribeUser();
    };
  }, [open, user]);

  useEffect(() => {
    if (!open || !user) return;
    void user.getIdToken().then(token =>
      fetch('/api/security/pin', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setPinConfigured(payload.configured === true);
    }).catch(() => undefined);
  }, [open, user]);

  useEffect(() => {
    const openFromEvent = () => {
      setActiveTab('conta');
      setOpen(true);
    };
    window.addEventListener(IDENTITY_VERIFICATION_OPEN_EVENT, openFromEvent);
    return () => window.removeEventListener(
      IDENTITY_VERIFICATION_OPEN_EVENT,
      openFromEvent
    );
  }, []);

  useEffect(() => {
    let inserted: HTMLButtonElement | null = null;
    const install = () => {
      if (document.getElementById('profile-verification-trigger')) return;
      const editButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.trim().toLocaleLowerCase('pt-BR') === 'editar perfil');
      if (!editButton?.parentElement) return;

      inserted = document.createElement('button');
      inserted.id = 'profile-verification-trigger';
      inserted.type = 'button';
      inserted.className = editButton.className;
      inserted.innerHTML = '<span aria-hidden="true">🛡️</span><span>Verificação e segurança</span>';
      inserted.addEventListener('click', () => {
        setActiveTab('conta');
        setOpen(true);
      });
      editButton.insertAdjacentElement('afterend', inserted);
    };
    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      inserted?.remove();
    };
  }, []);

  useEffect(() => {
    const gate = (event: Event) => {
      const action = actionFromEvent(event);
      if (!action) return;
      const result = workEligibility(record, action);
      if (result.allowed) return;
      event.preventDefault();
      event.stopPropagation();
      if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
      setActiveTab('documentos');
      setOpen(true);
      showToast(result.reason, 'warning');
    };
    document.addEventListener('submit', gate, true);
    document.addEventListener('click', gate, true);
    return () => {
      document.removeEventListener('submit', gate, true);
      document.removeEventListener('click', gate, true);
    };
  }, [record]);

  const requirements = useMemo(
    () => draft ? verificationRequirements(draft) : [],
    [draft]
  );

  if (!user || !draft || !open) return null;

  const readOnly = record?.status === 'approved';
  const setField = <Key extends keyof IdentityVerificationRecord>(
    key: Key,
    value: IdentityVerificationRecord[Key]
  ) => setDraft(current => current ? { ...current, [key]: value } : current);

  const toggleProfile = (profile: VerificationProfile) => {
    if (readOnly) return;
    setDraft(current => {
      if (!current) return current;
      const requestedProfiles = current.requestedProfiles.includes(profile)
        ? current.requestedProfiles.filter(item => item !== profile)
        : [...current.requestedProfiles, profile];
      const motorized = requestedProfiles.includes('motorized_courier');
      return {
        ...current,
        requestedProfiles,
        documentType: motorized ? 'cnh' : current.documentType,
      };
    });
  };

  const persistDraft = async (status: 'draft' | 'submitted') => {
    if (!isValidCpf(draft.cpf)) {
      setActiveTab('dados');
      showToast('Informe um CPF válido.', 'error');
      return;
    }
    if (!draft.fullName.trim() || !draft.address.trim() || !draft.whatsapp.trim()) {
      setActiveTab('dados');
      showToast('Complete nome, endereço e WhatsApp.', 'error');
      return;
    }
    if (draft.requestedProfiles.length === 0) {
      setActiveTab('conta');
      showToast('Selecione ao menos um perfil de atuação.', 'error');
      return;
    }
    if (status === 'submitted' && draft.documentPaths.length === 0) {
      setActiveTab('documentos');
      showToast('Envie um documento oficial com foto.', 'error');
      return;
    }
    if (status === 'submitted' && !draft.selfiePath) {
      setActiveTab('validacao');
      showToast('Envie a selfie de verificação antes de solicitar análise.', 'error');
      return;
    }
    if (
      draft.requestedProfiles.includes('motorized_courier')
      && (draft.documentType !== 'cnh' || !draft.cnhCategory || !draft.cnhHasEar)
    ) {
      setActiveTab('documentos');
      showToast('Entrega motorizada exige CNH compatível e EAR.', 'error');
      return;
    }

    setSaving(true);
    try {
      const reference = doc(db, IDENTITY_VERIFICATION_COLLECTION, user.uid);
      const nowFields = record?.createdAt
        ? { createdAt: record.createdAt }
        : { createdAt: serverTimestamp() };
      await setDoc(reference, {
        uid: user.uid,
        status,
        requestedProfiles: draft.requestedProfiles,
        approvedProfiles: record?.approvedProfiles ?? [],
        fullName: draft.fullName.trim().slice(0, 160),
        cpf: draft.cpf.replace(/\D/g, ''),
        address: draft.address.trim().slice(0, 300),
        whatsapp: draft.whatsapp.trim().slice(0, 40),
        documentType: draft.documentType,
        documentPaths: draft.documentPaths.slice(0, 4),
        selfiePath: draft.selfiePath,
        cnhCategory: draft.cnhCategory.trim().slice(0, 8),
        cnhHasEar: draft.cnhHasEar,
        consentVersion: IDENTITY_CONSENT_VERSION,
        reviewReason: record?.reviewReason ?? '',
        reviewedBy: record?.reviewedBy ?? '',
        reviewedAt: record?.reviewedAt ?? null,
        submittedAt: status === 'submitted' ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        ...nowFields,
      });
      await updateDoc(doc(db, 'users', user.uid), {
        isProfileVisible: profileVisible,
        updatedAt: serverTimestamp(),
      });
      showToast(
        status === 'submitted'
          ? 'Documentação enviada para análise.'
          : 'Dados salvos com segurança.',
        'success'
      );
    } catch (error) {
      console.error('Identity verification save failed.', error);
      showToast('Não foi possível salvar a verificação agora.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
    kind: 'document' | 'selfie'
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('O arquivo deve ter no máximo 10 MB.', 'error');
      return;
    }
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      showToast('Use JPG, PNG, WEBP ou PDF.', 'error');
      return;
    }
    if (kind === 'selfie' && !file.type.startsWith('image/')) {
      showToast('A selfie precisa ser uma imagem.', 'error');
      return;
    }

    setUploading(kind);
    try {
      const path = `identity-verification/${user.uid}/${kind}/${Date.now()}-${safeFileName(file.name)}`;
      await uploadBytes(ref(storage, path), file, {
        contentType: file.type,
        customMetadata: {
          ownerId: user.uid,
          purpose: kind,
          consentVersion: IDENTITY_CONSENT_VERSION,
        },
      });
      setDraft(current => current ? {
        ...current,
        documentPaths:
          kind === 'document'
            ? [...current.documentPaths, path].slice(-4)
            : current.documentPaths,
        selfiePath: kind === 'selfie' ? path : current.selfiePath,
      } : current);
      showToast(
        kind === 'document' ? 'Documento anexado.' : 'Selfie anexada.',
        'success'
      );
    } catch (error) {
      console.error('Identity file upload failed.', error);
      showToast('Não foi possível enviar o arquivo.', 'error');
    } finally {
      setUploading(null);
    }
  };

  const configurePin = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(pin) || pin !== pinConfirmation) {
      showToast('Use quatro números iguais nos dois campos.', 'error');
      return;
    }
    setPinBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await reauthenticateWithPopup(user, provider);
      const token = await user.getIdToken(true);
      const response = await fetch('/api/security/pin', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'set', pin }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha ao configurar PIN.');
      setPin('');
      setPinConfirmation('');
      setPinConfigured(true);
      showToast('PIN transacional configurado.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Não foi possível configurar o PIN.',
        'error'
      );
    } finally {
      setPinBusy(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[190] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
      <section className="flex h-[100dvh] w-full max-w-xl flex-col overflow-hidden bg-slate-950 text-slate-100 sm:h-[min(820px,94dvh)] sm:rounded-3xl sm:border sm:border-slate-800">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-500/30 bg-teal-500/10 text-teal-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black text-white">
                Verificação e segurança
              </h2>
              <p className="text-[9px] uppercase tracking-wider text-slate-500">
                Status: {statusLabel(record?.status ?? 'draft')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-slate-400"
            aria-label="Fechar verificação e segurança"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="shrink-0 overflow-x-auto border-b border-slate-800 bg-slate-900/60 px-2 py-2">
          <div className="flex min-w-max gap-1">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-w-20 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                    selected
                      ? 'bg-teal-500 text-slate-950'
                      : 'text-slate-500 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {activeTab === 'conta' && (
            <div className="space-y-4">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-teal-500/40 bg-slate-950 text-teal-300">
                    <UserRoundCheck className="h-7 w-7" />
                  </span>
                  <div className="min-w-0">
                    <span className="rounded-full bg-teal-500/10 px-2 py-1 text-[8px] font-black uppercase text-teal-300">
                      Autenticado via Google
                    </span>
                    <p className="mt-2 truncate text-[10px] text-slate-500">
                      {user.email}
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <div>
                  <h3 className="text-[10px] font-black uppercase text-white">
                    Perfis que deseja habilitar
                  </h3>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                    Contratar, prestar freelas e realizar entregas possuem verificações diferentes.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {PROFILE_OPTIONS.map(option => {
                    const Icon = option.icon;
                    const selected = draft.requestedProfiles.includes(option.id);
                    const approved = draft.approvedProfiles.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={readOnly}
                        onClick={() => toggleProfile(option.id)}
                        className={`rounded-2xl border p-3 text-left ${
                          selected
                            ? 'border-teal-500/40 bg-teal-500/10 text-teal-200'
                            : 'border-slate-800 bg-slate-950 text-slate-500'
                        } disabled:cursor-not-allowed`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="mt-2 block text-[9px] font-black uppercase">
                          {option.label}
                        </span>
                        {approved && (
                          <span className="mt-1 flex items-center gap-1 text-[8px] text-emerald-300">
                            <Check className="h-3 w-3" /> Aprovado
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="flex items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <div>
                  <h3 className="text-[10px] font-black uppercase text-white">
                    Perfil visível na Praça
                  </h3>
                  <p className="mt-1 text-[9px] text-slate-500">
                    Permite conexões e convites. Documentos nunca ficam públicos.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProfileVisible(current => !current)}
                  className={`relative h-7 w-12 rounded-full ${profileVisible ? 'bg-orange-500' : 'bg-slate-800'}`}
                  aria-pressed={profileVisible}
                >
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-slate-950 transition-transform ${profileVisible ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </section>
            </div>
          )}

          {activeTab === 'dados' && (
            <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <label className="block space-y-1.5">
                <span className="text-[9px] font-black uppercase text-slate-400">Nome completo</span>
                <input
                  className={inputClass}
                  value={draft.fullName}
                  disabled={readOnly}
                  onChange={event => setField('fullName', event.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[9px] font-black uppercase text-slate-400">CPF</span>
                <input
                  className={inputClass}
                  value={formatCpf(draft.cpf)}
                  disabled={readOnly}
                  inputMode="numeric"
                  onChange={event => setField('cpf', event.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="000.000.000-00"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[9px] font-black uppercase text-slate-400">Endereço de atuação/faturamento</span>
                <input
                  className={inputClass}
                  value={draft.address}
                  disabled={readOnly}
                  onChange={event => setField('address', event.target.value)}
                  placeholder="Rua, número, bairro, cidade - UF"
                  autoComplete="street-address"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[9px] font-black uppercase text-slate-400">WhatsApp</span>
                <input
                  className={inputClass}
                  value={draft.whatsapp}
                  disabled={readOnly}
                  onChange={event => setField('whatsapp', event.target.value)}
                  placeholder="(11) 99999-9999"
                  autoComplete="tel"
                />
              </label>
            </div>
          )}

          {activeTab === 'seguranca' && (
            <div className="space-y-4">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-start gap-3">
                  <Fingerprint className="mt-0.5 h-5 w-5 text-teal-300" />
                  <div>
                    <h3 className="text-[10px] font-black uppercase text-white">
                      Biometria do dispositivo
                    </h3>
                    <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                      O Kyrub usará WebAuthn/passkeys para Windows Hello, Touch ID ou biometria do aparelho sem receber sua digital ou imagem facial. A autorização criptográfica do servidor ainda será integrada antes de este controle ser ativado.
                    </p>
                    <span className="mt-3 inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[8px] font-black uppercase text-amber-300">
                      Aguardando integração passkey
                    </span>
                  </div>
                </div>
              </section>

              <form onSubmit={configurePin} className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[10px] font-black uppercase text-white">
                      PIN transacional
                    </h3>
                    <p className="mt-1 text-[9px] text-slate-500">
                      Hash protegido no servidor. Nunca é salvo no navegador ou no Firestore público.
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${pinConfigured ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-950 text-slate-500'}`}>
                    {pinConfigured ? 'Configurado' : 'Pendente'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className={inputClass}
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Novo PIN"
                    autoComplete="new-password"
                  />
                  <input
                    className={inputClass}
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinConfirmation}
                    onChange={event => setPinConfirmation(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Confirmar"
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={pinBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-3 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"
                >
                  {pinBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {pinConfigured ? 'Alterar PIN' : 'Configurar PIN'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'documentos' && (
            <div className="space-y-4">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <h3 className="text-[10px] font-black uppercase text-white">
                  Documento oficial
                </h3>
                <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                  CPF sozinho não comprova identidade. Envie CIN/RG ou CNH com foto legível.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(['cin', 'rg', 'cnh'] as IdentityDocumentType[]).map(type => (
                    <button
                      key={type}
                      type="button"
                      disabled={readOnly || (type !== 'cnh' && draft.requestedProfiles.includes('motorized_courier'))}
                      onClick={() => setField('documentType', type)}
                      className={`rounded-xl border py-2 text-[9px] font-black uppercase ${draft.documentType === type ? 'border-violet-500 bg-violet-500/15 text-violet-200' : 'border-slate-800 bg-slate-950 text-slate-500'} disabled:opacity-30`}
                    >
                      {type.toUpperCase()}
                    </button>
                  ))}
                </div>

                {draft.documentType === 'cnh' && (
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <input
                      className={inputClass}
                      value={draft.cnhCategory}
                      disabled={readOnly}
                      onChange={event => setField('cnhCategory', event.target.value.toUpperCase().slice(0, 8))}
                      placeholder="Categoria: A, B, AB..."
                    />
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setField('cnhHasEar', !draft.cnhHasEar)}
                      className={`rounded-xl border px-3 text-[9px] font-black uppercase ${draft.cnhHasEar ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-800 bg-slate-950 text-slate-500'}`}
                    >
                      EAR {draft.cnhHasEar ? 'sim' : 'não'}
                    </button>
                  </div>
                )}

                <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950 px-4 py-7 text-center">
                  {uploading === 'document' ? <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" /> : <Upload className="h-6 w-6 text-violet-300" />}
                  <span className="mt-2 text-[10px] font-black text-white">Anexar documento</span>
                  <span className="mt-1 text-[8px] text-slate-500">JPG, PNG, WEBP ou PDF, até 10 MB</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    disabled={readOnly || uploading !== null}
                    onChange={event => void upload(event, 'document')}
                  />
                </label>
                <p className="mt-2 text-[9px] text-slate-500">
                  {draft.documentPaths.length} arquivo(s) anexado(s).
                </p>
              </section>

              <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                <h3 className="text-[10px] font-black uppercase text-amber-200">Requisitos deste cadastro</h3>
                <ul className="mt-2 space-y-1.5 text-[9px] text-slate-400">
                  {requirements.map(item => <li key={item}>• {item}</li>)}
                </ul>
              </section>
            </div>
          )}

          {activeTab === 'validacao' && (
            <div className="space-y-4">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-start gap-3">
                  <Camera className="h-5 w-5 text-orange-300" />
                  <div>
                    <h3 className="text-[10px] font-black uppercase text-white">
                      Selfie e prova de vida assistida
                    </h3>
                    <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                      Nesta fase, a selfie será comparada durante a análise humana. O Kyrub não chamará isso de reconhecimento facial automático até integrar um fornecedor de liveness antifraude auditável.
                    </p>
                  </div>
                </div>
                <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-[10px] font-black uppercase text-white">
                  {uploading === 'selfie' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {draft.selfiePath ? 'Substituir selfie' : 'Enviar selfie'}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp"
                    capture="user"
                    disabled={readOnly || uploading !== null}
                    onChange={event => void upload(event, 'selfie')}
                  />
                </label>
                {draft.selfiePath && (
                  <p className="mt-3 flex items-center gap-2 text-[9px] text-emerald-300">
                    <BadgeCheck className="h-4 w-4" /> Selfie anexada para análise.
                  </p>
                )}
              </section>

              {record?.status === 'rejected' && record.reviewReason && (
                <div className="flex gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-[9px] text-red-200">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  {record.reviewReason}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 gap-2 border-t border-slate-800 bg-slate-950 px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-[10px] font-black uppercase text-slate-300"
          >
            Fechar
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => void persistDraft('draft')}
                className="rounded-xl border border-slate-700 px-4 py-3 text-[10px] font-black uppercase text-slate-300 disabled:opacity-50"
              >
                Salvar
              </button>
              <button
                type="button"
                disabled={saving || uploading !== null}
                onClick={() => void persistDraft('submitted')}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"
              >
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar análise
              </button>
            </>
          )}
        </footer>
      </section>

      {toast && (
        <div className={`fixed bottom-24 left-1/2 z-[210] w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border px-4 py-3 text-xs shadow-2xl ${
          toast.type === 'error'
            ? 'border-red-500/30 bg-red-950 text-red-100'
            : toast.type === 'warning'
              ? 'border-amber-500/30 bg-amber-950 text-amber-100'
              : toast.type === 'success'
                ? 'border-emerald-500/30 bg-emerald-950 text-emerald-100'
                : 'border-slate-700 bg-slate-900 text-slate-100'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );

  return createPortal(modal, document.body);
}
