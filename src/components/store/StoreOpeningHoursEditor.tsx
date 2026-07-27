import { Clock3, Copy } from 'lucide-react';
import type {
  StoreOpeningHours,
  StoreWeekday,
} from '../../utils/storeOperationalSettings';
import { STORE_WEEKDAYS } from '../../utils/storeOperationalSettings';

interface StoreOpeningHoursEditorProps {
  value: StoreOpeningHours;
  onChange: (value: StoreOpeningHours) => void;
  disabled?: boolean;
}

const DAY_LABELS: Record<StoreWeekday, string> = {
  monday: 'Segunda-feira',
  tuesday: 'Terça-feira',
  wednesday: 'Quarta-feira',
  thursday: 'Quinta-feira',
  friday: 'Sexta-feira',
  saturday: 'Sábado',
  sunday: 'Domingo',
};

export function StoreOpeningHoursEditor({
  value,
  onChange,
  disabled = false,
}: StoreOpeningHoursEditorProps) {
  const updateDay = (
    day: StoreWeekday,
    patch: Partial<StoreOpeningHours[StoreWeekday]>
  ): void => {
    onChange({
      ...value,
      [day]: {
        ...value[day],
        ...patch,
      },
    });
  };

  const copyMondayToWeekdays = (): void => {
    const monday = value.monday;
    onChange({
      ...value,
      monday: { ...monday },
      tuesday: { ...monday },
      wednesday: { ...monday },
      thursday: { ...monday },
      friday: { ...monday },
    });
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4"
      id="store-opening-hours-control"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-300">
            <Clock3 className="h-4 w-4 text-orange-400" />
            Horário de funcionamento
          </span>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            Ative somente os dias em que a loja funciona. Nenhum horário é preenchido automaticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={copyMondayToWeekdays}
          disabled={disabled || !value.monday.enabled}
          className="hidden min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-35 sm:flex"
          id="copy-monday-store-hours"
        >
          <Copy className="h-3.5 w-3.5" />
          Copiar seg.–sex.
        </button>
      </div>

      <div className="space-y-2">
        {STORE_WEEKDAYS.map(day => {
          const schedule = value[day];
          return (
            <div
              key={day}
              className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center"
            >
              <label className="flex items-center gap-2 text-[10px] font-bold text-slate-300">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={event =>
                    updateDay(day, {
                      enabled: event.target.checked,
                      opensAt: event.target.checked ? schedule.opensAt : '',
                      closesAt: event.target.checked ? schedule.closesAt : '',
                    })
                  }
                  disabled={disabled}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-orange-500"
                />
                {DAY_LABELS[day]}
              </label>

              {schedule.enabled ? (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <input
                    type="time"
                    value={schedule.opensAt}
                    onChange={event => updateDay(day, { opensAt: event.target.value })}
                    disabled={disabled}
                    aria-label={`Abertura de ${DAY_LABELS[day]}`}
                    className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-white outline-none focus:border-orange-500 disabled:opacity-45"
                  />
                  <span className="text-[9px] font-black uppercase text-slate-600">até</span>
                  <input
                    type="time"
                    value={schedule.closesAt}
                    onChange={event => updateDay(day, { closesAt: event.target.value })}
                    disabled={disabled}
                    aria-label={`Fechamento de ${DAY_LABELS[day]}`}
                    className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-white outline-none focus:border-orange-500 disabled:opacity-45"
                  />
                </div>
              ) : (
                <span className="rounded-xl border border-dashed border-slate-800 px-3 py-2 text-center text-[9px] font-black uppercase text-slate-600">
                  Fechado
                </span>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={copyMondayToWeekdays}
        disabled={disabled || !value.monday.enabled}
        className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-35 sm:hidden"
      >
        <Copy className="h-3.5 w-3.5" />
        Copiar segunda para dias úteis
      </button>
    </section>
  );
}
