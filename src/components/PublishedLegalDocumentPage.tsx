import { useEffect, useState } from 'react';
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

/** Public, read-only consultation. No acceptance is inferred from viewing. */
export function PublicLegalDocumentRoute({type}: {type: 'terms' | 'privacy'}) {
  const [document, setDocument] = useState<PublicLegalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDocument(null); setLoading(true); setFailed(false);
    void fetch('/api/legal-documents/' + type, {signal: controller.signal, cache: 'no-store', credentials: 'omit'})
      .then(async response => {
        if (!response.ok) throw Error('LEGAL_DOCUMENT_UNAVAILABLE');
        const payload = await response.json() as {document: PublicLegalDocument | null};
        if (payload.document !== null && (payload.document?.type !== type ||
          typeof payload.document.content !== 'string' || !payload.document.content.trim() ||
          typeof payload.document.version !== 'string' || !Number.isFinite(Date.parse(payload.document.publishedAt))))
          throw Error('LEGAL_DOCUMENT_INVALID');
        if (!controller.signal.aborted) setDocument(payload.document);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [type, retry]);
  return <div className="min-h-screen bg-slate-950 text-slate-100">
    {loading ? <p role="status" className="p-5 text-sm">Carregando documento…</p> :
      failed ? <main className="mx-auto max-w-3xl space-y-4 p-5 text-sm">
        <h1 className="text-base font-semibold">{type === 'terms' ? 'Termos de Uso' : 'Política de Privacidade'}</h1>
        <p role="status">Não foi possível consultar o documento.</p>
        <button type="button" className="underline" onClick={() => setRetry(v => v + 1)}>Tentar novamente</button>
        <a href="/" className="block underline">Voltar ao Kyrub</a>
      </main> : <PublishedLegalDocumentPage type={type} document={document} />}
  </div>;
}
