import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Bell,
  CheckCheck,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  X,
} from 'lucide-react';
import type { UserNotification } from '../../shared/userNotifications';
import { auth } from '../utils/firebase';
import { openStoreCustomerChat } from '../utils/storeCustomerChatEvents';
import {
  loadUserNotificationInbox,
  markAllUserNotificationsRead,
  markUserNotificationRead,
} from '../utils/userNotifications';

const formatTime = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

export function UserNotificationCenterBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    let cancelled = false;
    let currentHost: HTMLDivElement | null = null;

    const synchronize = (): void => {
      if (cancelled) return;
      const header = document.getElementById('app-header');
      if (!(header instanceof HTMLElement)) {
        currentHost?.remove();
        currentHost = null;
        setHost(null);
        return;
      }
      if (currentHost?.isConnected) return;
      currentHost = document.createElement('div');
      currentHost.id = 'user-notification-center-host';
      currentHost.className = 'ml-auto flex shrink-0 items-center pl-2';
      header.appendChild(currentHost);
      setHost(currentHost);
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer.disconnect();
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  const refresh = useCallback(async (silent = false): Promise<void> => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const inbox = await loadUserNotificationInbox(60);
      setNotifications(inbox.notifications);
      setUnreadCount(inbox.unreadCount);
      setErrorMessage('');
    } catch (error) {
      if (!silent) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível carregar as notificações.'
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh(true);
    const timer = window.setInterval(() => void refresh(true), 15000);
    return () => window.clearInterval(timer);
  }, [refresh, user]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const unreadIds = useMemo(
    () => new Set(notifications.filter(item => !item.readAt).map(item => item.id)),
    [notifications]
  );

  const readOne = async (notification: UserNotification): Promise<void> => {
    if (!notification.readAt) {
      try {
        await markUserNotificationRead(notification.id);
        setNotifications(current =>
          current.map(item =>
            item.id === notification.id
              ? { ...item, readAt: new Date().toISOString() }
              : item
          )
        );
        setUnreadCount(current => Math.max(0, current - 1));
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Não foi possível marcar como lida.'
        );
        return;
      }
    }

    if (notification.target.kind === 'store_chat' && user) {
      const perspective = notification.target.customerId === user.uid
        ? 'customer'
        : notification.target.storeId === user.uid
          ? 'store'
          : null;
      if (perspective) {
        openStoreCustomerChat({
          perspective,
          storeId: notification.target.storeId,
          ...(perspective === 'store'
            ? { customerId: notification.target.customerId }
            : {}),
        });
        setOpen(false);
      }
    }
  };

  const readAll = async (): Promise<void> => {
    try {
      await markAllUserNotificationsRead();
      const readAt = new Date().toISOString();
      setNotifications(current =>
        current.map(item => (item.readAt ? item : { ...item, readAt }))
      );
      setUnreadCount(0);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível marcar todas como lidas.'
      );
    }
  };

  if (!user || !host) return null;

  const trigger = createPortal(
    <button
      type="button"
      onClick={() => setOpen(current => !current)}
      className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 transition-colors hover:border-orange-500/40 hover:text-orange-300"
      aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : 'Notificações'}
      aria-expanded={open}
      id="canonical-notification-trigger"
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-orange-500 px-1 text-center font-mono text-[8px] font-black leading-4 text-slate-950">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>,
    host
  );

  const panel = open
    ? createPortal(
        <div className="fixed inset-0 z-[215] bg-slate-950/70 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none" onClick={() => setOpen(false)}>
          <section
            className="absolute inset-x-2 top-[max(4.5rem,env(safe-area-inset-top))] max-h-[78dvh] overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl sm:inset-x-auto sm:right-4 sm:top-16 sm:w-[min(26rem,calc(100vw-2rem))]"
            role="dialog"
            aria-label="Central de notificações"
            id="canonical-notification-center"
            onClick={event => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div>
                <h2 className="text-xs font-black uppercase tracking-wide text-white">Notificações</h2>
                <span className="text-[9px] text-slate-500">
                  {unreadCount > 0 ? `${unreadCount} não lida${unreadCount === 1 ? '' : 's'}` : 'Tudo lido'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-800 text-slate-500 hover:text-white"
                  aria-label="Atualizar notificações"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => void readAll()}
                  disabled={unreadCount === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-800 text-slate-500 hover:text-emerald-300 disabled:opacity-30"
                  aria-label="Marcar todas como lidas"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-800 text-slate-500 hover:text-white"
                  aria-label="Fechar notificações"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </header>

            {errorMessage && (
              <div className="m-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[9px] text-red-300" role="alert">
                {errorMessage}
              </div>
            )}

            <div className="max-h-[calc(78dvh-4rem)] overflow-y-auto p-2">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Carregando notificações…
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs leading-relaxed text-slate-500">
                  Nenhuma notificação real ainda. Eventos do Kyrub aparecerão aqui quando acontecerem.
                </div>
              ) : (
                notifications.map(notification => {
                  const unread = unreadIds.has(notification.id);
                  return (
                    <button
                      type="button"
                      key={notification.id}
                      onClick={() => void readOne(notification)}
                      className={`mb-1 flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                        unread
                          ? 'border-orange-500/25 bg-orange-500/8'
                          : 'border-transparent bg-slate-900/50 hover:border-slate-800'
                      }`}
                    >
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${unread ? 'bg-orange-500/15 text-orange-300' : 'bg-slate-900 text-slate-500'}`}>
                        {notification.category === 'store_chat'
                          ? <MessageSquareText className="h-4 w-4" />
                          : <Bell className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <strong className={`text-[10px] ${unread ? 'text-white' : 'text-slate-300'}`}>
                            {notification.title}
                          </strong>
                          {unread && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />}
                        </div>
                        {notification.body && (
                          <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                            {notification.body}
                          </p>
                        )}
                        <span className="mt-1.5 block font-mono text-[8px] text-slate-600">
                          {formatTime(notification.createdAt)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>,
        document.body
      )
    : null;

  return <>{trigger}{panel}</>;
}
