import { useEffect, useMemo, useState } from 'react';
import {
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import {
  inferLegacyServiceLocationKind,
  type ServiceLocation,
  type ServiceLocationKind,
} from '../../../shared/serviceLocation';
import { auth } from '../../utils/firebase';
import {
  createManagedServiceLocation,
  loadServiceLocations,
  updateManagedServiceLocation,
} from '../../utils/serviceLocations';

const LEGACY_SEED = ['GERAL', 'BALCÃO', 'ENTREGA', 'AGENDADOS'];

const normalized = (value: string): string =>
  value.trim().toLocaleUpperCase('pt-BR');

const isOnlyLegacySeed = (spaces: string[]): boolean => {
  const current = Array.from(new Set(spaces.map(normalized))).sort();
  const seed = [...LEGACY_SEED].sort();
  return current.length === seed.length && current.every((item, index) => item === seed[index]);
};

type LocationDraft = {
  label: string;
};

export const ServiceLocationManager = ({
  legacySpaces,
}: {
  legacySpaces: string[];
}) => {
  const storeId = auth.currentUser?.uid ?? '';
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LocationDraft>>({});
  const [newLabel, setNewLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const refresh = async (): Promise<void> => {
    if (!storeId) return;
    setLoading(true);
    try {
      const next = await loadServiceLocations(storeId);
      setLocations(next);
      setDrafts(Object.fromEntries(next.map(location => [
        location.id,
        { label: location.label },
      ])));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar os locais de atendimento.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [storeId]);

  const promotedKeys = useMemo(
    () => new Set(locations.map(location => `${location.kind}:${normalized(location.label)}`)),
    [locations]
  );

  const legacyCandidates = useMemo(() => {
    if (isOnlyLegacySeed(legacySpaces)) return [];
    const unique = Array.from(new Set(legacySpaces.map(space => space.trim()).filter(Boolean)));
    return unique.flatMap(label => {
      const kind = inferLegacyServiceLocationKind(label);
      if (!kind) return [];
      if (promotedKeys.has(`${kind}:${normalized(label)}`)) return [];
      return [{ label, kind }];
    });
  }, [legacySpaces, promotedKeys]);

  const createLocation = async (
    label: string,
    kind: ServiceLocationKind = 'other'
  ): Promise<void> => {
    if (!storeId || !label.trim()) return;
    setBusyId('create');
    setErrorMessage('');
    try {
      const created = await createManagedServiceLocation({
        storeId,
        kind,
        label: label.trim(),
      });
      setLocations(current => [...current, created].sort((left, right) =>
        left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' })
      ));
      setDrafts(current => ({
        ...current,
        [created.id]: { label: created.label },
      }));
      setNewLabel('');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível criar o local.'
      );
    } finally {
      setBusyId('');
    }
  };

  const saveLocation = async (location: ServiceLocation): Promise<void> => {
    const draft = drafts[location.id];
    if (!draft || !draft.label.trim()) return;
    setBusyId(location.id);
    setErrorMessage('');
    try {
      const updated = await updateManagedServiceLocation({
        storeId,
        locationId: location.id,
        label: draft.label.trim(),
      });
      setLocations(current => current.map(item => item.id === updated.id ? updated : item));
      setDrafts(current => ({
        ...current,
        [updated.id]: { label: updated.label },
      }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível atualizar o local.'
      );
    } finally {
      setBusyId('');
    }
  };

  const toggleLocation = async (location: ServiceLocation): Promise<void> => {
    setBusyId(location.id);
    setErrorMessage('');
    try {
      const updated = await updateManagedServiceLocation({
        storeId,
        locationId: location.id,
        active: !location.active,
      });
      setLocations(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível alterar o local.'
      );
    } finally {
      setBusyId('');
    }
  };

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-850 bg-slate-950/40 p-4"
      id="canonical-service-location-manager"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-orange-400" />
            <h4 className="text-[10px] font-black uppercase text-orange-400">
              Locais de atendimento
            </h4>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Cadastre livremente as áreas, setores ou ambientes onde sua loja atende clientes. Use os nomes reais do seu negócio; não há categorias obrigatórias.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-500 hover:text-white disabled:opacity-50"
          aria-label="Atualizar locais de atendimento"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          value={newLabel}
          onChange={event => setNewLabel(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && void createLocation(newLabel)}
          placeholder="Ex.: Salão principal, Mezanino, Calçada, Cadeiras de corte"
          aria-label="Nome do local de atendimento"
          className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none focus:border-orange-500/40"
        />
        <button
          type="button"
          onClick={() => void createLocation(newLabel)}
          disabled={!newLabel.trim() || busyId === 'create'}
          className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase text-slate-950 disabled:bg-slate-800 disabled:text-slate-600"
        >
          {busyId === 'create'
            ? <LoaderCircle className="h-4 w-4 animate-spin" />
            : <Plus className="h-4 w-4" />}
          Adicionar
        </button>
      </div>

      {legacyCandidates.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-[9px] font-black uppercase text-amber-300">
            Espaços antigos reconhecidos
          </p>
          <p className="mt-1 text-[9px] text-slate-500">
            A promoção é manual. O registro antigo permanece apenas como compatibilidade durante a transição.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {legacyCandidates.map(candidate => (
              <button
                key={`${candidate.kind}:${candidate.label}`}
                type="button"
                onClick={() => void createLocation(candidate.label, candidate.kind)}
                disabled={Boolean(busyId)}
                className="rounded-xl border border-amber-500/20 bg-slate-950 px-3 py-2 text-[9px] font-bold text-amber-200 disabled:opacity-50"
              >
                Promover {candidate.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      {locations.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-slate-800 py-7 text-center text-[9px] text-slate-500">
          Nenhum local de atendimento cadastrado. A loja começa vazia e você adiciona apenas o que realmente existe.
        </div>
      ) : (
        <div className="space-y-2">
          {locations.map(location => {
            const draft = drafts[location.id] ?? { label: location.label };
            return (
              <div
                key={location.id}
                className={`rounded-2xl border p-3 ${
                  location.active
                    ? 'border-slate-800 bg-slate-950'
                    : 'border-slate-850 bg-slate-950/50 opacity-70'
                }`}
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    value={draft.label}
                    onChange={event => setDrafts(current => ({
                      ...current,
                      [location.id]: { label: event.target.value },
                    }))}
                    aria-label={`Nome do local ${location.label}`}
                    className="min-h-9 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[10px] text-white outline-none focus:border-orange-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => void saveLocation(location)}
                    disabled={busyId === location.id || !draft.label.trim()}
                    className="flex min-h-9 items-center justify-center gap-1 rounded-xl border border-slate-700 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" /> Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleLocation(location)}
                    disabled={busyId === location.id}
                    className={`flex min-h-9 items-center justify-center gap-1 rounded-xl border px-3 text-[8px] font-black uppercase disabled:opacity-50 ${
                      location.active
                        ? 'border-emerald-500/20 text-emerald-300'
                        : 'border-slate-700 text-slate-500'
                    }`}
                  >
                    {location.active
                      ? <ToggleRight className="h-4 w-4" />
                      : <ToggleLeft className="h-4 w-4" />}
                    {location.active ? 'Ativo' : 'Inativo'}
                  </button>
                </div>
                <p className="mt-2 font-mono text-[8px] text-slate-700">
                  ID estável: {location.id}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};