import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageSquareText, Send, Store, X } from 'lucide-react';
import type { OpenStoreCustomerChatDetail } from '../../utils/storeCustomerChatEvents';
import {
  loadCustomerStoreChatThread,
  loadStoreCustomerChatThreadAsStore,
  markCustomerStoreChatRead,
  markStoreCustomerChatReadAsStore,
  sendCustomerStoreChatMessage,
  sendStoreCustomerChatMessageAsStore,
  type StoreCustomerChatThreadView,
} from '../../utils/storeCustomerChat';

interface StoreCustomerChatModalProps {
  detail: OpenStoreCustomerChatDetail;
  onClose: () => void;
}

const timeLabel = (iso: string): string => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
};

export function StoreCustomerChatModal({
  detail,
  onClose,
}: StoreCustomerChatModalProps) {
  const [thread, setThread] = useState<StoreCustomerChatThreadView | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const customerId = detail.customerId?.trim() ?? '';
  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const next = detail.perspective === 'store'
        ? await loadStoreCustomerChatThreadAsStore({
            storeId: detail.storeId,
            customerId,
          })
        : await loadCustomerStoreChatThread(detail.storeId);
      setThread(next);
      setErrorMessage('');
      if (next.exists) {
        if (detail.perspective === 'store') {
          await markStoreCustomerChatReadAsStore({
            storeId: detail.storeId,
            customerId,
          });
        } else {
          await markCustomerStoreChatRead(detail.storeId);
        }
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Não foi possível carregar a conversa.'
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [customerId, detail.perspective, detail.storeId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread?.messages.length]);

  const storeCanReply = detail.perspective !== 'store' || thread?.exists === true;

  const send = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const normalized = text.trim();
    if (!normalized || sending || !storeCanReply) return;
    setSending(true);
    setErrorMessage('');
    try {
      if (detail.perspective === 'store') {
        await sendStoreCustomerChatMessageAsStore({
          storeId: detail.storeId,
          customerId,
          text: normalized,
        });
      } else {
        await sendCustomerStoreChatMessage({
          storeId: detail.storeId,
          text: normalized,
        });
      }
      setText('');
      await load(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.'
      );
    } finally {
      setSending(false);
    }
  };

  const title = detail.perspective === 'store'
    ? detail.customerName || 'Cliente Kyrub'
    : detail.storeName || 'Loja Kyrub';
  const subtitle = detail.perspective === 'store'
    ? 'Respondendo com a identidade institucional da loja'
    : 'Conversa direta com a loja';

  return (
    <div
      className="fixed inset-0 z-[220] flex items-stretch justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Conversa com ${title}`}
      id="store-customer-chat-modal"
    >
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-900 shadow-2xl sm:h-[min(760px,92dvh)] sm:max-w-lg sm:rounded-3xl sm:border sm:border-slate-800">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300">
              {detail.perspective === 'customer'
                ? <Store className="h-5 w-5" />
                : <MessageSquareText className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black text-white">{title}</h3>
              <span className="block truncate text-[9px] text-slate-500">{subtitle}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
            aria-label="Fechar conversa"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-950/50 p-4">
          {loading && !thread ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Carregando conversa…
            </div>
          ) : (
            <div className="space-y-3">
              {(thread?.messages ?? []).map(message => {
                const mine = detail.perspective === 'store'
                  ? message.senderKind === 'store'
                  : message.senderKind === 'customer';
                return (
                  <div
                    key={message.id}
                    className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[84%] rounded-2xl px-3 py-2.5 ${
                        mine
                          ? 'rounded-tr-none bg-orange-600 text-white'
                          : 'rounded-tl-none border border-slate-800 bg-slate-900 text-slate-200'
                      }`}
                    >
                      <p className="break-words text-xs leading-relaxed">{message.text}</p>
                      <span className={`mt-1 block text-right font-mono text-[7px] ${mine ? 'text-orange-200' : 'text-slate-600'}`}>
                        {timeLabel(message.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {!loading && (thread?.messages.length ?? 0) === 0 && (
                <div className="py-12 text-center text-xs leading-relaxed text-slate-500">
                  {detail.perspective === 'store'
                    ? 'O cliente ainda não iniciou esta conversa. A loja poderá responder aqui assim que a primeira mensagem chegar.'
                    : 'Envie a primeira mensagem. O histórico ficará vinculado à sua conta e a esta loja.'}
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </main>

        {errorMessage && (
          <div className="mx-3 mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-300">
            {errorMessage}
          </div>
        )}

        <form
          onSubmit={event => void send(event)}
          className="flex shrink-0 gap-2 border-t border-slate-800 bg-slate-950 px-3 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]"
        >
          <input
            value={text}
            onChange={event => setText(event.target.value.slice(0, 4000))}
            disabled={!storeCanReply}
            placeholder={
              detail.perspective === 'store'
                ? storeCanReply
                  ? 'Responder como loja…'
                  : 'Aguardando o cliente iniciar…'
                : 'Escreva para a loja…'
            }
            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-3 text-xs text-white outline-none placeholder:text-slate-600 focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending || !storeCanReply}
            className="flex min-w-20 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-xs font-black uppercase text-white disabled:bg-slate-800 disabled:text-slate-500"
          >
            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
