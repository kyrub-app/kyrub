import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  BadgeCheck,
  Bike,
  Building2,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  IdCard,
  ImagePlus,
  LockKeyhole,
  MapPin,
  Send,
  ShieldCheck,
  Smartphone,
  Store,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { SocialPost } from '../../types';
import { MediaCarousel } from '../MediaCarousel';
import { auth, db } from '../../utils/firebase';
import { formatWhatsApp, formatCpf, formatCnpj } from '../../utils/helpers';

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
  triggerToast: (
    msg: string,
    type: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

type ExtendedSocialPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  taggedUsers?: string[];
  taggedUserIds?: string[];
  createdAt?: string;
};

type ProfileSection = 'conta' | 'dados' | 'seguranca' | 'verificacao';

type DirectoryUser = {
  uid: string;
  name: string;
  email: string;
  photoUrl: string;
};

const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;

const readStoredPosts = (rawValue: string | null): ExtendedSocialPost[] => {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as ExtendedSocialPost[]) : [];
  } catch (error) {
    console.warn('Não foi possível ler as publicações do perfil.', error);
    return [];
  }
};

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
    triggerToast,
  } = props;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newPostText, setNewPostText] = useState('');
  const [postMediaUrls, setPostMediaUrls] = useState<string[]>([]);
  const [taggedUsers, setTaggedUsers] = useState<string[]>([]);
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [profilePosts, setProfilePosts] = useState<ExtendedSocialPost[]>([]);
  const postsSectionRef = useRef<HTMLElement | null>(null);

  const currentUser = auth.currentUser;
  const currentUserId = currentUser?.uid ?? '';
  const displayName =
    profileName.trim() || currentUser?.displayName || profileEmail || 'Você';
  const displayAvatar = profilePhotoUrl || currentUser?.photoURL || '';
  const profileHandle = getProfileHandle(profileEmail, displayName);

  useEffect(() => {
    if (!isOpen) return;

    const user = auth.currentUser;
    if (!user) return;

    const userPostsKey = getUserPostsKey(user.uid);
    setProfilePosts(
      readStoredPosts(
        localStorage.getItem(userPostsKey) ??
          localStorage.getItem(LEGACY_POSTS_KEY)
      )
    );

    const unsubscribeDirectory = onSnapshot(
      collection(db, 'users'),
      snapshot => {
        setDirectoryUsers(
          snapshot.docs.flatMap(snapshotDocument => {
            if (snapshotDocument.id === user.uid) return [];
            const data = snapshotDocument.data() as Record<string, unknown>;
            if (data.isProfileVisible === false) return [];
            const name =
              typeof data.name === 'string' && data.name.trim()
                ? data.name.trim()
                : typeof data.email === 'string'
                  ? data.email.split('@')[0]
                  : 'Usuário Kyrub';
            return [
              {
                uid: snapshotDocument.id,
                name,
                email: typeof data.email === 'string' ? data.email : '',
                photoUrl:
                  typeof data.photoUrl === 'string' ? data.photoUrl : '',
              },
            ];
          })
        );
      },
      error => {
        console.warn('Não foi possível carregar usuários para marcação.', error);
        setDirectoryUsers([]);
      }
    );

    const handlePostsUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{ uid?: string; posts?: ExtendedSocialPost[] }>
      ).detail;
      if (detail?.uid === user.uid && Array.isArray(detail.posts)) {
        setProfilePosts(detail.posts);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === userPostsKey) {
        setProfilePosts(readStoredPosts(event.newValue));
      }
    };

    window.addEventListener(
      'kyrub-social-posts-updated',
      handlePostsUpdated as EventListener
    );
    window.addEventListener('storage', handleStorage);

    return () => {
      unsubscribeDirectory();
      window.removeEventListener(
        'kyrub-social-posts-updated',
        handlePostsUpdated as EventListener
      );
      window.removeEventListener('storage', handleStorage);
    };
  }, [isOpen]);

  const ownFeedPosts = useMemo(
    () =>
      profilePosts.filter(post => {
        if (post.publicationType === 'status') return false;
        if (post.authorId && currentUserId) return post.authorId === currentUserId;
        return post.user === displayName || post.user.includes('Você');
      }),
    [currentUserId, displayName, profilePosts]
  );

  const ownStatusCount = useMemo(
    () =>
      profilePosts.filter(
        post =>
          post.publicationType === 'status' &&
          (!post.authorId || post.authorId === currentUserId)
      ).length,
    [currentUserId, profilePosts]
  );

  if (!isOpen) return null;

  const persistPosts = (nextPosts: ExtendedSocialPost[]) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      localStorage.setItem(getUserPostsKey(user.uid), JSON.stringify(nextPosts));
      localStorage.setItem(LEGACY_POSTS_KEY, JSON.stringify(nextPosts));
    } catch (error) {
      console.warn('Não foi possível salvar a publicação localmente.', error);
    }

    setProfilePosts(nextPosts);
    window.dispatchEvent(
      new CustomEvent('kyrub-social-posts-updated', {
        detail: { uid: user.uid, posts: nextPosts },
      })
    );
  };

  const readPostImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const remainingSlots = 9 - postMediaUrls.length;
    if (remainingSlots <= 0) {
      triggerToast('O carrossel aceita no máximo 9 imagens.', 'info');
      return;
    }

    const selectedFiles = files
      .filter(file => file.type.startsWith('image/'))
      .slice(0, remainingSlots);
    const encodedImages = await Promise.all(
      selectedFiles.map(
        file =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
      )
    );

    setPostMediaUrls(current => [...current, ...encodedImages].slice(0, 9));
  };

  const toggleTaggedUser = (user: DirectoryUser) => {
    const selected = taggedUserIds.includes(user.uid);
    setTaggedUserIds(current =>
      selected ? current.filter(uid => uid !== user.uid) : [...current, user.uid]
    );
    setTaggedUsers(current =>
      selected
        ? current.filter(name => name !== user.name)
        : [...current, user.name]
    );
  };

  const publishPost = (publicationType: 'feed' | 'status') => {
    const user = auth.currentUser;
    const content = newPostText.trim();
    if (!user) {
      triggerToast('Faça login novamente para publicar.', 'error');
      return;
    }
    if (!content && postMediaUrls.length === 0) {
      triggerToast('Escreva algo ou adicione imagens antes de publicar.', 'info');
      return;
    }

    const newPost: ExtendedSocialPost = {
      id: `${publicationType}-${Date.now()}`,
      authorId: user.uid,
      user: displayName,
      avatar: displayAvatar,
      time: 'Agora mesmo',
      createdAt: new Date().toISOString(),
      content,
      likes: 0,
      mediaUrls: postMediaUrls,
      taggedUsers,
      taggedUserIds,
      publicationType,
    };
    persistPosts([newPost, ...profilePosts]);
    setNewPostText('');
    setPostMediaUrls([]);
    setTaggedUsers([]);
    setTaggedUserIds([]);
    setIsTagPickerOpen(false);
    triggerToast(
      publicationType === 'feed'
        ? 'Publicação enviada para o feed da Praça.'
        : 'Status publicado para seus contatos conectados.',
      'success'
    );
  };

  const likeOwnPost = (postId: string) => {
    persistPosts(
      profilePosts.map(post =>
        post.id === postId ? { ...post, likes: post.likes + 1 } : post
      )
    );
  };

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
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-2 py-2 text-center">
                      <strong className="block text-sm font-black text-white">
                        {ownFeedPosts.length}
                      </strong>
                      <span className="text-[8px] uppercase text-slate-500">
                        Publicações
                      </span>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-2 py-2 text-center">
                      <strong className="block text-sm font-black text-white">
                        {ownStatusCount}
                      </strong>
                      <span className="text-[8px] uppercase text-slate-500">
                        Status
                      </span>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-2 py-2 text-center">
                      <strong className="block text-sm font-black text-white">
                        {taggedUsers.length}
                      </strong>
                      <span className="text-[8px] uppercase text-slate-500">
                        Marcados
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section
              className="space-y-3 border-b border-slate-900 bg-slate-900/55 p-4 sm:p-5"
              id="profile-publication-composer"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Avatar
                    src={displayAvatar}
                    name={displayName}
                    className="h-9 w-9 rounded-full border border-slate-800 object-cover"
                  />
                  <div>
                    <span className="block text-[10px] font-black text-white">
                      {displayName}
                    </span>
                    <span className="text-[8px] font-mono uppercase text-slate-500">
                      Nova publicação
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:border-orange-500/40 hover:text-orange-400"
                    title="Informações e configurações do perfil"
                    aria-label="Abrir informações e configurações do perfil"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      postsSectionRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      })
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:border-teal-500/40 hover:text-teal-400"
                    title="Meu registro de publicações"
                    aria-label="Abrir meu registro de publicações"
                  >
                    <CircleUserRound className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <textarea
                value={newPostText}
                onChange={event => setNewPostText(event.target.value)}
                placeholder="O que está acontecendo no seu negócio ou região?"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-orange-500"
                rows={4}
                maxLength={3000}
              />

              {postMediaUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-2">
                  {postMediaUrls.map((url, index) => (
                    <div
                      key={`${url.slice(0, 32)}-${index}`}
                      className="relative aspect-square overflow-hidden rounded-xl border border-slate-800"
                    >
                      <img
                        src={url}
                        alt={`Imagem ${index + 1} da publicação`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setPostMediaUrls(current =>
                            current.filter((_, itemIndex) => itemIndex !== index)
                          )
                        }
                        className="absolute right-1 top-1 rounded-full bg-slate-950/90 p-1 text-white"
                        aria-label={`Remover imagem ${index + 1}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {taggedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {taggedUsers.map(name => (
                    <span
                      key={name}
                      className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[9px] font-bold text-teal-300"
                    >
                      @{name}
                    </span>
                  ))}
                </div>
              )}

              <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-3">
                <div className="flex items-center gap-2">
                  <label
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-orange-400"
                    title="Adicionar até 9 imagens"
                  >
                    <ImagePlus className="h-4 w-4" />
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={readPostImages}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsTagPickerOpen(current => !current)}
                    className={`flex h-9 w-9 items-center justify-center rounded-xl border bg-slate-950 transition-colors ${
                      isTagPickerOpen || taggedUsers.length > 0
                        ? 'border-teal-500/40 text-teal-400'
                        : 'border-slate-800 text-slate-400 hover:text-teal-400'
                    }`}
                    title="Marcar usuários"
                    aria-label="Marcar usuários na publicação"
                  >
                    <AtSign className="h-4 w-4" />
                  </button>
                  <span className="font-mono text-[8px] text-slate-500">
                    {postMediaUrls.length}/9
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => publishPost('status')}
                    className="flex items-center gap-1.5 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-[9px] font-black uppercase text-teal-300 hover:bg-teal-500/20"
                  >
                    <Clock3 className="h-3.5 w-3.5" />
                    Status
                  </button>
                  <button
                    type="button"
                    onClick={() => publishPost('feed')}
                    className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-[9px] font-black uppercase text-white hover:bg-orange-500"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Feed
                  </button>
                </div>

                {isTagPickerOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-56 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-2 shadow-2xl">
                    {directoryUsers.length === 0 ? (
                      <p className="p-3 text-center text-[10px] text-slate-500">
                        Nenhum usuário visível disponível para marcação.
                      </p>
                    ) : (
                      directoryUsers.map(user => (
                        <button
                          type="button"
                          key={user.uid}
                          onClick={() => toggleTaggedUser(user)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar
                              src={user.photoUrl}
                              name={user.name}
                              className="h-7 w-7 shrink-0 rounded-full border border-slate-800 object-cover"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-[10px] font-bold text-slate-300">
                                {user.name}
                              </span>
                              <span className="block truncate text-[8px] text-slate-600">
                                {user.email}
                              </span>
                            </span>
                          </span>
                          <span className="text-[9px] font-mono text-teal-400">
                            {taggedUserIds.includes(user.uid)
                              ? 'Marcado'
                              : 'Marcar'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </section>

            <section
              ref={postsSectionRef}
              className="space-y-4 p-4 sm:p-5"
              id="profile-publication-register"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-white">
                    Minhas publicações
                  </h3>
                  <p className="mt-1 text-[9px] text-slate-500">
                    Seu registro social publicado no feed da Praça.
                  </p>
                </div>
                <span className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[9px] font-mono text-slate-400">
                  {ownFeedPosts.length}
                </span>
              </div>

              {ownFeedPosts.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-12 text-center">
                  <CircleUserRound className="mx-auto h-8 w-8 text-slate-700" />
                  <p className="mt-3 text-xs text-slate-500">
                    Suas publicações aparecerão aqui e no feed Recentes da Praça.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {ownFeedPosts.map(post => (
                    <article
                      key={post.id}
                      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={post.avatar || displayAvatar}
                          name={post.user}
                          className="h-9 w-9 rounded-full border border-slate-800 object-cover"
                        />
                        <div className="min-w-0">
                          <h4 className="truncate text-xs font-bold text-slate-200">
                            {post.user}
                          </h4>
                          <span className="font-mono text-[9px] text-slate-500">
                            {post.time}
                          </span>
                        </div>
                      </div>
                      {post.content && (
                        <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">
                          {post.content}
                        </p>
                      )}
                      {post.taggedUsers && post.taggedUsers.length > 0 && (
                        <p className="text-[9px] font-mono text-teal-400">
                          com {post.taggedUsers.map(name => `@${name}`).join(', ')}
                        </p>
                      )}
                      {post.mediaUrls && post.mediaUrls.length > 0 && (
                        <MediaCarousel mediaUrls={post.mediaUrls} />
                      )}
                      <div className="flex items-center justify-between border-t border-slate-800 pt-2.5 text-[9px] font-mono text-slate-500">
                        <button
                          type="button"
                          onClick={() => likeOwnPost(post.id)}
                          className="flex items-center gap-1.5 hover:text-orange-300"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-orange-500" />
                          {post.likes} curtidas
                        </button>
                        <span>Feed Kyrub</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
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
