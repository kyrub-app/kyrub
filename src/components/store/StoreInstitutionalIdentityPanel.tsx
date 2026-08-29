import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BadgeCheck,
  Building2,
  IdCard,
  MapPin,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type {
  StoreInstitutionalCapability,
  StoreInstitutionalRepresentation,
} from '../../../shared/storeInstitutionalIdentity';
import { loadStoreInstitutionalRepresentation } from '../../utils/storeInstitutionalIdentity';

interface StoreInstitutionalIdentityPanelProps {
  user: User;
}

const ROLE_LABELS = {
  owner: 'Proprietário',
  manager: 'Gerente',
  attendant: 'Atendente',
} as const;

const CAPABILITY_LABELS: Record<StoreInstitutionalCapability, string> = {
  identity_manage: 'Gerenciar identidade',
  team_manage: 'Gerenciar equipe',
  relationship_read: 'Consultar relacionamento',
  conversation_act: 'Responder como loja',
  notification_act: 'Comunicar como loja',
};

const STATUS_LABELS = {
  open: 'Aberta',
  delayed: 'Operação com atraso',
  closed: 'Fechada',
} as const;

export function StoreInstitutionalIdentityPanel({
  user,
}: StoreInstitutionalIdentityPanelProps) {
  const [representation, setRepresentation] =
    useState<StoreInstitutionalRepresentation | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      setRepresentation(
        await loadStoreInstitutionalRepresentation(user, user.uid)
      );
    } catch (error) {
      console.error('Falha ao carregar identidade institucional:', error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar a identidade da loja.'
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const identity = representation?.identity;

  return (
    <section
      id="store-institutional-identity-panel"
      className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4 shadow-xl sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {identity?.avatarUrl ? (
            <img
              src={identity.avatarUrl}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 bg-slate-900 object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300">
              <Building2 className="h-6 w-6" />
            </div>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-400">
                Identidade institucional
              </span>
              {representation && (
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-emerald-300">
                  {ROLE_LABELS[representation.role]}
                </span>
              )}
            </div>
            <h3 className="mt-1 truncate text-base font-black text-white">
              {identity?.displayName || 'Sua loja'}
            </h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
              Você continua autenticado como pessoa. Quando o Kyrub precisar falar,
              notificar ou responder em nome do negócio, usará esta identidade da loja.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[9px] font-black uppercase text-slate-300 hover:border-orange-500/40 hover:text-orange-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[10px] font-bold text-red-300"
        >
          {errorMessage}
        </div>
      )}

      {identity && representation && (
        <>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <InfoCard
              icon={IdCard}
              label="Principal institucional"
              value={identity.principalId}
            />
            <InfoCard
              icon={BadgeCheck}
              label="Vitrine"
              value={identity.slug ? `@${identity.slug}` : 'Slug ainda não definido'}
            />
            <InfoCard
              icon={MapPin}
              label="Endereço comercial"
              value={identity.address || 'Ainda não informado'}
            />
            <InfoCard
              icon={ShieldCheck}
              label="Situação"
              value={STATUS_LABELS[identity.status]}
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">
                Apresentação comercial canônica
              </span>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                {identity.description ||
                  'A loja ainda não adicionou uma descrição institucional.'}
              </p>
              {identity.contact && (
                <span className="mt-2 block text-[9px] text-slate-500">
                  Contato: {identity.contact}
                </span>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <div className="flex items-center gap-2 text-slate-300">
                <Users className="h-4 w-4 text-orange-400" />
                <span className="text-[9px] font-black uppercase">
                  Pode agir como loja
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {representation.capabilities.map(capability => (
                  <span
                    key={capability}
                    className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[8px] font-bold text-slate-400"
                  >
                    {CAPABILITY_LABELS[capability]}
                  </span>
                ))}
              </div>
              {representation.capabilities.includes('conversation_act') && (
                <div className="mt-3 flex items-start gap-2 text-[9px] leading-relaxed text-slate-500">
                  <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />
                  <span>
                    O próximo módulo de conversa poderá usar este principal sem criar
                    uma conta de login separada para a loja.
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IdCard;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <Icon className="h-4 w-4 text-orange-400" />
      <span className="mt-2 block text-[8px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <strong className="mt-1 block break-words text-[10px] text-slate-200">
        {value}
      </strong>
    </div>
  );
}
