import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  CircleAlert,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  ShieldCheck,
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
  type AdminProfile,
  type AdminRole,
} from '../../utils/adminControlPlane';
import AdminDirectoryWorkspace from './AdminDirectoryWorkspace';
import AdminModulesWorkspace from './AdminModulesWorkspace';
import AdminPromotionalPlanWorkspace from './AdminPromotionalPlanWorkspace';

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  support: 'Suporte',
  operations: 'Operações',
  finance: 'Financeiro',
  compliance: 'Compliance',
};

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

const MetricSkeleton = () => (
  <article className="animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
    <div className="h-2 w-24 rounded bg-slate-800" />
    <div className="mt-3 h-7 w-16 rounded bg-slate-800" />
  </article>
);

export default function AdminControlPlaneApp() {
  const [authResolved, setAuthResolved] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null | undefined>(undefined);
  const [metrics, setMetrics] = useState<AdminDashboardMetric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribeProfile = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, nextUser => {
      unsubscribeProfile();
      unsubscribeProfile = () => undefined;
      setUser(nextUser);
      setMetrics([]);
      setMetricsError('');
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
    let cancelled = false;
    setMetricsLoading(true);
    setMetricsError('');

    void loadAdminDashboardMetrics(profile)
      .then(nextMetrics => {
        if (!cancelled) setMetrics(nextMetrics);
      })
      .catch(() => {
        if (!cancelled) {
          setMetricsError('Não foi possível atualizar os indicadores básicos.');
        }
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

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
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6">
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
              aria-label="Sair do Control Plane"
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

        <section aria-labelledby="admin-basic-metrics-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2
                id="admin-basic-metrics-title"
                className="text-sm font-black uppercase tracking-wider text-white"
              >
                Indicadores básicos
              </h2>
              <p className="mt-1 text-[10px] text-slate-500">
                Contagens consultadas diretamente no Firestore, sem valores fictícios.
              </p>
            </div>
            {metricsLoading && (
              <span className="text-[9px] font-black uppercase text-cyan-400">
                Atualizando
              </span>
            )}
          </div>

          {metricsError && (
            <div className="mb-3 flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{metricsError}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3" aria-busy={metricsLoading}>
            {metricsLoading && metrics.length === 0
              ? [0, 1, 2].map(item => <MetricSkeleton key={item} />)
              : metrics.map(metric => (
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
            {!metricsLoading && metrics.length === 0 && !metricsError && (
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

        {profile.role === 'super_admin' && (
          <AdminPromotionalPlanWorkspace
            authenticatedUser={user}
            profile={profile}
          />
        )}

        <AdminModulesWorkspace profile={profile} />

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p className="text-[10px] leading-relaxed text-slate-500">
              Consultas permanecem somente leitura. Alterações críticas, como concessões de plano, só podem ocorrer por backend seguro, autorização administrativa explícita e auditoria autoritativa.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
