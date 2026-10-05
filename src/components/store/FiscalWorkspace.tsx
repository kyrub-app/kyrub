import React, { useEffect, useState } from 'react';
import { Building2, CheckCircle2, Circle, ExternalLink, FileCheck2, HelpCircle, KeyRound, ReceiptText, ShieldCheck, Smartphone } from 'lucide-react';
import { auth } from '../../utils/firebase';

interface FiscalWorkspaceProps { storeName: string; canonicalStoreId: string; onStartOnboarding?: () => void | Promise<void>; }
type FiscalOnboardingState = 'required' | 'preparing' | 'prepared' | 'error';
type ProfileState = 'loading' | 'ready' | 'saving' | 'error';
type CredentialState = 'loading' | 'ready' | 'saving_a1' | 'saving_csc' | 'error';
type ContextualHelpTopic = 'mei' | 'a1' | 'csc' | null;
type ReadinessRequirement = { key: string; label: string; status: 'pending' | 'complete'; secret: boolean; };
type FiscalFamily = { family: 'nfce' | 'nfe' | 'nfse'; enabled: boolean; status: 'not_configured' | 'pending' | 'ready_for_production_authorization'; requirements: ReadinessRequirement[]; productionTrafficAllowed: false; };
type FiscalProfile = { legalName: string; cnpj: string; stateRegistration: string; municipalRegistration: string; taxRegime: string; address: { street: string; number: string; complement: string; district: string; city: string; state: string; postalCode: string; ibgeCityCode: string; }; };
type FiscalCredentialStatus = {
  canonicalStoreId: string;
  certificateA1: { configured: boolean; fileName: string | null; fingerprintSha256: string | null; byteLength: number | null; updatedAt: string | null; };
  nfceCsc: { configured: boolean; cscId: string | null; updatedAt: string | null; };
  authority: 'google_secret_manager';
  productionTrafficAllowed: false;
};

const emptyProfile = (): FiscalProfile => ({ legalName: '', cnpj: '', stateRegistration: '', municipalRegistration: '', taxRegime: '', address: { street: '', number: '', complement: '', district: '', city: '', state: '', postalCode: '', ibgeCityCode: '' } });
const emptyCredentialStatus = (canonicalStoreId: string): FiscalCredentialStatus => ({ canonicalStoreId, certificateA1: { configured: false, fileName: null, fingerprintSha256: null, byteLength: null, updatedAt: null }, nfceCsc: { configured: false, cscId: null, updatedAt: null }, authority: 'google_secret_manager', productionTrafficAllowed: false });
const profileEndpoint = '/api/store-connections/fiscal/profile';
const readinessEndpoint = '/api/store-connections/fiscal/readiness';
const credentialsEndpoint = '/api/store-connections/fiscal/credentials';
const SP_NFCE_URL = 'https://portal.fazenda.sp.gov.br/servicos/nfce';
const NFF_PLAY_URL = 'https://play.google.com/store/apps/details?id=br.gov.rs.procergs.nff';
const NFF_APPLE_URL = 'https://apps.apple.com/br/app/nota-fiscal-f%C3%A1cil-nff/id1531717982';
const externalLinkClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-white transition hover:border-cyan-500/40';
const familyName = (family: FiscalFamily['family']) => family === 'nfce' ? 'NFC-e' : family === 'nfe' ? 'NF-e' : 'NFS-e';
const familyDescription = (family: FiscalFamily['family']) => family === 'nfce' ? 'Venda ao consumidor' : family === 'nfe' ? 'Operações com mercadorias' : 'Prestação de serviços';
const missingFieldLabels: Record<string, string> = {
  legalName: 'razão social', cnpj: 'CNPJ', taxRegime: 'regime tributário',
  'address.street': 'logradouro', 'address.number': 'número', 'address.district': 'bairro',
  'address.city': 'município', 'address.state': 'UF', 'address.postalCode': 'CEP',
  'address.ibgeCityCode': 'código IBGE do município',
};
const friendlyMissingField = (field: string): string => missingFieldLabels[field] ?? field;
const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Não foi possível ler o certificado A1.'));
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    const comma = result.indexOf(',');
    if (comma < 0) return reject(new Error('Não foi possível ler o certificado A1.'));
    resolve(result.slice(comma + 1));
  };
  reader.readAsDataURL(file);
});
const credentialStatusFrom = (payload: Record<string, any>, canonicalStoreId: string): FiscalCredentialStatus => {
  if (payload.authority !== 'google_secret_manager' || payload.productionTrafficAllowed !== false || payload.canonicalStoreId !== canonicalStoreId) {
    throw new Error('O backend retornou um estado inesperado para as credenciais fiscais.');
  }
  return {
    canonicalStoreId,
    certificateA1: {
      configured: payload.certificateA1?.configured === true,
      fileName: typeof payload.certificateA1?.fileName === 'string' ? payload.certificateA1.fileName : null,
      fingerprintSha256: typeof payload.certificateA1?.fingerprintSha256 === 'string' ? payload.certificateA1.fingerprintSha256 : null,
      byteLength: typeof payload.certificateA1?.byteLength === 'number' ? payload.certificateA1.byteLength : null,
      updatedAt: typeof payload.certificateA1?.updatedAt === 'string' ? payload.certificateA1.updatedAt : null,
    },
    nfceCsc: {
      configured: payload.nfceCsc?.configured === true,
      cscId: typeof payload.nfceCsc?.cscId === 'string' ? payload.nfceCsc.cscId : null,
      updatedAt: typeof payload.nfceCsc?.updatedAt === 'string' ? payload.nfceCsc.updatedAt : null,
    },
    authority: 'google_secret_manager',
    productionTrafficAllowed: false,
  };
};

export const FiscalWorkspace: React.FC<FiscalWorkspaceProps> = ({ storeName, canonicalStoreId, onStartOnboarding }) => {
  const [onboardingState, setOnboardingState] = useState<FiscalOnboardingState>('required');
  const [feedback, setFeedback] = useState('');
  const [profileState, setProfileState] = useState<ProfileState>('loading');
  const [profile, setProfile] = useState<FiscalProfile>(emptyProfile);
  const [profileFeedback, setProfileFeedback] = useState('');
  const [completeness, setCompleteness] = useState<'pending' | 'complete'>('pending');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [readinessStatus, setReadinessStatus] = useState<'loading' | 'pending' | 'ready_for_production_authorization' | 'error'>('loading');
  const [families, setFamilies] = useState<FiscalFamily[]>([]);
  const [readinessFeedback, setReadinessFeedback] = useState('');
  const [credentialState, setCredentialState] = useState<CredentialState>('loading');
  const [credentialStatus, setCredentialStatus] = useState<FiscalCredentialStatus>(() => emptyCredentialStatus(canonicalStoreId));
  const [credentialFeedback, setCredentialFeedback] = useState('');
  const [a1File, setA1File] = useState<File | null>(null);
  const [a1Password, setA1Password] = useState('');
  const [a1InputKey, setA1InputKey] = useState(0);
  const [cscId, setCscId] = useState('');
  const [csc, setCsc] = useState('');
  const [contextualHelp, setContextualHelp] = useState<ContextualHelpTopic>(null);

  const requestToken = async (): Promise<string> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Faça login novamente para configurar a emissão fiscal.');
    return user.getIdToken();
  };

  const loadReadiness = async (): Promise<void> => {
    try {
      const token = await requestToken();
      const response = await fetch(`${readinessEndpoint}?canonicalStoreId=${encodeURIComponent(canonicalStoreId)}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível consultar a prontidão fiscal.');
      if (payload.productionTrafficAllowed !== false) throw new Error('A prontidão fiscal retornou um estado de produção inesperado.');
      const nextFamilies = Array.isArray(payload.families) ? payload.families.filter((item: any) => item && ['nfce', 'nfe', 'nfse'].includes(item.family) && item.productionTrafficAllowed === false) : [];
      setFamilies(nextFamilies);
      setReadinessStatus(payload.status === 'ready_for_production_authorization' ? 'ready_for_production_authorization' : 'pending');
      setReadinessFeedback('');
    } catch (error) {
      setReadinessStatus('error');
      setReadinessFeedback(error instanceof Error ? error.message : 'Não foi possível consultar a prontidão fiscal.');
    }
  };

  const loadCredentials = async (): Promise<void> => {
    try {
      const token = await requestToken();
      const response = await fetch(`${credentialsEndpoint}?canonicalStoreId=${encodeURIComponent(canonicalStoreId)}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível consultar as credenciais fiscais.');
      const next = credentialStatusFrom(payload, canonicalStoreId);
      setCredentialStatus(next);
      setCscId(next.nfceCsc.cscId ?? '');
      setCredentialState('ready');
      setCredentialFeedback('');
    } catch (error) {
      setCredentialState('error');
      setCredentialFeedback(error instanceof Error ? error.message : 'Não foi possível consultar as credenciais fiscais.');
    }
  };

  useEffect(() => {
    let active = true;
    setCredentialStatus(emptyCredentialStatus(canonicalStoreId));
    setCredentialState('loading');
    setA1File(null); setA1Password(''); setCscId(''); setCsc(''); setContextualHelp(null);
    void (async () => {
      try {
        const token = await requestToken();
        const response = await fetch(`${profileEndpoint}?canonicalStoreId=${encodeURIComponent(canonicalStoreId)}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
        const payload = await response.json().catch(() => ({})) as Record<string, any>;
        if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível carregar os dados fiscais.');
        if (!active) return;
        setProfile({ legalName: payload.legalName ?? '', cnpj: payload.cnpj ?? '', stateRegistration: payload.stateRegistration ?? '', municipalRegistration: payload.municipalRegistration ?? '', taxRegime: payload.taxRegime ?? '', address: { ...emptyProfile().address, ...(payload.address ?? {}) } });
        setCompleteness(payload.completeness === 'complete' ? 'complete' : 'pending');
        setMissingFields(Array.isArray(payload.missingFields) ? payload.missingFields.filter((item: unknown): item is string => typeof item === 'string') : []);
        setProfileState('ready');
        await Promise.all([loadReadiness(), loadCredentials()]);
      } catch (error) {
        if (!active) return;
        setProfileState('error');
        setProfileFeedback(error instanceof Error ? error.message : 'Não foi possível carregar os dados fiscais.');
      }
    })();
    return () => { active = false; };
  }, [canonicalStoreId]);

  const startOnboarding = async (): Promise<void> => {
    if (onboardingState === 'preparing' || onboardingState === 'prepared') return;
    setOnboardingState('preparing'); setFeedback('');
    try {
      if (onStartOnboarding) await onStartOnboarding();
      else {
        const token = await requestToken();
        const response = await fetch('/api/store-connections/fiscal/onboarding/prepare', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ canonicalStoreId }), cache: 'no-store' });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) throw new Error(typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : 'Não foi possível iniciar a configuração fiscal.');
        if (payload.status !== 'prepared' || payload.productionTrafficAllowed !== false) throw new Error('O backend não confirmou a preparação fiscal em modo seguro.');
      }
      setOnboardingState('prepared'); setFeedback('Preparação fiscal iniciada. A emissão em produção continua bloqueada até a validação dos requisitos.'); await loadReadiness();
    } catch (error) { setOnboardingState('error'); setFeedback(error instanceof Error ? error.message : 'Não foi possível iniciar a configuração fiscal.'); }
  };

  const saveProfile = async (): Promise<void> => {
    if (profileState === 'saving') return;
    setProfileState('saving'); setProfileFeedback('');
    try {
      const token = await requestToken();
      const response = await fetch(profileEndpoint, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ canonicalStoreId, profile }), cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível salvar os dados fiscais.');
      setProfile({ legalName: payload.legalName ?? '', cnpj: payload.cnpj ?? '', stateRegistration: payload.stateRegistration ?? '', municipalRegistration: payload.municipalRegistration ?? '', taxRegime: payload.taxRegime ?? '', address: { ...emptyProfile().address, ...(payload.address ?? {}) } });
      const complete = payload.completeness === 'complete'; setCompleteness(complete ? 'complete' : 'pending');
      setMissingFields(Array.isArray(payload.missingFields) ? payload.missingFields.filter((item: unknown): item is string => typeof item === 'string') : []);
      setProfileState('ready');
      setProfileFeedback(complete ? 'Dados fiscais salvos e estruturalmente completos. A emissão em produção continua bloqueada.' : 'Dados fiscais salvos. Complete os campos pendentes para avançar no onboarding.');
      await loadReadiness();
    } catch (error) { setProfileState('error'); setProfileFeedback(error instanceof Error ? error.message : 'Não foi possível salvar os dados fiscais.'); }
  };

  const saveA1 = async (): Promise<void> => {
    if (credentialState === 'saving_a1' || credentialState === 'saving_csc') return;
    if (!a1File) { setCredentialState('error'); setCredentialFeedback('Selecione o arquivo do certificado A1 (.pfx ou .p12).'); return; }
    if (!/\.(pfx|p12)$/i.test(a1File.name)) { setCredentialState('error'); setCredentialFeedback('Selecione um certificado A1 no formato .pfx ou .p12.'); return; }
    if (!a1Password) { setCredentialState('error'); setCredentialFeedback('Informe a senha do certificado A1.'); return; }
    setCredentialState('saving_a1'); setCredentialFeedback('');
    try {
      const certificateBase64 = await fileToBase64(a1File);
      const token = await requestToken();
      const response = await fetch(`${credentialsEndpoint}/a1`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ canonicalStoreId, fileName: a1File.name, certificateBase64, password: a1Password }), cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível guardar o certificado A1.');
      const next = credentialStatusFrom(payload, canonicalStoreId);
      setCredentialStatus(next);
      setA1File(null); setA1Password(''); setA1InputKey(current => current + 1);
      setCredentialState('ready');
      setCredentialFeedback('Certificado A1 guardado no cofre seguro. A senha não fica disponível para leitura pela interface.');
      await loadReadiness();
    } catch (error) {
      setCredentialState('error');
      setCredentialFeedback(error instanceof Error ? error.message : 'Não foi possível guardar o certificado A1.');
    }
  };

  const saveCsc = async (): Promise<void> => {
    if (credentialState === 'saving_a1' || credentialState === 'saving_csc') return;
    if (!cscId.trim() || !csc) { setCredentialState('error'); setCredentialFeedback('Informe o identificador do CSC e o código CSC da NFC-e.'); return; }
    setCredentialState('saving_csc'); setCredentialFeedback('');
    try {
      const token = await requestToken();
      const response = await fetch(`${credentialsEndpoint}/nfce-csc`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ canonicalStoreId, cscId, csc }), cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível guardar o CSC da NFC-e.');
      const next = credentialStatusFrom(payload, canonicalStoreId);
      setCredentialStatus(next);
      setCscId(next.nfceCsc.cscId ?? cscId.trim()); setCsc('');
      setCredentialState('ready');
      setCredentialFeedback('CSC e identificador guardados no cofre seguro. O código CSC não fica disponível para leitura pela interface.');
      await loadReadiness();
    } catch (error) {
      setCredentialState('error');
      setCredentialFeedback(error instanceof Error ? error.message : 'Não foi possível guardar o CSC da NFC-e.');
    }
  };

  const setField = (key: keyof Omit<FiscalProfile, 'address'>, value: string) => setProfile(current => ({ ...current, [key]: value }));
  const setAddress = (key: keyof FiscalProfile['address'], value: string) => setProfile(current => ({ ...current, address: { ...current.address, [key]: value } }));
  const inputClass = 'min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[11px] text-white outline-none focus:border-emerald-500/60';
  const labelClass = 'space-y-1 text-[9px] font-black uppercase tracking-wide text-slate-500';
  const statusLabel = onboardingState === 'prepared' ? 'Preparação iniciada' : onboardingState === 'preparing' ? 'Preparando...' : onboardingState === 'error' ? 'Configuração pendente' : 'Configuração necessária';
  const isSp = profile.address.state.trim().toUpperCase() === 'SP';
  const isMei = /(^|\W)MEI($|\W)/i.test(profile.taxRegime);
  const toggleHelp = (topic: Exclude<ContextualHelpTopic, null>) => setContextualHelp(current => current === topic ? null : topic);

  return <div className="space-y-5" id="kyrub-fiscal-workspace">
    <div className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3"><div><span className="font-mono text-[9px] font-black uppercase tracking-wider text-emerald-400">Emissor Fiscal Kyrub</span><h3 className="mt-1 text-sm font-black uppercase text-white">Fiscal</h3><p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-400">Configure a emissão fiscal da {storeName || 'sua loja'} e acompanhe os documentos vinculados às vendas do Kyrub.</p></div><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><FileCheck2 className="h-5 w-5" /></div></div>
      <div className="flex flex-wrap items-center gap-2 pt-1"><span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] font-black uppercase ${onboardingState === 'prepared' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-400'}`}>{statusLabel}</span><span className="font-mono text-[9px] text-slate-500">Produção bloqueada até autorização fiscal explícita.</span></div>
      {feedback && <p className={`rounded-2xl border px-3 py-2.5 text-[10px] ${onboardingState === 'prepared' ? 'border-emerald-500/20 text-emerald-100' : 'border-red-500/20 text-red-100'}`} role="status">{feedback}</p>}
    </div>

    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-400" /><h4 className="text-xs font-black uppercase text-white">Dados fiscais</h4></div><p className="mt-1 text-[10px] text-slate-400">Informe os dados reais da empresa emitente. O Kyrub não infere regime tributário nem classificação fiscal.</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[8px] font-black uppercase ${completeness === 'complete' ? 'border-emerald-500/20 text-emerald-300' : 'border-amber-500/20 text-amber-300'}`}>{completeness === 'complete' ? 'Completo' : 'Pendente'}</span></div>
      {profileState === 'loading' ? <p className="text-[10px] text-slate-500">Carregando dados fiscais...</p> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={labelClass}>Razão social<input className={inputClass} value={profile.legalName} onChange={e => setField('legalName', e.target.value)} /></label>
          <label className={labelClass}>CNPJ<input className={inputClass} inputMode="numeric" value={profile.cnpj} onChange={e => setField('cnpj', e.target.value)} /></label>
          <label className={labelClass}>Inscrição estadual<input className={inputClass} value={profile.stateRegistration} onChange={e => setField('stateRegistration', e.target.value)} /></label>
          <label className={labelClass}>Inscrição municipal<input className={inputClass} value={profile.municipalRegistration} onChange={e => setField('municipalRegistration', e.target.value)} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Regime tributário declarado<input className={inputClass} value={profile.taxRegime} onChange={e => setField('taxRegime', e.target.value)} placeholder="Informe conforme orientação contábil" /></label>
          {isMei && <div className="space-y-3 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4 sm:col-span-2">
            <button type="button" onClick={() => toggleHelp('mei')} aria-expanded={contextualHelp === 'mei'} className="flex w-full items-start justify-between gap-3 text-left">
              <div className="flex items-start gap-2"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><div><strong className="block text-[10px] uppercase text-cyan-100">Seu regime indica MEI</strong><span className="mt-1 block text-[9px] normal-case leading-relaxed text-slate-400">Entenda a Nota Fiscal Fácil e quando ela pode ser uma alternativa antes de contratar certificado.</span></div></div>
              <span className="shrink-0 rounded-full border border-cyan-500/20 px-2 py-1 text-[8px] font-black uppercase text-cyan-200">{contextualHelp === 'mei' ? 'Fechar' : 'Entender'}</span>
            </button>
            {contextualHelp === 'mei' && <div className="space-y-4 border-t border-cyan-500/10 pt-3">
              <div>
                <div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-cyan-300" /><h5 className="text-[10px] font-black uppercase text-cyan-100">Nota Fiscal Fácil (NFF)</h5></div>
                <p className="mt-2 text-[10px] normal-case leading-relaxed text-slate-300">A Nota Fiscal Fácil é um regime especial de âmbito nacional, instituído pelo Ajuste SINIEF 37/19, para simplificar a emissão de documentos fiscais eletrônicos. Ela atende públicos como transportadores autônomos, microempreendedores individuais e produtores primários, conforme a implantação e as regras de cada UF.</p>
              </div>
              <div className="grid grid-cols-1 gap-2 text-[9px] normal-case leading-relaxed text-slate-400 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">Sem certificado digital</strong>O aplicativo NFF permite preencher e solicitar a emissão de documentos fiscais sem exigir certificado A1 para esse fluxo simplificado.</div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">Gratuito no celular</strong>O app é gratuito e está disponível para Android e iPhone, reduzindo a complexidade técnica para quem está começando.</div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">Pode funcionar off-line</strong>A NFF prevê operação simplificada com recursos de contingência/off-line e armazenamento no aparelho, conforme o módulo e as regras aplicáveis.</div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">É complementar</strong>A NFF não substitui obrigatoriamente os emissores convencionais. O contribuinte pode usar caminhos diferentes conforme sua necessidade e enquadramento.</div>
              </div>
              {isSp ? <div className="space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3 normal-case">
                <strong className="block text-[9px] uppercase text-emerald-200">Para sua empresa em São Paulo</strong>
                <p className="text-[9px] leading-relaxed text-slate-300">Em São Paulo, a NFF está disponível para Transportadores Autônomos de Cargas e, desde 16/09/2024, também para MEI e Produtor Rural. Para MEI e Produtor Rural, o fluxo paulista contempla NF-e e NFC-e em operações como vendas e devoluções.</p>
                <p className="text-[9px] leading-relaxed text-slate-400">Isso permite avaliar a NFF antes de contratar certificado apenas para começar a emitir. A escolha não configura automaticamente o emissor integrado do Kyrub nem marca A1 ou CSC como concluídos.</p>
              </div> : <div className="space-y-2 rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 normal-case">
                <strong className="block text-[9px] uppercase text-amber-200">Disponibilidade depende da sua UF</strong>
                <p className="text-[9px] leading-relaxed text-slate-300">A NFF é nacional, mas a implantação por público e documento fiscal pode variar por estado. O Kyrub não presume que o recorte paulista vale para sua empresa.</p>
              </div>}
              <div className="space-y-2 normal-case">
                <p className="text-[9px] font-black uppercase text-slate-300">Baixar o aplicativo oficial</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <a className={externalLinkClass} href={NFF_PLAY_URL} target="_blank" rel="noreferrer">Android / Google Play <ExternalLink className="h-3.5 w-3.5" /></a>
                  <a className={externalLinkClass} href={NFF_APPLE_URL} target="_blank" rel="noreferrer">iPhone / App Store <ExternalLink className="h-3.5 w-3.5" /></a>
                </div>
              </div>
            </div>}
          </div>}
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2"><label className={labelClass}>Logradouro<input className={inputClass} value={profile.address.street} onChange={e => setAddress('street', e.target.value)} /></label><label className={labelClass}>Número<input className={inputClass} value={profile.address.number} onChange={e => setAddress('number', e.target.value)} /></label><label className={labelClass}>Complemento<input className={inputClass} value={profile.address.complement} onChange={e => setAddress('complement', e.target.value)} /></label><label className={labelClass}>Bairro<input className={inputClass} value={profile.address.district} onChange={e => setAddress('district', e.target.value)} /></label><label className={labelClass}>Município<input className={inputClass} value={profile.address.city} onChange={e => setAddress('city', e.target.value)} /></label><label className={labelClass}>UF<input className={inputClass} maxLength={2} value={profile.address.state} onChange={e => setAddress('state', e.target.value.toUpperCase())} /></label><label className={labelClass}>CEP<input className={inputClass} inputMode="numeric" value={profile.address.postalCode} onChange={e => setAddress('postalCode', e.target.value)} /></label><label className={labelClass}>Código IBGE do município<input className={inputClass} inputMode="numeric" value={profile.address.ibgeCityCode} onChange={e => setAddress('ibgeCityCode', e.target.value)} /></label></div>
        {missingFields.length > 0 && <p className="rounded-2xl border border-amber-500/20 px-3 py-2.5 text-[10px] text-amber-100">Campos obrigatórios pendentes: {missingFields.map(friendlyMissingField).join(', ')}.</p>}
        {profileFeedback && <p className={`rounded-2xl border px-3 py-2.5 text-[10px] ${profileState === 'error' ? 'border-red-500/20 text-red-100' : 'border-emerald-500/20 text-emerald-100'}`}>{profileFeedback}</p>}
        <div className="flex justify-end"><button type="button" onClick={() => void saveProfile()} disabled={profileState === 'saving'} className="min-h-11 rounded-xl bg-blue-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-50">{profileState === 'saving' ? 'Salvando...' : 'Salvar dados fiscais'}</button></div>
      </>}
    </section>

    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-cyan-400" /><h4 className="text-xs font-black uppercase text-white">Credenciais da NFC-e</h4></div><p className="mt-1 max-w-xl text-[10px] leading-relaxed text-slate-400">Cadastre o certificado A1 e o CSC da empresa. Os segredos são enviados ao cofre seguro e não podem ser lidos de volta pela interface.</p></div><span className="rounded-full border border-slate-700 px-2 py-1 font-mono text-[8px] font-black uppercase text-slate-400">Produção bloqueada</span></div>
      {credentialState === 'loading' ? <p className="text-[10px] text-slate-500">Consultando credenciais...</p> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex items-start justify-between gap-2"><div><h5 className="text-[11px] font-black uppercase text-white">Certificado digital A1</h5><p className="mt-1 text-[9px] text-slate-500">Arquivo PKCS#12 (.pfx ou .p12) e senha do certificado.</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[7px] font-black uppercase ${credentialStatus.certificateA1.configured ? 'border-emerald-500/20 text-emerald-300' : 'border-amber-500/20 text-amber-300'}`}>{credentialStatus.certificateA1.configured ? 'Configurado' : 'Pendente'}</span></div>
          {credentialStatus.certificateA1.configured && <p className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-[9px] text-emerald-100">Certificado atual: {credentialStatus.certificateA1.fileName || 'A1 protegido'}. Para substituir, selecione um novo arquivo e informe a senha correspondente.</p>}
          <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
            <button type="button" onClick={() => toggleHelp('a1')} aria-expanded={contextualHelp === 'a1'} className="flex w-full items-start justify-between gap-3 text-left"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><div><strong className="block text-[9px] uppercase text-cyan-100">Não tenho certificado A1</strong><span className="mt-1 block text-[9px] leading-relaxed text-slate-400">Entenda o que é e como providenciar.</span></div></div><span className="shrink-0 text-[8px] font-black uppercase text-cyan-200">{contextualHelp === 'a1' ? 'Fechar' : 'Como obter'}</span></button>
            {contextualHelp === 'a1' && <div className="mt-3 space-y-3 border-t border-cyan-500/10 pt-3">
              <p className="text-[9px] leading-relaxed text-slate-300">O A1 é o certificado digital da empresa usado na assinatura de documentos fiscais no fluxo integrado convencional. Ele não é criado automaticamente quando o CNPJ é aberto.</p>
              <div className="space-y-2 text-[9px] leading-relaxed text-slate-400">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><strong className="block text-white">1. Confirme se já existe</strong>Consulte sua contabilidade e procure por arquivos .pfx ou .p12 e mensagens sobre certificado digital.</div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><strong className="block text-white">2. Se não existir</strong>Providencie o certificado com uma autoridade certificadora adequada à empresa e guarde a senha com segurança.</div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><strong className="block text-white">3. Depois</strong>Cadastre o arquivo e a senha diretamente aqui. Não envie esses dados por mensagem.</div>
              </div>
              <p className="text-[9px] leading-relaxed text-amber-200">Não compre um certificado apenas para “deixar o check verde”. Primeiro confirme qual modalidade fiscal realmente se aplica à empresa.</p>
            </div>}
          </div>
          <label className={labelClass}>Arquivo A1<input key={a1InputKey} className="block min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] normal-case text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-[9px] file:font-black file:uppercase file:text-white" type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={event => setA1File(event.target.files?.[0] ?? null)} /></label>
          <label className={labelClass}>Senha do A1<input className={inputClass} type="password" autoComplete="new-password" value={a1Password} onChange={event => setA1Password(event.target.value)} placeholder="Não será exibida após salvar" /></label>
          <button type="button" onClick={() => void saveA1()} disabled={credentialState === 'saving_a1' || credentialState === 'saving_csc'} className="min-h-11 w-full rounded-xl bg-cyan-700 px-4 text-[10px] font-black uppercase text-white disabled:opacity-50">{credentialState === 'saving_a1' ? 'Guardando A1...' : credentialStatus.certificateA1.configured ? 'Substituir certificado A1' : 'Guardar certificado A1'}</button>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex items-start justify-between gap-2"><div><h5 className="text-[11px] font-black uppercase text-white">CSC da NFC-e</h5><p className="mt-1 text-[9px] text-slate-500">Identificador do CSC (idCSC) e código de segurança fornecidos pela SEFAZ.</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[7px] font-black uppercase ${credentialStatus.nfceCsc.configured ? 'border-emerald-500/20 text-emerald-300' : 'border-amber-500/20 text-amber-300'}`}>{credentialStatus.nfceCsc.configured ? 'Configurado' : 'Pendente'}</span></div>
          {credentialStatus.nfceCsc.configured && <p className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-[9px] text-emerald-100">CSC configurado com identificador {credentialStatus.nfceCsc.cscId || 'protegido'}. O código secreto não é exibido.</p>}
          <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
            <button type="button" onClick={() => toggleHelp('csc')} aria-expanded={contextualHelp === 'csc'} className="flex w-full items-start justify-between gap-3 text-left"><div className="flex items-start gap-2"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><div><strong className="block text-[9px] uppercase text-cyan-100">Como obter meu CSC?</strong><span className="mt-1 block text-[9px] leading-relaxed text-slate-400">Veja de onde vêm o idCSC e o código de segurança.</span></div></div><span className="shrink-0 text-[8px] font-black uppercase text-cyan-200">{contextualHelp === 'csc' ? 'Fechar' : 'Ver passo a passo'}</span></button>
            {contextualHelp === 'csc' && <div className="mt-3 space-y-3 border-t border-cyan-500/10 pt-3">
              {isSp ? <>
                <p className="text-[9px] leading-relaxed text-slate-300">Para estabelecimento em São Paulo, o CSC é obtido no ambiente da SEFAZ-SP após o credenciamento para NFC-e. No portal, a função de gerenciamento do Código de Segurança fornece o código e seu identificador (idCSC).</p>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-[9px] leading-relaxed text-slate-400"><strong className="block text-white">Sequência esperada</strong>Credenciar o estabelecimento para NFC-e → acessar o gerenciamento do Código de Segurança → gerar/consultar CSC e idCSC → cadastrar ambos aqui no Kyrub.</div>
                <a className={externalLinkClass} href={SP_NFCE_URL} target="_blank" rel="noreferrer">Abrir portal oficial NFC-e/SP <ExternalLink className="h-3.5 w-3.5" /></a>
              </> : <>
                <p className="text-[9px] leading-relaxed text-slate-300">O CSC é fornecido pela administração tributária competente para a NFC-e e o procedimento varia por UF.</p>
                <p className="text-[9px] leading-relaxed text-slate-400">Consulte o portal oficial da SEFAZ da sua UF para credenciamento de NFC-e e geração do CSC/idCSC. Depois, cadastre os valores diretamente aqui.</p>
              </>}
              <p className="text-[9px] leading-relaxed text-amber-200">CSC é segredo fiscal. O código não deve ser enviado por chat, e-mail aberto ou campo de observação.</p>
            </div>}
          </div>
          <label className={labelClass}>Identificador do CSC (idCSC)<input className={inputClass} value={cscId} onChange={event => setCscId(event.target.value)} placeholder="Ex.: 000001" /></label>
          <label className={labelClass}>Código CSC<input className={inputClass} type="password" autoComplete="new-password" value={csc} onChange={event => setCsc(event.target.value)} placeholder="Não será exibido após salvar" /></label>
          <button type="button" onClick={() => void saveCsc()} disabled={credentialState === 'saving_a1' || credentialState === 'saving_csc'} className="min-h-11 w-full rounded-xl bg-cyan-700 px-4 text-[10px] font-black uppercase text-white disabled:opacity-50">{credentialState === 'saving_csc' ? 'Guardando CSC...' : credentialStatus.nfceCsc.configured ? 'Substituir CSC' : 'Guardar CSC'}</button>
        </div>
      </div>}
      {credentialFeedback && <p className={`rounded-2xl border px-3 py-2.5 text-[10px] ${credentialState === 'error' ? 'border-red-500/20 text-red-100' : 'border-emerald-500/20 text-emerald-100'}`} role="status">{credentialFeedback}</p>}
      <p className="text-[9px] leading-relaxed text-slate-500">Guardar A1 ou CSC apenas comprova que a credencial está protegida no cofre. Isso não habilita tráfego fiscal de produção nem comprova homologação na SEFAZ.</p>
    </section>

    <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-400" /><h4 className="text-xs font-black uppercase text-white">Prontidão fiscal</h4></div>{readinessStatus !== 'loading' && readinessStatus !== 'error' && <span className={`rounded-full border px-2 py-1 font-mono text-[8px] font-black uppercase ${readinessStatus === 'ready_for_production_authorization' ? 'border-emerald-500/20 text-emerald-300' : 'border-amber-500/20 text-amber-300'}`}>{readinessStatus === 'ready_for_production_authorization' ? 'Pronto para autorização' : 'Pendente'}</span>}</div>
      {readinessStatus === 'loading' ? <p className="text-[10px] text-slate-500">Consultando requisitos...</p> : readinessStatus === 'error' ? <p className="text-[10px] text-red-200">{readinessFeedback}</p> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">{families.map(family => <div key={family.family} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex items-start justify-between gap-2"><div><h5 className="text-[11px] font-black uppercase text-white">{familyName(family.family)}</h5><p className="text-[9px] text-slate-500">{familyDescription(family.family)}</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[7px] font-black uppercase ${family.status === 'ready_for_production_authorization' ? 'border-emerald-500/20 text-emerald-300' : family.enabled ? 'border-amber-500/20 text-amber-300' : 'border-slate-700 text-slate-500'}`}>{family.status === 'ready_for_production_authorization' ? 'Pronto' : family.enabled ? 'Pendente' : 'Não configurado'}</span></div>{family.enabled ? <div className="space-y-2">{family.requirements.map(item => <div key={`${family.family}-${item.key}`} className="flex items-center gap-2"><span className={item.status === 'complete' ? 'text-emerald-400' : 'text-slate-600'}>{item.status === 'complete' ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}</span><span className="text-[9px] text-slate-300">{item.label}</span></div>)}</div> : <p className="text-[9px] leading-relaxed text-slate-500">Esta modalidade ainda não foi habilitada para a empresa.</p>}</div>)}</div>}
      <p className="text-[9px] leading-relaxed text-slate-500">Cada modalidade possui prontidão independente. Credenciais, certificado e segredos permanecem protegidos no backstage.</p>
    </section>

    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5"><ReceiptText className="h-5 w-5 text-violet-400" /><h4 className="mt-2 text-xs font-black uppercase text-white">Documentos fiscais</h4><p className="mt-1 text-[10px] leading-relaxed text-slate-400">Autorizações, rejeições e cancelamentos aparecerão aqui somente a partir de evidência autoritativa do serviço fiscal.</p></div>

    <div className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:flex-row sm:items-center"><div><h4 className="text-xs font-black uppercase text-white">Configurar Emissor Fiscal Kyrub</h4><p className="mt-1 max-w-xl text-[10px] text-slate-400">O provedor fiscal é gerenciado pelo Kyrub no backstage. A loja configura somente os requisitos da própria empresa.</p></div><button type="button" onClick={() => void startOnboarding()} disabled={onboardingState === 'preparing' || onboardingState === 'prepared'} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-[10px] font-black uppercase text-white disabled:opacity-50">{onboardingState === 'preparing' ? 'Preparando...' : onboardingState === 'prepared' ? 'Preparação iniciada' : 'Configurar emissão fiscal'}</button></div>
  </div>;
};
