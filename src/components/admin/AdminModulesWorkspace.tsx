import {
  Activity,
  ArrowDown,
  Banknote,
  Building2,
  ChevronDown,
  FileCheck2,
  Flag,
  Settings2,
  Users,
} from 'lucide-react';
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminProfile,
} from '../../utils/adminControlPlane';
import { auth } from '../../utils/firebase';
import AdminIntegrationsWorkspace from './AdminIntegrationsWorkspace';

interface AdminModuleDefinition {
  label: string;
  description: string;
  permission: AdminPermission;
  icon: typeof Users;
  status: 'available' | 'planned';
  anchor?: string;
  locationLabel?: string;
}

const MODULES: AdminModuleDefinition[] = [
  {
    label: 'Usuários',
    description: 'Busca exata, situação cadastral e vínculos conhecidos.',
    permission: 'read_users',
    icon: Users,
    status: 'available',
    anchor: 'admin-directory',
    locationLabel: 'Diretório administrativo',
  },
  {
    label: 'Lojas',
    description: 'Lojas canônicas, equipes, migração e tenants legados.',
    permission: 'read_stores',
    icon: Building2,
    status: 'available',
    anchor: 'admin-directory',
    locationLabel: 'Diretório administrativo',
  },
  {
    label: 'Planos & Cupons',
    description: 'Versões comerciais, funcionalidades, campanhas e cortesias auditadas.',
    permission: 'manage_admins',
    icon: Banknote,
    status: 'available',
    anchor: 'admin-plans-coupons',
    locationLabel: 'Governança comercial',
  },
  {
    label: 'Saúde do sistema',
    description: 'Filas, integrações e situação da operação logística.',
    permission: 'read_system_health',
    icon: Activity,
    status: 'available',
    anchor: 'admin-system-health',
    locationLabel: 'Painel operacional',
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
    label: 'Feature flags',
    description: 'Ativações graduais por ambiente, plano e conta.',
    permission: 'manage_features',
    icon: Flag,
    status: 'planned',
  },
];

export default function AdminModulesWorkspace({
  profile,
}: {
  profile: AdminProfile;
}) {
  const visibleModules = MODULES.filter(module =>
    hasAdminPermission(profile, module.permission)
  );
  const availableModules = visibleModules.filter(
    module => module.status === 'available'
  );
  const plannedModules = visibleModules.filter(
    module => module.status === 'planned'
  );
  const authenticatedUser = auth.currentUser;

  if (visibleModules.length === 0) return null;

  return (
    <>
      <section id="admin-modules" aria-labelledby="admin-modules-title">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-cyan-400" />
              <h2
                id="admin-modules-title"
                className="text-sm font-black uppercase tracking-wider text-white"
              >
                Áreas do Control Plane
              </h2>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              Primeiro, o que já pode ser usado. Recursos futuros ficam recolhidos abaixo.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[9px] font-black text-slate-400">
            {availableModules.length} ativa(s)
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {availableModules.map(module => {
            const Icon = module.icon;
            return (
              <a
                key={module.label}
                href={`#${module.anchor}`}
                className="group rounded-2xl border border-emerald-500/15 bg-slate-900/70 p-4 transition hover:border-cyan-500/35 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-xl bg-slate-800 p-2 text-slate-300 transition group-hover:bg-cyan-500/10 group-hover:text-cyan-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-emerald-300">
                    Disponível
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-black text-white">
                  {module.label}
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  {module.description}
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-cyan-400">
                  <ArrowDown className="h-3 w-3" />
                  {module.locationLabel}
                </span>
              </a>
            );
          })}

          {profile.role === 'super_admin' && (
            <a
              href="#admin-integrations"
              className="group rounded-2xl border border-violet-500/20 bg-slate-900/70 p-4 transition hover:border-violet-400/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-xl bg-violet-500/10 p-2 text-violet-300">
                  <Settings2 className="h-4 w-4" />
                </div>
                <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-violet-300">
                  Super Admin
                </span>
              </div>
              <h3 className="mt-3 text-sm font-black text-white">Integrações & Vault</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                Providers, autoridade de credenciais e readiness do cofre seguro.
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-violet-400">
                <ArrowDown className="h-3 w-3" />
                Integrações da plataforma
              </span>
            </a>
          )}
        </div>

        {plannedModules.length > 0 && (
          <details className="group mt-3 rounded-2xl border border-slate-800 bg-slate-900/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400">
              <div>
                <strong className="text-xs text-slate-300">
                  Recursos em preparação
                </strong>
                <p className="mt-0.5 text-[9px] text-slate-600">
                  {plannedModules.length} módulo(s) ainda sem operação liberada.
                </p>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" />
            </summary>

            <div className="grid gap-2 border-t border-slate-800 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {plannedModules.map(module => {
                const Icon = module.icon;
                return (
                  <article
                    key={module.label}
                    className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3"
                  >
                    <div className="rounded-lg bg-slate-800 p-2 text-slate-500">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xs font-black text-slate-300">
                          {module.label}
                        </h3>
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[7px] font-black uppercase text-amber-300">
                          Em preparação
                        </span>
                      </div>
                      <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
                        {module.description}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </details>
        )}
      </section>

      {profile.role === 'super_admin' && authenticatedUser && (
        <div id="admin-integrations">
          <AdminIntegrationsWorkspace
            authenticatedUser={authenticatedUser}
            profile={profile}
          />
        </div>
      )}
    </>
  );
}
