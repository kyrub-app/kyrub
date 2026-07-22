import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Banknote,
  Building2,
  CircleAlert,
  FileCheck2,
  Flag,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  getAdminPermissions,
  hasAdminPermission,
  loadAdminDashboardMetrics,
  recordAdminSessionAccess,
  subscribeToAdminProfile,
  type AdminDashboardMetric,
  type AdminPermission,
  type AdminProfile,
  type AdminRole,
} from '../../utils/adminControlPlane';
import AdminDirectoryWorkspace from './AdminDirectoryWorkspace';

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  support: 'Suporte',
  operations: 'Operações',
  finance: 'Financeiro',
  compliance: 'Compliance',
};

const MODULES: Array<{
  label: string;
  description: string;
  permission: AdminPermission;
  icon: typeof Users;
  status: 'available' | 'planned';
}> = [
  {
    label: 'Usuários',
    description: 'Busca exata, situação cadastral e lojas vinculadas.',
    permission: 'read_users',
    icon: Users,
    status: 'available',
  },
  {
    label: 'Lojas',
    description: 'Tenants, equipes, migração e planos registrados.',
    permission: 'read_stores',
    icon: Building2,
    status: 'available',
  },
  {
    label: 'Financeiro e BaaS',
    description: 'Onboarding, taxas, splits e conciliação.',
    permission: 'read_finance',
    icon: Banknote,
    status: 'planned',
  },
  {
    label: 'Auditoria',
    description: 'Ações administrativas e eventos críticos.',
    permission: 'read_audit',
    icon: FileCheck2,
    status: 'planned',
  },
  {
    label: 'Saúde do sistema',
    description: 'Jobs, integrações, custos e falhas.',
    permission: 'read_system_health',
    icon: Activity,
    status: 'planned',
  },
  {
    label: 'Feature flags',
    description: 'Ativações graduais por ambiente, plano e conta.',
    permission: 'manage_features',
    icon: Flag,
    status: 'planned',
  },
];

const formatMetric = (metric: AdminDashboardMetric): string => {
  if (metric.state === 'restricted') return 'Restrito';
  if (metric.state === 'unavailable' || metric.value === null) {
    return 'Indisponível';
  }
  return metric.value.toLocaleString('pt-BR');
};

const LoginScreen = ({
  busy,
  error,
  onLogin,
}: {
  busy: boolean;
  error: string;
  onLogin: () => void;
}) => (
  <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
    <section className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/30 sm:p-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <span className="mt-6 block text-[10px] font-black uppercase tracking-[0.24em] text-cyan-400">
        Kyrub Control Plane
      </span>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
        Administração do ecossistema
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        Área restrita para operação, segurança, finanças e compliance. O login não concede acesso automaticamente.
      </p>

      {error && (
        <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={onLogin}
        disabled={busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LockKeyhole className="h-4 w-4" />
        {busy ? 'Autenticando' : 'Entrar com Google'}
      </button>
      <p className="mt-4 text-center text-[10px] leading-relaxed text-slate-600">
        Contas administrativas são provisionadas exclusivamente por processo seguro e auditado.
      </p>
    </section>
  </main>
);

const AccessDeniedScreen = ({
  user,
  profile,
  onLogout,
}: {
  user: User;
  profile: AdminProfile | null;
  onLogout: () => void;
}) => {
  const suspended = profile?.status === 'suspended';
  const revoked = profile?.status === 'revoked';
  const title = suspended
    ? 'Acesso administrativo suspenso'
    : revoked
      ? 'Acesso administrativo revogado'
      : 'Conta sem autorização administrativa';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-lg rounded-[2rem] border border-amber-500/25 bg-slate-900/85 p-6 sm:p-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300">
          <LockKeyhole className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-black text-white">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          A autenticação de{' '}
          <strong className="text-slate-200">{user.email ?? user.uid}</strong>{' '}
          foi concluída, mas o Control Plane exige um registro administrativo ativo separado da conta Kyrub comum.
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-200 hover:bg-slate-700"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </section>
    </main>
  );
};

export default function AdminControlPlaneApp() {
  const [authResolved, setAuthResolved] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null | undefined>(undefined);
  const [metrics, setMetrics] = useState<AdminDashboardMetric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribeProfile = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, nextUser => {
      unsubscribeProfile();
      unsubscribeProfile = () => undefined;
      setUser(nextUser);
      setMetrics([]);
      setError('');

      if (!nextUser) {
        setProfile(null);
        setAuthResolved(true);
        return;
      }

      setProfile(undefined);
      unsubscribeProfile = subscribeToAdminProfile(
        nextUser,
        nextProfile => {
          setProfile(nextProfile);
          setAuthResolved(true);
        },
        () => {
          setProfile(null);
          setAuthResolved(true);
          setError('Não foi possível validar a autorização administrativa.');
        }
      );
    });

    return () => {
      unsubscribeProfile();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!user || !profile || profile.status !== 'active') return;
    const auditKey = `kyrub_admin_session_logged_${user.uid}`;
    try {
      if (sessionStorage.getItem(auditKey) === '1') return;
      sessionStorage.setItem(auditKey, '1');
    } catch {
      // Session storage is only a duplicate guard. Authorization remains server-side.
    }

    void recordAdminSessionAccess(user, profile).catch(() => {
      try {
        sessionStorage.removeItem(auditKey);
      } catch {
        // The audit failure must not create a client-side authorization bypass.
      }
    });
  }, [profile, user]);

  useEffect(() => {
    if (!profile || profile.status !== 'active') return;
    setMetricsLoading(true);
    void loadAdminDashboardMetrics(profile)
      .then(setMetrics)
      .finally(() => setMetricsLoading(false));
  }, [profile]);

  const visibleModules = useMemo(
    () =>
      profile
        ? MODULES.filter(module =>
            hasAdminPermission(profile, module.permission)
          )
        : [],
    [profile]
  );

  const handleLogin = async () => {
    setLoginBusy(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível concluir o login administrativo.'
      );
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = () => void signOut(auth);

  if (!authResolved || (user && profile === undefined)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-8 w-8 animate-pulse text-cyan-400" />
          <p className="mt-3 text-xs font-black uppercase tracking-[0.2em]">
            Validando acesso
          </p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen busy={loginBusy} error={error} onLogin={handleLogin} />;
  }

  if (!profile || profile.status !== 'active') {
    return (
      <AccessDeniedScreen
        user={user}
        profile={profile ?? null}
        onLogout={handleLogout}
      />
    );
  }

  const permissions = getAdminPermissions(profile.role);
  const canReadDirectory = hasAdminPermission(profile, 'read_users');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[9px] font-black uppercase tracking-[0.22em] text-cyan-400">
                admin.kyrub.com
              </span>
              <strong className="block truncate text-sm text-white">
                Kyrub Control Plane
              </strong>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <span className="block text-xs font-bold text-white">
                {profile.displayName || user.displayName || profile.email}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {ROLE_LABELS[profile.role]}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Sair"
              className="rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-[2rem] border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-300">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <div>
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400">
                  Visão geral
                </span>
                <h1 className="mt-1 text-xl font-black text-white sm:text-2xl">
                  Governança do ecossistema Kyrub
                </h1>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">
                  Fundação segura para usuários, lojas, planos, BaaS, logística, compliance e operação. Nenhum dado comercial é simulado neste painel.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-emerald-500/20 bg-emerald-500/5 p-5">
            <div className="flex items-center gap-2 text-emerald-300">
              <BadgeCheck className="h-5 w-5" />
              <strong className="text-xs font-black uppercase tracking-wider">
                Acesso ativo
              </strong>
            </div>
            <p className="mt-3 text-sm font-bold text-white">
              {ROLE_LABELS[profile.role]}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              {permissions.length} permissão(ões) derivadas do papel. Alterações de papel não são permitidas pelo navegador.
            </p>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                Indicadores básicos
              </h2>
              <p className="mt-1 text-[10px] text-slate-500">
                Contagens consultadas diretamente no Firestore, sem valores fictícios.
              </p>
            </div>
            {metricsLoading && (
              <span className="text-[9px] uppercase text-cyan-400">
                Atualizando
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {metrics.map(metric => (
              <article
                key={metric.key}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
              >
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                  {metric.label}
                </span>
                <strong
                  className={`mt-2 block text-2xl font-black ${
                    metric.state === 'available'
                      ? 'text-white'
                      : 'text-slate-500'
                  }`}
                >
                  {formatMetric(metric)}
                </strong>
              </article>
            ))}
            {!metricsLoading && metrics.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-xs text-slate-500 sm:col-span-3">
                Nenhum indicador disponível para este papel.
              </div>
            )}
          </div>
        </section>

        {canReadDirectory && (
          <AdminDirectoryWorkspace
            authenticatedUser={user}
            profile={profile}
          />
        )}

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-black uppercase tracking-wider text-white">
              Módulos autorizados
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleModules.map(module => {
              const Icon = module.icon;
              const available = module.status === 'available';
              return (
                <article
                  key={module.label}
                  className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-xl bg-slate-800 p-2 text-slate-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-wider ${
                        available
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      {available ? 'Disponível' : 'Próxima etapa'}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-black text-white">
                    {module.label}
                  </h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    {module.description}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div>
              <strong className="text-xs text-slate-300">
                Escopo desta entrega
              </strong>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                O diretório consulta usuários, lojas canônicas, equipes e tenants legados em modo somente leitura. Bloqueios, planos, integrações e mutações críticas continuam dependentes de backend seguro e auditoria autoritativa.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
