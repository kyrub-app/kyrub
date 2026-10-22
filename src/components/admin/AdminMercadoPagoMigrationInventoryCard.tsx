import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { User } from 'firebase/auth';

type Readiness = 'oauth_connected_rollout_enabled' | 'oauth_connected_rollout_pending'
  | 'oauth_required' | 'identity_review' | 'connection_review';
interface MigrationRow {
  canonicalStoreId: string;
  tenantId: string;
  storeName: string;
  publicationStatus: 'published';
  connection: 'connected' | 'not_connected' | 'review';
  providerAccountLast4: string;
  readiness: Readiness;
  needsLivePreflight: true;
}
interface MigrationInventory {
  generatedAt: string;
  scanned: number;
  complete: boolean;
  requiresOperationalSalesReview: true;
  rolloutMode: 'disabled' | 'canary' | 'connected_stores';
  items: MigrationRow[];
  warnings: string[];
}

const labels: Record<Readiness, string> = {
  oauth_connected_rollout_enabled: 'OAuth registrado · liberação incluída',
  oauth_connected_rollout_pending: 'OAuth registrado · liberação pendente',
  oauth_required: 'Conectar conta Mercado Pago',
  identity_review: 'Revisar identidade da loja',
  connection_review: 'Revisar cadastro de recebimentos',
};

const readinessValues = new Set<Readiness>([
  'oauth_connected_rollout_enabled', 'oauth_connected_rollout_pending',
  'oauth_required', 'identity_review', 'connection_review',
]);

// Treat the response as untrusted data: a failed or partial API response must
// show an inline error, never throw from React's render path.
export const parseMerchantPixMigrationInventory = (raw: unknown): MigrationInventory => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('O inventário Mercado Pago retornou dados inválidos.');
  }
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.items) || typeof data.generatedAt !== 'string'
    || typeof data.scanned !== 'number' || !Number.isSafeInteger(data.scanned)
    || data.complete !== true && data.complete !== false
    || !Array.isArray(data.warnings)
    || !['disabled', 'canary', 'connected_stores'].includes(String(data.rolloutMode))) {
    throw new Error('O inventário Mercado Pago está incompleto; consulte novamente.');
  }
  const items: MigrationRow[] = data.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Cadastro de loja inválido no inventário Mercado Pago.');
    }
    const row = item as Record<string, unknown>;
    if (typeof row.tenantId !== 'string' || typeof row.storeName !== 'string'
      || typeof row.canonicalStoreId !== 'string'
      || typeof row.providerAccountLast4 !== 'string'
      || !['connected', 'not_connected', 'review'].includes(String(row.connection))
      || !readinessValues.has(row.readiness as Readiness)) {
      throw new Error('Cadastro de loja incompleto no inventário Mercado Pago.');
    }
    return {
      canonicalStoreId: row.canonicalStoreId,
      tenantId: row.tenantId,
      storeName: row.storeName,
      publicationStatus: 'published',
      connection: row.connection as MigrationRow['connection'],
      providerAccountLast4: row.providerAccountLast4.slice(-4),
      readiness: row.readiness as Readiness,
      needsLivePreflight: true,
    };
  });
  return {
    generatedAt: data.generatedAt,
    scanned: data.scanned,
    complete: data.complete as boolean,
    requiresOperationalSalesReview: true,
    rolloutMode: data.rolloutMode as MigrationInventory['rolloutMode'],
    items,
    warnings: data.warnings.filter((item): item is string => typeof item === 'string'),
  };
};

const load = async (user: User): Promise<MigrationInventory> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/admin/operations/health?transport=mercado-pago-migration-inventory', {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({})) as unknown;
  const serverError = data && typeof data === 'object' && 'error' in data
    && typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error : '';
  if (!response.ok) throw new Error(serverError || 'Inventário Mercado Pago indisponível.');
  return parseMerchantPixMigrationInventory(data);
};

export default function AdminMercadoPagoMigrationInventoryCard({ user }: { user: User }) {
  const [snapshot, setSnapshot] = useState<MigrationInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      setSnapshot(await load(user));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao consultar inventário.');
      setSnapshot(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void refresh(); }, [user.uid]);

  return <article id="admin-mercado-pago-migration-inventory" className="mt-5 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <span className="text-[9px] font-black uppercase tracking-wider text-sky-400">Mercado Pago · migração Pix por loja</span>
        <h3 className="mt-1 text-sm font-black text-white">Inventário de prontidão (somente leitura)</h3>
        <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">
          Consulta lojas publicadas e vínculos OAuth sem acessar tokens ou gerar cobranças. Uma loja publicada não é necessariamente uma loja com vendas ativas.
        </p>
      </div>
      <button type="button" disabled={busy} onClick={() => void refresh()}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] font-bold text-slate-200 disabled:opacity-40">
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Atualizar inventário
      </button>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
    {snapshot && <>
      <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-slate-300">
        <span className="rounded-lg border border-slate-700 px-3 py-2">Lojas publicadas consultadas: <strong>{snapshot.scanned}</strong></span>
        <span className="rounded-lg border border-slate-700 px-3 py-2">Inventário: <strong>{snapshot.complete ? 'Sem truncamento' : 'Parcial — revisar'}</strong></span>
        <span className="rounded-lg border border-slate-700 px-3 py-2">Liberação: <strong>{snapshot.rolloutMode === 'canary' ? 'Piloto' : snapshot.rolloutMode === 'connected_stores' ? 'Lojas conectadas' : 'Desativada'}</strong></span>
      </div>
      <div className="mt-3 space-y-2">
        {snapshot.items.length === 0 && <p className="text-xs text-slate-400">Nenhuma loja publicada identificada nesta consulta. Isso não prova que não existam pagamentos legados.</p>}
        {snapshot.items.map(item => <div key={item.tenantId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-xs text-slate-200">
          <div className="min-w-0">
            <strong className="block truncate">{item.storeName || 'Loja sem nome informado'}</strong>
            <span className="text-[10px] text-slate-500">Conta Mercado Pago: {item.providerAccountLast4 ? `final ••••${item.providerAccountLast4}` : 'não confirmada'}</span>
          </div>
          <span className="text-[10px] text-slate-300">{labels[item.readiness]}</span>
        </div>)}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-amber-200">
        Próximo gate: validar atividade de vendas, cobranças em aberto e beneficiário no Mercado Pago. Este inventário NÃO autoriza merge, Pix ou migração automática.
      </p>
      {!snapshot.complete && <p className="mt-2 text-[10px] text-red-200">Inventário incompleto: bloqueie a promoção até revisar os demais estabelecimentos.</p>}
      <p className="mt-2 text-[9px] text-slate-500">Leitura: {new Date(snapshot.generatedAt).toLocaleString('pt-BR')} · Sem acesso a tokens e sem operações financeiras.</p>
    </>}
  </article>;
}
