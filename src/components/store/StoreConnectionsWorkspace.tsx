import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Download,
  RefreshCw,
  Store,
} from 'lucide-react';
import type { KyrubSyncAuthority } from '../../../shared/storeConnections';
import type { MercadoLivreCatalogPreviewItem } from '../../../shared/mercadoLivreIntegration';
import MercadoLivreImportDraftQueue from './MercadoLivreImportDraftQueue';
import MercadoLivreSyncReviewQueue from './MercadoLivreSyncReviewQueue';
import {
  beginMercadoLivreConnection,
  confirmMercadoLivreCatalogImport,
  loadMercadoLivreCatalogPreview,
  loadStoreConnectionOnboarding,
  updateStoreConnectionSyncAuthority,
  type PublicStoreConnectionRecord,
  type StoreConnectionOnboardingSnapshot,
} from '../../utils/storeConnections';

const SYNC_OPTIONS: Array<{ value: KyrubSyncAuthority; label: string; detail: string }> = [
  {
    value: 'manual_review',
    label: 'Revisão manual',
    detail: 'Nada é sincronizado automaticamente entre os canais.',
  },
  {
    value: 'external_to_kyrub',
    label: 'Mercado Livre → Kyrub',
    detail: 'O canal externo pode ser tratado como origem das sincronizações futuras.',
  },
  {
    value: 'kyrub_to_external',
    label: 'Kyrub → Mercado Livre',
    detail: 'O Kyrub pode ser tratado como origem das sincronizações futuras.',
  },
  {
    value: 'bidirectional',
    label: 'Bidirecional',
    detail: 'Reservado para quando regras de conflito e sincronização estiverem habilitadas.',
  },
];

const money = (value: number | null): string =>
  value === null
    ? 'Preço não informado'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const maskExternalAccount = (value: string): string => {
  const cleaned = value.trim();
  if (cleaned.length <= 4) return cleaned || 'Conta conectada';
  return `••••${cleaned.slice(-4)}`;
};

export default function StoreConnectionsWorkspace({
  user,
  storeId,
  notify,
}: {
  user: User;
  storeId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [snapshot, setSnapshot] = useState<StoreConnectionOnboardingSnapshot | null>(null);
  const [preview, setPreview] = useState<MercadoLivreCatalogPreviewItem[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importDraftRefreshKey, setImportDraftRefreshKey] = useState(0);
  const [message, setMessage] = useState('');

  const mercadoLivre = useMemo(
    () => snapshot?.connections.find(connection => connection.provider === 'mercado_livre') ?? null,
    [snapshot]
  );

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setMessage('');
    try {
      const next = await loadStoreConnectionOnboarding(user, storeId);
      setSnapshot(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível consultar as conexões da loja.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [storeId, user.uid]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('integration') !== 'mercado_livre') return;
    const status = params.get('status');
    const code = params.get('code');
    if (status === 'connected') {
      notify('Mercado Livre conectado à sua loja.', 'success');
      void refresh();
    } else if (status === 'error') {
      notify(
        code ? `Não foi possível conectar o Mercado Livre (${code}).` : 'Não foi possível conectar o Mercado Livre.',
        'error'
      );
    }
    params.delete('integration');
    params.delete('status');
    params.delete('code');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [storeId, user.uid]);

  const connect = async (): Promise<void> => {
    setConnecting(true);
    setMessage('');
    try {
      const authorizationUrl = await beginMercadoLivreConnection(user, storeId);
      window.location.assign(authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível iniciar a autorização do Mercado Livre.');
      setConnecting(false);
    }
  };

  const loadPreview = async (): Promise<void> => {
    setLoadingPreview(true);
    setMessage('');
    try {
      const result = await loadMercadoLivreCatalogPreview(user, storeId, 50);
      setPreview(result.items);
      setPreviewTotal(result.total);
      setSelected(new Set());
      if (!result.items.length) setMessage('A conta conectada não retornou anúncios para este preview.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar os produtos do Mercado Livre.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggle = (externalId: string): void => {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(externalId)) next.delete(externalId);
      else if (next.size < 50) next.add(externalId);
      return next;
    });
  };

  const importSelected = async (): Promise<void> => {
    if (!selected.size) {
      setMessage('Selecione pelo menos um anúncio para importar como rascunho.');
      return;
    }
    setImporting(true);
    setMessage('');
    try {
      const result = await confirmMercadoLivreCatalogImport(user, storeId, Array.from(selected));
      setSelected(new Set());
      setImportDraftRefreshKey(current => current + 1);
      setMessage(`${result.imported} item(ns) importado(s) como rascunho. Nada foi publicado automaticamente.`);
      notify(`${result.imported} item(ns) do Mercado Livre chegaram como rascunho.`, 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível importar os itens selecionados.');
    } finally {
      setImporting(false);
    }
  };

  const changeSyncAuthority = async (
    connection: PublicStoreConnectionRecord,
    syncAuthority: KyrubSyncAuthority
  ): Promise<void> => {
    if (connection.syncAuthority === syncAuthority) return;
    setSyncing(true);
    setMessage('');
    try {
      const updated = await updateStoreConnectionSyncAuthority(
        user,
        storeId,
        connection.id,
        syncAuthority
      );
      setSnapshot(previous => previous ? {
        ...previous,
        connections: previous.connections.map(item => item.id === updated.id ? updated : item),
      } : previous);
      setMessage('Autoridade de sincronização registrada. Esta escolha não publica nem altera produtos por si só.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível alterar a autoridade de sincronização.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/5 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-yellow-400">Canal da sua loja</span>
            <h3 className="mt-1 flex items-center gap-2 text-base font-black text-white">
              <Store className="h-4 w-4" /> Mercado Livre
            </h3>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">
              Conecte a conta do seu negócio pelo login oficial do Mercado Livre. O Kyrub nunca pede aqui o Client Secret da aplicação nem o Access Token do vendedor.
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[9px] font-black uppercase ${mercadoLivre?.status === 'connected' ? 'border-emerald-500/30 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
            {mercadoLivre?.status === 'connected' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
            {mercadoLivre?.status === 'connected' ? 'Conectado' : 'Não conectado'}
          </span>
        </div>

        {mercadoLivre?.status === 'connected' ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Conta autorizada</span>
                <p className="mt-1 text-xs font-bold text-white">Seller {maskExternalAccount(mercadoLivre.externalAccountId)}</p>
                <p className="mt-1 text-[10px] text-slate-500">Tokens protegidos no cofre exclusivo desta loja.</p>
              </div>
              <label className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] font-bold text-slate-400">
                Autoridade de sincronização
                <select
                  value={mercadoLivre.syncAuthority}
                  disabled={syncing}
                  onChange={event => void changeSyncAuthority(mercadoLivre, event.target.value as KyrubSyncAuthority)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-yellow-500 disabled:opacity-50"
                >
                  {SYNC_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <span className="mt-2 block font-normal leading-relaxed text-slate-500">
                  {SYNC_OPTIONS.find(option => option.value === mercadoLivre.syncAuthority)?.detail}
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => void loadPreview()}
              disabled={loadingPreview || importing}
              className="inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
              {loadingPreview ? 'Consultando…' : 'Ver produtos do Mercado Livre'}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting || loading}
              className="inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-50"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {connecting ? 'Abrindo Mercado Livre…' : 'Conectar Mercado Livre'}
            </button>
          </div>
        )}
      </div>

      {mercadoLivre?.status === 'connected' && (
        <MercadoLivreImportDraftQueue
          user={user}
          storeId={storeId}
          refreshKey={importDraftRefreshKey}
          notify={notify}
        />
      )}

      {mercadoLivre?.status === 'connected' && (
        <MercadoLivreSyncReviewQueue user={user} storeId={storeId} notify={notify} />
      )}

      {preview.length > 0 && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Preview somente leitura</span>
              <h4 className="mt-1 text-sm font-black text-white">Produtos encontrados</h4>
              <p className="mt-1 text-[10px] text-slate-500">Mostrando {preview.length} de {previewTotal}. Selecione até 50. A importação cria rascunhos; não publica produtos.</p>
            </div>
            <button
              type="button"
              onClick={() => void importSelected()}
              disabled={importing || selected.size === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-emerald-300 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              {importing ? 'Importando…' : `Importar ${selected.size || ''} como rascunho`}
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {preview.map(item => (
              <label key={item.externalId} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 hover:border-slate-700">
                <input type="checkbox" checked={selected.has(item.externalId)} onChange={() => toggle(item.externalId)} className="h-4 w-4 shrink-0" />
                {item.thumbnail ? <img src={item.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-xl bg-slate-800" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-white">{item.title}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{money(item.price)} · ML {item.externalId}</p>
                  {item.sourceAvailableQuantity !== undefined && <p className="mt-0.5 text-[9px] text-slate-600">Disponível no Mercado Livre: {item.sourceAvailableQuantity} · não altera o estoque Kyrub.</p>}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {message && <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] leading-relaxed text-slate-300" aria-live="polite">{message}</div>}

      <p className="text-[10px] leading-relaxed text-slate-600">
        Credenciais da aplicação do Kyrub são administradas pela plataforma. Aqui você apenas autoriza a conta da sua loja e decide quando importar ou sincronizar informações.
      </p>
    </div>
  );
}
