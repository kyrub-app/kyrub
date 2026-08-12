import { useState, type FormEvent } from 'react';
import { Gift, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import { grantFoundingProPromotion } from '../../utils/adminPromotionalPlan';

interface AdminPromotionalPlanWorkspaceProps {
  authenticatedUser: User;
  profile: AdminProfile;
}

export default function AdminPromotionalPlanWorkspace({
  authenticatedUser,
  profile,
}: AdminPromotionalPlanWorkspaceProps) {
  const [targetUserId, setTargetUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (profile.role !== 'super_admin' || profile.status !== 'active') {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = targetUserId.trim();
    if (!target || busy) return;

    const confirmed = window.confirm(
      'Conceder Pro cortesia a esta Loja Kyrub? A ação altera o entitlement real para Pro, não cria cobrança e ficará registrada na auditoria administrativa.'
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      const result = await grantFoundingProPromotion(
        authenticatedUser,
        target
      );
      setSuccess(
        result.status === 'already_granted'
          ? `A loja ${result.storeId} já possui a cortesia Pro founding_pro_001 ativa.`
          : `Cortesia Pro concedida à loja ${result.storeId}. O entitlement agora é Pro, sem cobrança e sem vencimento definido.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível conceder a cortesia Pro.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="admin-promotional-plans"
      aria-labelledby="admin-promotional-plans-title"
      className="space-y-4 rounded-[2rem] border border-violet-500/20 bg-violet-500/5 p-4 sm:p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-violet-300">
            <Gift className="h-5 w-5" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">
              Benefício promocional
            </span>
          </div>
          <h2 id="admin-promotional-plans-title" className="mt-2 text-lg font-black text-white">
            Pro cortesia — primeira loja bonificada
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Concede a campanha interna <strong className="text-slate-200">founding_pro_001</strong> a uma Loja Kyrub existente. O servidor aplica o entitlement Pro, registra a origem promocional e audita quem concedeu. Nenhuma assinatura ou pagamento é simulado.
          </p>
        </div>

        <div className="rounded-2xl border border-violet-500/20 bg-slate-950/70 px-4 py-3 text-[10px] leading-relaxed text-slate-400">
          <strong className="flex items-center gap-1.5 text-violet-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Somente Super Admin
          </strong>
          O usuário da loja não consegue atribuir este benefício a si mesmo.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="mb-2 block text-[9px] font-black uppercase tracking-wider text-slate-500">
            UID exato do proprietário da loja
          </span>
          <input
            type="text"
            value={targetUserId}
            onChange={event => setTargetUserId(event.target.value)}
            placeholder="Cole o UID exibido no Diretório administrativo"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-xs text-white outline-none placeholder:font-sans placeholder:text-slate-600 focus:border-violet-500/60 disabled:opacity-60"
          />
        </label>

        <button
          type="submit"
          disabled={busy || !targetUserId.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Gift className="h-4 w-4" />
          )}
          {busy ? 'Concedendo' : 'Conceder Pro cortesia'}
        </button>
      </form>

      {error && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs leading-relaxed text-emerald-200" role="status">
          {success}
        </div>
      )}
    </section>
  );
}
