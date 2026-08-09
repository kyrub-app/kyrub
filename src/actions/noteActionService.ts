import type { User } from 'firebase/auth';
import type {
  KyrubActionExecutionResult,
  KyrubAiCreateNoteProposal,
} from '../../shared/kyrubActions';

const SAFE_ACTION_ENDPOINT = '/api/action-execute';

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const executionErrorMessage = (
  body: Record<string, unknown>,
  fallback: string
): string => typeof body.error === 'string' && body.error.trim()
  ? body.error.trim()
  : fallback;

const unstructuredExecutionErrorMessage = (response: Response): string => {
  if (response.status === 404) {
    return 'O endpoint do executor seguro não foi encontrado neste ambiente (HTTP 404).';
  }
  if (response.status >= 500) {
    return `O executor seguro falhou antes de devolver um diagnóstico estruturado (HTTP ${response.status}).`;
  }
  return `O executor seguro respondeu sem um diagnóstico estruturado (HTTP ${response.status}).`;
};

export const executeConfirmedCreateNoteAction = async (
  user: User,
  proposal: KyrubAiCreateNoteProposal
): Promise<KyrubActionExecutionResult> => {
  let token = '';
  try {
    // A confirmed mutation requests a freshly issued Firebase ID token instead
    // of reusing a cached bearer token from an older app session.
    token = await user.getIdToken(true);
  } catch {
    throw new Error(
      'Não foi possível validar sua sessão. Entre novamente antes de confirmar a nota.'
    );
  }

  let response: Response;
  try {
    response = await fetch(SAFE_ACTION_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        confirmed: true,
        proposal,
      }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(
      'Não foi possível conectar ao executor seguro do Kyrub. Tente novamente.'
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      executionErrorMessage(
        body,
        unstructuredExecutionErrorMessage(response)
      )
    );
  }

  if (
    typeof body.actionId !== 'string' ||
    body.type !== 'create_note' ||
    (body.status !== 'success' && body.status !== 'already_applied') ||
    typeof body.entityId !== 'string' ||
    typeof body.origin !== 'string' ||
    typeof body.idempotencyKey !== 'string'
  ) {
    throw new Error(
      `O executor seguro respondeu sem um recibo de execução válido (HTTP ${response.status}).`
    );
  }

  return body as unknown as KyrubActionExecutionResult;
};
