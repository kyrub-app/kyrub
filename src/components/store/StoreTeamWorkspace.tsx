import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Store as StoreIcon,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { Store } from '../../types';
import { auth } from '../../utils/firebase';
import {
  STORE_ROLE_LABELS,
  canAssignStoreRole,
  canManageStoreRole,
  type StoreRole,
} from '../../utils/storeSecurity';
import {
  createCanonicalStore,
  createCanonicalStoreFromLegacy,
  inviteExistingKyrubUser,
  searchExistingKyrubUsers,
  subscribeToStoreMembers,
  subscribeToUserStoreAccess,
  updateOwnStoreInvitation,
  updateStoreMemberRole,
  updateStoreMemberStatus,
  type CanonicalStoreRecord,
  type KyrubDirectoryUser,
  type StoreAccessRecord,
  type StoreMemberDirectoryRecord,
} from '../../utils/storeDirectory';

interface StoreTeamWorkspaceProps {
  legacyStore: Store;
  legacyStoreId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const assignableRolesFor = (actorRole: StoreRole): StoreRole[] =>
  (['manager', 'cashier', 'seller', 'production'] as StoreRole[]).filter(role =>
    canAssignStoreRole(actorRole, role)
  );

const statusLabel = (status: StoreAccessRecord['status']): string => {
  if (status === 'invited') return 'Convite pendente';
  if (status === 'suspended') return 'Acesso suspenso';
  return 'Acesso ativo';
};

const memberStatusLabel = (status: StoreMemberDirectoryRecord['status']): string => {
  const labels: Record<StoreMemberDirectoryRecord['status'], string> = {
    invited: 'Convite pendente',
    active: 'Ativo',
    suspended: 'Suspenso',
    removed: 'Removido',
  };
  return labels[status];
};

const roleBadgeClass = (role: StoreRole): string => {
  const styles: Record<StoreRole, string> = {
    owner: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    manager: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    cashier: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    seller: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    production: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  };
  return styles[role];
};

export const StoreTeamWorkspace = ({
  legacyStore,
  legacyStoreId,
  notify,
}: StoreTeamWorkspaceProps) => {
  const [accesses, setAccesses] = useState<StoreAccessRecord[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [members, setMembers] = useState<StoreMemberDirectoryRecord[]>([]);
  const [directoryResults, setDirectoryResults] = useState<KyrubDirectoryUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [inviteRole, setInviteRole] = useState<StoreRole>('seller');
  const [newStoreName, setNewStoreName] = useState('');
  const [isLoadingAccess, setIsLoadingAccess] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [accessError, setAccessError] = useState('');

  const user = auth.currentUser;
  const selectedAccess = useMemo(
    () => accesses.find(access => access.store.id === selectedStoreId) ?? null,
    [accesses, selectedStoreId]
  );
  const pendingInvites = useMemo(
    () => accesses.filter(access => access.status === 'invited'),
    [accesses]
  );
  const activeAccesses = useMemo(
    () => accesses.filter(access => access.status === 'active'),
    [accesses]
  );
  const legacyStoreRegistered = accesses.some(
    access => access.store.legacyTenantId === legacyStoreId
  );
  const canManageMembers =
    selectedAccess?.status === 'active' &&
    (selectedAccess.role === 'owner' || selectedAccess.role === 'manager');
  const assignableRoles = selectedAccess
    ? assignableRolesFor(selectedAccess.role)
    : [];

  useEffect(() => {
    if (!user) {
      setAccesses([]);
      setIsLoadingAccess(false);
      return;
    }

    setIsLoadingAccess(true);
    setAccessError('');
    return subscribeToUserStoreAccess(
      user.uid,
      nextAccesses => {
        setAccesses(nextAccesses);
        setIsLoadingAccess(false);
        setSelectedStoreId(current => {
          if (nextAccesses.some(access => access.store.id === current)) return current;
          const preferred =
            nextAccesses.find(
              access =>
                access.status === 'active' &&
                access.store.legacyTenantId === legacyStoreId
            ) ??
            nextAccesses.find(access => access.status === 'active') ??
            nextAccesses[0];
          return preferred?.store.id ?? '';
        });
      },
      error => {
        console.warn('Diretório multi-loja indisponível:', error);
        setIsLoadingAccess(false);
        setAccessError(
          'As regras canônicas de lojas ainda não estão implantadas neste Firebase.'
        );
      }
    );
  }, [legacyStoreId, user?.uid]);

  useEffect(() => {
    setMembers([]);
    if (!selectedAccess || !canManageMembers) return;

    return subscribeToStoreMembers(
      selectedAccess.store.id,
      setMembers,
      error => {
        console.warn('Equipe da loja indisponível:', error);
        notify('Não foi possível carregar a equipe desta loja.', 'error');
      }
    );
  }, [canManageMembers, notify, selectedAccess?.store.id]);

  useEffect(() => {
    if (assignableRoles.length > 0 && !assignableRoles.includes(inviteRole)) {
      setInviteRole(assignableRoles[0]);
    }
  }, [assignableRoles, inviteRole]);

  const runBusy = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusyKey(key);
    try {
      await action();
    } finally {
      setBusyKey('');
    }
  };

  const handleRegisterLegacyStore = async (): Promise<void> => {
    if (!user) return;
    if (user.uid !== legacyStoreId) {
      notify('Somente o proprietário atual pode registrar esta loja.', 'error');
      return;
    }

    await runBusy('register-legacy', async () => {
      try {
        const created = await createCanonicalStoreFromLegacy(
          user,
          legacyStore,
          legacyStoreId
        );
        setSelectedStoreId(created.id);
        notify('Estrutura multi-loja ativada para esta loja.', 'success');
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : 'Não foi possível registrar a loja.',
          'error'
        );
      }
    });
  };

  const handleCreateStore = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!user) return;

    await runBusy('create-store', async () => {
      try {
        const created = await createCanonicalStore(user, { name: newStoreName });
        setNewStoreName('');
        setSelectedStoreId(created.id);
        notify('Nova loja criada no diretório multi-loja.', 'success');
      } catch (error) {
        notify(
          error instanceof Error ? error.message : 'Não foi possível criar a loja.',
          'error'
        );
      }
    });
  };

  const handleInvitationDecision = async (
    storeId: string,
    decision: 'accept' | 'decline'
  ): Promise<void> => {
    if (!user) return;
    await runBusy(`${decision}-${storeId}`, async () => {
      try {
        await updateOwnStoreInvitation(user, storeId, decision);
        notify(
          decision === 'accept' ? 'Convite aceito.' : 'Convite recusado.',
          decision === 'accept' ? 'success' : 'info'
        );
      } catch (error) {
        notify(
          error instanceof Error ? error.message : 'Não foi possível responder ao convite.',
          'error'
        );
      }
    });
  };

  const handleSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!searchTerm.trim()) return;
    setIsSearching(true);
    try {
      const results = await searchExistingKyrubUsers(searchTerm);
      setDirectoryResults(
        results.filter(result =>
          result.uid !== user?.uid && !members.some(member => member.userId === result.uid)
        )
      );
      if (results.length === 0) {
        notify('Nenhuma conta Kyrub encontrada com esse dado exato.', 'info');
      }
    } catch (error) {
      console.error('Falha ao buscar usuário Kyrub:', error);
      notify('Não foi possível consultar o diretório de usuários.', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleInvite = async (targetUser: KyrubDirectoryUser): Promise<void> => {
    if (!user || !selectedAccess) return;
    await runBusy(`invite-${targetUser.uid}`, async () => {
      try {
        await inviteExistingKyrubUser(user, {
          store: selectedAccess.store,
          actorRole: selectedAccess.role,
          targetUser,
          role: inviteRole,
        });
        setDirectoryResults(current =>
          current.filter(result => result.uid !== targetUser.uid)
        );
        notify(
          `${targetUser.name} foi convidado como ${STORE_ROLE_LABELS[inviteRole]}.`,
          'success'
        );
      } catch (error) {
        notify(
          error instanceof Error ? error.message : 'Não foi possível enviar o convite.',
          'error'
        );
      }
    });
  };

  const handleMemberStatus = async (
    member: StoreMemberDirectoryRecord,
    status: 'active' | 'suspended' | 'removed'
  ): Promise<void> => {
    if (!selectedAccess || !canManageStoreRole(selectedAccess.role, member.role)) {
      notify('Seu papel não pode alterar este membro.', 'error');
      return;
    }

    await runBusy(`${status}-${member.userId}`, async () => {
      try {
        await updateStoreMemberStatus(selectedAccess.store.id, member.userId, status);
        notify('Vínculo da equipe atualizado.', 'success');
      } catch (error) {
        notify(
          error instanceof Error ? error.message : 'Não foi possível atualizar o membro.',
          'error'
        );
      }
    });
  };

  const handleRoleChange = async (
    member: StoreMemberDirectoryRecord,
    role: StoreRole
  ): Promise<void> => {
    if (!selectedAccess || !canAssignStoreRole(selectedAccess.role, role)) {
      notify('Seu papel não pode atribuir esta função.', 'error');
      return;
    }

    await runBusy(`role-${member.userId}`, async () => {
      try {
        await updateStoreMemberRole(selectedAccess.store.id, member.userId, role);
        notify('Função do membro atualizada.', 'success');
      } catch (error) {
        notify(
          error instanceof Error ? error.message : 'Não foi possível alterar a função.',
          'error'
        );
      }
    });
  };

  return (
    <section className="mb-5 space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
            Segurança multi-loja
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-base font-black text-white">
            <ShieldCheck className="h-5 w-5 text-orange-400" />
            Lojas, equipe e permissões
          </h3>
          <p className="mt-1 max-w-2xl text-[11px] text-slate-500">
            Somente contas Kyrub existentes podem receber convites. Este seletor controla o contexto administrativo; pedidos e produtos serão migrados na etapa de gravação dupla.
          </p>
        </div>

        {accesses.length > 0 && (
          <label className="relative min-w-0 lg:w-72">
            <span className="mb-1 block font-mono text-[8px] font-bold uppercase text-slate-500">
              Loja administrativa
            </span>
            <select
              value={selectedStoreId}
              onChange={event => setSelectedStoreId(event.target.value)}
              className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 pr-9 text-xs font-bold text-white focus:border-orange-500 focus:outline-none"
            >
              {accesses.map(access => (
                <option key={access.store.id} value={access.store.id}>
                  {access.store.name} — {STORE_ROLE_LABELS[access.role]}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 text-slate-500" />
          </label>
        )}
      </div>

      {accessError && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs text-amber-200">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong className="block">Implantação das regras pendente</strong>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
                {accessError} A interface está pronta, mas não usará o caminho inseguro de <code>/artifacts</code> para armazenar papéis da equipe.
              </p>
              <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 font-mono text-[10px] text-slate-300">
                npm run deploy:firestore-security
              </code>
            </div>
          </div>
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase text-white">Convites recebidos</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {pendingInvites.map(access => (
              <article
                key={access.store.id}
                className="rounded-2xl border border-orange-500/25 bg-orange-500/10 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="text-sm text-white">{access.store.name}</strong>
                    <p className="mt-1 text-[10px] text-slate-400">
                      Função: {STORE_ROLE_LABELS[access.role]}
                    </p>
                  </div>
                  <UserPlus className="h-5 w-5 text-orange-400" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleInvitationDecision(access.store.id, 'accept')}
                    disabled={busyKey === `accept-${access.store.id}`}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"
                  >
                    Aceitar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleInvitationDecision(access.store.id, 'decline')}
                    disabled={busyKey === `decline-${access.store.id}`}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase text-slate-300 disabled:opacity-50"
                  >
                    Recusar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {isLoadingAccess ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/50 py-8 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando vínculos de lojas…
        </div>
      ) : (
        <>
          {!legacyStoreRegistered && user?.uid === legacyStoreId && !accessError && (
            <div className="rounded-2xl border border-dashed border-orange-500/30 bg-slate-950/60 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div>
                <strong className="text-xs uppercase text-white">Registrar a loja atual</strong>
                <p className="mt-1 text-[11px] text-slate-500">
                  Cria um ID independente e mantém a ligação temporária com os dados existentes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRegisterLegacyStore()}
                disabled={busyKey === 'register-legacy'}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50 sm:mt-0 sm:w-auto"
              >
                {busyKey === 'register-legacy' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Building2 className="h-4 w-4" />
                )}
                Ativar multi-loja
              </button>
            </div>
          )}

          {!accessError && (
            <form
              onSubmit={event => void handleCreateStore(event)}
              className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-950/50 p-3 sm:flex-row"
            >
              <input
                value={newStoreName}
                onChange={event => setNewStoreName(event.target.value)}
                placeholder="Nome da nova loja"
                className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-orange-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newStoreName.trim() || busyKey === 'create-store'}
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-[10px] font-black uppercase text-white disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Nova loja
              </button>
            </form>
          )}

          {selectedAccess && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:col-span-2">
                  <span className="font-mono text-[8px] font-bold uppercase text-slate-600">Contexto selecionado</span>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-orange-400">
                      <StoreIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-white">{selectedAccess.store.name}</strong>
                      <span className="text-[10px] text-slate-500">{selectedAccess.store.id}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <span className="font-mono text-[8px] font-bold uppercase text-slate-600">Seu acesso</span>
                  <span className={`mt-2 block w-fit rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${roleBadgeClass(selectedAccess.role)}`}>
                    {STORE_ROLE_LABELS[selectedAccess.role]}
                  </span>
                  <p className="mt-2 text-[10px] text-slate-500">{statusLabel(selectedAccess.status)}</p>
                </div>
              </div>

              {selectedAccess.store.migrationStatus === 'registry_only' && (
                <p className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[10px] text-blue-200">
                  Cadastro e permissões preparados. Produtos, pedidos, caixa e PDV continuarão no caminho legado até a gravação dupla.
                </p>
              )}

              {canManageMembers ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
                  <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="flex items-center gap-2 text-xs font-black uppercase text-white">
                          <Users className="h-4 w-4 text-pink-400" /> Equipe
                        </h4>
                        <p className="mt-1 text-[10px] text-slate-500">{members.length} vínculo(s)</p>
                      </div>
                    </div>

                    {members.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-800 py-8 text-center text-[11px] text-slate-600">
                        Nenhum colaborador convidado.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {members.map(member => {
                          const canManage = canManageStoreRole(selectedAccess.role, member.role);
                          const roleOptions = assignableRolesFor(selectedAccess.role);
                          return (
                            <article key={member.userId} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                              <div className="flex items-start gap-3">
                                {member.photoUrl ? (
                                  <img src={member.photoUrl} alt="" className="h-10 w-10 rounded-xl object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-slate-600">
                                    <Users className="h-4 w-4" />
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <strong className="block truncate text-xs text-white">{member.displayName || member.email}</strong>
                                  <span className="block truncate text-[10px] text-slate-500">{member.email}</span>
                                  <span className="mt-1 block text-[9px] font-bold uppercase text-slate-600">{memberStatusLabel(member.status)}</span>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                <select
                                  value={member.role}
                                  onChange={event => void handleRoleChange(member, event.target.value as StoreRole)}
                                  disabled={!canManage || busyKey === `role-${member.userId}`}
                                  className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
                                >
                                  {!roleOptions.includes(member.role) && (
                                    <option value={member.role}>{STORE_ROLE_LABELS[member.role]}</option>
                                  )}
                                  {roleOptions.map(role => (
                                    <option key={role} value={role}>{STORE_ROLE_LABELS[role]}</option>
                                  ))}
                                </select>

                                {member.status === 'active' ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleMemberStatus(member, 'suspended')}
                                    disabled={!canManage || busyKey === `suspended-${member.userId}`}
                                    className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[9px] font-black uppercase text-amber-300 disabled:opacity-40"
                                  >
                                    <UserMinus className="h-3.5 w-3.5" /> Suspender
                                  </button>
                                ) : member.status === 'suspended' ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleMemberStatus(member, 'active')}
                                    disabled={!canManage || busyKey === `active-${member.userId}`}
                                    className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase text-emerald-300 disabled:opacity-40"
                                  >
                                    <UserCheck className="h-3.5 w-3.5" /> Reativar
                                  </button>
                                ) : null}

                                {member.status !== 'removed' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleMemberStatus(member, 'removed')}
                                    disabled={!canManage || busyKey === `removed-${member.userId}`}
                                    className="flex items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-300 disabled:opacity-40"
                                    aria-label="Remover membro"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div>
                      <h4 className="flex items-center gap-2 text-xs font-black uppercase text-white">
                        <UserPlus className="h-4 w-4 text-orange-400" /> Convidar conta Kyrub
                      </h4>
                      <p className="mt-1 text-[10px] text-slate-500">Busca exata por e-mail ou nome do perfil.</p>
                    </div>

                    <form onSubmit={event => void handleSearch(event)} className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                        <input
                          value={searchTerm}
                          onChange={event => setSearchTerm(event.target.value)}
                          placeholder="E-mail exato ou nome completo"
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-3 text-xs text-white focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                      <select
                        value={inviteRole}
                        onChange={event => setInviteRole(event.target.value as StoreRole)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs font-bold text-white"
                      >
                        {assignableRoles.map(role => (
                          <option key={role} value={role}>{STORE_ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={isSearching || !searchTerm.trim()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-2.5 text-[10px] font-black uppercase text-white disabled:opacity-40"
                      >
                        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Buscar conta
                      </button>
                    </form>

                    <div className="space-y-2">
                      {directoryResults.map(result => (
                        <article key={result.uid} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                          <div className="flex items-center gap-3">
                            {result.photoUrl ? (
                              <img src={result.photoUrl} alt="" className="h-9 w-9 rounded-xl object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-slate-600">
                                <Users className="h-4 w-4" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <strong className="block truncate text-xs text-white">{result.name}</strong>
                              <span className="block truncate text-[10px] text-slate-500">{result.email}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleInvite(result)}
                              disabled={busyKey === `invite-${result.uid}`}
                              className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-slate-950 disabled:opacity-50"
                              aria-label={`Convidar ${result.name}`}
                            >
                              {busyKey === `invite-${result.uid}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              ) : selectedAccess.status === 'suspended' ? (
                <p className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-5 text-center text-xs text-red-300">
                  Seu acesso a esta loja está suspenso.
                </p>
              ) : selectedAccess.role !== 'owner' && selectedAccess.role !== 'manager' ? (
                <p className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-5 text-center text-xs text-slate-500">
                  Seu papel pode operar a loja após a migração dos módulos, mas não administra a equipe.
                </p>
              ) : null}
            </div>
          )}

          {activeAccesses.length === 0 && pendingInvites.length === 0 && !accessError && user?.uid !== legacyStoreId && (
            <div className="rounded-2xl border border-dashed border-slate-800 py-8 text-center">
              <StoreIcon className="mx-auto h-8 w-8 text-slate-700" />
              <p className="mt-3 text-xs font-bold text-slate-500">Nenhum vínculo de loja encontrado.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
};
