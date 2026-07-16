import React from 'react';

interface ChatMessage {
  sender: string;
  text: string;
  time: string;
}

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedChatUser: any | null;
  setSelectedChatUser: (user: any | null) => void;
  chatMessageText: string;
  setChatMessageText: (text: string) => void;
  simulatedChatHistory: { [key: string]: ChatMessage[] };
  setSimulatedChatHistory: React.Dispatch<React.SetStateAction<{ [key: string]: ChatMessage[] }>>;
  profileName: string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export const ChatModal: React.FC<ChatModalProps> = ({
  isOpen,
  onClose,
  selectedChatUser,
  setSelectedChatUser,
  chatMessageText,
  setChatMessageText,
  simulatedChatHistory,
  setSimulatedChatHistory,
  profileName,
  triggerToast,
}) => {
  if (!isOpen || !selectedChatUser) return null;

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageText.trim()) return;

    const userId = selectedChatUser.id;
    const userMsg = {
      sender: profileName || 'Você',
      text: chatMessageText,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setSimulatedChatHistory(prev => ({
      ...prev,
      [userId]: [...(prev[userId] || []), userMsg]
    }));
    setChatMessageText('');

    setTimeout(() => {
      const responses = [
        "Que ótimo! Com certeza podemos negociar isso.",
        "Perfeito, vou verificar no estoque do ERP agora mesmo e te retorno.",
        "Obrigado pelo contato! Se quiser, posso gerar um split de faturamento via BaaS.",
        "Excelente! Vamos conversando por aqui."
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      const systemMsg = {
        sender: selectedChatUser.name,
        text: randomResponse,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };

      setSimulatedChatHistory(prev => ({
        ...prev,
        [userId]: [...(prev[userId] || []), systemMsg]
      }));
      triggerToast(`Nova mensagem de ${selectedChatUser.name}`, 'info');
    }, 1500);
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
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-950 rounded-full animate-pulse" />
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
            {(simulatedChatHistory[selectedChatUser.id] || [])
              .map((msg, i) => {
                const isMe = msg.sender.includes('Você') || msg.sender === 'me';
                return (
                  <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                    <div className={`max-w-[80%] rounded-2xl p-3 space-y-1 ${
                      isMe 
                        ? 'bg-orange-600 text-white rounded-tr-none' 
                        : 'bg-slate-850 text-slate-200 rounded-tl-none border border-slate-800/80'
                    }`}>
                      <p className="text-xs leading-relaxed break-words">{msg.text}</p>
                      <span className={`text-[8px] font-mono block text-right ${
                        isMe ? 'text-orange-200' : 'text-slate-500'
                      }`}>
                        {msg.time}
                      </span>
                    </div>
                  </div>
                );
              })}

            {(!simulatedChatHistory[selectedChatUser.id] || simulatedChatHistory[selectedChatUser.id].length === 0) && (
              <div className="text-center py-12 text-slate-500 text-xs italic">
                Nenhuma mensagem anterior. Digite algo abaixo para iniciar o chat criptografado local!
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
            onChange={(e) => setChatMessageText(e.target.value)}
            placeholder="Escreva uma mensagem privada..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 font-sans"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
};
