import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Building2,
  Check,
  CircleAlert,
  Loader2,
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
import { STORE_ACCESS_PROFILE_TEMPLATES, createStoreAccessProfileFromTemplate } from '../../utils/storeAccessProfiles';
import { auth } from '../../utils/firebase';
import { claimExternalTeamInvitation, issueExternalTeamInvitation, type IssuedExternalTeamInvitation, type ExternalTeamInviteRole } from '../../utils/externalTeamInvitations';
import {
  STORE_ROLE_LABELS,
  canAssignStoreRole,
  canManageStoreRole,
  type StoreRole,
} from '../../utils/storeSecurity';
import {
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
  const [lastInvited, setLastInvited] = useState<{ name: string; email: string; storeName: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [externalInviteEmail, setExternalInviteEmail] = useState('');
  const [claimStoreId, setClaimStoreId] = useState('');
  const [claimInvitationId, setClaimInvitationId] = useState('');
  const [claimToken, setClaimToken] = useState('');
  const [issuedExternalInvite, setIssuedExternalInvite] = useState<IssuedExternalTeamInvitation | null>(null);
  const [inviteRole, setInviteRole] = useState<StoreRole>('seller');
  const [draftJobTitle, setDraftJobTitle] = useState('');
  const [draftDepartment, setDraftDepartment] = useState('');
  const [draftWorkArea, setDraftWorkArea] = useState('');
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
        console.warn('Diretório de lojas indisponível:', error);
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
        notify('Equipe e permissões ativadas para esta loja.', 'success');
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

  const normalizedInvitePhone = invitePhone.replace(/\D/g, '');
  const validInvitePhone = normalizedInvitePhone.length === 11 || (normalizedInvitePhone.length === 13 && normalizedInvitePhone.startsWith('55'));
  const invitePhoneE164 = normalizedInvitePhone.length === 11 ? `55${normalizedInvitePhone}` : normalizedInvitePhone;

  const handleClaimExternalInvite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!user) {
      notify('Faça login com o e-mail do destinatário para resgatar o convite.', 'error');
      return;
    }
    await runBusy('external-claim', async () => {
      try {
        const idToken = await user.getIdToken();
        await claimExternalTeamInvitation(idToken, {
          storeId: claimStoreId.trim(),
          invitationId: claimInvitationId.trim(),
          token: claimToken.trim(),
        });
        setClaimToken('');
        setClaimInvitationId('');
        setClaimStoreId('');
        notify('Convite resgatado. Aceite ou recuse na lista de convites recebidos.', 'success');
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Não foi possível resgatar o convite.', 'error');
      }
    });
  };

  const handleExternalInvite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!user || !selectedAccess || !canManageMembers) return;
    setIssuedExternalInvite(null);
    await runBusy('external-invite', async () => {
      try {
        const idToken = await user.getIdToken();
        const issued = await issueExternalTeamInvitation(idToken, {
          storeId: selectedAccess.store.id,
          recipientEmail: externalInviteEmail.trim(),
          role: inviteRole,
        });
        setIssuedExternalInvite(issued);
        notify('Convite criado. Compartilhe o código apenas com o destinatário.', 'success');
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Não foi possível criar o convite externo.', 'error');
      }
    });
  };

  const handleInvite = async (targetUser: KyrubDirectoryUser): Promise<void> => {
    if (!user || !selectedAccess) return;
    setLastInvited(null);
    await runBusy(`invite-${targetUser.uid}`, async () => {
      try {
        await inviteExistingKyrubUser(user, {
          store: selectedAccess.store,
          actorRole: selectedAccess.role,
          targetUser,
          role: inviteRole,
          ...(draftJobTitle.trim() ? { organization: { jobTitle: draftJobTitle, department: draftDepartment, workArea: draftWorkArea } } : {}),
        });
        setDirectoryResults(current =>
          current.filter(result => result.uid !== targetUser.uid)
        );
        setLastInvited({ name: targetUser.name, email: targetUser.email, storeName: selectedAccess.store.name });
        setDraftJobTitle('');
        setDraftDepartment('');
        setDraftWorkArea('');
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
      <div>
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
          Equipe da loja
        </span>
        <h3 className="mt-1 flex items-center gap-2 text-base font-black text-white">
          <ShieldCheck className="h-5 w-5 text-orange-400" />
          Equipe & Permissões
        </h3>
        <p className="mt-1 max-w-2xl text-[11px] text-slate-500">
          Convide contas Kyrub existentes e defina o acesso de cada pessoa à loja atual.
        </p>
      </div>

      <details className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
        <summary className="cursor-pointer text-xs font-bold text-white">Cargos e permissões — modelos iniciais</summary>
        <p className="mt-2 text-[11px] text-slate-400">Modelos de referência para personalização futura. Ainda não atribuem permissões nem enviam convites; o cadastro de equipe existente permanece inalterado.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {STORE_ACCESS_PROFILE_TEMPLATES.map(template => {
            const preview = createStoreAccessProfileFromTemplate(selectedAccess?.store.id ?? legacyStoreId, template);
            return (
              <div key={template.id} className="rounded-xl border border-slate-800 p-3">
                <strong className="text-xs text-white">{preview.name}</strong>
                <p className="mt-1 text-[10px] text-slate-400">{preview.permissions.length} permissões iniciais · base técnica: {STORE_ROLE_LABELS[preview.baseRole]}</p>
              </div>
            );
          })}
        </div>
      </details>

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

      <details className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
        <summary className="cursor-pointer text-xs font-bold text-white">Recebi um convite externo</summary>
        <p className="mt-2 text-[11px] text-slate-400">Entre com o mesmo e-mail verificado informado pelo responsável da loja. O resgate não aceita o convite automaticamente.</p>
        <form onSubmit={event => void handleClaimExternalInvite(event)} className="mt-3 grid gap-2">
          <input required value={claimStoreId} onChange={event => setClaimStoreId(event.target.value)} placeholder="Identificador da loja" aria-label="Identificador da loja convidante" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
          <input required value={claimInvitationId} onChange={event => setClaimInvitationId(event.target.value)} placeholder="Identificador do convite" aria-label="Identificador do convite externo" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
          <input required value={claimToken} onChange={event => setClaimToken(event.target.value)} placeholder="Código privado do convite" aria-label="Código privado do convite" autoComplete="off" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
          <button type="submit" disabled={busyKey === 'external-claim' || !user} className="rounded-xl bg-orange-500 px-4 py-2 text-[10px] font-bold text-slate-950 disabled:opacity-40">Resgatar convite</button>
        </form>
      </details>

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
                <strong className="text-xs uppercase text-white">Preparar equipe e permissões</strong>
                <p className="mt-1 text-[11px] text-slate-500">
                  Prepare esta loja para convidar pessoas e controlar seus acessos.
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
                Ativar equipe
              </button>
            </div>
          )}

          {selectedAccess && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-orange-400">
                    <StoreIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <span className="font-mono text-[8px] font-bold uppercase text-slate-600">Loja atual</span>
                    <strong className="block truncate text-sm text-white">{selectedAccess.store.name}</strong>
                  </div>
                </div>
                <div className="sm:text-right">
                  <span className="font-mono text-[8px] font-bold uppercase text-slate-600">Seu acesso</span>
                  <span className={`mt-1 block w-fit rounded-full border px-2.5 py-1 text-[9px] font-black uppercase sm:ml-auto ${roleBadgeClass(selectedAccess.role)}`}>
                    {STORE_ROLE_LABELS[selectedAccess.role]}
                  </span>
                  <p className="mt-1 text-[10px] text-slate-500">{statusLabel(selectedAccess.status)}</p>
                </div>
              </div>

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
                                  {(member.jobTitle || member.department || member.workArea) && (
                                    <span className="mt-1 block text-[10px] text-slate-400">{[member.jobTitle, member.department, member.workArea].filter(Boolean).join(' · ')}</span>
                                  )}
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
                      <div className="space-y-2 rounded-xl border border-slate-800 p-3">
                        <p className="text-[10px] text-slate-400">Organização do colaborador (opcional; enviada com o convite quando o cargo for preenchido)</p>
                        <input value={draftJobTitle} onChange={event => setDraftJobTitle(event.target.value)} maxLength={80} placeholder="Cargo ou função (ex.: Representante de vendas)" aria-label="Cargo ou função" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                        <input value={draftDepartment} onChange={event => setDraftDepartment(event.target.value)} maxLength={80} placeholder="Setor (opcional, ex.: Marketing)" aria-label="Setor" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                        <input value={draftWorkArea} onChange={event => setDraftWorkArea(event.target.value)} maxLength={80} placeholder="Área de atuação (opcional, ex.: Conteúdo digital)" aria-label="Área de atuação" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="team-invite-phone" className="block text-[10px] text-slate-400">Celular para avisar por SMS (opcional, DDD brasileiro)</label>
                        <input id="team-invite-phone" type="tel" inputMode="tel" autoComplete="off" value={invitePhone} onChange={event => setInvitePhone(event.target.value)} placeholder="(11) 99999-9999" className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white" />
                        {invitePhone.trim() && !validInvitePhone && <p className="text-[10px] text-amber-300">Informe 11 dígitos com DDD ou +55 seguido do DDD e número.</p>}
                      </div>
                      <button
                        type="submit"
                        disabled={isSearching || !searchTerm.trim()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-2.5 text-[10px] font-black uppercase text-white disabled:opacity-40"
                      >
                        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Buscar conta
                      </button>
                    </form>

                    <form onSubmit={event => void handleExternalInvite(event)} className="space-y-2 rounded-xl border border-slate-800 p-3">
                      <strong className="block text-[11px] text-white">Convidar pessoa sem conta Kyrub</strong>
                      <p className="text-[10px] text-slate-400">O convite é vinculado ao e-mail informado. A pessoa precisará entrar com esse e-mail verificado para resgatar o convite.</p>
                      <input type="email" required value={externalInviteEmail} onChange={event => { setExternalInviteEmail(event.target.value); setIssuedExternalInvite(null); }} placeholder="E-mail do destinatário" aria-label="E-mail para convite externo" className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white" />
                      <button type="submit" disabled={busyKey === 'external-invite' || !externalInviteEmail.trim() || assignableRoles.length === 0} className="w-full rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2.5 text-[10px] font-bold text-orange-300 disabled:opacity-40">Criar convite externo para a função selecionada</button>
                      {issuedExternalInvite && (
                        <div className="space-y-2 rounded-xl border border-amber-500/30 p-3 text-[10px] text-amber-200">
                          <p>Convite gerado. Envie o identificador e o código ao destinatário por um canal privado. O código só será exibido nesta sessão e não concede acesso sem autenticação.</p>
                          <p className="break-all">Loja: {selectedAccess.store.id}</p>
                          <p className="break-all">Identificador: {issuedExternalInvite.invitationId}</p>
                          <p className="break-all">Código: {issuedExternalInvite.token}</p>
                          <p>Validade: {new Date(issuedExternalInvite.expiresAt).toLocaleString('pt-BR')}</p>
                        </div>
                      )}
                    </form>

                    {lastInvited && (
                      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[11px] text-slate-200">
                        <p>Convite interno criado para <strong>{lastInvited.name}</strong>. Você também pode avisar pelo WhatsApp; o aceite continua exclusivo da conta convidada no Kyrub.</p>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(`Olá, ${lastInvited.name}! A empresa ${lastInvited.storeName} convidou você para trabalhar pelo Kyrub. Acesse https://kyrub.com, entre com sua conta e confira o convite no sino de notificações para aceitar ou recusar.`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex rounded-lg border border-emerald-500/40 px-3 py-2 font-bold text-emerald-300 hover:bg-emerald-500/10"
                        >Compartilhar pelo WhatsApp</a>
                        {lastInvited.email && (
                          <a
                            href={`mailto:${encodeURIComponent(lastInvited.email)}?subject=${encodeURIComponent('Convite de trabalho no Kyrub')}&body=${encodeURIComponent(`Olá, ${lastInvited.name}! A empresa ${lastInvited.storeName} convidou você para sua equipe no Kyrub. Entre em https://kyrub.com com sua conta e responda ao convite pelo sino de notificações. O convite só pode ser aceito pela conta destinatária.`)}`}
                            className="ml-2 mt-2 inline-flex rounded-lg border border-slate-600 px-3 py-2 font-bold text-slate-200 hover:bg-slate-800"
                          >Compartilhar por e-mail</a>
                        )}
                        {validInvitePhone && (
                          <a
                            href={`sms:+${invitePhoneE164}?body=${encodeURIComponent(`Olá, ${lastInvited.name}! ${lastInvited.storeName} convidou você para trabalhar pelo Kyrub. Acesse https://kyrub.com e responda pelo sino de notificações com sua conta.`)}`}
                            className="ml-2 mt-2 inline-flex rounded-lg border border-slate-600 px-3 py-2 font-bold text-slate-200 hover:bg-slate-800"
                          >Compartilhar por SMS</a>
                        )}
                        <p className="mt-2 text-[10px] text-slate-400">O envio depende de confirmação no aplicativo escolhido. O número digitado é usado apenas para abrir o SMS; não identifica nem autentica o convidado.</p>
                      </div>
                    )}
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
