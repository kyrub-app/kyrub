import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { Bell, Package, RefreshCw, X } from 'lucide-react';
import { auth, db } from '../../utils/firebase';
import { getPrimaryUserStoreDocumentPath } from '../../utils/storePaths';
import { getProductInventoryDocumentPath, parseInventoryCatalog } from '../../utils/productInventory';
import { buildInventoryManagementAlerts, type InventoryManagementAlert } from '../../../shared/erpManagementAlerts';

type State = {
  uid: string;
  status: 'loading' | 'ready' | 'unconfigured' | 'unavailable' | 'forbidden';
  alerts: InventoryManagementAlert[];
};
const initial = (uid = ''): State => ({ uid, status: 'loading', alerts: [] });
const formatQuantity = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function ErpManagementAlertsBell() {
  const [state, setState] = useState<State>(() => initial(auth.currentUser?.uid));
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let previousUid = auth.currentUser?.uid;
    let stopInventory = () => {};
    const stopAuth = onAuthStateChanged(auth, user => {
      const ticket = ++generation;
      stopInventory();
      stopInventory = () => {};
      if (previousUid !== user?.uid) setOpen(false);
      previousUid = user?.uid;
      setState(initial(user?.uid));
      if (!user) return;
      const uid = user.uid;
      const active = () => !disposed && generation === ticket && auth.currentUser?.uid === uid;
      const update = (status: State['status'], alerts: InventoryManagementAlert[] = []) => {
        if (active()) setState({ uid, status, alerts });
      };
      // This card belongs to the owner, not a staff membership or a cached identity.
      void getDocFromServer(doc(db, getPrimaryUserStoreDocumentPath(uid))).then(store => {
        if (!active()) return;
        if (!store.exists() || store.data()?.ownerId !== uid) {
          update('forbidden');
          return;
        }
        stopInventory = onSnapshot(
          doc(db, getProductInventoryDocumentPath(uid)),
          { includeMetadataChanges: true },
          snapshot => {
            if (!active()) return;
            if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
              update('unavailable');
              return;
            }
            const data = snapshot.data();
            if (!snapshot.exists()) { update('unconfigured'); return; }
            if (data?.ownerId !== undefined && data.ownerId !== uid) { update('forbidden'); return; }
            const raw = Array.isArray(data?.inventoryCatalog) ? data.inventoryCatalog : data?.catalog;
            if (!Array.isArray(raw)) { update('unconfigured'); return; }
            const catalog = parseInventoryCatalog(raw);
            if (catalog.length !== raw.length) { update('unavailable'); return; }
            update('ready', buildInventoryManagementAlerts(catalog));
          },
          () => update('unavailable')
        );
      }).catch(() => update('unavailable'));
    });
    return () => {
      disposed = true;
      generation += 1;
      stopAuth();
      stopInventory();
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (!state.uid || state.uid !== auth.currentUser?.uid || state.status === 'forbidden') return null;
  const count = state.status === 'ready' ? state.alerts.length : 0;
  return <>
    <button type="button" id="erp-management-alerts-trigger"
      aria-label={count ? 'Avisos do ERP, ' + count + ' condições ativas' : 'Avisos do ERP'}
      aria-expanded={open} onClick={() => setOpen(true)}
      className="relative ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-orange-300">
      <Bell className="h-4 w-4" />
      {count > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-orange-600 px-1.5 text-[10px] font-bold text-white">{count > 99 ? '99+' : count}</span>}
      {state.status === 'unavailable' && <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-red-400" />}
    </button>
    {open && createPortal(
      <div className="fixed inset-0 z-[180] flex items-end justify-center bg-slate-950/85 sm:items-center sm:p-6"
        onMouseDown={() => setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby="erp-management-alerts-title"
          id="erp-management-alerts-panel"
          className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-950 p-4 sm:max-w-lg sm:rounded-3xl"
          onMouseDown={event => event.stopPropagation()}>
          <header className="flex items-center gap-3 border-b border-slate-800 pb-3">
            <Bell className="h-5 w-5 text-orange-400"/>
            <div className="min-w-0 flex-1">
              <h2 id="erp-management-alerts-title" className="text-xs font-black text-white">Avisos do ERP</h2>
              <p className="text-[10px] text-slate-400">Alertas gerenciais da sua loja</p>
            </div>
            <button type="button" aria-label="Fechar avisos do ERP" className="p-2 text-slate-300" onClick={() => setOpen(false)}><X className="h-5 w-5"/></button>
          </header>
          <div className="space-y-3 pt-3" aria-live="polite">
            <h3 className="text-xs font-bold text-white">Estoque</h3>
            {state.status === 'loading' && <p className="text-[10px] text-slate-400">Consultando estoque...</p>}
            {state.status === 'unconfigured' && <p className="text-[10px] text-slate-400">Nenhum catálogo de estoque disponível.</p>}
            {state.status === 'unavailable' && <div role="alert" className="text-[10px] text-orange-300">
              Não foi possível confirmar o estoque. <button type="button" className="inline-flex items-center gap-1 font-bold" onClick={() => setRefreshKey(value => value + 1)}><RefreshCw className="h-3 w-3"/> Tentar novamente</button>
            </div>}
            {state.status === 'ready' && !count && <p className="text-[10px] text-slate-400">Nenhum alerta de estoque ativo.</p>}
            {state.status === 'ready' && state.alerts.map(alert => <article key={alert.id} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
              <Package className="h-4 w-4 shrink-0 text-orange-400"/>
              <div className="min-w-0">
                <h4 className="break-words text-xs font-bold text-white">{alert.name}</h4>
                <p className="text-[10px] font-semibold text-orange-300">{alert.severity === 'out_of_stock' ? 'Estoque zerado' : 'Estoque mínimo atingido'}</p>
                <p className="text-[10px] text-slate-400">Atual: {formatQuantity(alert.currentQuantity)} {alert.unit} · Mínimo: {formatQuantity(alert.minimumQuantity)} {alert.unit}</p>
              </div>
            </article>)}
            <p className="text-[10px] text-slate-500">Condições atuais do estoque. Os alertas deixam de aparecer após a reposição suficiente.</p>
          </div>
        </section>
      </div>, document.body
    )}
  </>;
}
