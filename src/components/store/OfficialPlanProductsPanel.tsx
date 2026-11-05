import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { configureOfficialPlanProduct, loadOfficialPlanProducts, type OfficialPlanProductRow } from '../../utils/officialStore';

export default function OfficialPlanProductsPanel({ user, storeId }: { user: User; storeId: string }) {
  const [products, setProducts] = useState<OfficialPlanProductRow[]>([]);
  const [productId, setProductId] = useState('');
  const [plan, setPlan] = useState<'pro' | 'business'>('pro');
  const [xp, setXp] = useState('0');
  const [achievementId, setAchievementId] = useState('');
  const [achievementTitle, setAchievementTitle] = useState('');
  const [achievementDescription, setAchievementDescription] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const select = (id: string) => {
    const product = products.find(row => row.id === id);
    setProductId(id); setPlan(product?.planId === 'business' ? 'business' : 'pro');
    setXp(String(product?.rewards.xp ?? 0));
    setAchievementId(product?.rewards.achievement?.id ?? ''); setAchievementTitle(product?.rewards.achievement?.title ?? '');
    setAchievementDescription(product?.rewards.achievement?.description ?? ''); setBadgeId(product?.rewards.achievement?.badgeId ?? '');
    setMessage(''); setError('');
  };
  useEffect(() => {
    let current = true;
    void loadOfficialPlanProducts(user).then(result => {
      if (!current) return;
      if (result.storeId !== storeId) throw new Error('A loja aberta não corresponde à Loja Oficial.');
      setProducts(result.products);
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Consulta indisponível.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [user, storeId]);
  const save = async () => {
    if (busy || !productId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const rewards = { xp: Number(xp), ...(achievementId ? { achievement: { id: achievementId.trim(), title: achievementTitle.trim(),
        description: achievementDescription.trim(), ...(badgeId.trim() ? { badgeId: badgeId.trim() } : {}) } } : {}) };
      await configureOfficialPlanProduct(user, productId, plan, rewards);
      setProducts(rows => rows.map(row => row.id === productId ? { ...row, planId: plan, rewards } : row));
      setMessage('Vínculo e recompensas salvos. Preço, descontos e publicação permanecem sob seu controle no cadastro do produto.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const field = 'mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white';
  return <section className="mt-4 space-y-3 rounded-xl border border-cyan-700 p-4 text-xs" aria-label="Planos oficiais Pro e Business">
    <h5 className="font-bold text-white">Planos oficiais Pro e Business</h5>
    <p>Cadastre no catálogo um produto de assinatura mensal com benefício de acesso. Defina preço, pontos por compra e descontos por prazo no próprio produto. Aqui você vincula o produto ao plano e configura recompensas globais.</p>
    <label className="block">Produto existente<select className={field} value={productId} disabled={busy} onChange={event => select(event.target.value)}>
      <option value="">Selecione um produto</option>{products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.publicationStatus}</option>)}
    </select></label>
    <label className="block">Plano<select className={field} value={plan} disabled={busy || !productId} onChange={event => setPlan(event.target.value as 'pro' | 'business')}>
      <option value="pro">Kyrub Pro</option><option value="business">Kyrub Business</option>
    </select></label>
    <label className="block">XP por contratação paga<input className={field} type="number" min="0" max="1000000" step="1" value={xp} disabled={busy || !productId} onChange={event => setXp(event.target.value)} /></label>
    <p>Zero significa sem XP. Pontos da loja seguem o cadastro do produto. Conquistas e selos abaixo são opcionais e concedidos uma única vez por pessoa.</p>
    <label className="block">Identificador da conquista<input className={field} value={achievementId} disabled={busy || !productId} onChange={event => setAchievementId(event.target.value)} /></label>
    <label className="block">Título da conquista<input className={field} value={achievementTitle} disabled={busy || !productId} onChange={event => setAchievementTitle(event.target.value)} /></label>
    <label className="block">Descrição<input className={field} value={achievementDescription} disabled={busy || !productId} onChange={event => setAchievementDescription(event.target.value)} /></label>
    <label className="block">Identificador do selo, se aplicável<input className={field} value={badgeId} disabled={busy || !productId} onChange={event => setBadgeId(event.target.value)} /></label>
    <button type="button" className="min-h-10 rounded-lg bg-cyan-700 px-3 font-bold text-white disabled:opacity-50" disabled={busy || !productId} onClick={() => void save()}>{busy ? 'Processando…' : 'Salvar vínculo e recompensas'}</button>
    {error && <p role="alert" className="text-amber-300">{error}</p>}{message && <p role="status" className="text-emerald-300">{message}</p>}
  </section>;
}
