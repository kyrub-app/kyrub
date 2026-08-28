import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gift, Sparkles } from 'lucide-react';
import type { CustomerOrder } from '../../utils/customerOrders';
import { auth } from '../../utils/firebase';
import {
  savePersonalizedBenefit,
  type PersonalizedBenefitType,
} from '../../utils/personalizedBenefits';

type Props = { orders: CustomerOrder[] };

const normalizeEmail = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const findProfileEmail = (dialog: HTMLElement): string => {
  for (const candidate of Array.from(dialog.querySelectorAll('p, span, strong'))) {
    const text = candidate.textContent?.trim() ?? '';
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) return normalizeEmail(match[0]);
  }
  return '';
};

export function CrmPersonalizedBenefitBridge({ orders }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PersonalizedBenefitType>('discount');
  const [value, setValue] = useState('10');
  const [code, setCode] = useState('');
  const [productName, setProductName] = useState('');
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
        currentHost?.remove(); currentHost = null; setHost(null); setSelectedEmail('');
        timer = window.setTimeout(synchronize, 120); return;
      }
      const isProfile = Array.from(dialog.querySelectorAll('h3')).some(
        heading => heading.textContent?.trim().toLocaleLowerCase('pt-BR') === 'ficha do cliente'
      );
      if (!isProfile) {
        currentHost?.remove(); currentHost = null; setHost(null); setSelectedEmail('');
        timer = window.setTimeout(synchronize, 120); return;
      }
      setSelectedEmail(findProfileEmail(dialog));
      if (!currentHost?.isConnected) {
        const profileBody = dialog.querySelector('.min-h-0.flex-1.overflow-y-auto');
        const sections = profileBody?.querySelectorAll('section');
        const anchor = sections?.[sections.length - 1];
        if (anchor?.parentElement) {
          currentHost = document.createElement('div');
          currentHost.id = 'kyrub-crm-personalized-benefit-host';
          anchor.insertAdjacentElement('beforebegin', currentHost);
          setHost(currentHost);
        }
      }
      timer = window.setTimeout(synchronize, 120);
    };
    synchronize();
    return () => { disposed = true; window.clearTimeout(timer); currentHost?.remove(); setHost(null); };
  }, []);

  const customer = useMemo(() => {
    if (!selectedEmail) return null;
    const order = orders.find(item => normalizeEmail(item.buyerEmail) === selectedEmail);
    return order ? { buyerId: order.buyerId, buyerEmail: order.buyerEmail, name: order.buyerName || 'Cliente' } : null;
  }, [orders, selectedEmail]);

  const save = async () => {
    const user = auth.currentUser;
    if (!user || !customer || busy) return;
    setBusy(true); setMessage('');
    try {
      await savePersonalizedBenefit(user, {
        buyerId: customer.buyerId,
        buyerEmail: customer.buyerEmail,
        title,
        description,
        type,
        value: Math.max(0, Number(value) || 0),
        productName: type === 'free_product' ? productName : '',
        code,
        startsAt: '',
        endsAt,
        active: true,
      });
      setMessage(`Benefício criado para ${customer.name}. Ele aparecerá em “Para você”.`);
      setTitle(''); setDescription(''); setCode(''); setProductName('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível criar o benefício.');
    } finally { setBusy(false); }
  };

  if (!host || !customer) return null;

  return createPortal(
    <section className="rounded-3xl border border-fuchsia-400/20 bg-fuchsia-400/5 p-4" id="crm-personalized-benefit">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-400/10 text-fuchsia-300"><Gift className="h-4 w-4" /></div>
        <div><h5 className="text-[9px] font-black uppercase tracking-[.12em] text-white">Benefício personalizado</h5><p className="mt-1 text-[9px] text-slate-500">Crie algo exclusivo para este cliente. Não entra em “Em promoção”.</p></div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex.: 15% na próxima compra" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />
        <select value={type} onChange={event => setType(event.target.value as PersonalizedBenefitType)} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white"><option value="discount">Desconto</option><option value="voucher">Voucher / benefício</option><option value="free_product">Produto grátis</option></select>
        {type === 'discount' && <input type="number" min="0" value={value} onChange={event => setValue(event.target.value)} placeholder="Percentual" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />}
        {type === 'free_product' && <input value={productName} onChange={event => setProductName(event.target.value)} placeholder="Produto" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />}
        <input value={code} onChange={event => setCode(event.target.value)} placeholder="Código opcional" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] uppercase text-white" />
        <input type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />
      </div>
      <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Mensagem para o cliente" className="mt-2 min-h-16 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white" />
      <button type="button" disabled={busy || !title.trim()} onClick={() => void save()} className="mt-2 inline-flex items-center gap-2 rounded-xl bg-fuchsia-400 px-3 py-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />{busy ? 'Criando…' : 'Criar para este cliente'}</button>
      {message && <p className="mt-2 text-[9px] font-bold text-fuchsia-200">{message}</p>}
    </section>,
    host
  );
}
