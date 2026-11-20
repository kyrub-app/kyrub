import { ExternalLink } from 'lucide-react';

// Audited external classroom address, not an integrated SSO or enrolment route.
const KYRUB_CURSOS_URL = 'https://smartlyst.com.br/platform/kyrubcursos';

/** Jemboé focuses on direct access to the classroom, without intro panels. */
export function JemboeHabilidadesTab() {
  return (
    <section id="jemboe-habilidades-tab" aria-label="Jemboé — Habilidades">
      <section className="kyrub-tone-editorial rounded-2xl p-5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#4A6953]">
          Kyrub Cursos · Plataforma externa
        </span>
        <h1 className="kyrub-editorial-heading mt-2 text-xl text-[#121A17]">Acesse a sala de aula</h1>
        <p className="mt-2 text-xs leading-relaxed text-[#2C3833]">
          A plataforma de ensino é externa ao Kyrub. O login, a matrícula, os certificados
          e os valores dos cursos ainda não estão integrados à sua conta Kyrub.
          A disponibilidade dos cursos deve ser conferida na sala de aula.
        </p>
        <a id="jemboe-kyrub-cursos-link" href={KYRUB_CURSOS_URL} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-xs font-black uppercase text-[#121A17] transition hover:bg-teal-400">
          Acessar Kyrub Cursos <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </section>
    </section>
  );
}
