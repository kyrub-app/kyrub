import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, CircleDashed, SkipForward } from 'lucide-react';
import type {
  MercadoLivreE2ECategoryAttribute,
  MercadoLivreE2ECategoryOptions,
  MercadoLivreSaleTermInput,
  MercadoLivreShippingInput,
} from '../../utils/mercadoLivreE2ETest';

type AttributeValue = { valueId?: string; valueName?: string };
type SaleTermDraft = { valueId?: string; valueName?: string; amount?: string; unit?: string };
type StepId = 'configuration' | 'variations' | 'required' | 'additional' | 'sale_terms' | 'shipping' | 'review';

type WizardStep = {
  id: StepId;
  title: string;
  description: string;
  attributes?: MercadoLivreE2ECategoryAttribute[];
};

export interface MercadoLivreCommercialWizardInput {
  saleTerms: MercadoLivreSaleTermInput[];
  shipping?: MercadoLivreShippingInput;
}

const hasValue = (value?: AttributeValue): boolean => Boolean(value?.valueId?.trim() || value?.valueName?.trim());
const requiredForCondition = (attribute: MercadoLivreE2ECategoryAttribute, condition: string): boolean =>
  attribute.required || attribute.catalogRequired || (condition === 'new' && attribute.newRequired);
const editable = (attribute: MercadoLivreE2ECategoryAttribute): boolean => !attribute.hidden && !attribute.readOnly;
const attributeLabel = (attribute: MercadoLivreE2ECategoryAttribute, condition: string): string => {
  if (requiredForCondition(attribute, condition)) return 'obrigatório';
  if (attribute.conditionalRequired) return 'validação condicional';
  return 'opcional';
};
const shippingModeLabel = (mode: string): string => {
  if (mode === 'me2') return 'Mercado Envios (ME2)';
  if (mode === 'me1') return 'Mercado Envios (ME1)';
  if (mode === 'custom') return 'Envio personalizado';
  if (mode === 'not_specified') return 'Envio não especificado';
  return mode;
};

function AttributeField({ attribute, condition, value, onChange }: {
  attribute: MercadoLivreE2ECategoryAttribute;
  condition: string;
  value?: AttributeValue;
  onChange: (value: AttributeValue) => void;
}) {
  const label = attributeLabel(attribute, condition);
  const required = requiredForCondition(attribute, condition);
  const inputId = `ml-attribute-${attribute.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const datalistId = `${inputId}-suggestions`;
  return (
    <label className="block rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-[10px] font-bold text-slate-300">
      <span className="flex flex-wrap items-center gap-2">
        <span>{attribute.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${required ? 'bg-amber-500/15 text-amber-200' : attribute.conditionalRequired ? 'bg-cyan-500/15 text-cyan-200' : 'bg-slate-800 text-slate-400'}`}>{label}</span>
        {(attribute.variationAttribute || attribute.allowVariations) && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-200">variação</span>}
      </span>
      <span className="mt-1 block text-[8px] font-normal text-slate-600">{attribute.id}</span>
      {attribute.values.length > 0 && attribute.valueType.trim().toLowerCase() !== 'string' ? (
        <select id={inputId} value={value?.valueId ?? ''} onChange={event => {
          const chosen = attribute.values.find(candidate => candidate.id === event.target.value);
          onChange(chosen ? { valueId: chosen.id, valueName: chosen.name } : {});
        }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
          <option value="">Não informado</option>
          {attribute.values.map(option => <option key={`${attribute.id}:${option.id}`} value={option.id}>{option.name}</option>)}
        </select>
      ) : (
        <>
          <input id={inputId} list={attribute.values.length ? datalistId : undefined} value={value?.valueName ?? ''} onChange={event => onChange({ valueName: event.target.value })} placeholder={required ? 'Preencha para publicar' : 'Opcional — pode deixar em branco'} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white placeholder:text-slate-700" />
          {attribute.values.length > 0 && <datalist id={datalistId}>{attribute.values.map(option => <option key={`${attribute.id}:${option.id}`} value={option.name} />)}</datalist>}
        </>
      )}
    </label>
  );
}

export default function MercadoLivreRequirementsWizard({
  options, listingTypeId, condition, attributeValues, busy,
  onListingTypeChange, onConditionChange, onAttributeChange, onValidate,
}: {
  options: MercadoLivreE2ECategoryOptions;
  listingTypeId: string;
  condition: string;
  attributeValues: Record<string, AttributeValue>;
  busy: boolean;
  onListingTypeChange: (value: string) => void;
  onConditionChange: (value: string) => void;
  onAttributeChange: (id: string, value: AttributeValue) => void;
  onValidate: (commercial: MercadoLivreCommercialWizardInput) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [skipped, setSkipped] = useState<Set<StepId>>(new Set());
  const [saleTermValues, setSaleTermValues] = useState<Record<string, SaleTermDraft>>({});
  const [shippingMode, setShippingMode] = useState('');
  const [freeShippingChoice, setFreeShippingChoice] = useState('');
  const [localPickUpChoice, setLocalPickUpChoice] = useState('');

  const editableAttributes = useMemo(() => options.attributes.filter(editable), [options.attributes]);
  const variationAttributes = useMemo(() => editableAttributes.filter(attribute => attribute.variationAttribute || attribute.allowVariations), [editableAttributes]);
  const requiredAttributes = useMemo(() => editableAttributes.filter(attribute => !variationAttributes.includes(attribute) && (requiredForCondition(attribute, condition) || attribute.conditionalRequired)), [editableAttributes, variationAttributes, condition]);
  const additionalAttributes = useMemo(() => editableAttributes.filter(attribute => !variationAttributes.includes(attribute) && !requiredAttributes.includes(attribute)), [editableAttributes, variationAttributes, requiredAttributes]);

  const steps = useMemo<WizardStep[]>(() => [
    { id: 'configuration', title: 'Configuração do anúncio', description: 'Escolha condição e tipo de anúncio antes de revisar os dados da categoria.' },
    { id: 'variations', title: 'Variações', description: variationAttributes.length ? 'Preencha cor, tamanho e outros dados que o Mercado Livre permite usar para diferenciar variações.' : 'Esta categoria não retornou atributos de variação editáveis.', attributes: variationAttributes },
    { id: 'required', title: 'Características necessárias', description: 'Obrigatórios e condicionais ficam juntos aqui. Você pode avançar e deixar a validação oficial apontar o que ainda faltar.', attributes: requiredAttributes },
    { id: 'additional', title: 'Características adicionais', description: 'Informações opcionais enriquecem o anúncio e podem depois enriquecer o cadastro do produto no Kyrub. Preencha o que souber ou pule a etapa.', attributes: additionalAttributes },
    { id: 'sale_terms', title: 'Disponibilidade e garantia', description: 'Prazo de disponibilidade, garantia e demais condições comerciais vêm da própria categoria do Mercado Livre. Você pode pular o que não souber.' },
    { id: 'shipping', title: 'Entrega', description: 'Escolha apenas modos permitidos para esta conta e categoria. Se pular, o validador oficial poderá pedir uma decisão depois.' },
    { id: 'review', title: 'Revisão e validação', description: 'Revise o preenchimento. O Mercado Livre continua sendo a autoridade final e pode pedir correções depois desta etapa.' },
  ], [variationAttributes, requiredAttributes, additionalAttributes]);

  useEffect(() => { setStepIndex(previous => Math.min(previous, steps.length - 1)); }, [steps.length]);
  const step = steps[stepIndex];
  const answeredCount = editableAttributes.filter(attribute => hasValue(attributeValues[attribute.id])).length;
  const missingRequired = editableAttributes.filter(attribute => requiredForCondition(attribute, condition) && !hasValue(attributeValues[attribute.id]));
  const saleTermCount = Object.values(saleTermValues).filter(value => Boolean(value.valueId?.trim() || value.valueName?.trim() || value.amount?.trim())).length;
  const shippingComplete = Boolean(shippingMode && freeShippingChoice && (!options.shipping.localPickUpAvailable || localPickUpChoice));

  const statusFor = (candidate: WizardStep): 'complete' | 'skipped' | 'attention' | 'pending' => {
    if (candidate.id === 'configuration') return listingTypeId && condition ? 'complete' : skipped.has(candidate.id) ? 'skipped' : 'attention';
    if (candidate.id === 'sale_terms') {
      const missing = options.saleTerms.filter(term => term.required).some(term => {
        const value = saleTermValues[term.id];
        return !value?.valueId?.trim() && !value?.valueName?.trim() && !value?.amount?.trim();
      });
      if (missing) return skipped.has(candidate.id) ? 'skipped' : 'attention';
      if (skipped.has(candidate.id)) return 'skipped';
      return 'complete';
    }
    if (candidate.id === 'shipping') {
      if (skipped.has(candidate.id)) return 'skipped';
      return shippingComplete ? 'complete' : 'attention';
    }
    if (candidate.id === 'review') return 'pending';
    const attrs = candidate.attributes ?? [];
    const missing = attrs.filter(attribute => requiredForCondition(attribute, condition) && !hasValue(attributeValues[attribute.id]));
    if (missing.length) return skipped.has(candidate.id) ? 'skipped' : 'attention';
    if (skipped.has(candidate.id)) return 'skipped';
    return 'complete';
  };

  const statusBadge = (candidate: WizardStep) => {
    const status = statusFor(candidate);
    if (status === 'complete') return <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Concluída</span>;
    if (status === 'skipped') return <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase text-slate-500"><CircleDashed className="h-3 w-3" /> Pulada</span>;
    if (status === 'attention') return <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase text-amber-300"><CircleAlert className="h-3 w-3" /> Requer atenção</span>;
    return <span className="text-[8px] font-black uppercase text-slate-600">Revisão</span>;
  };

  const moveNext = (): void => setStepIndex(previous => Math.min(previous + 1, steps.length - 1));
  const skipCurrent = (): void => { setSkipped(previous => new Set(previous).add(step.id)); moveNext(); };

  const normalizedSaleTerms = (): MercadoLivreSaleTermInput[] => options.saleTerms.flatMap(term => {
    const draft = saleTermValues[term.id];
    if (!draft) return [];
    if (draft.valueId || draft.valueName) return [{ id: term.id, ...(draft.valueId ? { valueId: draft.valueId } : {}), ...(draft.valueName ? { valueName: draft.valueName } : {}) }];
    if (draft.amount?.trim()) {
      const unit = draft.unit?.trim() || term.defaultUnit || term.allowedUnits[0]?.name || term.allowedUnits[0]?.id || '';
      return unit ? [{ id: term.id, valueName: `${draft.amount.trim()} ${unit}` }] : [{ id: term.id, valueName: draft.amount.trim() }];
    }
    return [];
  });
  const normalizedShipping = (): MercadoLivreShippingInput | undefined => shippingComplete ? {
    mode: shippingMode,
    freeShipping: freeShippingChoice === 'seller',
    localPickUp: options.shipping.localPickUpAvailable ? localPickUpChoice === 'yes' : false,
  } : undefined;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/40 p-3 sm:p-4" id="mercado-livre-requirements-wizard">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {steps.map((candidate, index) => <button key={candidate.id} type="button" onClick={() => setStepIndex(index)} className={`rounded-xl border px-2 py-2 text-left ${index === stepIndex ? 'border-cyan-400/40 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/50'}`}><span className="block text-[8px] font-black uppercase tracking-wide text-slate-500">Etapa {index + 1}</span><span className="mt-0.5 block text-[9px] font-black text-slate-200">{candidate.title}</span><span className="mt-1 block">{statusBadge(candidate)}</span></button>)}
      </div>
      <div className="mt-4"><p className="text-[11px] font-black text-white">{step.title}</p><p className="mt-1 text-[9px] leading-relaxed text-slate-500">{step.description}</p></div>

      {step.id === 'configuration' && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[10px] font-bold text-slate-400">Tipo de anúncio<select value={listingTypeId} onChange={event => onListingTypeChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"><option value="">Selecione…</option>{options.listingTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-[10px] font-bold text-slate-400">Condição<select value={condition} onChange={event => onConditionChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"><option value="">Selecione…</option>{options.conditions.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>}

      {(step.id === 'variations' || step.id === 'required' || step.id === 'additional') && <div className="mt-4 grid gap-3 sm:grid-cols-2">{(step.attributes ?? []).length ? (step.attributes ?? []).map(attribute => <AttributeField key={attribute.id} attribute={attribute} condition={condition} value={attributeValues[attribute.id]} onChange={value => onAttributeChange(attribute.id, value)} />) : <p className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-500">Nenhum campo desta categoria nesta etapa.</p>}</div>}

      {step.id === 'sale_terms' && <div className="mt-4 grid gap-3 sm:grid-cols-2">{options.saleTerms.length ? options.saleTerms.map(term => {
        const draft = saleTermValues[term.id] ?? {};
        return <div key={term.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold text-slate-300">{term.name}</span><span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase ${term.required ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-slate-400'}`}>{term.required ? 'obrigatório' : 'opcional'}</span></div><span className="mt-1 block text-[8px] text-slate-600">{term.id}</span>
          {term.values.length > 0 ? <select value={draft.valueId ?? ''} onChange={event => { const option = term.values.find(item => item.id === event.target.value); setSaleTermValues(previous => ({ ...previous, [term.id]: option ? { valueId: option.id, valueName: option.name } : {} })); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"><option value="">Não informado</option>{term.values.map(option => <option key={`${term.id}:${option.id}`} value={option.id}>{option.name}</option>)}</select> : term.allowedUnits.length > 0 ? <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input type="number" min="0" step="1" value={draft.amount ?? ''} onChange={event => setSaleTermValues(previous => ({ ...previous, [term.id]: { ...previous[term.id], amount: event.target.value } }))} placeholder={term.id === 'MANUFACTURING_TIME' ? '0 = disponível agora' : 'Quantidade'} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" /><select value={draft.unit ?? term.defaultUnit ?? term.allowedUnits[0]?.name ?? ''} onChange={event => setSaleTermValues(previous => ({ ...previous, [term.id]: { ...previous[term.id], unit: event.target.value } }))} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">{term.allowedUnits.map(unit => <option key={`${term.id}:${unit.id}`} value={unit.name || unit.id}>{unit.name || unit.id}</option>)}</select></div> : <input value={draft.valueName ?? ''} onChange={event => setSaleTermValues(previous => ({ ...previous, [term.id]: { valueName: event.target.value } }))} placeholder="Opcional — pode deixar em branco" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />}
        </div>;
      }) : <p className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-500">O Mercado Livre não retornou condições comerciais adicionais para esta categoria.</p>}</div>}

      {step.id === 'shipping' && <div className="mt-4 space-y-3">
        <label className="block text-[10px] font-bold text-slate-400">Forma de entrega<select value={shippingMode} onChange={event => setShippingMode(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"><option value="">Não informado</option>{options.shipping.allowedModes.map(mode => <option key={mode} value={mode}>{shippingModeLabel(mode)}</option>)}</select></label>
        {options.shipping.allowedModes.length === 0 && <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] text-amber-100">Nenhum modo de envio comum entre esta conta e a categoria foi retornado. Pule esta etapa e deixe o validador oficial explicar a restrição.</p>}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[10px] font-bold text-slate-300">Quem arca com o frete?</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setFreeShippingChoice('buyer')} className={`rounded-xl border px-3 py-2 text-[10px] font-bold ${freeShippingChoice === 'buyer' ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 text-slate-400'}`}>Frete por conta do comprador</button><button type="button" onClick={() => setFreeShippingChoice('seller')} className={`rounded-xl border px-3 py-2 text-[10px] font-bold ${freeShippingChoice === 'seller' ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 text-slate-400'}`}>Oferecer frete grátis</button></div></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[10px] font-bold text-slate-300">Retirada pessoal</p>{options.shipping.localPickUpAvailable ? <div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setLocalPickUpChoice('yes')} className={`rounded-xl border px-3 py-2 text-[10px] font-bold ${localPickUpChoice === 'yes' ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 text-slate-400'}`}>Ofereço retirada</button><button type="button" onClick={() => setLocalPickUpChoice('no')} className={`rounded-xl border px-3 py-2 text-[10px] font-bold ${localPickUpChoice === 'no' ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 text-slate-400'}`}>Não ofereço</button></div> : <p className="mt-2 text-[9px] text-slate-500">A preferência atual da conta não disponibiliza retirada local para esta configuração.</p>}</div>
      </div>}

      {step.id === 'review' && <div className="mt-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Categoria</span><p className="mt-1 text-[10px] font-bold text-white">{options.category.name}</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Características</span><p className="mt-1 text-[10px] font-bold text-white">{answeredCount} de {editableAttributes.length} preenchidas</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Condições comerciais</span><p className="mt-1 text-[10px] font-bold text-white">{saleTermCount} preenchida(s)</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-[8px] font-black uppercase text-slate-600">Entrega</span><p className={`mt-1 text-[10px] font-bold ${shippingComplete ? 'text-emerald-300' : 'text-amber-200'}`}>{shippingComplete ? shippingModeLabel(shippingMode) : 'Não concluída'}</p></div></div>
        {missingRequired.length > 0 && <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] leading-relaxed text-amber-100">Você pode validar mesmo assim. Se algum campo for indispensável, o Mercado Livre devolverá a correção e o Cairube poderá conduzir o preenchimento faltante.</p>}
        <button type="button" onClick={() => onValidate({ saleTerms: normalizedSaleTerms(), shipping: normalizedShipping() })} disabled={busy || !listingTypeId || !condition} className="w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-[10px] font-black uppercase text-cyan-200 disabled:opacity-40">Validar com Mercado Livre</button>
      </div>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3"><button type="button" onClick={() => setStepIndex(previous => Math.max(previous - 1, 0))} disabled={stepIndex === 0} className="inline-flex items-center gap-1 rounded-xl border border-slate-800 px-3 py-2 text-[9px] font-black uppercase text-slate-400 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /> Voltar</button>{step.id !== 'review' && <div className="flex gap-2"><button type="button" onClick={skipCurrent} className="inline-flex items-center gap-1 rounded-xl border border-slate-800 px-3 py-2 text-[9px] font-black uppercase text-slate-500"><SkipForward className="h-3.5 w-3.5" /> Pular etapa</button><button type="button" onClick={moveNext} className="inline-flex items-center gap-1 rounded-xl bg-cyan-300 px-3 py-2 text-[9px] font-black uppercase text-slate-950">Continuar <ChevronRight className="h-3.5 w-3.5" /></button></div>}</div>
    </div>
  );
}
