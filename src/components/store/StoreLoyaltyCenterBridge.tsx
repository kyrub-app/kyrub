import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Award,
  BadgePercent,
  CheckCircle2,
  Gift,
  LoaderCircle,
  Save,
  Target,
} from 'lucide-react';
import { normalizeStorePointsPerUnit } from '../../../shared/storePoints';
import { auth } from '../../utils/firebase';
import {
  persistPublicProduct,
  subscribeToPreferredPublicProducts,
  type PublicProduct,
} from '../../utils/publicProducts';

type LoyaltyTab = 'coupons' | 'points' | 'challenges' | 'rewards';
type DraftMap = Record<string, string>;

const normalizeText = (value: string | null | undefined): string =>
  value?.trim().toLocaleUpperCase('pt-BR') ?? '';

const parseDraftPoints = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  try {
    return normalizeStorePointsPerUnit(parsed);
  } catch {
    return null;
  }
};

const findLegacyModuleHeading = (): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>('h3,h4,strong')).find(element => {
    const text = normalizeText(element.textContent);
    return text === 'CUPONS & VOUCHERS' || text === 'FIDELIDADE & PROMOÇÕES';
  }) ?? null;

const updateLegacyModuleLabel = (): void => {
  const heading = findLegacyModuleHeading();
  if (!heading) return;
  heading.textContent = 'FIDELIDADE & PROMOÇÕES';
  const description = heading.parentElement?.querySelector('p');
  if (description) {
    description.textContent =
      'Cupons, Pontos da Loja, desafios e recompensas em uma única central.';
  }
};

export function StoreLoyaltyCenterBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<LoyaltyTab>('coupons');
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [busyProductId, setBusyProductId] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const createdHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setProducts([]);
      setDrafts({});
      return;
    }

    return subscribeToPreferredPublicProducts(
      user.uid,
      result => {
        setProducts(result.products);
        setDrafts(current => {
          const next: DraftMap = {};
          for (const product of result.products) {
            next[product.id] = current[product.id]
              ?? String(product.storePointsPerUnit ?? 0);
          }
          return next;
        });
      },
      () => {
        setProducts([]);
        setDrafts({});
      }
    );
  }, [user?.uid]);

  useEffect(() => {
    let cancelled = false;

    const teardown = (): void => {
      createdHostRef.current?.remove();
      createdHostRef.current = null;
      setHost(null);
    };

    const synchronize = (): void => {
      if (cancelled) return;
      updateLegacyModuleLabel();

      const promotionHost = document.getElementById(
        'kyrub-manual-store-promotion-host'
      );
      const parent = promotionHost?.parentElement;
      if (!(promotionHost instanceof HTMLElement) || !(parent instanceof HTMLElement)) {
        if (createdHostRef.current) teardown();
        return;
      }

      if (!createdHostRef.current?.isConnected) {
        const nextHost = document.createElement('div');
        nextHost.id = 'kyrub-store-loyalty-center-host';
        parent.insertBefore(nextHost, promotionHost);
        createdHostRef.current = nextHost;
        setHost(nextHost);
      }
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      const promotionHost = document.getElementById(
        'kyrub-manual-store-promotion-host'
      );
      if (promotionHost instanceof HTMLElement) promotionHost.style.display = '';
      teardown();
    };
  }, []);

  useEffect(() => {
    const promotionHost = document.getElementById(
      'kyrub-manual-store-promotion-host'
    );
    if (!(promotionHost instanceof HTMLElement)) return;
    promotionHost.style.display = activeTab === 'coupons' ? '' : 'none';
  }, [activeTab, host]);

  const configuredCount = useMemo(
    () => products.filter(product => (product.storePointsPerUnit ?? 0) > 0).length,
    [products]
  );

  const saveProductPoints = async (product: PublicProduct): Promise<void> => {
    if (!user || busyProductId) return;
    const points = parseDraftPoints(drafts[product.id] ?? '0');
    if (points === null) {
      setSuccess(false);
      setMessage('Informe uma quantidade inteira de pontos igual ou maior que zero.');
      return;
    }

    setBusyProductId(product.id);
    setMessage('');
    setSuccess(false);
    try {
      await persistPublicProduct(user, {
        ...product,
        storePointsPerUnit: points,
        updatedAt: new Date().toISOString(),
      });
      setSuccess(true);
      setMessage(`${product.name}: ${points} ponto${points === 1 ? '' : 's'} por unidade.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar a pontuação deste item.'
      );
    } finally {
      setBusyProductId('');
    }
  };

  if (!host) return null;

  const tabs: Array<{
    id: LoyaltyTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'coupons', label: 'Cupons', icon: BadgePercent },
    { id: 'points', label: 'Pontos', icon: Award },
    { id: 'challenges', label: 'Desafios', icon: Target },
    { id: 'rewards', label: 'Recompensas', icon: Gift },
  ];

  return createPortal(
    <div className="mb-5 space-y-4" id="kyrub-store-loyalty-center">
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-400">
              Fidelidade & Promoções
            </span>
            <h3 className="mt-1 text-base font-black text-white">Benefícios da sua loja</h3>
          </div>
          {products.length > 0 && (
            <span className="text-[10px] font-bold text-slate-500">
              {configuredCount}/{products.length} itens pontuando
            </span>
          )}
        </div>

        <nav className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Áreas de fidelidade e promoções">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setMessage('');
                }}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[10px] font-black uppercase transition ${
                  active
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : 'border-slate-800 bg-slate-950 text-slate-500 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </section>

      {activeTab === 'points' && (
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Award className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <h4 className="text-sm font-black uppercase text-white">Pontos por produto</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                Esta lista edita o mesmo campo do cadastro do produto. Na compra, o valor vigente é congelado no pedido e o ledger credita quantidade × pontos por unidade.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {products.map(product => {
              const draft = drafts[product.id] ?? String(product.storePointsPerUnit ?? 0);
              const parsed = parseDraftPoints(draft);
              const current = product.storePointsPerUnit ?? 0;
              const changed = parsed !== null && parsed !== current;
              const busy = busyProductId === product.id;

              return (
                <div
                  key={product.id}
                  className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-xs text-white">{product.name}</strong>
                    <span className="mt-0.5 block truncate text-[9px] text-slate-500">
                      {product.category || 'Sem categoria'}
                    </span>
                  </div>
                  <label className="block">
                    <span className="sr-only">Pontos por unidade de {product.name}</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={draft}
                      disabled={Boolean(busyProductId)}
                      onChange={event => {
                        setDrafts(currentDrafts => ({
                          ...currentDrafts,
                          [product.id]: event.target.value,
                        }));
                        setMessage('');
                      }}
                      className={`w-full rounded-xl border bg-slate-900 px-3 py-2.5 text-sm font-black outline-none disabled:opacity-45 ${
                        parsed === null
                          ? 'border-red-500/60 text-red-300'
                          : 'border-slate-700 text-amber-200 focus:border-amber-400'
                      }`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!changed || Boolean(busyProductId)}
                    onClick={() => void saveProductPoints(product)}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-[9px] font-black uppercase text-amber-200 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Salvar
                  </button>
                </div>
              );
            })}
            {products.length === 0 && (
              <p className="rounded-2xl border border-dashed border-slate-800 px-4 py-7 text-center text-xs text-slate-500">
                Cadastre ou publique produtos para configurar Pontos da Loja.
              </p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'challenges' && (
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 h-5 w-5 text-violet-300" />
            <div>
              <h4 className="text-sm font-black uppercase text-white">Desafios</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                O contrato de desafios já existe. Publicação, progresso e concessão de benefício entram no próximo bloco funcional, sobre o ledger real de pontos.
              </p>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'rewards' && (
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-3">
            <Gift className="mt-0.5 h-5 w-5 text-emerald-300" />
            <div>
              <h4 className="text-sm font-black uppercase text-white">Recompensas</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                Recompensas continuam separadas de K-Coins. Resgate e consumo serão ligados ao saldo real da loja depois do fluxo funcional de desafios.
              </p>
            </div>
          </div>
        </section>
      )}

      {message && activeTab === 'points' && (
        <div
          className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-[10px] font-bold ${
            success
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {success && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {message}
        </div>
      )}
    </div>,
    host
  );
}
