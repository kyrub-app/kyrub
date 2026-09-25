import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';
import {
  subscribeToStoreMembers,
  subscribeToUserStoreAccess,
  type StoreMemberDirectoryRecord,
} from '../../utils/storeDirectory';

type CompensationKind = 'salary' | 'fixed_fee';

type Compensation = {
  id: string;
  financeStoreId: string;
  teamStoreId: string;
  memberUserId: string;
  memberDisplayNameSnapshot: string;
  memberRoleSnapshot: string;
  kind: CompensationKind;
  currency: 'BRL';
  monthlyAmountMinor: number;
  payDay: number;
  active: boolean;
  sourceAuthority: 'store_owner_manual';
  createdAt: string;
  updatedAt: string;
};

type PayrollPayload = {
  compensations?: Compensation[];
  compensation?: Compensation;
  payable?: {
    id: string;
    status: 'open' | 'paid' | 'cancelled';
    payrollPeriod: string;
  };
  created?: boolean;
  error?: string;
};

type Props = {
  legacyStoreId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
};

const amountToMinor = (value: string): number | null => {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const minor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const currentPeriod = (): string => new Date().toISOString().slice(0, 7);

async function requestPayroll(
  url: string,
  options?: RequestInit
): Promise<PayrollPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('A folha respondeu em um formato inesperado.');
  }
  const payload = await response.json() as PayrollPayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível administrar a folha.');
  return payload;
}

export default function StorePayrollWorkspace({ legacyStoreId, notify }: Props) {
  const [teamStoreId, setTeamStoreId] = useState('');
  const [members, setMembers] = useState<StoreMemberDirectoryRecord[]>([]);
  const [compensations, setCompensations] = useState<Compensation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [payDay, setPayDay] = useState('');
  const [kind, setKind] = useState<CompensationKind>('salary');
  const [active, setActive] = useState(true);
  const [period, setPeriod] = useState(currentPeriod());
  const [saving, setSaving] = useState(false);
  const [generatingMemberId, setGeneratingMemberId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);

  const user = auth.currentUser;
  const activeMembers = useMemo(
    () => members.filter(member => member.status === 'active'),
    [members]
  );

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setTeamStoreId('');
      return;
    }
    return subscribeToUserStoreAccess(
      user.uid,
      accesses => {
        const linked = accesses.find(access =>
          access.status === 'active'
          && access.role === 'owner'
          && (access.store.legacyTenantId === legacyStoreId || access.store.id === legacyStoreId)
        );
        setTeamStoreId(linked?.store.id ?? '');
        setLoading(false);
      },
      () => {
        setTeamStoreId('');
        setLoading(false);
      }
    );
  }, [legacyStoreId, user?.uid]);

  useEffect(() => {
    setMembers([]);
    if (!teamStoreId) return;
    return subscribeToStoreMembers(
      teamStoreId,
      setMembers,
      () => notify('Não foi possível carregar a equipe para a folha.', 'error')
    );
  }, [notify, teamStoreId]);

  const loadCompensations = useCallback(async () => {
    if (!teamStoreId) {
      setCompensations([]);
      return;
    }
    try {
      const query = new URLSearchParams({ storeId: legacyStoreId, teamStoreId });
      const payload = await requestPayroll(`/api/store-payroll?${query.toString()}`);
      setCompensations(payload.compensations ?? []);
    } catch (caught) {
      setFeedbackError(true);
      setFeedback(caught instanceof Error ? caught.message : 'Não foi possível carregar a remuneração.');
    }
  }, [legacyStoreId, teamStoreId]);

  useEffect(() => { void loadCompensations(); }, [loadCompensations]);

  useEffect(() => {
    if (!selectedMemberId && activeMembers.length > 0) {
      setSelectedMemberId(activeMembers[0].userId);
      return;
    }
    const compensation = compensations.find(item => item.memberUserId === selectedMemberId);
    if (compensation) {
      setAmount((compensation.monthlyAmountMinor / 100).toFixed(2).replace('.', ','));
      setPayDay(String(compensation.payDay));
      setKind(compensation.kind);
      setActive(compensation.active);
    } else {
      setAmount('');
      setPayDay('');
      setKind('salary');
      setActive(true);
    }
  }, [activeMembers, compensations, selectedMemberId]);

  const saveCompensation = async () => {
    const monthlyAmountMinor = amountToMinor(amount);
    const parsedPayDay = Number(payDay);
    if (!selectedMemberId || monthlyAmountMinor === null || !Number.isSafeInteger(parsedPayDay) || parsedPayDay < 1 || parsedPayDay > 28) {
      setFeedbackError(true);
      setFeedback('Selecione um colaborador, informe o valor mensal e um dia de pagamento entre 1 e 28.');
      return;
    }

    setSaving(true);
    setFeedback('');
    setFeedbackError(false);
    try {
      await requestPayroll('/api/store-payroll', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save_member_compensation',
          storeId: legacyStoreId,
          teamStoreId,
          memberUserId: selectedMemberId,
          monthlyAmountMinor,
          payDay: parsedPayDay,
          kind,
          active,
        }),
      });
      setFeedback('Remuneração vinculada ao colaborador real do RH.');
      await loadCompensations();
    } catch (caught) {
      setFeedbackError(true);
      setFeedback(caught instanceof Error ? caught.message : 'Não foi possível salvar a remuneração.');
    } finally {
      setSaving(false);
    }
  };

  const generatePayroll = async (memberUserId: string) => {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) {
      setFeedbackError(true);
      setFeedback('Informe uma competência válida.');
      return;
    }
    setGeneratingMemberId(memberUserId);
    setFeedback('');
    setFeedbackError(false);
    try {
      const payload = await requestPayroll('/api/store-payroll', {
        method: 'POST',
        body: JSON.stringify({
          action: 'generate_payroll_payable',
          storeId: legacyStoreId,
          teamStoreId,
          memberUserId,
          period,
        }),
      });
      setFeedback(payload.created === false
        ? 'A competência já existia e não foi duplicada.'
        : 'Competência gerada em Contas a Pagar. Isso ainda não registra pagamento.');
    } catch (caught) {
      setFeedbackError(true);
      setFeedback(caught instanceof Error ? caught.message : 'Não foi possível gerar a competência.');
    } finally {
      setGeneratingMemberId('');
    }
  };

  if (loading) {
    return <section className="rounded-3xl border border-violet-500/20 bg-slate-900 p-5 text-[10px] text-slate-400">Carregando remuneração da equipe…</section>;
  }

  if (!teamStoreId) {
    return (
      <section className="rounded-3xl border border-violet-500/20 bg-slate-900 p-5 text-white">
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">Remuneração & Folha</span>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
          A folha será habilitada quando a loja canônica da equipe estiver vinculada a esta loja financeira. Nenhum salário legado será copiado automaticamente.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-violet-500/20 bg-slate-900 p-5 text-white" data-kyrub-store-payroll="canonical">
      <div>
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">Remuneração & Folha</span>
        <h4 className="mt-1 text-xs font-black uppercase">Equipe real ligada ao Financeiro</h4>
        <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
          A remuneração fica vinculada ao usuário ativo do RH. Gerar uma competência cria uma conta a pagar determinística; não marca salário como pago e não duplica a mesma competência.
        </p>
      </div>

      {activeMembers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] text-slate-500">
          Não há colaborador ativo nesta equipe para configurar remuneração.
        </p>
      ) : (
        <form
          className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
          onSubmit={event => { event.preventDefault(); void saveCompensation(); }}
        >
          <h5 className="text-[10px] font-black uppercase text-slate-200">Configurar remuneração</h5>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-[8px] font-black uppercase text-slate-500 md:col-span-2">
              Colaborador
              <select
                value={selectedMemberId}
                onChange={event => setSelectedMemberId(event.target.value)}
                className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] normal-case text-white"
              >
                {activeMembers.map(member => (
                  <option key={member.userId} value={member.userId}>{member.displayName || member.email}</option>
                ))}
              </select>
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Tipo
              <select value={kind} onChange={event => setKind(event.target.value as CompensationKind)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] normal-case text-white">
                <option value="salary">Salário</option>
                <option value="fixed_fee">Remuneração fixa</option>
              </select>
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Valor mensal
              <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] normal-case text-white" />
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Dia de pagamento
              <input value={payDay} onChange={event => setPayDay(event.target.value)} inputMode="numeric" placeholder="1 a 28" className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] normal-case text-white" />
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[9px] text-slate-300">
              <input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />
              Remuneração ativa
            </label>
          </div>
          <button type="submit" disabled={saving} className="mt-4 min-h-10 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 text-[9px] font-black uppercase text-violet-100 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar remuneração'}
          </button>
        </form>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h5 className="text-[10px] font-black uppercase text-slate-200">Competência da folha</h5>
            <p className="mt-1 text-[8px] text-slate-600">Escolha o mês e gere apenas para quem já possui remuneração configurada.</p>
          </div>
          <label className="text-[8px] font-black uppercase text-slate-500">
            Competência
            <input type="month" value={period} onChange={event => setPeriod(event.target.value)} className="mt-1 min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] normal-case text-white" />
          </label>
        </div>

        {compensations.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-800 p-4 text-center text-[9px] text-slate-600">Nenhuma remuneração configurada.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {compensations.map(compensation => (
              <article key={compensation.memberUserId} className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <strong className="block truncate text-[10px]">{compensation.memberDisplayNameSnapshot}</strong>
                    <p className="mt-1 text-[8px] text-slate-500">
                      {compensation.kind === 'salary' ? 'Salário' : 'Remuneração fixa'} · {money(compensation.monthlyAmountMinor)} · dia {compensation.payDay}
                    </p>
                    {!compensation.active && <span className="mt-1 inline-block text-[8px] font-black uppercase text-amber-300">Inativa</span>}
                  </div>
                  <button
                    type="button"
                    disabled={!compensation.active || generatingMemberId === compensation.memberUserId}
                    onClick={() => void generatePayroll(compensation.memberUserId)}
                    className="min-h-9 shrink-0 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 text-[8px] font-black uppercase text-violet-100 disabled:opacity-40"
                  >
                    {generatingMemberId === compensation.memberUserId ? 'Gerando…' : 'Gerar competência'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {feedback && (
        <p className={`rounded-xl border p-3 text-[9px] ${feedbackError ? 'border-rose-500/20 bg-rose-500/10 text-rose-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'}`}>
          {feedback}
        </p>
      )}
    </section>
  );
}