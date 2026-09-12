// FOUNDATION STUB — the subset of msr-app-replit/apps/api/src/errors.ts that
// the stalls module imports. Signatures match the host's exactly. Discarded at
// migration; the module's own errors live in modules/stalls/errors.ts.

/** The caller is not permitted to perform a write. The write path stays closed;
 *  mapped to 403. The message names the specific check that failed. */
export class NotAuthorizedError extends Error {
  constructor(message = 'caller is not authorized for this action') {
    super(message);
    this.name = 'NotAuthorizedError';
  }
}

/** One bad field. In the host this is published by `@msr/shared`; the shape is
 *  identical here so the web client's field-error rendering is the same code. */
export interface FieldViolation {
  row: number;
  fieldKey: string;
  message: string;
}

/** A save rejected by validation rules. Carries EVERY violation, not the first:
 *  a person fixing a form wants the whole list at once, not one error per
 *  round-trip. Mapped to 422 — the request was well-formed, its contents were
 *  not. */
export class ValidationFailedError extends Error {
  constructor(readonly violations: FieldViolation[]) {
    super(`${violations.length} field violation(s)`);
    this.name = 'ValidationFailedError';
  }
}
