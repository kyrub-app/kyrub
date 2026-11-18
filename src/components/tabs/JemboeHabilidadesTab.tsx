import { BookOpen, ExternalLink, GraduationCap, Sparkles } from 'lucide-react';
import { KYRUBIA_LEARNING_TRACKS } from '../../ai/kyrubiaLearningTracks';

// Public classroom from the prior Kyrub Cursos audit (31/10/2026).
// The URL is external; we have NOT implemented SSO or learner enrolment.
const KYRUB_CURSOS_URL = 'https://smartlyst.com.br/platform/kyrubcursos';

/** Jemboé is for learning; do not mix course enrolments with Kyrub paid plans. */
export function JemboeHabilidadesTab() {
  return (
    <section id="jemboe-habilidades-tab" aria-label="Jemboé — Habilidades" className="space-y-5">
      <header className="rounded-3xl border border-orange-500/25 bg-gradient-to-br from-orange-950/40 via-slate-900 to-slate-950 p-6">
        <div className="flex items-center gap-2 text-orange-400">
          <GraduationCap className="h-6 w-6" aria-hidden="true" />
          <span className="font-mono text-xs font-bold uppercase tracking-[0.18em]">Jemboé · Habilidades</span>
        </div>
        <h1 className="mt-4 text-2xl font-black leading-tight text-white">
          Aprenda uma habilidade. Transforme conhecimento em oportunidades.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Explore caminhos para aprender, empreender e aproveitar os recursos do Kyrub.
          A formação pode começar aqui, sem exigir login no aplicativo.
        </p>
      </header>
      <div className="space-y-3" aria-label="Trilhas de aprendizagem">
        {KYRUBIA_LEARNING_TRACKS.map((track, index) => (
          <article key={track.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center gap-3">
              {index === 0
                ? <BookOpen className="h-5 w-5 shrink-0 text-orange-400" aria-hidden="true" />
                : <Sparkles className="h-5 w-5 shrink-0 text-orange-400" aria-hidden="true" />}
              <div>
                <h2 className="text-sm font-black text-slate-100">{track.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{track.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <section className="rounded-2xl border border-teal-500/20 bg-slate-900 p-5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-teal-400">
          Kyrub Cursos · Plataforma externa
        </span>
        <h2 className="mt-2 text-lg font-black text-white">Acesse a sala de aula</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          A plataforma de ensino é externa ao Kyrub. O login, a matrícula, os certificados
          e os valores dos cursos ainda não estão integrados à sua conta Kyrub.
          A disponibilidade dos cursos deve ser conferida na sala de aula.
        </p>
        <a id="jemboe-kyrub-cursos-link" href={KYRUB_CURSOS_URL} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-3 text-xs font-black uppercase text-slate-950 transition hover:bg-teal-400">
          Acessar Kyrub Cursos <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </section>
    </section>
  );
}
