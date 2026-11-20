import React, { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Bookmark,
  Bike,
  Building2,
  CheckCircle2,
  CircleUserRound,
  Eye,
  EyeOff,
  Fingerprint,
  IdCard,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  Smartphone,
  Store,
  UserRound,
  UsersRound,
  Users,
  X,
} from 'lucide-react';
import {
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { formatWhatsApp, formatCpf, formatCnpj } from '../../utils/helpers';
import { createSelection, resolveSavedPublication, setSavedPublicationSelections, subscribeSavedPublications, subscribeSelections, type ResolvedSavedPublication, type SavedPublication, type SavedSelection } from '../../utils/savedLibrary';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
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

type ProfileSection = 'conta' | 'dados' | 'seguranca' | 'verificacao';

const getProfileHandle = (email: string, name: string): string => {
  const emailHandle = email.split('@')[0]?.trim();
  const source = emailHandle || name || 'usuario';
  return source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 30);
};

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

const Toggle = ({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
      active
        ? 'border-teal-400/50 bg-teal-500'
        : 'border-slate-700 bg-slate-800'
    }`}
    aria-pressed={active}
    aria-label={label}
  >
    <span
      className={`h-4 w-4 rounded-full bg-slate-950 shadow transition-transform ${
        active ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const ProfileSettingsPanel: React.FC<UserProfileModalProps> = props => {
  const {
    isOpen,
    onClose,
    profileName,
    setProfileName,
    profileEmail,
    profilePhotoUrl,
    accountTypeCliente,
    setAccountTypeCliente,
    accountTypeEntregador,
    setAccountTypeEntregador,
    accountTypeLojista,
    setAccountTypeLojista,
    isProfileVisible,
    setIsProfileVisible,
    biometricsActive,
    setBiometricsActive,
    transactionPin,
    setTransactionPin,
    kycDocType,
    setKycDocType,
    kycStatus,
    setKycStatus,
    facialValidated,
    setFacialValidated,
    isFacialScanning,
    setIsFacialScanning,
    profileAddress,
    setProfileAddress,
    profileWhatsApp,
    setProfileWhatsApp,
    kycCpf,
    setKycCpf,
    kycCnh,
    setKycCnh,
    kycCnpj,
    setKycCnpj,
    triggerToast,
  } = props;
  const [activeSection, setActiveSection] =
    useState<ProfileSection>('conta');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSavePublicProfile = async () => {
    const user = auth.currentUser;
    if (!user) {
      triggerToast('Faça login novamente para salvar o perfil.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          name: profileName.trim() || user.displayName || '',
          email: user.email ?? profileEmail,
          photoUrl: user.photoURL ?? profilePhotoUrl,
          isProfileVisible,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      triggerToast(
        'Perfil público atualizado e sincronizado entre dispositivos.',
        'success'
      );
      onClose();
    } catch (error) {
      console.error('Falha ao salvar perfil público:', error);
      triggerToast(
        'Não foi possível sincronizar o perfil agora. Revise sua conexão.',
        'error'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const startDocumentSimulation = () => {
    setKycStatus('Em Análise');
    triggerToast(
      'Documento preparado para análise. O envio definitivo dependerá do backend seguro.',
      'info'
    );
  };

  const startFacialSimulation = () => {
    setIsFacialScanning(true);
    triggerToast('Iniciando demonstração da validação facial...', 'info');

    window.setTimeout(() => {
      setIsFacialScanning(false);
      setFacialValidated(true);
      triggerToast('Demonstração facial concluída.', 'success');
    }, 2500);
  };

  const sectionItems: Array<{
    id: ProfileSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'conta', label: 'Conta', icon: UserRound },
    { id: 'dados', label: 'Dados', icon: MapPin },
    { id: 'seguranca', label: 'Segurança', icon: LockKeyhole },
    { id: 'verificacao', label: 'Verificação', icon: BadgeCheck },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/90 p-3 backdrop-blur-md animate-fade-in sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl animate-scale-up">
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-500/30 bg-teal-500/10 text-teal-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-black text-white">
                Informações e configurações
              </h3>
              <p className="truncate text-[10px] text-slate-500">
                Conta, dados, segurança, verificação e visibilidade
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-slate-500 hover:text-white"
            aria-label="Fechar configurações do perfil"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-slate-800 bg-slate-950/50 px-3 py-2 sm:px-5">
          <div className="grid grid-cols-4 gap-1.5">
            {sectionItems.map(section => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[9px] font-bold uppercase transition-all sm:flex-row sm:text-[10px] ${
                    active
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-500 hover:bg-slate-900 hover:text-slate-300'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${
                      active ? 'text-teal-400' : 'text-slate-600'
                    }`}
                  />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {activeSection === 'conta' && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={profilePhotoUrl}
                    name={profileName}
                    className="h-16 w-16 shrink-0 rounded-2xl border-2 border-teal-500/60 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex rounded-full border border-teal-500/20 bg-teal-500/10 px-2 py-1 text-[8px] font-bold uppercase text-teal-400">
                      Google conectado
                    </span>
                    <p className="mt-2 truncate text-[10px] font-mono text-slate-500">
                      {profileEmail}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-1.5 border-t border-slate-900 pt-4">
                  <label className="text-[9px] font-mono uppercase text-slate-500">
                    Nome exibido no Kyrub
                  </label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={event => setProfileName(event.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-white focus:border-teal-500/50 focus:outline-none"
                    placeholder="Seu nome"
                  />
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center gap-2">
                  <UsersRound className="h-4 w-4 text-orange-400" />
                  <h4 className="text-[10px] font-black uppercase text-slate-200">
                    Perfis de uso
                  </h4>
                </div>
                <p className="text-[9px] leading-relaxed text-slate-500">
                  Uma mesma conta pode acessar recursos de cliente, entregas e loja.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountTypeCliente(!accountTypeCliente)}
                    className={`rounded-xl border p-3 text-[9px] font-black uppercase transition-all ${
                      accountTypeCliente
                        ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                        : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    <UserRound className="mx-auto mb-1.5 h-4 w-4" />
                    Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAccountTypeEntregador(!accountTypeEntregador)
                    }
                    className={`rounded-xl border p-3 text-[9px] font-black uppercase transition-all ${
                      accountTypeEntregador
                        ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                        : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    <Bike className="mx-auto mb-1.5 h-4 w-4" />
                    Entregador
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountTypeLojista(!accountTypeLojista)}
                    className={`rounded-xl border p-3 text-[9px] font-black uppercase transition-all ${
                      accountTypeLojista
                        ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                        : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    <Store className="mx-auto mb-1.5 h-4 w-4" />
                    Lojista
                  </button>
                </div>
              </section>

              <section className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="min-w-0">
                  <h4 className="text-[10px] font-black uppercase text-slate-200">
                    Perfil visível na Praça
                  </h4>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                    Permite que outros usuários encontrem você para conexões e colaboração.
                  </p>
                </div>
                <Toggle
                  active={isProfileVisible}
                  onClick={() => setIsProfileVisible(!isProfileVisible)}
                  label="Alternar visibilidade do perfil"
                />
              </section>
            </div>
          )}

          {activeSection === 'dados' && (
            <div className="space-y-4">
              <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-orange-400" />
                  <div>
                    <h4 className="text-[10px] font-black uppercase text-slate-200">
                      Dados de atuação
                    </h4>
                    <p className="mt-0.5 text-[9px] text-slate-500">
                      Informações usadas para recursos de distância e contato.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-mono uppercase text-slate-500">
                    Endereço de atuação ou faturamento
                  </label>
                  <input
                    type="text"
                    value={profileAddress}
                    onChange={event => setProfileAddress(event.target.value)}
                    placeholder="Rua, número, bairro, cidade - UF"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-white focus:border-orange-500/50 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-mono uppercase text-slate-500">
                    WhatsApp
                  </label>
                  <div className="relative">
                    <Smartphone className="absolute left-3 top-3 h-4 w-4 text-slate-600" />
                    <input
                      type="text"
                      value={profileWhatsApp}
                      onChange={event =>
                        setProfileWhatsApp(formatWhatsApp(event.target.value))
                      }
                      placeholder="(11) 99999-9999"
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-9 pr-3 text-xs font-mono text-white focus:border-orange-500/50 focus:outline-none"
                    />
                  </div>
                </div>
              </section>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-[9px] leading-relaxed text-amber-200/80">
                Endereço e telefone permanecem no contexto operacional deste dispositivo até a ativação do contrato privado do perfil.
              </div>
            </div>
          )}

          {activeSection === 'seguranca' && (
            <div className="space-y-4">
              <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center gap-2">
                  <Fingerprint className="h-4 w-4 text-teal-400" />
                  <h4 className="text-[10px] font-black uppercase text-slate-200">
                    Proteção do dispositivo
                  </h4>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-900 bg-slate-900/60 p-3">
                  <div>
                    <span className="block text-[10px] font-bold text-slate-200">
                      Biometria local
                    </span>
                    <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                      Confirma operações sensíveis usando os recursos do aparelho.
                    </p>
                  </div>
                  <Toggle
                    active={biometricsActive}
                    onClick={() => setBiometricsActive(!biometricsActive)}
                    label="Alternar biometria local"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-mono uppercase text-slate-500">
                    PIN transacional de demonstração
                  </label>
                  <div className="relative">
                    <LockKeyhole className="absolute left-3 top-3 h-4 w-4 text-slate-600" />
                    <input
                      type="password"
                      value={transactionPin}
                      onChange={event =>
                        setTransactionPin(
                          event.target.value.replace(/\D/g, '').slice(0, 4)
                        )
                      }
                      placeholder="••••"
                      maxLength={4}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-9 pr-3 text-xs tracking-[0.45em] text-white focus:border-teal-500/50 focus:outline-none"
                    />
                  </div>
                  <p className="text-[8px] leading-relaxed text-slate-600">
                    Este protótipo não envia nem armazena o PIN no Firestore.
                  </p>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-orange-400" />
                    <div>
                      <h4 className="text-[10px] font-black uppercase text-slate-200">
                        Validação facial
                      </h4>
                      <p className="mt-0.5 text-[9px] text-slate-500">
                        Demonstração visual de liveness antifraude.
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
                      facialValidated
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    {facialValidated ? 'Validado' : 'Pendente'}
                  </span>
                </div>
                {isFacialScanning ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/5 py-8 text-center">
                    <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full border-2 border-dashed border-orange-500 text-orange-300">
                      <UserRound className="h-8 w-8" />
                    </div>
                    <span className="mt-3 text-[10px] font-bold text-orange-300">
                      Simulando leitura facial...
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startFacialSimulation}
                    className="w-full rounded-xl border border-orange-500/25 bg-orange-500/10 py-2.5 text-[10px] font-black uppercase text-orange-300 hover:bg-orange-500/15"
                  >
                    {facialValidated
                      ? 'Refazer demonstração'
                      : 'Iniciar demonstração'}
                  </button>
                )}
              </section>
            </div>
          )}

          {activeSection === 'verificacao' && (
            <div className="space-y-4">
              <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <IdCard className="h-4 w-4 text-indigo-400" />
                    <div>
                      <h4 className="text-[10px] font-black uppercase text-slate-200">
                        Perfil para verificação
                      </h4>
                      <p className="mt-0.5 text-[9px] text-slate-500">
                        Organize os documentos conforme a atividade exercida.
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
                      kycStatus === 'Verificado'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : kycStatus === 'Em Análise'
                          ? 'border-orange-500/30 bg-orange-500/10 text-orange-300'
                          : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    {kycStatus}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'bike' as const, label: 'Bike', icon: Bike },
                    { id: 'motorized' as const, label: 'Motorizado', icon: IdCard },
                    { id: 'lojista' as const, label: 'Lojista', icon: Building2 },
                  ].map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setKycDocType(item.id);
                          setKycStatus('Pendente');
                        }}
                        className={`rounded-xl border p-2.5 text-[8px] font-bold uppercase ${
                          kycDocType === item.id
                            ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                            : 'border-slate-800 bg-slate-900 text-slate-500'
                        }`}
                      >
                        <Icon className="mx-auto mb-1 h-4 w-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {kycDocType === 'bike' && (
                  <input
                    type="text"
                    value={kycCpf}
                    onChange={event => setKycCpf(formatCpf(event.target.value))}
                    placeholder="CPF: 000.000.000-00"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-mono text-white focus:border-indigo-500/50 focus:outline-none"
                  />
                )}
                {kycDocType === 'motorized' && (
                  <input
                    type="text"
                    value={kycCnh}
                    onChange={event =>
                      setKycCnh(event.target.value.replace(/\D/g, '').slice(0, 11))
                    }
                    placeholder="Número de registro da CNH com EAR"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-mono text-white focus:border-indigo-500/50 focus:outline-none"
                  />
                )}
                {kycDocType === 'lojista' && (
                  <input
                    type="text"
                    value={kycCnpj}
                    onChange={event => setKycCnpj(formatCnpj(event.target.value))}
                    placeholder="CNPJ: 00.000.000/0001-00"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-mono text-white focus:border-indigo-500/50 focus:outline-none"
                  />
                )}
                <button
                  type="button"
                  onClick={startDocumentSimulation}
                  className="w-full rounded-xl border border-dashed border-indigo-500/35 bg-indigo-500/10 py-3 text-[9px] font-black uppercase text-indigo-300 hover:bg-indigo-500/15"
                >
                  Preparar documento para análise
                </button>
              </section>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[9px] leading-relaxed text-slate-500">
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="h-4 w-4 text-teal-400" />
                  <span className="font-bold uppercase">Separação de segurança</span>
                </div>
                <p className="mt-2">
                  Documentos, PIN e biometria não são gravados pelo navegador no diretório público.
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-slate-800 bg-slate-950/50 p-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl bg-slate-800 py-2.5 text-[10px] font-bold uppercase text-slate-300 hover:bg-slate-700"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleSavePublicProfile}
              disabled={isSaving}
              className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-[10px] font-black uppercase text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
            >
              {isSaving ? 'Sincronizando...' : 'Salvar perfil público'}
            </button>
          </div>
          <p className="mt-2 text-center text-[8px] text-slate-600">
            Nome e visibilidade são sincronizados na nuvem. Dados sensíveis permanecem fora do diretório público.
          </p>
        </footer>
      </div>
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
    friends,
    connectionRequests,
    onOpenCommunities,
    onOpenConnections,
    triggerToast,
  } = props;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedPublication[]>([]);
  const [resolvedSavedItems, setResolvedSavedItems] = useState<ResolvedSavedPublication[]>([]);
  const [selections, setSelections] = useState<SavedSelection[]>([]);
  const [isSavedOpen, setIsSavedOpen] = useState(false);
  const [newSelectionName, setNewSelectionName] = useState('');
  const [isCreatingSelection, setIsCreatingSelection] = useState(false);

  const currentUser = auth.currentUser;
  const currentUserId = currentUser?.uid ?? '';
  const displayName =
    profileName.trim() || currentUser?.displayName || profileEmail || 'Você';
  const displayAvatar = profilePhotoUrl || currentUser?.photoURL || '';
  const profileHandle = getProfileHandle(profileEmail, displayName);

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
      >
        <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl animate-scale-up">
          <header className="flex items-center justify-between border-b border-slate-900 bg-slate-950/95 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
                Meu perfil
              </span>
              <h2 className="truncate text-base font-black text-white">
                {displayName}
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
            <section className="border-b border-slate-900 bg-gradient-to-b from-slate-900/90 to-slate-950 px-4 py-5 sm:px-5">
              <div className="flex items-center gap-4">
                <Avatar
                  src={displayAvatar}
                  name={displayName}
                  className="h-20 w-20 shrink-0 rounded-full border-2 border-orange-500 object-cover shadow-lg shadow-orange-500/10 sm:h-24 sm:w-24"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-lg font-black text-white">
                      {displayName}
                    </h3>
                    <span
                      className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
                        isProfileVisible
                          ? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
                          : 'border-slate-700 bg-slate-900 text-slate-500'
                      }`}
                    >
                      {isProfileVisible ? 'Visível na Praça' : 'Perfil reservado'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-mono text-slate-500">
                    @{profileHandle}
                  </p>
                  <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
                    Seu centro pessoal é privado. Publicações acontecem na Praça e nas Comunidades.
                  </p>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-2 border-b border-slate-900 bg-slate-950 p-4 sm:grid-cols-3 sm:p-5" id="profile-personal-center">
              <button type="button" onClick={onOpenCommunities} className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-left hover:border-sky-500/40">
                <UsersRound className="h-5 w-5 text-sky-300" />
                <strong className="mt-3 block text-[10px] font-black uppercase text-slate-100">Comunidades</strong>
                <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">Seus espaços, membros e conexões.</span>
              </button>
              <button type="button" onClick={() => setIsSavedOpen(current => !current)} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-left hover:border-amber-500/40">
                <Bookmark className="h-5 w-5 text-amber-300" />
                <strong className="mt-3 block text-[10px] font-black uppercase text-slate-100">Salvos</strong>
                <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">{savedItems.length} publicações · {selections.length} Seleções</span>
              </button>
              <button type="button" onClick={() => setIsSettingsOpen(true)} className="rounded-2xl border border-slate-700 bg-slate-900 p-3 text-left hover:border-slate-600">
                <ShieldCheck className="h-5 w-5 text-slate-300" />
                <strong className="mt-3 block text-[10px] font-black uppercase text-slate-100">Conta</strong>
                <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">Dados, segurança e verificação.</span>
              </button>
            </section>

            {isSavedOpen && (
              <section className="space-y-4 border-b border-slate-900 bg-slate-900/45 p-4 sm:p-5" id="profile-saved-library">
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

      <ProfileSettingsPanel
        {...props}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
};
