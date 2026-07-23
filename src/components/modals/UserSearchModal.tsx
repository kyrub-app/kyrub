import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { Search, UserRound, Users } from 'lucide-react';
import { auth, db } from '../../utils/firebase';

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
  appUsers?: AppUser[];
  selectedFriendsForNote: string[];
  setSelectedFriendsForNote: React.Dispatch<React.SetStateAction<string[]>>;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const normalizeDirectoryUser = (
  id: string,
  data: Record<string, unknown>
): AppUser => ({
  id:
    typeof data.uid === 'string' && data.uid.trim()
      ? data.uid
      : id,
  name:
    typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : typeof data.displayName === 'string' && data.displayName.trim()
        ? data.displayName.trim()
        : typeof data.email === 'string' && data.email.includes('@')
          ? data.email.split('@')[0]
          : 'Usuário Kyrub',
  email: typeof data.email === 'string' ? data.email : '',
  role:
    typeof data.role === 'string' && data.role.trim()
      ? data.role
      : 'Usuário',
  avatar:
    typeof data.photoUrl === 'string'
      ? data.photoUrl
      : typeof data.photoURL === 'string'
        ? data.photoURL
        : typeof data.avatar === 'string'
          ? data.avatar
          : '',
});

export const UserSearchModal: React.FC<UserSearchModalProps> = ({
  isOpen,
  onClose,
  userSearchEmail,
  setUserSearchEmail,
  appUsers = [],
  selectedFriendsForNote,
  setSelectedFriendsForNote,
  triggerToast,
}) => {
  const [directoryUsers, setDirectoryUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let unsubscribeDirectory = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeDirectory();
      setDirectoryError('');

      if (!user) {
        setDirectoryUsers(appUsers);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      unsubscribeDirectory = onSnapshot(
        collection(db, 'users'),
        snapshot => {
          const users = snapshot.docs
            .flatMap(snapshotDocument => {
              const data =
                snapshotDocument.data() as Record<string, unknown>;

              if (data.isProfileVisible === false) return [];

              const directoryUser = normalizeDirectoryUser(
                snapshotDocument.id,
                data
              );

              return directoryUser.id === user.uid
                ? []
                : [directoryUser];
            })
            .sort((first, second) =>
              first.name.localeCompare(second.name, 'pt-BR')
            );

          setDirectoryUsers(users);
          setIsLoading(false);
        },
        error => {
          console.warn('Diretório de usuários indisponível para notas.', error);
          setDirectoryUsers(
            appUsers.filter(directoryUser => directoryUser.id !== user.uid)
          );
          setDirectoryError(
            'Não foi possível atualizar o diretório agora. Exibindo os usuários disponíveis no cache.'
          );
          setIsLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeDirectory();
    };
  }, [appUsers, isOpen]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = userSearchEmail.trim().toLocaleLowerCase('pt-BR');

    if (!normalizedSearch) return directoryUsers;

    return directoryUsers.filter(user => {
      const searchableName = user.name.toLocaleLowerCase('pt-BR');
      const searchableEmail = user.email.toLocaleLowerCase('pt-BR');
      return (
        searchableEmail.includes(normalizedSearch) ||
        searchableName.includes(normalizedSearch)
      );
    });
  }, [directoryUsers, userSearchEmail]);

  if (!isOpen) return null;

  const handleClose = () => {
    onClose();
    setUserSearchEmail('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-fade-in"
      id="modal-busca-colaboradores"
    >
      <div className="relative max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl animate-scale-up">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h3 className="flex items-center gap-2 text-base font-black text-white">
            <Users className="h-5 w-5 text-teal-400" />
            <span>Buscar colaboradores</span>
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-slate-500 hover:text-slate-300"
            aria-label="Fechar busca de colaboradores"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="note-collaborator-search"
              className="mb-1.5 block text-[10px] font-mono uppercase text-slate-400"
            >
              Digite o e-mail ou nome do usuário
            </label>
            <div className="relative">
              <input
                id="note-collaborator-search"
                type="search"
                placeholder="Nome ou e-mail cadastrado no Kyrub"
                value={userSearchEmail}
                onChange={event => setUserSearchEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-9 pr-4 text-xs text-white focus:border-teal-500 focus:outline-none"
                autoFocus
              />
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
            </div>
          </div>

          {directoryError && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-300">
              {directoryError}
            </p>
          )}

          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <span className="block text-[9px] font-mono uppercase text-slate-500">
                Usuários reais do app
              </span>
              {!isLoading && (
                <span className="text-[9px] font-mono text-slate-600">
                  {filteredUsers.length} resultado(s)
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Atualizando diretório...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-8 text-center text-xs italic text-slate-500">
                Nenhum usuário correspondente encontrado.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map(user => {
                  const isAlreadyAdded =
                    selectedFriendsForNote.includes(user.name);

                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 transition-colors hover:border-slate-700"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {user.avatar ? (
                          <img
                            src={user.avatar}
                            alt={user.name}
                            className="h-9 w-9 shrink-0 rounded-full border border-slate-800 object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-500"
                            aria-hidden="true"
                          >
                            <UserRound className="h-4 w-4" />
                          </div>
                        )}

                        <div className="min-w-0">
                          <h4 className="truncate text-xs font-bold text-white">
                            {user.name}
                          </h4>
                          <p className="truncate text-[10px] text-slate-400">
                            {user.email || 'E-mail não informado'}
                          </p>
                          <span className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-[8px] font-mono font-semibold uppercase text-slate-500">
                            {user.role}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (isAlreadyAdded) {
                            setSelectedFriendsForNote(previous =>
                              previous.filter(name => name !== user.name)
                            );
                            triggerToast(`${user.name} removido!`, 'info');
                            return;
                          }

                          setSelectedFriendsForNote(previous => [
                            ...previous,
                            user.name,
                          ]);
                          triggerToast(`${user.name} adicionado!`, 'success');
                        }}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold font-mono transition-all ${
                          isAlreadyAdded
                            ? 'border border-red-500/30 bg-red-500/15 text-red-400 hover:bg-red-500/25'
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

        <button
          type="button"
          onClick={handleClose}
          className="w-full rounded-xl bg-slate-800 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-300 transition-all hover:bg-slate-700"
        >
          Concluir seleção
        </button>
      </div>
    </div>
  );
};
