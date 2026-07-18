import React from 'react';
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

  if (!isOpen || !selectedChatUser) return null;

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

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="chat-modal">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl shadow-2xl relative flex flex-col h-[500px] overflow-hidden animate-scale-up text-xs">
        {/* Header */}
        <div className="flex items-center justify-between bg-slate-950 p-4 border-b border-slate-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={selectedChatUser.avatar}
                alt={selectedChatUser.name}
                className="w-10 h-10 rounded-full object-cover border border-slate-800"
                referrerPolicy="no-referrer"
              />
            </div>
            <div>
              <h4 className="text-xs font-black text-white uppercase tracking-wide">{selectedChatUser.name}</h4>
              <span className="text-[8px] font-mono text-slate-500 uppercase">{selectedChatUser.role}</span>
            </div>
          </div>
          <button
            onClick={() => {
              onClose();
              setSelectedChatUser(null);
            }}
            className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Chat History Messages Container */}
        <div className="flex-1 p-4 overflow-y-auto bg-slate-950/40 space-y-3.5 flex flex-col-reverse">
          <div className="space-y-3.5">
            {isLoading && (
              <div className="text-center py-4 text-slate-500 text-xs italic">
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
                <div key={message.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                  <div className={`max-w-[80%] rounded-2xl p-3 space-y-1 ${
                    isMe
                      ? 'bg-orange-600 text-white rounded-tr-none'
                      : 'bg-slate-850 text-slate-200 rounded-tl-none border border-slate-800/80'
                  }`}>
                    <p className="text-xs leading-relaxed break-words">{message.text}</p>
                    <span className={`text-[8px] font-mono block text-right ${
                      isMe ? 'text-orange-200' : 'text-slate-500'
                    }`}>
                      {messageTime}
                    </span>
                  </div>
                </div>
              );
            })}

            {!isLoading && isChatEnabled && messages.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-xs italic">
                Nenhuma mensagem anterior. Digite algo abaixo para iniciar a conversa.
              </div>
            )}
          </div>
        </div>

        {/* Bottom Message Input Form */}
        <form
          onSubmit={handleSendChatMessage}
          className="p-3 bg-slate-950 border-t border-slate-800/80 shrink-0 flex gap-2"
        >
          <input
            type="text"
            value={chatMessageText}
            onChange={(event) => setChatMessageText(event.target.value)}
            placeholder="Escreva uma mensagem privada..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 font-sans"
          />
          <button
            type="submit"
            disabled={!isChatEnabled || isSending || !chatMessageText.trim()}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer"
          >
            {isSending ? 'Enviando...' : 'Enviar'}
          </button>
        </form>
      </div>
    </div>
  );
};
