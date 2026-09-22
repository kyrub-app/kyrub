import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, MessageCircle, ShoppingBag, X } from 'lucide-react';
import { auth } from '../utils/firebase';

type NotificationKind = 'message' | 'sale';
type NotificationFilter = 'all' | NotificationKind;

export interface KyrubNotificationPayload {
  id?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt?: string;
  sourceId?: string;
}

interface KyrubNotification extends Omit<KyrubNotificationPayload, 'sourceId'> {
  id: string;
  createdAt: string;
  sourceId: string | undefined;
  readAt: string | null;
}

declare global {
  interface WindowEventMap {
    'kyrub:notification': CustomEvent<KyrubNotificationPayload>;
  }
}

const STORAGE_PREFIX = 'kyrub_notification_center_';
const HOST_ID = 'kyrub-notification-center-host';
const MAX_STORED_NOTIFICATIONS = 100;

const storageKey = () => `${STORAGE_PREFIX}${auth.currentUser?.uid ?? 'guest'}`;

const readStoredNotifications = (): KyrubNotification[] => {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const row = item as Partial<KyrubNotification>;
        if ((row.kind !== 'message' && row.kind !== 'sale') || !row.title || !row.body) return null;
        return {
          id: typeof row.id === 'string' ? row.id : crypto.randomUUID(),
          kind: row.kind,
          title: row.title,
          body: row.body,
          sourceId: typeof row.sourceId === 'string' ? row.sourceId : undefined,
          createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
          readAt: typeof row.readAt === 'string' ? row.readAt : null,
        } satisfies KyrubNotification;
      })
      .filter((item): item is KyrubNotification => Boolean(item));
  } catch {
    return [];
  }
};

const persistNotifications = (items: KyrubNotification[]) => {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(items.slice(0, MAX_STORED_NOTIFICATIONS)));
  } catch {
    // Notification persistence is best-effort and must never break the header.
  }
};

const formatWhen = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffMinutes = Math.max(0, Math.round((now - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'agora';
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export const emitKyrubNotification = (payload: KyrubNotificationPayload) => {
  window.dispatchEvent(new CustomEvent('kyrub:notification', { detail: payload }));
};

export function NotificationCenterBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [notifications, setNotifications] = useState<KyrubNotification[]>([]);

  useEffect(() => {
    let frame = 0;
    let stopped = false;

    const attach = () => {
      frame = 0;
      if (stopped) return;
      const wallet = document.getElementById('header-wallet-balance');
      if (!wallet?.parentElement) return;

      let mount = document.getElementById(HOST_ID);
      if (!mount) {
        mount = document.createElement('div');
        mount.id = HOST_ID;
        mount.className = 'shrink-0';
        wallet.parentElement.insertBefore(mount, wallet);
      }
      setHost(mount);
    };

    const schedule = () => {
      if (frame || stopped) return;
      frame = window.requestAnimationFrame(attach);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      stopped = true;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const reload = () => setNotifications(readStoredNotifications());
    reload();

    const unsubscribe = auth.onAuthStateChanged(() => reload());
    const receive = (event: WindowEventMap['kyrub:notification']) => {
      const payload = event.detail;
      if (!payload || (payload.kind !== 'message' && payload.kind !== 'sale')) return;

      setNotifications(previous => {
        const sourceKey = payload.sourceId?.trim();
        if (sourceKey && previous.some(item => item.kind === payload.kind && item.sourceId === sourceKey)) {
          return previous;
        }
        const next: KyrubNotification[] = [
          {
            ...payload,
            sourceId: payload.sourceId,
            id: payload.id ?? crypto.randomUUID(),
            createdAt: payload.createdAt ?? new Date().toISOString(),
            readAt: null,
          },
          ...previous,
        ].slice(0, MAX_STORED_NOTIFICATIONS);
        persistNotifications(next);
        return next;
      });
    };

    window.addEventListener('kyrub:notification', receive);
    return () => {
      unsubscribe();
      window.removeEventListener('kyrub:notification', receive);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const unreadCount = notifications.filter(item => !item.readAt).length;
  const visibleNotifications = useMemo(
    () => notifications.filter(item => filter === 'all' || item.kind === filter),
    [filter, notifications]
  );

  const markRead = (id: string) => {
    setNotifications(previous => {
      const next = previous.map(item => item.id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item);
      persistNotifications(next);
      return next;
    });
  };

  const markAllRead = () => {
    const now = new Date().toISOString();
    setNotifications(previous => {
      const next = previous.map(item => item.readAt ? item : { ...item, readAt: now });
      persistNotifications(next);
      return next;
    });
  };

  if (!host) return null;

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/90 text-slate-400 shadow-sm transition-colors hover:border-teal-500/30 hover:text-teal-300"
        aria-label={unreadCount ? `Notificações, ${unreadCount} não lidas` : 'Notificações'}
        title="Notificações"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-2.5 top-2.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[8px] font-black leading-none text-slate-950 ring-2 ring-slate-900">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-center-title"
          onMouseDown={event => event.currentTarget === event.target && setOpen(false)}
        >
          <section className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:max-h-[82vh] sm:max-w-lg sm:rounded-3xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
              <div>
                <span className="text-[9px] font-black uppercase tracking-[.18em] text-orange-400">Kyrub</span>
                <div className="mt-1 flex items-center gap-2">
                  <Bell className="h-4 w-4 text-teal-400" />
                  <h2 id="notification-center-title" className="text-base font-black uppercase text-white">Central de notificações</h2>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">Mensagens e movimentações comerciais em um só lugar.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-slate-400 hover:text-white" aria-label="Fechar notificações">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
              {([
                ['all', 'Todas'],
                ['message', 'Mensagens'],
                ['sale', 'Vendas'],
              ] as Array<[NotificationFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase transition-colors ${filter === value ? 'bg-teal-400 text-slate-950' : 'bg-slate-950 text-slate-500 hover:text-slate-200'}`}
                >
                  {label}
                </button>
              ))}
              <button type="button" onClick={markAllRead} disabled={!unreadCount} className="ml-auto flex items-center gap-1.5 px-2 py-2 text-[9px] font-bold uppercase text-slate-500 hover:text-teal-300 disabled:opacity-30">
                <CheckCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Marcar lidas</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {visibleNotifications.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-slate-600">
                    {filter === 'message' ? <MessageCircle className="h-6 w-6" /> : filter === 'sale' ? <ShoppingBag className="h-6 w-6" /> : <Bell className="h-6 w-6" />}
                  </div>
                  <h3 className="mt-4 text-xs font-black uppercase text-slate-300">Nenhuma notificação por aqui</h3>
                  <p className="mt-1 max-w-xs text-[10px] leading-5 text-slate-600">
                    {filter === 'message' ? 'Novas mensagens aparecerão nesta aba.' : filter === 'sale' ? 'Vendas confirmadas aparecerão nesta aba.' : 'Quando houver uma nova mensagem ou venda confirmada, ela aparecerá aqui.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {visibleNotifications.map(item => {
                    const Icon = item.kind === 'message' ? MessageCircle : ShoppingBag;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => markRead(item.id)}
                        className={`flex w-full gap-3 rounded-2xl border p-3.5 text-left transition-colors ${item.readAt ? 'border-slate-800 bg-slate-950/40' : 'border-teal-500/25 bg-teal-500/[.05]'}`}
                      >
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.kind === 'message' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <strong className="text-[11px] font-black text-slate-200">{item.title}</strong>
                            <span className="shrink-0 text-[8px] uppercase text-slate-600">{formatWhen(item.createdAt)}</span>
                          </span>
                          <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-slate-500">{item.body}</span>
                        </span>
                        {!item.readAt && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-400" aria-label="Não lida" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>,
        document.body
      )}
    </>,
    host
  );
}
