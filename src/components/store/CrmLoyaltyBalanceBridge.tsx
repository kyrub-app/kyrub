import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, Trophy } from 'lucide-react';
import type { CustomerOrder } from '../../utils/customerOrders';
import {
  getBuyerLoyaltyBalance,
  subscribeToStoreLoyaltyLedger,
  type LoyaltyLedgerEvent,
} from '../../utils/loyaltyLedger';
import { auth } from '../../utils/firebase';

type Props = {
  orders: CustomerOrder[];
};

const normalizeEmail = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const relationshipLevel = (points: number): { label: string; next: number } => {
  if (points >= 1500) return { label: 'Ouro', next: 2500 };
  if (points >= 500) return { label: 'Prata', next: 1500 };
  return { label: 'Bronze', next: 500 };
};

const findProfileEmail = (dialog: HTMLElement): string => {
  const candidates = Array.from(dialog.querySelectorAll('p, span, strong'));
  for (const candidate of candidates) {
    const text = candidate.textContent?.trim() ?? '';
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) return normalizeEmail(match[0]);
  }
  return '';
};

export function CrmLoyaltyBalanceBridge({ orders }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [events, setEvents] = useState<LoyaltyLedgerEvent[]>([]);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let currentHost: HTMLDivElement | null = null;

    const synchronize = (): void => {
      if (disposed) return;
      const dialog = document.querySelector('[role="dialog"][aria-label="CRM da loja"]');
      if (!(dialog instanceof HTMLElement)) {
        currentHost?.remove();
        currentHost = null;
        setHost(null);
        setSelectedEmail('');
        timer = window.setTimeout(synchronize, 120);
        return;
      }

      const isProfile = Array.from(dialog.querySelectorAll('h3')).some(
        heading => heading.textContent?.trim().toLocaleLowerCase('pt-BR') === 'ficha do cliente'
      );
      if (!isProfile) {
        currentHost?.remove();
        currentHost = null;
        setHost(null);
        setSelectedEmail('');
        timer = window.setTimeout(synchronize, 120);
        return;
      }

      const email = findProfileEmail(dialog);
      setSelectedEmail(email);

      if (!currentHost?.isConnected) {
        const profileBody = dialog.querySelector('.min-h-0.flex-1.overflow-y-auto');
        const firstSection = profileBody?.querySelector('section');
        if (firstSection?.parentElement) {
          currentHost = document.createElement('div');
          currentHost.id = 'kyrub-crm-loyalty-balance-host';
          firstSection.insertAdjacentElement('afterend', currentHost);
          setHost(currentHost);
        }
      }

      timer = window.setTimeout(synchronize, 120);
    };

    synchronize();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let timer = 0;
    let lastUid = '';

    const synchronize = (): void => {
      const uid = auth.currentUser?.uid ?? '';
      if (uid !== lastUid) {
        unsubscribe?.();
        unsubscribe = null;
        lastUid = uid;
        setEvents([]);
        if (uid) {
          unsubscribe = subscribeToStoreLoyaltyLedger(
            uid,
            setEvents,
            error => {
              console.warn('CRM: saldo de fidelidade indisponível.', error);
              setEvents([]);
            }
          );
        }
      }
      timer = window.setTimeout(synchronize, 500);
    };

    synchronize();
    return () => {
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, []);

  const buyerId = useMemo(() => {
    if (!selectedEmail) return '';
    return orders.find(order => normalizeEmail(order.buyerEmail) === selectedEmail)?.buyerId ?? '';
  }, [orders, selectedEmail]);

  const points = useMemo(
    () => getBuyerLoyaltyBalance(events, buyerId, selectedEmail),
    [buyerId, events, selectedEmail]
  );
  const level = relationshipLevel(points);
  const progress = Math.min(100, Math.round((points / level.next) * 100));

  if (!host || !selectedEmail) return null;

  return createPortal(
    <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-4" id="crm-canonical-loyalty-balance">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-300">
            <Trophy className="h-4 w-4" />
            <h5 className="text-[9px] font-black uppercase tracking-[.12em] text-white">
              Fidelidade
            </h5>
          </div>
          <p className="mt-1 text-[9px] text-slate-500">
            Mesmo saldo canônico exibido ao cliente em Meu relacionamento.
          </p>
        </div>
        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[8px] font-black uppercase text-amber-300">
          {level.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-500">Saldo atual</span>
          <strong className="mt-1 flex items-center gap-1 text-lg font-black text-white">
            <Star className="h-4 w-4 text-amber-300" /> {points} pts
          </strong>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-500">Próximo marco</span>
          <strong className="mt-1 block text-sm font-black text-white">
            {Math.max(0, level.next - points)} pts
          </strong>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </section>,
    host
  );
}
