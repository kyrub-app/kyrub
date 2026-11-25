import type { PublicLegalDocument } from '../../server/governance/publicLegalDocumentPolicy';

/** Candidate view; mount only with a trusted published-only server response.
 * Render plain text, not arbitrary HTML. No draft fallback or fake acceptance. */
export function PublishedLegalDocumentPage({type, document}: {
  type: 'terms' | 'privacy'; document: PublicLegalDocument | null;
}) {
  const title = type === 'terms' ? 'Termos de Uso' : 'Política de Privacidade';
  const available = document?.type === type && Boolean(document.content.trim());
  return <main className="mx-auto max-w-3xl space-y-4 p-5 text-sm">
    <h1 className="text-base font-semibold">{title}</h1>
    {available && document ? <>
      <p>Versão {document.version} · Publicado em {new Date(document.publishedAt).toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'})}</p>
      <article className="whitespace-pre-wrap break-words leading-relaxed">{document.content}</article>
    </> : <p role="status">Não há uma versão publicada disponível para consulta neste momento.</p>}
    <a className="underline" href="/">Voltar ao Kyrub</a>
  </main>;
}
