import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Megaphone, Sparkles, UsersRound } from 'lucide-react';
import type { CustomerOrder } from '../../utils/customerOrders';
import { auth } from '../../utils/firebase';
import {
  buildCrmSegmentRecipients,
  createCrmSegmentCampaign,
  type CrmSegment,
} from '../../utils/crmSegmentCampaigns';
import type { PersonalizedBenefitType } from '../../utils/personalizedBenefits';

type Props = { orders: CustomerOrder[] };

const labels: Record<CrmSegment, string> = {
  new: 'Novos',
  recurring: 'Recorrentes',
  vip: 'VIP',
  inactive: 'Inativos',
};

export function CrmSegmentCampaignBridge({ orders }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [segment, setSegment] = useState<CrmSegment>('recurring');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PersonalizedBenefitType>('discount');
  const [value, setValue] = useState('10');
  const [code, setCode] = useState('');
  const [productName, setProductName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let currentHost: HTMLDivElement | null = null;
    const synchronize = () => {
      if (disposed) return;
      const dialog = document.querySelector('[role="dialog"][aria-label="CRM da loja"]');
      if (!(dialog instanceof HTMLElement)) {
        currentHost?.remove(); currentHost = null; setHost(null);
        timer = window.setTimeout(synchronize, 120); return;
      }
      const isProfile = Array.from(dialog.querySelectorAll('h3')).some(
        heading => heading.textContent?.trim().toLocaleLowerCase('pt-BR') === 'ficha do cliente'
      );
      if (isProfile) {
        currentHost?.remove(); currentHost = null; setHost(null);
        timer = window.setTimeout(synchronize, 120); return;
      }
      if (!currentHost?.isConnected) {
        const body = dialog.querySelector('.min-h-0.flex-1.overflow-y-auto');
        const firstSection = body?.querySelector('section');
        if (body instanceof HTMLElement) {
          currentHost = document.createElement('div');
          currentHost.id = 'kyrub-crm-segment-campaign-host';
          if (firstSection) firstSection.insertAdjacentElement('beforebegin', currentHost);
          else body.prepend(currentHost);
          setHost(currentHost);
        }
      }
      timer = window.setTimeout(synchronize, 120);
    };
    synchronize();
    return () => { disposed = true; window.clearTimeout(timer); currentHost?.remove(); setHost(null); };
  }, []);

  const recipients = useMemo(() => buildCrmSegmentRecipients(orders), [orders]);
  const counts = useMemo(() => ({
    new: recipients.filter(item => item.segment === 'new').length,
    recurring: recipients.filter(item => item.segment === 'recurring').length,
    vip: recipients.filter(item => item.segment === 'vip').length,
    inactive: recipients.filter(item => item.segment === 'inactive').length,
  }), [recipients]);

  const publish = async () => {
    const user = auth.currentUser;
    if (!user || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await createCrmSegmentCampaign(user, {
        segment,
        title,
        description,
        type,
        value: Math.max(0, Number(value) || 0),
        productName,
        code,
        startsAt,
        endsAt,
      }, recipients);
      setMessage(`Campanha publicada para ${result.recipientCount} cliente(s) de ${labels[segment]}.`);
      setTitle(''); setDescription(''); setCode(''); setProductName('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível publicar a campanha.');
    } finally { setBusy(false); }
  };

  if (!host) return null;

  return createPortal(
    <section className="mb-4 rounded-3xl border border-fuchsia-400/20 bg-fuchsia-400/5 p-4" id="crm-segment-campaigns">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-400/10 text-fuchsia-300"><Megaphone className="h-4 w-4" /></div>
          <div><h4 className="text-[10px] font-black uppercase tracking-[.12em] text-white">Campanha por segmento</h4><p className="mt-1 text-[9px] text-slate-500">Transforme a segmentação real do CRM em benefícios individuais no “Para você”.</p></div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2 py-1 text-[8px] font-black text-fuchsia-300"><UsersRound className="h-3 w-3" />{recipients.length}</span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {(Object.keys(labels) as CrmSegment[]).map(valueKey => (
          <button key={valueKey} type="button" onClick={() => setSegment(valueKey)} className={`rounded-xl border px-2 py-2 text-[7px] font-black uppercase ${segment === valueKey ? 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200' : 'border-slate-800 bg-slate-950 text-slate-500'}`}>
            <span className="block">{labels[valueKey]}</span><strong className="mt-1 block text-[10px]">{counts[valueKey]}</strong>
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex.: Sentimos sua falta — 15% OFF" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />
        <select value={type} onChange={event => setType(event.target.value as PersonalizedBenefitType)} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white"><option value="discount">Desconto</option><option value="voucher">Voucher / benefício</option><option value="free_product">Produto grátis</option></select>
        {type === 'discount' && <input type="number" min="0" value={value} onChange={event => setValue(event.target.value)} placeholder="Percentual" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />}
        {type === 'free_product' && <input value={productName} onChange={event => setProductName(event.target.value)} placeholder="Produto" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />}
        <input value={code} onChange={event => setCode(event.target.value)} placeholder="Código opcional" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] uppercase text-white" />
        <div className="grid grid-cols-2 gap-2"><input type="date" value={startsAt} onChange={event => setStartsAt(event.target.value)} className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-2 py-2 text-[9px] text-white" /><input type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-2 py-2 text-[9px] text-white" /></div>
      </div>
      <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Mensagem que aparecerá para este grupo de clientes" className="mt-2 min-h-16 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[8px] text-slate-500">Público atual: <strong className="text-fuchsia-200">{counts[segment]} {labels[segment].toLocaleLowerCase('pt-BR')}</strong></span>
        <button type="button" disabled={busy || !title.trim() || counts[segment] === 0} onClick={() => void publish()} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-400 px-3 py-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />{busy ? 'Publicando…' : 'Publicar campanha'}</button>
      </div>
      {message && <p className="mt-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/5 px-3 py-2 text-[9px] font-bold text-fuchsia-200">{message}</p>}
    </section>,
    host
  );
}
