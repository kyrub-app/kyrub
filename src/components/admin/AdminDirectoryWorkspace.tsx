import { useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  Building2,
  CircleAlert,
  Database,
  Search,
  ShieldCheck,
  Store,
  UserRound,
  UsersRound,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  lookupAdminDirectory,
  type AdminDirectoryResult,
  type AdminDirectoryStoreLink,
} from '../../utils/adminDirectory';
import type { AdminProfile } from '../../utils/adminControlPlane';

interface AdminDirectoryWorkspaceProps {
  authenticatedUser: User;
  profile: AdminProfile;
}

const valueOrFallback = (value: string, fallback = 'Não informado'): string =>
  value || fallback;

const relationshipLabel = (store: AdminDirectoryStoreLink): string =>
  store.relationship === 'owner' ? 'Proprietário' : 'Equipe';

const statusClass = (value: string): string => {
  if (value === 'active' || value === 'published' || value === 'canonical') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  }
  if (value === 'suspended' || value === 'removed' || value === 'paused') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
  }
  return 'border-slate-700 bg-slate-800 text-slate-300';
};

const EmptyResult = ({ lookup }: { lookup: string }) => (
  <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/40 px-5 py-10 text-center">
    <Search className="mx-auto h-6 w-6 text-slate-600" />
    <strong className="mt-3 block text-sm text-slate-300">Nenhuma conta encontrada</strong>
    <p className="mt-1 text-[10px] text-slate-500">
      Não existe usuário cadastrado para a busca exata “{lookup}”.
    </p>
  </div>
);

export default function AdminDirectoryWorkspace({
  authenticatedUser,
  profile,
}: AdminDirectoryWorkspaceProps) {
  const [lookup, setLookup] = useState('');
  const [result, setResult] = useState<AdminDirectoryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);

    try {
      setResult(await lookupAdminDirectory(authenticatedUser, profile, lookup));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível consultar o diretório administrativo.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-[2rem] border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-cyan-300">
            <UsersRound className="h-5 w-5" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">
              Diretório administrativo
            </span>
          </div>
          <h2 className="mt-2 text-lg font-black text-white">Usuários e lojas vinculadas</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Consulte somente por e-mail completo ou UID. Esta área não lista pessoas indiscriminadamente e não oferece ações de bloqueio, plano ou edição.
          </p>
        </div>

        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-[10px] leading-relaxed text-slate-400">
          <strong className="block text-cyan-300">Modo somente leitura</strong>
          Consultas bem-sucedidas geram evento de auditoria administrativa.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">E-mail completo ou UID</span>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 focus-within:border-cyan-500/50">
            <Search className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              type="text"
              value={lookup}
              onChange={event => setLookup(event.target.value)}
              placeholder="email@dominio.com ou UID"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
            />
          </div>
        </label>
        <button
          type="submit"
          disabled={busy || !lookup.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
          {busy ? 'Consultando' : 'Buscar'}
        </button>
      </form>

      {error && (
        <div className="flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && !result.user && <EmptyResult lookup={result.lookup.value} />}

      {result?.user && (
        <div className="space-y-4">
          <article className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                {result.user.photoUrl ? (
                  <img
                    src={result.user.photoUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-2xl object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-800 text-slate-400">
                    <UserRound className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-black text-white">
                      {valueOrFallback(result.user.name, 'Usuário sem nome público')}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[8px] font-black uppercase text-emerald-300">
                      <BadgeCheck className="h-3 w-3" />
                      Cadastrado
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-400">{result.user.email}</p>
                  <p className="mt-2 break-all font-mono text-[9px] text-slate-600">
                    UID: {result.user.uid}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] text-slate-400">
                Perfil social: <strong className="text-slate-200">{result.user.isProfileVisible ? 'visível' : 'restrito'}</strong>
              </div>
            </div>
          </article>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-cyan-300" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    Lojas canônicas
                  </h3>
                </div>
                <span className="text-[9px] font-black text-slate-500">
                  {result.stores.length}
                </span>
              </div>

              <div className="mt-3 space-y-3">
                {result.stores.map(store => (
                  <article key={store.storeId} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm text-white">
                          {valueOrFallback(store.storeName, store.storeId)}
                        </strong>
                        <span className="mt-1 block font-mono text-[8px] text-slate-600">
                          {store.storeId}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-[8px] font-black uppercase text-cyan-300">
                        {relationshipLabel(store)}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
                      <div className="rounded-xl bg-slate-950 p-2">
                        <span className="block text-slate-600">Papel</span>
                        <strong className="text-slate-300">{valueOrFallback(store.role)}</strong>
                      </div>
                      <div className="rounded-xl bg-slate-950 p-2">
                        <span className="block text-slate-600">Plano</span>
                        <strong className="text-slate-300">{valueOrFallback(store.plan)}</strong>
                      </div>
                      <div className="rounded-xl bg-slate-950 p-2">
                        <span className="block text-slate-600">Migração</span>
                        <strong className="text-slate-300">{valueOrFallback(store.migrationStatus)}</strong>
                      </div>
                      <div className="rounded-xl bg-slate-950 p-2">
                        <span className="block text-slate-600">Vínculo</span>
                        <strong className="text-slate-300">{valueOrFallback(store.membershipStatus)}</strong>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {store.publicationStatus && (
                        <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${statusClass(store.publicationStatus)}`}>
                          {store.publicationStatus}
                        </span>
                      )}
                      {store.migrationStatus && (
                        <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${statusClass(store.migrationStatus)}`}>
                          {store.migrationStatus}
                        </span>
                      )}
                    </div>
                  </article>
                ))}

                {result.stores.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-center text-[10px] text-slate-500">
                    Nenhuma loja canônica vinculada.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-amber-300" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    Tenants legados
                  </h3>
                </div>
                <span className="text-[9px] font-black text-slate-500">
                  {result.legacyTenants.length}
                </span>
              </div>

              <div className="mt-3 space-y-3">
                {result.legacyTenants.map(tenant => (
                  <article key={tenant.tenantId} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-amber-500/10 p-2 text-amber-300">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <strong className="block truncate text-sm text-white">
                          {valueOrFallback(tenant.name, tenant.tenantId)}
                        </strong>
                        <span className="mt-1 block break-all font-mono text-[8px] text-slate-600">
                          {tenant.tenantId}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
                      <div className="rounded-xl bg-slate-950 p-2">
                        <span className="block text-slate-600">Plano registrado</span>
                        <strong className="text-slate-300">{valueOrFallback(tenant.plan)}</strong>
                      </div>
                      <div className="rounded-xl bg-slate-950 p-2">
                        <span className="block text-slate-600">Estado registrado</span>
                        <strong className="text-slate-300">{valueOrFallback(tenant.status)}</strong>
                      </div>
                    </div>
                  </article>
                ))}

                {result.legacyTenants.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-center text-[10px] text-slate-500">
                    Nenhum tenant legado vinculado por propriedade.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] leading-relaxed text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              “Cadastrado” confirma apenas a existência do documento de usuário. Bloqueio, KYC, assinatura, entregador e freelancer ainda não possuem uma fonte administrativa canônica nesta etapa.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
