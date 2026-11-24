import React, { useEffect, useRef } from 'react';
import { useChatMessages } from '../../hooks/useChatMessages';
import { auth } from '../../utils/firebase';
import { OPEN_COMMUNITY_FROM_SQUARE_EVENT } from '../../utils/communitySquareFeed';
import { buildCommunityPostInternalLink, sendCommunityPostToConnectedUser } from '../../utils/communityPostForwarding';
import { issueCommunityForwardReceivedNotification } from '../../utils/userNotifications';
import type { CloudCommunityPost } from '../../utils/communityCloud';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedChatUser: any | null;
  setSelectedChatUser: (user: any | null) => void;
  chatMessageText: string;
  setChatMessageText: (text: string) => void;
  onMessageSent?: (text: string) => void;
  forwardingPost?: CloudCommunityPost | null;
}

export const ChatModal: React.FC<ChatModalProps> = ({
  isOpen,
  onClose,
  selectedChatUser,
  setSelectedChatUser,
  chatMessageText,
  setChatMessageText,
  onMessageSent,
  forwardingPost,
}) => {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [forwardSendError, setForwardSendError] = React.useState('');
  const [clearError, setClearError] = React.useState('');
  const [showClear, setShowClear] = React.useState(false);
  useEffect(()=>{setShowClear(false);setClearError('');},[isOpen,selectedChatUser?.connectionId]);
  const isChatEnabled = Boolean(
    isOpen
    && selectedChatUser
    && selectedChatUser.connectionStatus === 'accepted'
    && selectedChatUser.connectionId
  );

  const {
    messages,
    isLoading,
    isSending,
    isClearing,
    historyReady,
    historyError,
    retryHistory,
    clearConversation,
    error,
    sendMessage
  } = useChatMessages({
    connectionId: selectedChatUser?.connectionId,
    receiverId: selectedChatUser?.id,
    enabled: isChatEnabled
  });

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isOpen, messages.length]);

  if (!isOpen || !selectedChatUser) return null;

  const closeChat = () => {
    onClose();
    setSelectedChatUser(null);
  };

  const handleSendChatMessage = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!isChatEnabled || !historyReady || isSending || isClearing || !chatMessageText.trim()) return;

    try {
      setForwardSendError('');
      const sentText = chatMessageText;
      const isForward = Boolean(forwardingPost &&
        sentText.includes(buildCommunityPostInternalLink(forwardingPost)));
      if (isForward && forwardingPost) {
        const delivered = await sendCommunityPostToConnectedUser({
          post: forwardingPost,
          connectionId: selectedChatUser.connectionId,
          recipientId: selectedChatUser.id,
          text: sentText,
        });
        setChatMessageText('');
        onMessageSent?.(sentText);
        void issueCommunityForwardReceivedNotification(delivered.connectionId, delivered.messageId, forwardingPost.id)
          .catch(error => console.warn('Mensagem enviada; notificação interna temporariamente indisponível.', error));
      } else {
        await sendMessage(sentText);
        setChatMessageText('');
        onMessageSent?.(sentText);
      }
    } catch (error) {
      // A transação privada também pode bloquear um segundo encaminhamento
      // para a mesma pessoa dentro de 24h. O texto permanece para revisão.
      setForwardSendError(error instanceof Error ? error.message : 'Não foi possível enviar esta mensagem.');
    }
  };

  const readInternalPostLink = (messageText: string): { communityId: string; postId: string } | null => {
    const links = messageText.match(/https?:\/\/[^\s]+/g) || [];
    for (const link of links) {
      try {
        const url = new URL(link);
        if (url.origin !== window.location.origin &&
          !(url.protocol === 'https:' && ['kyrub.com', 'www.kyrub.com'].includes(url.hostname))) continue;
        const communityId = url.searchParams.get('community') || '';
        const postId = url.searchParams.get('post') || '';
        if (/^[a-zA-Z0-9_-]{1,128}$/.test(communityId) &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(postId)) return { communityId, postId };
      } catch { /* Invalid/untrusted URL is not an in-app publication link. */ }
    }
    return null;
  };

  const contactInitial = String(selectedChatUser.name || 'K')
    .trim()
    .charAt(0)
    .toLocaleUpperCase('pt-BR');

  return (
    <div
      className="fixed inset-0 z-[170] flex items-stretch justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4"
      id="chat-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Conversa com ${selectedChatUser.name}`}
    >
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-900 text-xs shadow-2xl sm:h-[min(720px,92dvh)] sm:max-w-md sm:rounded-3xl sm:border sm:border-slate-800">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            {selectedChatUser.avatar ? (
              <img
                src={selectedChatUser.avatar}
                alt={selectedChatUser.name}
                className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-orange-500 text-sm font-black text-slate-950">
                {contactInitial}
              </span>
            )}
            <div className="min-w-0">
              <h4 className="truncate text-sm font-black text-white">
                {selectedChatUser.name}
              </h4>
              <span className="block truncate text-[9px] font-mono uppercase text-slate-500">
                {selectedChatUser.role || 'Conectado no Kyrub'}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          <button type="button" aria-label="Opções da conversa" aria-expanded={showClear}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-lg text-slate-400"
            onClick={()=>setShowClear(v=>!v)}>⋮</button>
          <button
            type="button"
            onClick={closeChat}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-lg text-slate-400"
            aria-label="Fechar conversa"
          >
            ×
          </button>
          </div>
        </div>
        {showClear&&<div className="space-y-2 border-b border-slate-800 p-3">
          <p className="text-sm text-slate-300">Excluir o histórico apenas da sua conta? A outra pessoa continuará com as mensagens e vocês poderão conversar novamente.</p>
          <button type="button" disabled={!historyReady||isClearing||isSending}
            className="rounded-xl border border-red-500/40 px-3 py-3 text-sm font-semibold text-red-300 disabled:opacity-50"
            onClick={async()=>{setClearError('');try{await clearConversation();setShowClear(false);}catch{setClearError('Não foi possível excluir a conversa. Tente novamente.');}}}
          >{isClearing?'Excluindo…':'Confirmar exclusão da conversa'}</button>
          <button type="button" disabled={isClearing} className="ml-2 p-3 text-sm underline" onClick={()=>setShowClear(false)}>Cancelar</button>
        </div>}
        {clearError&&<p role="alert" className="p-3 text-red-300">{clearError}</p>}
        {historyError&&<div role="alert" className="p-3 text-red-300">{historyError} <button type="button" onClick={retryHistory} className="underline">Tentar novamente</button></div>}

        <div className="flex-1 overflow-y-auto bg-slate-950/40 p-4">
          <div className="space-y-3.5">
            {isLoading && (
              <div className="py-4 text-center text-xs italic text-slate-500">
                Carregando mensagens...
              </div>
            )}

            {(error || forwardSendError) && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-[10px] text-red-300" role="alert">
                {forwardSendError || error}
              </div>
            )}

            {!isChatEnabled && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-[10px] text-amber-300">
                Esta conversa não está disponível para envio de mensagens.
              </div>
            )}

            {messages.map(message => {
              const isMe = message.senderId === auth.currentUser?.uid;
              const messageTime = message.createdAt
                ? message.createdAt.toDate().toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Enviando...';

              return (
                <div
                  key={message.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[82%] space-y-1 rounded-2xl p-3 ${
                      isMe
                        ? 'rounded-tr-none bg-orange-600 text-white'
                        : 'rounded-tl-none border border-slate-800/80 bg-slate-900 text-slate-200'
                    }`}
                  >
                    <p className="break-words text-xs leading-relaxed">
                      {message.text}
                    </p>
                    {readInternalPostLink(message.text) && (
                      <button type="button" onClick={() => {
                        const link = readInternalPostLink(message.text);
                        if (!link) return;
                        closeChat();
                        window.dispatchEvent(new CustomEvent(OPEN_COMMUNITY_FROM_SQUARE_EVENT, {
                          detail: link,
                        }));
                      }}
                        className={`mt-2 min-h-9 rounded-lg border px-3 text-xs font-bold ${isMe
                          ? 'border-orange-200/50 bg-orange-400/20 text-white'
                          : 'border-sky-500/35 bg-sky-500/10 text-sky-200'}`}>
                        Abrir publicação no Kyrub
                      </button>
                    )}
                    <span
                      className={`block text-right font-mono text-[8px] ${
                        isMe ? 'text-orange-200' : 'text-slate-500'
                      }`}
                    >
                      {messageTime}
                    </span>
                  </div>
                </div>
              );
            })}

            {!isLoading && historyReady && isChatEnabled && messages.length === 0 && (
              <div className="py-12 text-center text-xs italic text-slate-500">
                Nenhuma mensagem anterior. Digite algo abaixo para iniciar a conversa.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <form
          onSubmit={handleSendChatMessage}
          className="flex shrink-0 gap-2 border-t border-slate-800/80 bg-slate-950 px-3 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]"
        >
          <input
            type="text"
            value={chatMessageText}
            onChange={event => setChatMessageText(event.target.value.slice(0, 2000))}
            placeholder="Escreva uma mensagem privada..."
            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-3 text-xs text-white placeholder-slate-500 outline-none focus:border-orange-500"
          />
          <button
            type="submit"
            disabled={!isChatEnabled || !historyReady || isSending || isClearing || !chatMessageText.trim()}
            className="min-w-20 rounded-xl bg-orange-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            {isSending ? 'Enviando' : 'Enviar'}
          </button>
        </form>
      </div>
    </div>
  );
};
