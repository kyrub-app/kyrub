import React, { useEffect, useState } from 'react';
import { Building2, FileCheck2, ReceiptText, ShieldCheck } from 'lucide-react';
import { auth } from '../../utils/firebase';

interface FiscalWorkspaceProps { storeName: string; onStartOnboarding?: () => void | Promise<void>; }
type FiscalOnboardingState = 'required' | 'preparing' | 'prepared' | 'error';
type ProfileState = 'loading' | 'ready' | 'saving' | 'error';

type FiscalProfile = {
  legalName: string; cnpj: string; stateRegistration: string; municipalRegistration: string; taxRegime: string;
  address: { street: string; number: string; complement: string; district: string; city: string; state: string; postalCode: string; ibgeCityCode: string; };
};
const emptyProfile = (): FiscalProfile => ({ legalName: '', cnpj: '', stateRegistration: '', municipalRegistration: '', taxRegime: '', address: { street: '', number: '', complement: '', district: '', city: '', state: '', postalCode: '', ibgeCityCode: '' } });
const endpoint = '/api/store-connections/fiscal/profile';

export const FiscalWorkspace: React.FC<FiscalWorkspaceProps> = ({ storeName, onStartOnboarding }) => {
  const [onboardingState, setOnboardingState] = useState<FiscalOnboardingState>('required');
  const [feedback, setFeedback] = useState('');
  const [profileState, setProfileState] = useState<ProfileState>('loading');
  const [profile, setProfile] = useState<FiscalProfile>(emptyProfile);
  const [profileFeedback, setProfileFeedback] = useState('');
  const [completeness, setCompleteness] = useState<'pending' | 'complete'>('pending');
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const requestToken = async (): Promise<{ token: string; uid: string }> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Faça login novamente para configurar a emissão fiscal.');
    return { token: await user.getIdToken(), uid: user.uid };
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { token, uid } = await requestToken();
        const response = await fetch(`${endpoint}?canonicalStoreId=${encodeURIComponent(uid)}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
        const payload = await response.json().catch(() => ({})) as Record<string, any>;
        if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível carregar os dados fiscais.');
        if (!active) return;
        setProfile({ legalName: payload.legalName ?? '', cnpj: payload.cnpj ?? '', stateRegistration: payload.stateRegistration ?? '', municipalRegistration: payload.municipalRegistration ?? '', taxRegime: payload.taxRegime ?? '', address: { ...emptyProfile().address, ...(payload.address ?? {}) } });
        setCompleteness(payload.completeness === 'complete' ? 'complete' : 'pending');
        setMissingFields(Array.isArray(payload.missingFields) ? payload.missingFields.filter((item: unknown): item is string => typeof item === 'string') : []);
        setProfileState('ready');
      } catch (error) {
        if (!active) return;
        setProfileState('error'); setProfileFeedback(error instanceof Error ? error.message : 'Não foi possível carregar os dados fiscais.');
      }
    })();
    return () => { active = false; };
  }, []);

  const startOnboarding = async (): Promise<void> => {
    if (onboardingState === 'preparing' || onboardingState === 'prepared') return;
    setOnboardingState('preparing'); setFeedback('');
    try {
      if (onStartOnboarding) await onStartOnboarding();
      else {
        const { token, uid } = await requestToken();
        const response = await fetch('/api/store-connections/fiscal/onboarding/prepare', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ canonicalStoreId: uid }), cache: 'no-store' });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) throw new Error(typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : 'Não foi possível iniciar a configuração fiscal.');
        if (payload.status !== 'prepared' || payload.productionTrafficAllowed !== false) throw new Error('O backend não confirmou a preparação fiscal em modo seguro.');
      }
      setOnboardingState('prepared'); setFeedback('Preparação fiscal iniciada. A emissão em produção continua bloqueada até a validação dos dados fiscais da empresa.');
    } catch (error) { setOnboardingState('error'); setFeedback(error instanceof Error ? error.message : 'Não foi possível iniciar a configuração fiscal.'); }
  };

  const saveProfile = async (): Promise<void> => {
    if (profileState === 'saving') return;
    setProfileState('saving'); setProfileFeedback('');
    try {
      const { token, uid } = await requestToken();
      const response = await fetch(endpoint, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ canonicalStoreId: uid, profile }), cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível salvar os dados fiscais.');
      setProfile({ legalName: payload.legalName ?? '', cnpj: payload.cnpj ?? '', stateRegistration: payload.stateRegistration ?? '', municipalRegistration: payload.municipalRegistration ?? '', taxRegime: payload.taxRegime ?? '', address: { ...emptyProfile().address, ...(payload.address ?? {}) } });
      const complete = payload.completeness === 'complete'; setCompleteness(complete ? 'complete' : 'pending');
      setMissingFields(Array.isArray(payload.missingFields) ? payload.missingFields.filter((item: unknown): item is string => typeof item === 'string') : []);
      setProfileState('ready'); setProfileFeedback(complete ? 'Dados fiscais salvos e estruturalmente completos. A emissão em produção continua bloqueada.' : 'Dados fiscais salvos. Complete os campos pendentes para avançar no onboarding.');
    } catch (error) { setProfileState('error'); setProfileFeedback(error instanceof Error ? error.message : 'Não foi possível salvar os dados fiscais.'); }
  };

  const setField = (key: keyof Omit<FiscalProfile, 'address'>, value: string) => setProfile(current => ({ ...current, [key]: value }));
  const setAddress = (key: keyof FiscalProfile['address'], value: string) => setProfile(current => ({ ...current, address: { ...current.address, [key]: value } }));
  const inputClass = 'min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[11px] text-white outline-none focus:border-emerald-500/60';
  const labelClass = 'space-y-1 text-[9px] font-black uppercase tracking-wide text-slate-500';
  const statusLabel = onboardingState === 'prepared' ? 'Preparação iniciada' : onboardingState === 'preparing' ? 'Preparando...' : onboardingState === 'error' ? 'Configuração pendente' : 'Configuração necessária';

  return <div className="space-y-5" id="kyrub-fiscal-workspace">
    <div className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3"><div><span className="font-mono text-[9px] font-black uppercase tracking-wider text-emerald-400">Emissor Fiscal Kyrub</span><h3 className="mt-1 text-sm font-black uppercase text-white">Fiscal</h3><p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-400">Configure a emissão fiscal da {storeName || 'sua loja'} e acompanhe os documentos vinculados às vendas do Kyrub.</p></div><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><FileCheck2 className="h-5 w-5" /></div></div>
      <div className="flex flex-wrap items-center gap-2 pt-1"><span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] font-black uppercase ${onboardingState === 'prepared' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-400'}`}>{statusLabel}</span><span className="font-mono text-[9px] text-slate-500">Produção bloqueada até validação fiscal.</span></div>
      {feedback && <p className={`rounded-2xl border px-3 py-2.5 text-[10px] leading-relaxed ${onboardingState === 'prepared' ? 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100' : 'border-red-500/20 bg-red-500/[0.06] text-red-100'}`} role="status">{feedback}</p>}
    </div>

    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-400" /><h4 className="text-xs font-black uppercase text-white">Dados fiscais</h4></div><p className="mt-1 text-[10px] leading-relaxed text-slate-400">Informe os dados reais da empresa emitente. O Kyrub não infere regime tributário nem classificação fiscal.</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[8px] font-black uppercase ${completeness === 'complete' ? 'border-emerald-500/20 text-emerald-300' : 'border-amber-500/20 text-amber-300'}`}>{completeness === 'complete' ? 'Completo' : 'Pendente'}</span></div>
      {profileState === 'loading' ? <p className="text-[10px] text-slate-500">Carregando dados fiscais...</p> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={labelClass}>Razão social<input className={inputClass} value={profile.legalName} onChange={e => setField('legalName', e.target.value)} /></label><label className={labelClass}>CNPJ<input className={inputClass} inputMode="numeric" value={profile.cnpj} onChange={e => setField('cnpj', e.target.value)} placeholder="Somente números ou formatado" /></label><label className={labelClass}>Inscrição estadual<input className={inputClass} value={profile.stateRegistration} onChange={e => setField('stateRegistration', e.target.value)} /></label><label className={labelClass}>Inscrição municipal<input className={inputClass} value={profile.municipalRegistration} onChange={e => setField('municipalRegistration', e.target.value)} /></label><label className={`${labelClass} sm:col-span-2`}>Regime tributário declarado<input className={inputClass} value={profile.taxRegime} onChange={e => setField('taxRegime', e.target.value)} placeholder="Informe conforme orientação contábil" /></label></div>
        <div className="grid grid-cols-1 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2"><label className={labelClass}>Logradouro<input className={inputClass} value={profile.address.street} onChange={e => setAddress('street', e.target.value)} /></label><label className={labelClass}>Número<input className={inputClass} value={profile.address.number} onChange={e => setAddress('number', e.target.value)} /></label><label className={labelClass}>Complemento<input className={inputClass} value={profile.address.complement} onChange={e => setAddress('complement', e.target.value)} /></label><label className={labelClass}>Bairro<input className={inputClass} value={profile.address.district} onChange={e => setAddress('district', e.target.value)} /></label><label className={labelClass}>Município<input className={inputClass} value={profile.address.city} onChange={e => setAddress('city', e.target.value)} /></label><label className={labelClass}>UF<input className={inputClass} maxLength={2} value={profile.address.state} onChange={e => setAddress('state', e.target.value.toUpperCase())} /></label><label className={labelClass}>CEP<input className={inputClass} inputMode="numeric" value={profile.address.postalCode} onChange={e => setAddress('postalCode', e.target.value)} /></label><label className={labelClass}>Código IBGE do município<input className={inputClass} inputMode="numeric" value={profile.address.ibgeCityCode} onChange={e => setAddress('ibgeCityCode', e.target.value)} /></label></div>
        {missingFields.length > 0 && <p className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5 text-[10px] text-amber-100">Campos obrigatórios ainda pendentes: {missingFields.join(', ')}.</p>}
        {profileFeedback && <p className={`rounded-2xl border px-3 py-2.5 text-[10px] ${profileState === 'error' ? 'border-red-500/20 text-red-100' : 'border-emerald-500/20 text-emerald-100'}`} role="status">{profileFeedback}</p>}
        <div className="flex justify-end"><button type="button" onClick={() => void saveProfile()} disabled={profileState === 'saving'} className="min-h-11 rounded-xl bg-blue-600 px-4 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-50">{profileState === 'saving' ? 'Salvando...' : 'Salvar dados fiscais'}</button></div>
      </>}
    </section>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="space-y-2 rounded-3xl border border-slate-800 bg-slate-900 p-5"><ShieldCheck className="h-5 w-5 text-emerald-400" /><h4 className="text-xs font-black uppercase text-white">Situação da emissão</h4><p className="text-[10px] leading-relaxed text-slate-400">A loja só poderá emitir após preparação, validação, homologação e autorização explícita do fluxo fiscal.</p></div><div className="space-y-2 rounded-3xl border border-slate-800 bg-slate-900 p-5"><ReceiptText className="h-5 w-5 text-violet-400" /><h4 className="text-xs font-black uppercase text-white">Documentos fiscais</h4><p className="text-[10px] leading-relaxed text-slate-400">Autorizações, rejeições e cancelamentos aparecerão aqui somente a partir de evidência autoritativa do serviço fiscal.</p></div></div>

    <div className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:flex-row sm:items-center"><div><h4 className="text-xs font-black uppercase text-white">Configurar Emissor Fiscal Kyrub</h4><p className="mt-1 max-w-xl text-[10px] text-slate-400">O provedor fiscal é gerenciado pelo Kyrub no backstage. A loja configura somente os dados e requisitos da própria empresa.</p></div><button type="button" onClick={() => void startOnboarding()} disabled={onboardingState === 'preparing' || onboardingState === 'prepared'} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-50">{onboardingState === 'preparing' ? 'Preparando...' : onboardingState === 'prepared' ? 'Preparação iniciada' : 'Configurar emissão fiscal'}</button></div>
  </div>;
};
