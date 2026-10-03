import { Activity, Banknote, Bot, Building2, FileCheck2, Flag, Network, ReceiptText, ShieldCheck, Users } from 'lucide-react';
import { hasAdminPermission, type AdminPermission, type AdminProfile } from '../../utils/adminControlPlane';
import { auth } from '../../utils/firebase';
import AdminAccordionSection from './AdminAccordionSection';
import AdminAiOperationsDashboard from './AdminAiOperationsDashboard';
import AdminIntegrationsWorkspace from './AdminIntegrationsWorkspace';
import AdminOperationalResponsibilityWorkspace from './AdminOperationalResponsibilityWorkspace';

interface AdminModuleDefinition { label: string; description: string; permission: AdminPermission; icon: typeof Users; status: 'available' | 'planned'; anchor?: string; folder: 'people' | 'platform_finance' | 'operations' | 'governance'; }
const FOLDERS = [
  { id: 'people' as const, label: 'Pessoas & Tenants', description: 'Usuários, lojas, identidade e vínculos administrativos.', icon: Users },
  { id: 'platform_finance' as const, label: 'Financeiro da Plataforma', description: 'BaaS, taxas da plataforma, splits, settlement e conciliação sistêmica.', icon: Banknote },
  { id: 'operations' as const, label: 'Operações', description: 'Saúde, logística e controles técnicos da plataforma.', icon: Activity },
  { id: 'governance' as const, label: 'Governança', description: 'Auditoria, compliance, segurança, capacidades e políticas.', icon: ShieldCheck },
] as const;
const MODULES: AdminModuleDefinition[] = [
  { label: 'Usuários', description: 'Busca exata, situação cadastral e vínculos conhecidos.', permission: 'read_users', icon: Users, status: 'available', anchor: 'admin-directory', folder: 'people' },
  { label: 'Lojas', description: 'Lojas canônicas, equipes, migração e tenants legados.', permission: 'read_stores', icon: Building2, status: 'available', anchor: 'admin-directory', folder: 'people' },
  { label: 'Financeiro da Plataforma & BaaS', description: 'Taxas, splits, settlement, conciliação e infraestrutura financeira. Não inclui venda dos planos Kyrub.', permission: 'read_finance', icon: Banknote, status: 'planned', folder: 'platform_finance' },
  { label: 'Saúde do sistema', description: 'Filas, integrações e situação da operação logística.', permission: 'read_system_health', icon: Activity, status: 'available', anchor: 'admin-system-health', folder: 'operations' },
  { label: 'Feature flags e capacidades', description: 'Ativações graduais e enforcement técnico por ambiente, entitlement e conta.', permission: 'manage_features', icon: Flag, status: 'planned', folder: 'governance' },
  { label: 'Auditoria', description: 'Ações administrativas, receipts e eventos críticos.', permission: 'read_audit', icon: FileCheck2, status: 'planned', folder: 'governance' },
];

const ModuleCard = ({ module }: { module: AdminModuleDefinition }) => { const Icon = module.icon; const available = module.status === 'available'; const content = <><div className="flex items-start justify-between gap-2"><div className="rounded-lg bg-slate-800 p-2 text-slate-300"><Icon className="h-3.5 w-3.5" /></div><span className={`rounded-full px-2 py-0.5 text-[7px] font-black uppercase ${available ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{available ? 'Disponível' : 'Em preparação'}</span></div><h4 className="mt-2 text-[11px] font-black text-slate-200">{module.label}</h4><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{module.description}</p></>; const cls = available ? 'block rounded-xl border border-emerald-500/15 bg-slate-950/55 p-3 transition hover:border-cyan-500/35' : 'rounded-xl border border-slate-800 bg-slate-950/35 p-3 opacity-75'; return available && module.anchor ? <a href={`#${module.anchor}`} className={cls}>{content}</a> : <article className={cls}>{content}</article>; };

export default function AdminModulesWorkspace({ profile }: { profile: AdminProfile }) {
  const visibleModules = MODULES.filter(module => hasAdminPermission(profile, module.permission));
  const authenticatedUser = auth.currentUser;
  const superAdmin = profile.role === 'super_admin';
  const canReviewResponsibility = superAdmin || profile.role === 'operations';
  if (visibleModules.length === 0 && !superAdmin && !canReviewResponsibility) return null;

  return <section id="admin-modules" aria-labelledby="admin-modules-title">
    <div className="mb-4"><h2 id="admin-modules-title" className="text-sm font-black uppercase tracking-wider text-white">Central administrativa</h2><p className="mt-1 text-[10px] leading-relaxed text-slate-500">Organizada por autoridade. A Loja Oficial administra a atividade comercial do Kyrub; este Control Plane governa plataforma, infraestrutura, fiscal e políticas sistêmicas.</p></div>
    <div className="space-y-3">
      <AdminAccordionSection id="admin-platform-tenants" title="Plataforma & Tenants" description="Usuários, lojas e infraestrutura financeira sistêmica. Planos comerciais não são vendidos nem administrados aqui." icon={Users} badge="Control Plane">
        <div className="grid gap-3 md:grid-cols-2">{FOLDERS.filter(folder => folder.id === 'people' || folder.id === 'platform_finance').map(folder => { const Icon = folder.icon; const modules = visibleModules.filter(module => module.folder === folder.id); if (!modules.length) return null; return <div key={folder.id} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-cyan-300"/><strong className="text-xs text-white">{folder.label}</strong></div><p className="mt-1 text-[9px] text-slate-600">{folder.description}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{modules.map(module => <ModuleCard key={module.label} module={module}/>)}</div></div>; })}</div>
      </AdminAccordionSection>

      {superAdmin && authenticatedUser && <AdminAccordionSection id="admin-integrations" title="Integrações & Infraestrutura" description="Providers globais, Vault e credenciais técnicas da plataforma. Mercado Pago, Mercado Livre, Maps e demais integrações." icon={Network} badge="Super Admin"><AdminIntegrationsWorkspace authenticatedUser={authenticatedUser} profile={profile} mode="infrastructure" /></AdminAccordionSection>}

      {superAdmin && authenticatedUser && <AdminAccordionSection id="admin-fiscal" title="Fiscal / Nota Fiscal" description="Focus NFe, homologação, produção, emitentes e gates fiscais. A Loja Oficial aparece aqui somente como um emitente da plataforma." icon={ReceiptText} badge="Super Admin"><AdminIntegrationsWorkspace authenticatedUser={authenticatedUser} profile={profile} mode="fiscal" /></AdminAccordionSection>}

      <AdminAccordionSection id="admin-governance" title="Governança & Operações" description="IA, políticas, capacidades e limites técnicos derivados dos entitlements, auditoria, incidentes e saúde operacional." icon={ShieldCheck} badge={superAdmin ? 'Governança' : 'Operações'}>
        <div className="grid gap-2 sm:grid-cols-2">{visibleModules.filter(module => module.folder === 'operations' || module.folder === 'governance').map(module => <ModuleCard key={module.label} module={module}/>)}</div>
        {superAdmin && <div className="mt-4"><AdminAiOperationsDashboard profile={profile} /></div>}
        {canReviewResponsibility && authenticatedUser && <div className="mt-4"><AdminOperationalResponsibilityWorkspace authenticatedUser={authenticatedUser} profile={profile} /></div>}
      </AdminAccordionSection>
    </div>
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/35 p-4"><div className="flex items-start gap-3"><Bot className="mt-0.5 h-4 w-4 text-cyan-400"/><p className="text-[10px] leading-relaxed text-slate-500"><strong className="text-slate-300">Regra de autoridade:</strong> venda e gestão comercial dos planos ficam na Loja Oficial Kyrub. O Admin conserva apenas enforcement, capacidades, limites, segurança, auditoria e infraestrutura necessária para cumprir o entitlement adquirido.</p></div></div>
  </section>;
}
