import React from 'react';
import { Search, Users } from 'lucide-react';

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
}

interface UserSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  userSearchEmail: string;
  setUserSearchEmail: (val: string) => void;
  appUsers: AppUser[];
  selectedFriendsForNote: string[];
  setSelectedFriendsForNote: React.Dispatch<React.SetStateAction<string[]>>;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const UserSearchModal: React.FC<UserSearchModalProps> = ({
  isOpen,
  onClose,
  userSearchEmail,
  setUserSearchEmail,
  appUsers,
  selectedFriendsForNote,
  setSelectedFriendsForNote,
  triggerToast
}) => {
  if (!isOpen) return null;

  const filteredUsers = appUsers.filter(u => 
    u.email.toLowerCase().includes(userSearchEmail.toLowerCase()) || 
    u.name.toLowerCase().includes(userSearchEmail.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-busca-colaboradores">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-teal-400" />
            <span>Buscar Colaboradores</span>
          </h3>
          <button 
            onClick={() => {
              onClose();
              setUserSearchEmail('');
            }}
            className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1.5">Digite o e-mail ou nome do usuário:</label>
            <div className="relative">
              <input
                type="text"
                placeholder="ex: pedro.eletronicos@kyrub.com ou Maria"
                value={userSearchEmail}
                onChange={(e) => setUserSearchEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-teal-500"
                autoFocus
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            </div>
          </div>

          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            <span className="text-[9px] font-mono uppercase text-slate-500 block">Resultados em tempo real</span>
            
            {filteredUsers.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs italic">
                Nenhum usuário correspondente encontrado.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map(user => {
                  const isAlreadyAdded = selectedFriendsForNote.includes(user.name);
                  return (
                    <div key={user.id} className="bg-slate-950 border border-slate-850 p-3 rounded-xl flex items-center justify-between gap-3 hover:border-slate-800 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full object-cover border border-slate-800 shrink-0" referrerPolicy="no-referrer" />
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-white truncate">{user.name}</h4>
                          <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                          <span className="text-[8px] px-1.5 py-0.2 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">{user.role}</span>
                        </div>
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => {
                          if (!isAlreadyAdded) {
                            setSelectedFriendsForNote(prev => [...prev, user.name]);
                            triggerToast(`${user.name} adicionado!`, 'success');
                          } else {
                            setSelectedFriendsForNote(prev => prev.filter(n => n !== user.name));
                            triggerToast(`${user.name} removido!`, 'info');
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all shrink-0 cursor-pointer ${
                          isAlreadyAdded 
                            ? 'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25' 
                            : 'bg-teal-500 text-slate-950 hover:bg-teal-400'
                        }`}
                      >
                        {isAlreadyAdded ? 'Remover' : '+ Adicionar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              setUserSearchEmail('');
            }}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider cursor-pointer"
          >
            Concluir Seleção
          </button>
        </div>
      </div>
    </div>
  );
};
