import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PlugZap, Sparkles, Store as StoreIcon } from 'lucide-react';

interface StoreConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  configStoreName: string;
  setConfigStoreName: (val: string) => void;
  configStoreBio: string;
  setConfigStoreBio: (val: string) => void;
  configStoreAddress: string;
  setConfigStoreAddress: (val: string) => void;
  configStoreContact: string;
  setConfigStoreContact: (val: string) => void;
  configStoreKeywords: string;
  setConfigStoreKeywords: (val: string) => void;
  newAtendimentoSpace: string;
  setNewAtendimentoSpace: (val: string) => void;
  handleAddAtendimentoSpace: () => void;
  atendimentoSpaces: string[];
  handleRemoveAtendimentoSpace: (space: string) => void;
  newProducaoSpace: string;
  setNewProducaoSpace: (val: string) => void;
  handleAddProducaoSpace: () => void;
  producaoSpaces: string[];
  handleRemoveProducaoSpace: (space: string) => void;
  handleSaveStoreProfile: () => void;
  profileMediaControls?: React.ReactNode;
  profileOperationalControls?: React.ReactNode;
  integrationsControls?: React.ReactNode;
}

const STEPS = [
  ['identity', 'Identidade', 'Vamos começar pela identidade da sua loja: nome, descrição e palavras-chave.'],
  ['visual', 'Visual', 'Agora cuide de como sua loja aparece para o público: logo, capa e imagens.'],
  ['contact', 'Contato e localização', 'Informe onde a loja está e como seus clientes podem falar com você.'],
  ['operation', 'Funcionamento', 'Defina horários e demais regras operacionais da loja.'],
  ['spaces', 'Ambientes e estações', 'Organize os espaços de atendimento e as estações de produção.'],
  ['integrations', 'Integrações', 'Conecte os serviços que ajudam sua loja a funcionar.'],
  ['review', 'Revisão', 'Confira a configuração antes de salvar. Você pode voltar a qualquer etapa.'],
] as const;

export const StoreConfigModal: React.FC<StoreConfigModalProps> = props => {
  const {
    isOpen, onClose, configStoreName, setConfigStoreName, configStoreBio, setConfigStoreBio,
    configStoreAddress, setConfigStoreAddress, configStoreContact, setConfigStoreContact,
    configStoreKeywords, setConfigStoreKeywords, newAtendimentoSpace, setNewAtendimentoSpace,
    handleAddAtendimentoSpace, atendimentoSpaces, handleRemoveAtendimentoSpace,
    newProducaoSpace, setNewProducaoSpace, handleAddProducaoSpace, producaoSpaces,
    handleRemoveProducaoSpace, handleSaveStoreProfile, profileMediaControls,
    profileOperationalControls, integrationsControls,
  } = props;
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  const completed = useMemo(() => [
    Boolean(configStoreName.trim() && configStoreBio.trim() && configStoreKeywords.trim()),
    Boolean(profileMediaControls),
    Boolean(configStoreAddress.trim() && configStoreContact.trim()),
    Boolean(profileOperationalControls),
    atendimentoSpaces.length > 0 || producaoSpaces.length > 0,
    Boolean(integrationsControls),
  ], [configStoreName, configStoreBio, configStoreKeywords, configStoreAddress, configStoreContact, profileMediaControls, profileOperationalControls, atendimentoSpaces.length, producaoSpaces.length, integrationsControls]);

  if (!isOpen) return null;
  const goNext = () => setStepIndex(current => Math.min(STEPS.length - 1, current + 1));
  const goBack = () => setStepIndex(current => Math.max(0, current - 1));

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl flex flex-col font-sans animate-fade-in my-8 max-h-[90vh]">
        <header className="bg-slate-950 px-5 py-4 border-b border-slate-800">
          <div className="flex justify-between items-start gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 shrink-0 rounded-xl bg-orange-500 flex items-center justify-center"><StoreIcon className="w-5 h-5 text-slate-950" /></div>
              <div><span className="text-[9px] font-mono font-black uppercase tracking-[.18em] text-orange-400">Kyrubia · Configuração guiada</span><h3 className="text-base font-black text-white uppercase">Configurações da loja</h3></div>
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 bg-slate-900 border border-slate-800 w-9 h-9 rounded-full font-bold">✕</button>
          </div>
          <div className="mt-4 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-orange-500 transition-all" style={{width:`${progress}%`}} /></div><span className="text-[10px] font-mono font-black text-slate-400">{stepIndex + 1}/{STEPS.length}</span></div>
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">{STEPS.map((item,index)=><button type="button" key={item[0]} onClick={()=>setStepIndex(index)} title={item[1]} className={`h-2.5 min-w-8 flex-1 rounded-full ${index===stepIndex?'bg-orange-500':index<completed.length&&completed[index]?'bg-teal-500':'bg-slate-800'}`} />)}</div>
        </header>

        <div className="border-b border-slate-800 bg-orange-500/[.05] px-5 py-4"><div className="flex gap-3"><Sparkles className="w-5 h-5 shrink-0 text-orange-400"/><div><span className="text-[9px] font-black uppercase tracking-wider text-orange-400">Etapa {stepIndex+1}</span><h4 className="text-lg font-black text-white">{step[1]}</h4><p className="mt-1 text-sm leading-relaxed text-slate-300">{step[2]}</p></div></div></div>

        <main className="p-5 overflow-y-auto space-y-4 flex-1">
          {step[0] === 'identity' && <>
            <Field label="Nome da loja"><input data-store-profile-field="name" value={configStoreName} onChange={e=>setConfigStoreName(e.target.value)} className={inputClass} placeholder="Nome fantasia..." /></Field>
            <Field label="Biografia (descrição)"><textarea data-store-profile-field="description" value={configStoreBio} onChange={e=>setConfigStoreBio(e.target.value)} className={`${inputClass} h-28 resize-none`} placeholder="Fale brevemente sobre o seu negócio..." /></Field>
            <Field label="Palavras-chave"><input data-store-profile-field="keywords" value={configStoreKeywords} onChange={e=>setConfigStoreKeywords(e.target.value)} className={inputClass} placeholder="pizza, bar, lanches..." /></Field>
          </>}
          {step[0] === 'visual' && (profileMediaControls || <Empty text="Os controles de imagem aparecerão aqui quando estiverem disponíveis." />)}
          {step[0] === 'contact' && <><Field label="Endereço"><input data-store-profile-field="address" value={configStoreAddress} onChange={e=>setConfigStoreAddress(e.target.value)} className={inputClass} placeholder="Rua, número, bairro..." /></Field><Field label="Contato"><input data-store-profile-field="contact" value={configStoreContact} onChange={e=>setConfigStoreContact(e.target.value)} className={inputClass} placeholder="(DD) 99999-9999..." /></Field></>}
          {step[0] === 'operation' && (profileOperationalControls || <Empty text="Nenhuma configuração operacional adicional disponível." />)}
          {step[0] === 'spaces' && <div className="space-y-4"><SpaceEditor title="Espaços de atendimento" accent="orange" value={newAtendimentoSpace} setValue={setNewAtendimentoSpace} add={handleAddAtendimentoSpace} spaces={atendimentoSpaces} remove={handleRemoveAtendimentoSpace}/><SpaceEditor title="Espaços de produção" accent="teal" value={newProducaoSpace} setValue={setNewProducaoSpace} add={handleAddProducaoSpace} spaces={producaoSpaces} remove={handleRemoveProducaoSpace}/></div>}
          {step[0] === 'integrations' && (integrationsControls || <Empty text="Nenhuma integração disponível neste momento." />)}
          {step[0] === 'review' && <div className="space-y-3"><Review label="Loja" value={configStoreName || 'Não informado'}/><Review label="Descrição" value={configStoreBio || 'Não informada'}/><Review label="Contato" value={configStoreContact || 'Não informado'}/><Review label="Endereço" value={configStoreAddress || 'Não informado'}/><Review label="Ambientes" value={`${atendimentoSpaces.length} atendimento · ${producaoSpaces.length} produção`}/><p className="text-xs text-slate-500">Use os indicadores no topo para voltar diretamente a qualquer etapa antes de salvar.</p></div>}
        </main>

        <footer className="bg-slate-950 px-5 py-4 border-t border-slate-800 grid grid-cols-[auto_1fr] gap-3">
          <button type="button" onClick={stepIndex===0?onClose:goBack} className="min-h-12 px-4 rounded-2xl border border-slate-700 text-slate-300 font-black text-xs uppercase flex items-center gap-1"><ChevronLeft className="w-4 h-4"/>{stepIndex===0?'Fechar':'Voltar'}</button>
          {stepIndex < STEPS.length-1 ? <button type="button" onClick={goNext} className="min-h-12 rounded-2xl bg-orange-500 text-slate-950 font-black text-xs uppercase flex items-center justify-center gap-2">Continuar <ChevronRight className="w-4 h-4"/></button> : <button type="button" onClick={handleSaveStoreProfile} className="min-h-12 rounded-2xl bg-orange-500 text-slate-950 font-black text-xs uppercase">Salvar configuração</button>}
        </footer>
      </div>
    </div>
  );
};

const inputClass = 'w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-orange-500';
const Field: React.FC<{label:string;children:React.ReactNode}> = ({label,children}) => <div className="space-y-1.5"><label className="text-[10px] font-mono text-slate-400 uppercase font-black">{label}</label>{children}</div>;
const Empty: React.FC<{text:string}> = ({text}) => <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-sm text-slate-400">{text}</div>;
const Review: React.FC<{label:string;value:string}> = ({label,value}) => <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><span className="text-[9px] font-black uppercase text-slate-500">{label}</span><strong className="mt-1 block text-sm text-white">{value}</strong></div>;

const SpaceEditor: React.FC<{title:string;accent:'orange'|'teal';value:string;setValue:(v:string)=>void;add:()=>void;spaces:string[];remove:(v:string)=>void}> = ({title,accent,value,setValue,add,spaces,remove}) => <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-3"><h4 className={`text-[10px] font-mono uppercase font-black ${accent==='orange'?'text-orange-400':'text-teal-400'}`}>{title}</h4><div className="flex gap-2"><input value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()} className="min-w-0 flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white uppercase" placeholder="Novo espaço..."/><button type="button" onClick={add} className={`${accent==='orange'?'bg-orange-500':'bg-teal-500'} text-slate-950 font-black px-3 rounded-xl text-xs`}>+ Adicionar</button></div><div className="flex flex-wrap gap-2">{spaces.map(space=><span key={space} className="inline-flex items-center gap-2 bg-slate-900 border border-slate-800 text-xs text-slate-300 px-3 py-1.5 rounded-full font-bold">{space}<button type="button" onClick={()=>remove(space)} className="text-red-400">✕</button></span>)}</div></section>;
