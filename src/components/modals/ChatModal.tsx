import React, { useEffect, useRef } from 'react';
import { useChatMessages } from '../../hooks/useChatMessages';
import { auth } from '../../utils/firebase';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedChatUser: any | null;
  setSelectedChatUser: (user: any | null) => void;
  chatMessageText: string;
  setChatMessageText: (text: string) => void;
}

export const ChatModal: React.FC<ChatModalProps> = ({
  isOpen,
  onClose,
  selectedChatUser,
  setSelectedChatUser,
  chatMessageText,
  setChatMessageText
}) => {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
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

    if (!isChatEnabled || isSending || !chatMessageText.trim()) return;

    try {
      await sendMessage(chatMessageText);
      setChatMessageText('');
    } catch {
      // O hook preserva o erro para exibição e o texto permanece no campo.
    }
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
          <button
            type="button"
            onClick={closeChat}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-lg text-slate-400"
            aria-label="Fechar conversa"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-950/40 p-4">
          <div className="space-y-3.5">
            {isLoading && (
              <div className="py-4 text-center text-xs italic text-slate-500">
                Carregando mensagens...
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-[10px] text-red-300">
                {error}
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

            {!isLoading && isChatEnabled && messages.length === 0 && (
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
            disabled={!isChatEnabled || isSending || !chatMessageText.trim()}
            className="min-w-20 rounded-xl bg-orange-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            {isSending ? 'Enviando' : 'Enviar'}
          </button>
        </form>
      </div>
    </div>
  );
};
