import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

interface Props {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}

export default function AdminAccordionSection({ id, title, description, icon: Icon, children, defaultOpen = false, badge }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details id={id} open={open} onToggle={event => setOpen(event.currentTarget.open)} className="group overflow-hidden rounded-[1.75rem] border border-slate-800 bg-slate-900/55">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400 sm:p-5 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0 rounded-xl bg-slate-800 p-2.5 text-cyan-300"><Icon className="h-4 w-4" /></div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-black text-white">{title}</h2>{badge && <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-black uppercase text-slate-400">{badge}</span>}</div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{description}</p></div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      {open && <div className="border-t border-slate-800 p-4 sm:p-5">{children}</div>}
    </details>
  );
}
