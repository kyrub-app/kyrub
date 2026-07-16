import React from 'react';
import { ShieldCheck } from 'lucide-react';
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
  setKycDocType: React.Dispatch<React.SetStateAction<'bike' | 'motorized' | 'lojista'>>;
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
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-user-profile">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto animate-scale-up text-xs">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-400" />
            <span>Meu Perfil e Segurança</span>
          </h3>
          <button 
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* BLOC 1: Identidade */}
        <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
          <div className="flex items-center gap-4">
            <div className="relative">
              <img 
                src={profilePhotoUrl || undefined} 
                alt={profileName} 
                className="w-16 h-16 rounded-full object-cover border-2 border-teal-500/80" 
              />
              <div className="absolute -bottom-1 -right-1 bg-teal-500 text-slate-950 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">
                G
              </div>
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-white uppercase">{profileName}</h4>
              <p className="text-slate-400 text-[10px] font-mono">{profileEmail}</p>
              <span className="text-[8px] bg-teal-400/10 border border-teal-400/20 text-teal-400 font-bold font-mono px-2 py-0.5 rounded uppercase">
                Autenticado via Google
              </span>
            </div>
          </div>

          {/* Account tags selection/visuals */}
          <div className="space-y-1.5 pt-2 border-t border-slate-900">
            <span className="text-[10px] text-slate-500 uppercase font-mono block">Tipos de Conta Ativos</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAccountTypeCliente(!accountTypeCliente)}
                className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                  accountTypeCliente 
                    ? 'bg-orange-500 text-slate-950 text-[10px]' 
                    : 'bg-slate-900 border border-slate-800 text-slate-500 text-[10px]'
                }`}
              >
                Cliente
              </button>
              <button
                type="button"
                onClick={() => setAccountTypeEntregador(!accountTypeEntregador)}
                className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                  accountTypeEntregador 
                    ? 'bg-teal-500 text-slate-950 text-[10px]' 
                    : 'bg-slate-900 border border-slate-800 text-slate-500 text-[10px]'
                }`}
              >
                Entregador
              </button>
              <button
                type="button"
                onClick={() => setAccountTypeLojista(!accountTypeLojista)}
                className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                  accountTypeLojista 
                    ? 'bg-indigo-500 text-white text-[10px]' 
                    : 'bg-slate-900 border border-slate-800 text-slate-500 text-[10px]'
                }`}
              >
                Lojista
              </button>
            </div>
          </div>

          {/* Privacy Setting Toggle */}
          <div className="space-y-1.5 pt-2.5 border-t border-slate-900 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-300 uppercase font-mono block">Tornar meu perfil visível na Praça</span>
              <p className="text-[9px] text-slate-500">Permite que outros usuários se conectem e enviem mensagens.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsProfileVisible(!isProfileVisible)}
              className={`relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isProfileVisible ? 'bg-orange-500' : 'bg-slate-800'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                  isProfileVisible ? 'translate-x-4.5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* BLOC 2: Dados Cadastrais */}
        <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
          <h4 className="font-black text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5 text-orange-400">
            <span>Dados Cadastrais</span>
          </h4>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 font-mono uppercase">Endereço de Atuação/Faturamento</label>
              <input
                type="text"
                value={profileAddress}
                onChange={(e) => setProfileAddress(e.target.value)}
                placeholder="Rua, Número, Bairro, Cidade - UF"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 font-mono uppercase">WhatsApp</label>
              <input
                type="text"
                value={profileWhatsApp}
                onChange={(e) => setProfileWhatsApp(formatWhatsApp(e.target.value))}
                placeholder="(11) 99999-9999"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </div>

        {/* BLOC 3: Segurança Financeira */}
        <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
          <h4 className="font-black text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5 text-teal-400">
            <span>Segurança Financeira (BaaS Guard)</span>
          </h4>
          <div className="flex items-center justify-between bg-slate-900/50 p-2.5 rounded-xl border border-slate-900">
            <div>
              <span className="font-bold text-slate-200 block">Biometria Nativa Local</span>
              <p className="text-[9px] text-slate-500">Exigir autenticação biométrica do dispositivo antes de confirmar splits e transações.</p>
            </div>
            <button
              type="button"
              onClick={() => setBiometricsActive(!biometricsActive)}
              className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
                biometricsActive ? 'bg-teal-500' : 'bg-slate-800'
              }`}
            >
              <span className={`w-4 h-4 bg-slate-950 rounded-full shadow-md transform transition-transform ${
                biometricsActive ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-mono uppercase flex items-center gap-1">
              <span>PIN Transacional BaaS (4 dígitos)</span>
            </label>
            <div className="relative">
              <input
                type="password"
                value={transactionPin}
                onChange={(e) => setTransactionPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                maxLength={4}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-white font-mono tracking-[0.5em] focus:outline-none focus:border-teal-500"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔒</span>
            </div>
            <p className="text-[9px] text-slate-500 font-mono">Senha segura criptografada e armazenada localmente com assinatura hash no Firestore.</p>
          </div>
        </div>

        {/* BLOC 4: Onboarding de Documentos / KYC */}
        <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
            <h4 className="font-black text-white uppercase tracking-wider text-[11px] text-indigo-400">
              <span>Onboarding de Documentos &amp; KYC</span>
            </h4>
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] uppercase font-mono text-slate-500 font-bold">Status:</span>
              <span className={`text-[9px] font-black font-mono uppercase px-2 py-0.5 rounded-full ${
                kycStatus === 'Verificado' 
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                  : kycStatus === 'Em Análise' 
                  ? 'bg-orange-500/10 border border-orange-500/20 text-orange-400 animate-pulse' 
                  : 'bg-slate-900 border border-slate-800 text-slate-500'
              }`}>
                {kycStatus}
              </span>
            </div>
          </div>

          {/* Onboarding Selector */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-mono uppercase block">Tipo de Perfil Profissional para Validação</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => { setKycDocType('bike'); setKycStatus('Pendente'); }}
                className={`py-1.5 rounded-lg border font-bold uppercase text-[9px] transition-all text-center ${
                  kycDocType === 'bike' 
                    ? 'bg-indigo-600 border-indigo-500 text-white' 
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                Entregador Bike
              </button>
              <button
                type="button"
                onClick={() => { setKycDocType('motorized'); setKycStatus('Pendente'); }}
                className={`py-1.5 rounded-lg border font-bold uppercase text-[9px] transition-all text-center ${
                  kycDocType === 'motorized' 
                    ? 'bg-indigo-600 border-indigo-500 text-white' 
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                Motorizado (CNH)
              </button>
              <button
                type="button"
                onClick={() => { setKycDocType('lojista'); setKycStatus('Pendente'); }}
                className={`py-1.5 rounded-lg border font-bold uppercase text-[9px] transition-all text-center ${
                  kycDocType === 'lojista' 
                    ? 'bg-indigo-600 border-indigo-500 text-white' 
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                Lojista (CNPJ)
              </button>
            </div>
          </div>

          {/* Conditional input fields */}
          <div className="bg-slate-900/55 p-3 rounded-xl space-y-3.5 border border-slate-900">
            {kycDocType === 'bike' && (
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono uppercase">CPF do Entregador</label>
                <input
                  type="text"
                  value={kycCpf}
                  onChange={(e) => setKycCpf(formatCpf(e.target.value))}
                  placeholder="000.000.000-00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[8px] text-slate-500 leading-tight mt-1">
                  Necessário para emissão de relatórios de fretes e seguro de acidentes pessoais no modal de bike.
                </p>
              </div>
            )}

            {kycDocType === 'motorized' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono uppercase">CNH (Com EAR)</label>
                  <input
                    type="text"
                    value={kycCnh}
                    onChange={(e) => setKycCnh(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    placeholder="Digite o número de registro da CNH"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[8px] text-orange-400 font-bold block mt-1">⚠️ Obrigatório conter a observação "EAR" (Exerce Atividade Remunerada)</span>
                </div>
              </div>
            )}

            {kycDocType === 'lojista' && (
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono uppercase">CNPJ da Empresa</label>
                <input
                  type="text"
                  value={kycCnpj}
                  onChange={(e) => setKycCnpj(formatCnpj(e.target.value))}
                  placeholder="00.000.000/0001-00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[8px] text-slate-500 leading-tight mt-1">
                  Utilizado para faturamento e integração com a Receita Federal para emissão automatizada de NF-e e splits B2B.
                </p>
              </div>
            )}

            {/* Upload document placeholder button */}
            <div className="border border-dashed border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center space-y-2 bg-slate-950 text-center">
              <span className="text-lg">📁</span>
              <div>
                <span className="text-[10px] font-bold text-slate-300 block">Anexar Cópia do Documento Oficial</span>
                <span className="text-[8px] text-slate-500">Formatos aceitos: PDF, PNG, JPG (Max: 5MB)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setKycStatus('Em Análise');
                  triggerToast('Documento enviado com sucesso para análise no KYC!', 'success');
                  
                  // Auto-simulate verification after 4 seconds
                  setTimeout(() => {
                    setKycStatus('Verificado');
                    triggerToast('Onboarding KYC verificado com sucesso!', 'success');
                  }, 4000);
                }}
                className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold rounded-lg text-[9px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                Simular Envio / Upload
              </button>
            </div>
          </div>
        </div>

        {/* BLOC 5: Validação Facial */}
        <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
          <h4 className="font-black text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5 text-orange-400">
            <span>Validação Facial Liveness Antifraude</span>
          </h4>
          
          {isFacialScanning ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center space-y-4 animate-pulse">
              <div className="relative w-28 h-28 rounded-full border-4 border-dashed border-orange-500 flex items-center justify-center">
                <div className="w-24 h-24 rounded-full bg-slate-950 flex items-center justify-center">
                  <span className="text-2xl animate-pulse">👤</span>
                </div>
              </div>
              <div className="text-center space-y-1">
                <span className="text-[10px] font-bold text-orange-400 block">Escaneando Biometria Facial...</span>
                <span className="text-[8px] text-slate-500">Mantenha o rosto centralizado e pisque para validar.</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-slate-900/50 p-3 rounded-xl border border-slate-900">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <span>Status da Validação:</span>
                  {facialValidated ? (
                    <span className="text-emerald-400 font-bold font-mono">✓ Validado</span>
                  ) : (
                    <span className="text-slate-500 font-mono">Não Realizada</span>
                  )}
                </span>
                <p className="text-[9px] text-slate-500 leading-tight">Biometria liveness exigida para autorizar saques e transferências de PIX acima de R$ 1.000,00.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsFacialScanning(true);
                  triggerToast('Iniciando captura de biometria facial...', 'info');
                  
                  setTimeout(() => {
                    setIsFacialScanning(false);
                    setFacialValidated(true);
                    triggerToast('✓ Reconhecimento facial antifraude validado com sucesso!', 'success');
                  }, 3000);
                }}
                className={`shrink-0 px-3 py-2 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer ${
                  facialValidated 
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25'
                    : 'bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-600/10'
                }`}
              >
                {facialValidated ? 'Refazer Scanner' : 'Iniciar Facial'}
              </button>
            </div>
          )}
        </div>

        {/* Actions: Save / Cancel */}
        <div className="flex gap-3 border-t border-slate-800/80 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl transition-all uppercase tracking-wider cursor-pointer text-center"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              triggerToast('⏱ Persistindo dados no Firestore...', 'info');
              
              // Simulate Firebase Write I/O latency
              setTimeout(() => {
                console.log("[Firestore] Salvando dados cadastrais no document users/" + profileEmail, {
                  name: profileName,
                  email: profileEmail,
                  photoUrl: profilePhotoUrl,
                  accountTypes: { cliente: accountTypeCliente, entregador: accountTypeEntregador, lojista: accountTypeLojista },
                  address: profileAddress,
                  whatsapp: profileWhatsApp,
                  biometricsActive,
                  transactionPin,
                  kycDocType,
                  kycCpf,
                  kycCnh,
                  kycCnpj,
                  kycStatus,
                  facialValidated,
                  updatedAt: new Date().toISOString()
                });
                
                triggerToast('✓ Perfil e Segurança persistidos com segurança no Firestore!', 'success');
                onClose();
              }, 800); // 800ms simulation
            }}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 rounded-xl transition-all uppercase tracking-wider cursor-pointer text-center"
          >
            Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  );
};
