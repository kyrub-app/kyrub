import React from 'react';
import { Bell } from 'lucide-react';
import { Note } from '../../types';

interface ActiveAlarmModalProps {
  isOpen: boolean;
  activeAlarmNote: Note | null;
  onSnooze: (newReminder: string) => void;
  onDismiss: () => void;
}

export const ActiveAlarmModal: React.FC<ActiveAlarmModalProps> = ({
  isOpen,
  activeAlarmNote,
  onSnooze,
  onDismiss
}) => {
  if (!isOpen || !activeAlarmNote) return null;

  const handleSnoozeClick = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const newReminder = `${year}-${month}-${day}T${hours}:${minutes}`;
    onSnooze(newReminder);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" id="active-alarm-modal">
      <div className="bg-slate-900 border-2 border-orange-500/50 w-full max-w-sm p-6 rounded-3xl shadow-2xl shadow-orange-500/10 text-center space-y-5 relative overflow-hidden animate-scale-up">
        
        {/* Animated Ring Accent */}
        <div className="absolute -top-12 -left-12 w-24 h-24 bg-orange-500/10 rounded-full blur-xl animate-pulse"></div>
        <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-teal-500/10 rounded-full blur-xl animate-pulse"></div>

        <div className="flex flex-col items-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400 animate-bounce">
            <Bell className="w-8 h-8 text-orange-500" />
          </div>
          <div>
            <span className="text-[10px] font-mono text-orange-400 uppercase font-black tracking-widest block">🔔 ALARME DE TAREFA ATIVO</span>
            <h3 className="text-base font-black text-white uppercase mt-1 tracking-wide">{activeAlarmNote.title}</h3>
          </div>
        </div>

        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-slate-300 text-xs leading-relaxed">
          {activeAlarmNote.content}
        </div>

        {activeAlarmNote.checklist && activeAlarmNote.checklist.length > 0 && (
          <div className="text-left bg-slate-950/50 p-3 rounded-2xl border border-slate-800/60 space-y-1.5">
            <span className="text-[9px] font-mono uppercase text-slate-500 block">Checklist Associado</span>
            {activeAlarmNote.checklist.slice(0, 3).map(item => (
              <div key={item.id} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className={item.done ? 'text-emerald-400 font-bold font-mono' : 'text-slate-600 font-bold font-mono'}>
                  {item.done ? '✓' : '☐'}
                </span>
                <span className={item.done ? 'line-through text-slate-600' : ''}>{item.text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={handleSnoozeClick}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-[11px] uppercase tracking-wider transition-all cursor-pointer"
          >
            Soneca (1m)
          </button>
          
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black py-2.5 rounded-xl text-[11px] uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-orange-600/20"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
};
