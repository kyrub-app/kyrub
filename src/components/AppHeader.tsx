import { useState } from 'react';
import { CheckSquare, LogOut, Store as StoreIcon, User, Wallet } from 'lucide-react';
import { UserNotificationCenter } from './UserNotificationCenter';

interface AppHeaderProps {
  profilePhotoUrl: string;
  activeSection: 'perfil' | 'renda' | 'kyrub';
  onLogout: () => void | Promise<void>;
  onProfile: () => void;
  onMarketplace: () => void;
  onNotes: () => void;
  onWallet: () => void;
  onNotificationsOpen: () => void;
}

const controlClassName =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 transition-colors hover:border-orange-500/40 hover:text-orange-300 max-[390px]:h-9 max-[390px]:w-9';

export function AppHeader({
  profilePhotoUrl,
  activeSection,
  onLogout,
  onProfile,
  onMarketplace,
  onNotes,
  onWallet,
  onNotificationsOpen,
}: AppHeaderProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const navigate = (action: () => void): void => {
    setNotificationsOpen(false);
    action();
  };

  return (
    <header
      id="app-header"
      aria-label="Cabeçalho do Kyrub"
      className="sticky top-0 z-[160] flex items-center gap-2 border-b border-slate-900 bg-slate-950/90 px-3 py-3 backdrop-blur-md max-[390px]:gap-1 max-[390px]:px-2"
    >
      <button
        type="button"
        className={`${controlClassName} mr-auto hover:text-red-400`}
        title="Sair"
        aria-label="Sair"
        onClick={() => navigate(() => void onLogout())}
      >
        <LogOut className="h-4 w-4 scale-x-[-1]" />
      </button>
      <button
        type="button"
        className={`${controlClassName} overflow-hidden`}
        id="header-user-profile-trigger"
        title="Meu perfil"
        aria-label="Abrir meu perfil"
        onClick={() => navigate(onProfile)}
      >
        {profilePhotoUrl ? (
          <img src={profilePhotoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <User className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        className={controlClassName}
        id="header-marketplace-trigger"
        title="Marketplace"
        aria-label="Abrir Marketplace"
        aria-pressed={activeSection === 'kyrub'}
        onClick={() => navigate(onMarketplace)}
      >
        <StoreIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`${controlClassName} text-teal-400 hover:text-teal-300`}
        id="header-wallet-balance"
        title="Abrir Carteira"
        aria-label="Abrir Carteira"
        onClick={() => navigate(onWallet)}
      >
        <Wallet className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={controlClassName}
        id="header-notes-trigger"
        title="Notas"
        aria-label="Abrir Notas"
        aria-pressed={activeSection === 'perfil'}
        onClick={() => navigate(onNotes)}
      >
        <CheckSquare className="h-4 w-4" />
      </button>
      <UserNotificationCenter
        open={notificationsOpen}
        onOpenChange={value => {
          setNotificationsOpen(value);
          if (value) onNotificationsOpen();
        }}
      />
    </header>
  );
}
