import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import {
  getProductInventoryDocumentPath,
  readProductInventorySettings,
  type InventoryCatalogItem,
} from '../../utils/productInventory';
import { ProductPurchaseList } from './ProductPurchaseList';

interface StorePurchaseWorkspaceProps {
  storeId: string;
}

export function StorePurchaseWorkspace({ storeId }: StorePurchaseWorkspaceProps) {
  const [catalog, setCatalog] = useState<InventoryCatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || user.uid !== storeId) {
      setCatalog([]);
      setLoaded(true);
      setError('Faça login novamente para consultar a lista de compras.');
      return;
    }

    return onSnapshot(
      doc(db, getProductInventoryDocumentPath(user.uid)),
      snapshot => {
        setCatalog(readProductInventorySettings(snapshot.data()).catalog);
        setLoaded(true);
        setError('');
      },
      snapshotError => {
        console.warn('Não foi possível carregar a lista global de compras.', snapshotError);
        setLoaded(true);
        setError('A lista de compras está indisponível neste momento.');
      }
    );
  }, [storeId]);

  return (
    <section
      id="store-purchase-workspace"
      className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5"
    >
      <header className="border-b border-slate-800 pb-3">
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">
          Reposição da loja
        </span>
        <h4 className="mt-1 text-sm font-black uppercase text-white">
          Compras
        </h4>
        <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
          Esta visão considera o estoque inteiro da loja. Um insumo usado por vários produtos aparece uma única vez na necessidade de reposição.
        </p>
      </header>

      {error && (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] text-amber-100" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!loaded ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-500">
          Calculando necessidades de reposição…
        </p>
      ) : (
        <ProductPurchaseList catalog={catalog} />
      )}
    </section>
  );
}
