import React, { useState } from 'react';
import {
  BadgeCheck,
  Bike,
  Building2,
  CheckCircle2,
  Fingerprint,
  IdCard,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  Smartphone,
  Store,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
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

type ProfileSection = 'conta' | 'dados' | 'seguranca' | 'verificacao';

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

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
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
}) => {
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
      await updateDoc(doc(db, 'users', user.uid), {
        name: profileName.trim() || user.displayName || '',
        email: user.email ?? profileEmail,
        photoUrl: user.photoURL ?? profilePhotoUrl,
        isProfileVisible,
        updatedAt: serverTimestamp(),
      });

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm animate-fade-in sm:p-4"
      id="modal-user-profile"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl animate-scale-up">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-500/30 bg-teal-500/10 text-teal-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-black text-white">
                Meu perfil
              </h3>
              <p className="truncate text-[10px] text-slate-500">
                Identidade, preferências e segurança da conta
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-slate-500 hover:text-white"
            aria-label="Fechar perfil"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

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
                  {profilePhotoUrl ? (
                    <img
                      src={profilePhotoUrl}
                      alt={profileName}
                      className="h-16 w-16 shrink-0 rounded-2xl border-2 border-teal-500/60 object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-teal-500/30 bg-slate-900 text-slate-500">
                      <UserRound className="h-7 w-7" />
                    </div>
                  )}
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
                Endereço e telefone ainda permanecem no contexto operacional deste dispositivo. A sincronização desses campos será ativada junto ao contrato privado do perfil, sem expô-los no diretório público.
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
                    Este protótipo não envia nem armazena o PIN no Firestore. O recurso definitivo exigirá cofre seguro e backend privilegiado.
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
                    {facialValidated ? 'Refazer demonstração' : 'Iniciar demonstração'}
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
                  <button
                    type="button"
                    onClick={() => {
                      setKycDocType('bike');
                      setKycStatus('Pendente');
                    }}
                    className={`rounded-xl border p-2.5 text-[8px] font-bold uppercase ${
                      kycDocType === 'bike'
                        ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                        : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    <Bike className="mx-auto mb-1 h-4 w-4" />
                    Bike
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKycDocType('motorized');
                      setKycStatus('Pendente');
                    }}
                    className={`rounded-xl border p-2.5 text-[8px] font-bold uppercase ${
                      kycDocType === 'motorized'
                        ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                        : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    <IdCard className="mx-auto mb-1 h-4 w-4" />
                    Motorizado
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKycDocType('lojista');
                      setKycStatus('Pendente');
                    }}
                    className={`rounded-xl border p-2.5 text-[8px] font-bold uppercase ${
                      kycDocType === 'lojista'
                        ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                        : 'border-slate-800 bg-slate-900 text-slate-500'
                    }`}
                  >
                    <Building2 className="mx-auto mb-1 h-4 w-4" />
                    Lojista
                  </button>
                </div>

                {kycDocType === 'bike' && (
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-mono uppercase text-slate-500">
                      CPF do entregador
                    </label>
                    <input
                      type="text"
                      value={kycCpf}
                      onChange={event => setKycCpf(formatCpf(event.target.value))}
                      placeholder="000.000.000-00"
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-mono text-white focus:border-indigo-500/50 focus:outline-none"
                    />
                  </div>
                )}

                {kycDocType === 'motorized' && (
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-mono uppercase text-slate-500">
                      Registro da CNH com EAR
                    </label>
                    <input
                      type="text"
                      value={kycCnh}
                      onChange={event =>
                        setKycCnh(
                          event.target.value.replace(/\D/g, '').slice(0, 11)
                        )
                      }
                      placeholder="Número de registro da CNH"
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-mono text-white focus:border-indigo-500/50 focus:outline-none"
                    />
                  </div>
                )}

                {kycDocType === 'lojista' && (
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-mono uppercase text-slate-500">
                      CNPJ da empresa
                    </label>
                    <input
                      type="text"
                      value={kycCnpj}
                      onChange={event =>
                        setKycCnpj(formatCnpj(event.target.value))
                      }
                      placeholder="00.000.000/0001-00"
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-mono text-white focus:border-indigo-500/50 focus:outline-none"
                    />
                  </div>
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
                  <span className="font-bold uppercase">
                    Separação de segurança
                  </span>
                </div>
                <p className="mt-2">
                  Documentos, PIN e biometria não são gravados pelo navegador no diretório público. O fluxo definitivo será ligado ao backend administrativo e ao armazenamento protegido.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 bg-slate-950/50 p-4">
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
        </div>
      </div>
    </div>
  );
};
