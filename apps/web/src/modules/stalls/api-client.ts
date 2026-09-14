/** One fetch wrapper. Same-origin, cookies on, JSON in and out, and every
 *  non-2xx becomes an `ApiError` carrying the status and the server's message —
 *  so a screen can tell a 401 (sign in) from a 403 (not allowed) from a 409
 *  (someone got there first) without parsing text. */

export interface FieldViolation {
  row: number;
  fieldKey: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly violations: FieldViolation[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiInit extends Omit<RequestInit, 'body'> {
  json?: unknown;
}

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      accept: 'application/json',
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; violations?: FieldViolation[] };
    throw new ApiError(res.status, b.error ?? b.message ?? res.statusText, b.violations ?? []);
  }
  return body as T;
}

/** Zod's 400 arrives as one string: `contactNumber: expected …; email: …`.
 *  Split it back into a per-field map so a form can mark the right inputs. */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const v of err.violations) out[v.fieldKey] = v.message;
  if (err.status === 400) {
    for (const part of err.message.split('; ')) {
      const i = part.indexOf(': ');
      if (i > 0) out[part.slice(0, i)] = part.slice(i + 2);
    }
  }
  return out;
}
