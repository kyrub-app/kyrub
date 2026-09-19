import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { reviewAttendanceOrderAuthoritatively } from './attendanceReviewService.js';

type AttendanceReviewExecutionHttpResult = {
  status: number;
  body: unknown;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapAttendanceReviewExecutionError = (
  error: unknown
): AttendanceReviewExecutionHttpResult => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? clean((error as { code?: unknown }).code)
    : '';

  if (code === 'AUTH_REQUIRED' || /sessão|token|auth|id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.' } };
  }
  if (/não encontrado/i.test(message)) {
    return { status: 404, body: { error: message } };
  }
  if (/não está mais aguardando revisão|mudou desde que foi aberta|Mantenha ao menos um item/i.test(message)) {
    return {
      status: 409,
      body: { error: message, code: 'ATTENDANCE_REVIEW_STALE' },
    };
  }
  if (/inválid|explique|identificado|Revise os dados|Revise os itens|Revise as quantidades|itens demais/i.test(message)) {
    return { status: 400, body: { error: message } };
  }

  console.error('[Attendance Review Execution]', error);
  return {
    status: 503,
    body: {
      error: message || 'Não foi possível revisar o pedido de autoatendimento.',
    },
  };
};

export const executeAuthorizedAttendanceReview = async (
  authorization: string,
  body: unknown
): Promise<AttendanceReviewExecutionHttpResult> => {
  try {
    const token = bearerToken(authorization);
    if (!token) throw new Error('AUTH_REQUIRED');
    const identity = await verifyFirebaseIdToken(token);
    const candidate = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const orderId = clean(candidate.orderId);
    if (!orderId || orderId.length > 240 || orderId.includes('/')) {
      throw new Error('Pedido não identificado.');
    }

    const result = await reviewAttendanceOrderAuthoritatively(
      identity.uid,
      orderId,
      candidate
    );
    return { status: 200, body: result };
  } catch (error) {
    return mapAttendanceReviewExecutionError(error);
  }
};
