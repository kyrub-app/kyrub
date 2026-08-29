import { useEffect, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  UserCommunicationCategoryPreferences,
  UserCommunicationPreferences,
} from '../../shared/userCommunicationPreferences';
import { saveUserCommunicationPreferences } from '../utils/userCommunicationPreferences';

interface UserCommunicationPreferencesModalProps {
  open: boolean;
  preferences: UserCommunicationPreferences;
  onClose: () => void;
  onSaved: (preferences: UserCommunicationPreferences) => void;
}

const CATEGORY_ITEMS: Array<{
  key: keyof UserCommunicationCategoryPreferences;
  label: string;
  description: string;
  icon: typeof Bell;
}> = [
  {
    key: 'store_chat',
    label: 'Mensagens de lojas e clientes',
    description: 'Novas mensagens do Chat Cliente ↔ Loja.',
    icon: MessageSquareText,
  },
  {
    key: 'order',
    label: 'Pedidos',
    description: 'Mudanças e eventos operacionais de pedidos quando forem conectados à central.',
    icon: PackageCheck,
  },
  {
    key: 'loyalty',
    label: 'Fidelidade',
    description: 'Pontos, desafios e recompensas quando esses eventos forem conectados à central.',
    icon: Sparkles,
  },
  {
    key: 'system',
    label: 'Sistema',
    description: 'Avisos técnicos e de segurança compatíveis com este canal.',
    icon: ShieldCheck,
  },
];

const browserPermission = (): NotificationPermission | 'unsupported' => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
};

export function UserCommunicationPreferencesModal({
  open,
  preferences,
  onClose,
  onSaved,
}: UserCommunicationPreferencesModalProps) {
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [categories, setCategories] = useState<UserCommunicationCategoryPreferences>(
    preferences.browser.categories
  );
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    browserPermission()
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setBrowserEnabled(preferences.browser.enabled);
    setCategories(preferences.browser.categories);
    setPermission(browserPermission());
    setErrorMessage('');
  }, [open, preferences]);

  if (!open) return null;

  const toggleBrowser = async (): Promise<void> => {
    if (browserEnabled) {
      setBrowserEnabled(false);
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      setErrorMessage('Este navegador não oferece alertas do sistema para o Kyrub.');
      return;
    }
    if (Notification.permission === 'denied') {
      setPermission('denied');
      setErrorMessage(
        'Os alertas estão bloqueados nas permissões do navegador. A caixa interna continuará funcionando normalmente.'
      );
      return;
    }
    const nextPermission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    setPermission(nextPermission);
    setBrowserEnabled(nextPermission === 'granted');
    if (nextPermission !== 'granted') {
      setErrorMessage(
        'Sem permissão do navegador, os alertas externos ficam desligados. As notificações continuam dentro do Kyrub.'
      );
    } else {
      setErrorMessage('');
    }
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setErrorMessage('');
    try {
      const saved = await saveUserCommunicationPreferences({
        browserEnabled: browserEnabled && permission === 'granted',
        categories,
      });
      onSaved(saved);
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar suas preferências.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[230] flex items-end justify-center bg-slate-950/90 p-3 backdrop-blur-md sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Preferências de comunicação"
      id="communication-preferences-modal"
    >
      <section className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white">Preferências de comunicação</h2>
              <p className="text-[9px] text-slate-500">Escolha como o Kyrub chama sua atenção.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 text-slate-500 hover:text-white"
            aria-label="Fechar preferências"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <strong className="text-[10px] uppercase text-emerald-300">Caixa interna do Kyrub</strong>
                <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                  Eventos canônicos continuam registrados na central interna. Estas preferências não apagam histórico nem silenciam a fonte de verdade.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                <div>
                  <strong className="text-xs text-white">Alertas do navegador</strong>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                    Mostra um alerta do sistema quando um novo evento compatível chegar enquanto o Kyrub estiver aberto.
                  </p>
                  <span className="mt-2 block font-mono text-[8px] uppercase text-slate-600">
                    Permissão neste dispositivo: {permission === 'unsupported' ? 'não suportado' : permission}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void toggleBrowser()}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                  browserEnabled
                    ? 'border-orange-400/50 bg-orange-500'
                    : 'border-slate-700 bg-slate-800'
                }`}
                aria-pressed={browserEnabled}
                aria-label="Ativar alertas do navegador"
              >
                <span className={`h-5 w-5 rounded-full bg-slate-950 transition-transform ${browserEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </section>

          <section className={`space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 ${browserEnabled ? '' : 'opacity-60'}`}>
            <div>
              <strong className="text-[10px] uppercase text-slate-300">Categorias no navegador</strong>
              <p className="mt-1 text-[9px] text-slate-600">A caixa interna continua recebendo os eventos mesmo se uma categoria for desmarcada aqui.</p>
            </div>
            {CATEGORY_ITEMS.map(item => {
              const Icon = item.icon;
              const active = categories[item.key];
              return (
                <button
                  type="button"
                  key={item.key}
                  disabled={!browserEnabled}
                  onClick={() =>
                    setCategories(current => ({
                      ...current,
                      [item.key]: !current[item.key],
                    }))
                  }
                  className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-left disabled:cursor-not-allowed"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    <div>
                      <strong className="text-[10px] text-slate-200">{item.label}</strong>
                      <p className="mt-0.5 text-[8px] leading-relaxed text-slate-600">{item.description}</p>
                    </div>
                  </div>
                  <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${active ? 'border-orange-400 bg-orange-500' : 'border-slate-700 bg-slate-900'}`} />
                </button>
              );
            })}
          </section>

          {errorMessage && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[9px] leading-relaxed text-red-300" role="alert">
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 px-4 text-[10px] font-black uppercase text-white disabled:bg-slate-800 disabled:text-slate-500"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Salvar preferências
          </button>
        </div>
      </section>
    </div>
  );
}
