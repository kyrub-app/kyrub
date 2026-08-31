import { useEffect, useState } from 'react';
import { CircleAlert, MapPin, Save } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import {
  loadAdminCustomerArrivalPolicy,
  saveAdminCustomerArrivalPolicy,
  type AdminCustomerArrivalPolicy,
} from '../../utils/adminIntegrationReadiness';

export default function AdminCustomerArrivalPolicyCard({
  authenticatedUser,
  profile,
}: {
  authenticatedUser: User;
  profile: AdminProfile;
}) {
  const [policy, setPolicy] = useState<AdminCustomerArrivalPolicy | null>(null);
  const [policyId, setPolicyId] = useState('');
  const [version, setVersion] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const applyPolicy = (next: AdminCustomerArrivalPolicy): void => {
    setPolicy(next);
    setPolicyId(next.policyId);
    setVersion(next.version ? String(next.version + 1) : '1');
    setRadiusMeters(next.radiusMeters ? String(next.radiusMeters) : '');
    setEnabled(next.enabled);
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setMessage('');
    try {
      applyPolicy(await loadAdminCustomerArrivalPolicy(authenticatedUser, profile));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível carregar a política.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile.role !== 'super_admin' || profile.status !== 'active') return;
    void refresh();
  }, [authenticatedUser.uid, profile.role, profile.status]);

  const save = async (): Promise<void> => {
    const normalizedVersion = Number(version);
    const normalizedRadius = Number(radiusMeters);
    if (!policyId.trim()) {
      setMessage('Informe um identificador para a política.');
      return;
    }
    if (!Number.isSafeInteger(normalizedVersion) || normalizedVersion <= 0) {
      setMessage('A versão deve ser um inteiro positivo.');
      return;
    }
    if (!Number.isSafeInteger(normalizedRadius) || normalizedRadius <= 0) {
      setMessage('Informe um raio inteiro positivo em metros.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const saved = await saveAdminCustomerArrivalPolicy(authenticatedUser, profile, {
        policyId: policyId.trim(),
        version: normalizedVersion,
        radiusMeters: normalizedRadius,
        enabled,
      });
      applyPolicy(saved);
      setMessage(
        saved.enabled
          ? `Política v${saved.version} ativada com raio de ${saved.radiusMeters} m.`
          : `Política v${saved.version} salva desativada.`
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível salvar a política.');
    } finally {
      setSaving(false);
    }
  };

  if (profile.role !== 'super_admin' || profile.status !== 'active') return null;

  return (
    <article className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-wider text-violet-400">
            Responsabilidade Operacional · chegada ao cliente
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-sm font-black text-white">
            <MapPin className="h-4 w-4" />
            Raio autoritativo do geofence
          </h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Define quantos metros ao redor do destino canônico qualificam a entrada do entregador no geofence. Cada alteração exige uma nova versão e só afeta entregas criadas depois dela.
          </p>
        </div>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase text-slate-300">
          {loading ? 'Carregando' : policy?.configured ? (policy.enabled ? 'Ativa' : 'Desativada') : 'Não configurada'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-[10px] font-bold text-slate-400">
          Policy ID
          <input
            type="text"
            value={policyId}
            onChange={event => setPolicyId(event.target.value)}
            placeholder="delivery-customer-arrival"
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-500"
          />
        </label>
        <label className="text-[10px] font-bold text-slate-400">
          Nova versão
          <input
            type="number"
            min="1"
            step="1"
            value={version}
            onChange={event => setVersion(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-500"
          />
        </label>
        <label className="text-[10px] font-bold text-slate-400">
          Raio de chegada (metros)
          <input
            type="number"
            min="1"
            step="1"
            value={radiusMeters}
            onChange={event => setRadiusMeters(event.target.value)}
            placeholder="Defina explicitamente"
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-500"
          />
        </label>
      </div>

      <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[10px] text-slate-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={event => setEnabled(event.target.checked)}
          className="h-4 w-4"
        />
        <span>
          <strong className="block text-white">Ativar esta versão para novas entregas</strong>
          Entregas já publicadas preservam o snapshot anterior.
        </span>
      </label>

      {policy?.configured && (
        <p className="mt-3 text-[10px] text-slate-500">
          Atual: {policy.policyId} · v{policy.version} · {policy.radiusMeters} m · {policy.enabled ? 'ativa' : 'desativada'}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Salvando…' : 'Salvar nova versão'}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={saving || loading}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 disabled:opacity-40"
        >
          Recarregar
        </button>
      </div>

      {message && (
        <div className="mt-3 flex gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] leading-relaxed text-slate-300" aria-live="polite">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
          <span>{message}</span>
        </div>
      )}
    </article>
  );
}
