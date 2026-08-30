import {
  Activity,
  Banknote,
  Bot,
  Building2,
  ChevronDown,
  FileCheck2,
  Flag,
  Folder,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminProfile,
} from '../../utils/adminControlPlane';
import { auth } from '../../utils/firebase';
import AdminAiOperationsDashboard from './AdminAiOperationsDashboard';
import AdminIntegrationsWorkspace from './AdminIntegrationsWorkspace';
import AdminOperationalResponsibilityWorkspace from './AdminOperationalResponsibilityWorkspace';

interface AdminModuleDefinition {
  label: string;
  description: string;
  permission: AdminPermission;
  icon: typeof Users;
  status: 'available' | 'planned';
  anchor?: string;
  folder: 'people' | 'business' | 'operations' | 'governance';
}

const FOLDERS = [
  {
    id: 'people' as const,
    label: 'Pessoas & Tenants',
    description: 'Usuários, lojas, identidade e vínculos administrativos.',
    icon: Users,
  },
  {
    id: 'business' as const,
    label: 'Comercial & Financeiro',
    description: 'Planos, cupons, BaaS, pagamentos, splits e conciliação.',
    icon: Banknote,
  },
  {
    id: 'operations' as const,
    label: 'Operações & Infraestrutura',
    description: 'Saúde, integrações, Vault, logística e controles técnicos.',
    icon: Activity,
  },
  {
    id: 'governance' as const,
    label: 'Governança & IA',
    description: 'AI Operations, auditoria, compliance, segurança e políticas.',
    icon: ShieldCheck,
  },
] as const;

const MODULES: AdminModuleDefinition[] = [
  {
    label: 'Usuários',
    description: 'Busca exata, situação cadastral e vínculos conhecidos.',
    permission: 'read_users',
    icon: Users,
    status: 'available',
    anchor: 'admin-directory',
    folder: 'people',
  },
  {
    label: 'Lojas',
    description: 'Lojas canônicas, equipes, migração e tenants legados.',
    permission: 'read_stores',
    icon: Building2,
    status: 'available',
    anchor: 'admin-directory',
    folder: 'people',
  },
  {
    label: 'Planos & Cupons',
    description: 'Versões comerciais, funcionalidades, campanhas e cortesias auditadas.',
    permission: 'manage_admins',
    icon: Banknote,
    status: 'available',
    anchor: 'admin-plans-coupons',
    folder: 'business',
  },
  {
    label: 'Financeiro e BaaS',
    description: 'Onboarding, taxas, splits, settlement e conciliação.',
    permission: 'read_finance',
    icon: Banknote,
    status: 'planned',
    folder: 'business',
  },
  {
    label: 'Saúde do sistema',
    description: 'Filas, integrações e situação da operação logística.',
    permission: 'read_system_health',
    icon: Activity,
    status: 'available',
    anchor: 'admin-system-health',
    folder: 'operations',
  },
  {
    label: 'Feature flags',
    description: 'Ativações graduais por ambiente, plano e conta.',
    permission: 'manage_features',
    icon: Flag,
    status: 'planned',
    folder: 'operations',
  },
  {
    label: 'Auditoria',
    description: 'Ações administrativas, receipts e eventos críticos.',
    permission: 'read_audit',
    icon: FileCheck2,
    status: 'planned',
    folder: 'governance',
  },
];

const ModuleCard = ({ module }: { module: AdminModuleDefinition }) => {
  const Icon = module.icon;
  const available = module.status === 'available';
  const className = available
    ? 'group rounded-xl border border-emerald-500/15 bg-slate-950/55 p-3 transition hover:border-cyan-500/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
    : 'rounded-xl border border-slate-800 bg-slate-950/35 p-3 opacity-75';

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="rounded-lg bg-slate-800 p-2 text-slate-300">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[7px] font-black uppercase ${
            available
              ? 'bg-emerald-500/10 text-emerald-300'
              : 'bg-amber-500/10 text-amber-300'
          }`}
        >
          {available ? 'Disponível' : 'Em preparação'}
        </span>
      </div>
      <h4 className="mt-2 text-[11px] font-black text-slate-200">{module.label}</h4>
      <p className="mt-1 text-[9px] leading-relaxed text-slate-600">{module.description}</p>
    </>
  );

  return available && module.anchor ? (
    <a href={`#${module.anchor}`} className={className}>{content}</a>
  ) : (
    <article className={className}>{content}</article>
  );
};

export default function AdminModulesWorkspace({ profile }: { profile: AdminProfile }) {
  const visibleModules = MODULES.filter(module => hasAdminPermission(profile, module.permission));
  const authenticatedUser = auth.currentUser;
  const superAdmin = profile.role === 'super_admin';
  const canReviewResponsibility = profile.role === 'super_admin' || profile.role === 'operations';

  if (visibleModules.length === 0 && !superAdmin && !canReviewResponsibility) return null;

  const specialModules = (superAdmin ? 2 : 0) + (canReviewResponsibility ? 1 : 0);

  return (
    <>
      <section id="admin-modules" aria-labelledby="admin-modules-title">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-cyan-400" />
              <h2 id="admin-modules-title" className="text-sm font-black uppercase tracking-wider text-white">
                Central administrativa
              </h2>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              Funções agrupadas por contexto para reduzir ruído e tornar o Control Plane mais fácil de acompanhar.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[9px] font-black text-slate-400">
            {visibleModules.filter(module => module.status === 'available').length + specialModules} ativa(s)
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {FOLDERS.map(folder => {
            const folderModules = visibleModules.filter(module => module.folder === folder.id);
            const FolderIcon = folder.icon;
            const hasIntegrations = superAdmin && folder.id === 'operations';
            const hasResponsibility = canReviewResponsibility && folder.id === 'operations';
            const hasAiOps = superAdmin && folder.id === 'governance';
            if (folderModules.length === 0 && !hasIntegrations && !hasResponsibility && !hasAiOps) return null;

            return (
              <article key={folder.id} className="rounded-[1.5rem] border border-slate-800 bg-slate-900/55 p-4">
                <div className="flex items-start gap-3 border-b border-slate-800 pb-3">
                  <div className="rounded-xl bg-slate-800 p-2.5 text-cyan-300">
                    <FolderIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-white">{folder.label}</h3>
                    <p className="mt-1 text-[9px] leading-relaxed text-slate-600">{folder.description}</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {folderModules.map(module => <ModuleCard key={module.label} module={module} />)}

                  {hasIntegrations && (
                    <a
                      href="#admin-integrations"
                      className="group rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 transition hover:border-violet-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300">
                          <Settings2 className="h-3.5 w-3.5" />
                        </div>
                        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[7px] font-black uppercase text-violet-300">Super Admin</span>
                      </div>
                      <h4 className="mt-2 text-[11px] font-black text-slate-200">Integrações & Vault</h4>
                      <p className="mt-1 text-[9px] leading-relaxed text-slate-600">Providers, credenciais protegidas e readiness das integrações.</p>
                    </a>
                  )}

                  {hasResponsibility && (
                    <a
                      href="#admin-operational-responsibility"
                      className="group rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 transition hover:border-amber-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="rounded-lg bg-amber-500/10 p-2 text-amber-300">
                          <ShieldAlert className="h-3.5 w-3.5" />
                        </div>
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[7px] font-black uppercase text-amber-300">Somente leitura</span>
                      </div>
                      <h4 className="mt-2 text-[11px] font-black text-slate-200">Responsabilidade Operacional</h4>
                      <p className="mt-1 text-[9px] leading-relaxed text-slate-600">Casos ambíguos, incidentes externos e evidências que exigem revisão humana.</p>
                    </a>
                  )}

                  {hasAiOps && (
                    <a
                      href="#admin-ai-operations"
                      className="group rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 transition hover:border-cyan-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-300">
                          <Bot className="h-3.5 w-3.5" />
                        </div>
                        <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[7px] font-black uppercase text-cyan-300">Novo</span>
                      </div>
                      <h4 className="mt-2 text-[11px] font-black text-slate-200">AI Operations</h4>
                      <p className="mt-1 text-[9px] leading-relaxed text-slate-600">Equipe, workstreams, gates, bloqueios e evidências operacionais.</p>
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <details className="group mt-4 rounded-2xl border border-slate-800 bg-slate-900/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400">
            <div>
              <strong className="text-xs text-slate-300">Como esta organização funciona</strong>
              <p className="mt-0.5 text-[9px] text-slate-600">Pastas organizam navegação; permissões continuam sendo derivadas do papel administrativo.</p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" />
          </summary>
          <p className="border-t border-slate-800 px-4 py-3 text-[9px] leading-relaxed text-slate-500">
            Esta reorganização não amplia permissões nem cria atalhos de autorização. Cada workspace continua aplicando seus próprios gates server-side e de papel.
          </p>
        </details>
      </section>

      {superAdmin && <AdminAiOperationsDashboard profile={profile} />}

      {canReviewResponsibility && authenticatedUser && (
        <AdminOperationalResponsibilityWorkspace authenticatedUser={authenticatedUser} profile={profile} />
      )}

      {superAdmin && authenticatedUser && (
        <div id="admin-integrations">
          <AdminIntegrationsWorkspace authenticatedUser={authenticatedUser} profile={profile} />
        </div>
      )}
    </>
  );
}
