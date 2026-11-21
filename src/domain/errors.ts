/**
 * The ONLY place that turns a failure into something the UI may show.
 * Rule (docs/security.md section 8): users never see codes, SQL, stack traces or raw
 * messages. Every failure becomes a known ErrorCode, and the UI shows the
 * translated sentence for `err.<CODE>` plus a next action.
 */
export const ERROR_CODES = [
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'INVALID_TRANSITION',
  'OVERPAYMENT',
  'RATE_LIMITED',
  'SESSION_EXPIRED',
  'OFFLINE',
  'AI_UNAVAILABLE',
  'UNKNOWN',
  'LIMIT_EXCEEDED',
  'DUPLICATE',
  'INVALID_CODE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN = new Set<string>(ERROR_CODES);

export interface TranslatedError {
  code: ErrorCode;
  /** i18n key for the user-facing sentence. */
  messageKey: `err.${ErrorCode}`;
  /** Whether trying again later can help (network, rate limit, server hiccup). */
  transient: boolean;
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
}

function asObject(e: unknown): ErrorLike {
  return typeof e === 'object' && e !== null ? (e as ErrorLike) : {};
}

export function codeFromParts(e: unknown): ErrorCode {
  const o = asObject(e);
  const message = typeof o.message === 'string' ? o.message.trim() : '';
  const dbCode = typeof o.code === 'string' ? o.code : '';
  const status = typeof o.status === 'number' ? o.status : 0;

  // 1. Coded errors raised by RPC functions: message is exactly the code.
  if (KNOWN.has(message)) return message as ErrorCode;

  // 2. Network failures.
  if (
    o.name === 'TypeError' ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/i.test(message)
  ) {
    return 'OFFLINE';
  }

  // 3. HTTP status.
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'UNKNOWN';

  // 4. Postgres / PostgREST SQLSTATE codes.
  if (dbCode === '42501') return 'FORBIDDEN';
  if (dbCode === '23505') return 'DUPLICATE';
  if (dbCode === '23514' || dbCode === '22P02' || dbCode === '23502' || dbCode === '22003' || dbCode === '22023') {
    return 'VALIDATION';
  }
  if (dbCode === '23503' || dbCode === 'PGRST116') return 'NOT_FOUND';
  if (dbCode === 'PGRST301' || dbCode === 'PGRST303') return 'SESSION_EXPIRED';

  return 'UNKNOWN';
}

const TRANSIENT: ReadonlySet<ErrorCode> = new Set(['OFFLINE', 'RATE_LIMITED', 'UNKNOWN', 'AI_UNAVAILABLE']);

export function translateError(e: unknown): TranslatedError {
  const code = codeFromParts(e);
  return { code, messageKey: `err.${code}`, transient: TRANSIENT.has(code) };
}

export function isTransient(code: ErrorCode): boolean {
  return TRANSIENT.has(code);
}
