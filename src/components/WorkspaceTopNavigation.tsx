import { Bell, Bookmark, CheckSquare, Sparkles, UserRound, Users } from 'lucide-react';

/**
 * One canonical navigation bar for authenticated and guest workspaces.
 *
 * The authenticated notification center inserts its own live trigger into
 * #app-header. Guests receive a login-gated bell in the same last position.
 * No session-specific duplication of navigation labels, order or icons.
 */
interface WorkspaceTopNavigationProps {
  profilePhotoUrl?: string;
  onProfile: () => void;
  onKyrubia: () => void;
  onTasks: () => void;
  onConnections: () => void;
  onSaved: () => void;
  onGuestNotifications?: () => void;
}

const navButtonClass =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 transition-colors hover:border-orange-500/40 hover:text-orange-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500';

export function WorkspaceTopNavigation({
  profilePhotoUrl,
  onProfile,
  onKyrubia,
  onTasks,
  onConnections,
  onSaved,
  onGuestNotifications,
}: WorkspaceTopNavigationProps) {
  return (
    <>
      <button
        id="header-user-profile-trigger"
        type="button"
        onClick={onProfile}
        className={navButtonClass + ' mr-auto overflow-hidden'}
        title="Meu perfil"
        aria-label="Abrir meu perfil"
      >
        {profilePhotoUrl
          ? <img src={profilePhotoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          : <UserRound className="h-4 w-4" aria-hidden="true" />}
      </button>
      <button
        id="header-kyrubia-trigger"
        type="button"
        onClick={onKyrubia}
        className={navButtonClass + ' border-orange-500/25 text-orange-400 hover:border-orange-500/50 hover:bg-orange-500/10'}
        title="Cairúbia"
        aria-label="Abrir Cairúbia"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        id="header-tasks-trigger"
        type="button"
        onClick={onTasks}
        className={navButtonClass}
        title="Tarefas"
        aria-label="Abrir Tarefas"
      >
        <CheckSquare className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        id="header-connected-trigger"
        type="button"
        onClick={onConnections}
        className={navButtonClass}
        title="Minha Tribo"
        aria-label="Abrir Minha Tribo"
      >
        <Users className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        id="header-saved-trigger"
        type="button"
        onClick={onSaved}
        className={navButtonClass}
        title="Salvos"
        aria-label="Abrir Salvos"
      >
        <Bookmark className="h-4 w-4" aria-hidden="true" />
      </button>
      {onGuestNotifications && (
        <button
          id="header-guest-notifications-trigger"
          type="button"
          onClick={onGuestNotifications}
          className={navButtonClass + ' ml-auto'}
          title="Notificações"
          aria-label="Abrir notificações"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </>
  );
}
