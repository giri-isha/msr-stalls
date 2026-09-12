import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NotAuthorizedError, ValidationFailedError } from '../../errors';
import {
  AlreadyConfirmedError,
  AlreadySentError,
  CustomFieldInUseError,
  InvalidTransitionError,
  LastAdminError,
  NoActiveEditionError,
  NoPaymentError,
  NotIssuedError,
  NotSelectedError,
  StallAlreadyAllocatedError,
  StallBlockedError,
  TooManyStallsError,
  UnknownAccessLinkError,
  UnknownPersonError,
  UnknownRequestError,
  UnknownStallError,
  UnknownZoneError,
  UploadsUnavailableError,
} from './errors';
import { NotSignedInError } from './roles';

/** Domain error → status, in one place. A handler throws; this maps. Adding a
 *  condition means a class in `errors.ts` and a line here — never a status
 *  code constructed inside a route. */
function statusFor(err: unknown): number | null {
  if (err instanceof NotSignedInError) return 401;
  if (err instanceof NotAuthorizedError) return 403;
  if (
    err instanceof UnknownAccessLinkError ||
    err instanceof UnknownRequestError ||
    err instanceof UnknownStallError ||
    err instanceof UnknownZoneError ||
    err instanceof UnknownPersonError
  ) {
    return 404;
  }
  if (
    err instanceof StallAlreadyAllocatedError ||
    err instanceof StallBlockedError ||
    err instanceof InvalidTransitionError ||
    err instanceof LastAdminError ||
    err instanceof CustomFieldInUseError ||
    err instanceof AlreadySentError ||
    err instanceof NotSelectedError ||
    err instanceof NoPaymentError ||
    err instanceof AlreadyConfirmedError ||
    err instanceof NotIssuedError
  ) {
    return 409;
  }
  if (err instanceof TooManyStallsError || err instanceof ValidationFailedError) return 422;
  if (err instanceof NoActiveEditionError || err instanceof UploadsUnavailableError) return 503;
  return null;
}

export function stallsErrorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  const status = statusFor(err);
  if (status !== null) {
    const body: Record<string, unknown> = { error: err.message };
    if (err instanceof ValidationFailedError) body.violations = err.violations;
    void reply.status(status).send(body);
    return;
  }
  // Zod's 400s and Fastify's own 4xx (rate limit, payload too large) carry a
  // statusCode; pass them through with their message. Everything else is a
  // 500 and its message stays in the log, not the response.
  const code = (err as FastifyError).statusCode;
  if (code && code >= 400 && code < 500) {
    void reply.status(code).send({ error: err.message });
    return;
  }
  req.log.error({ err }, 'unhandled error in stalls module');
  void reply.status(500).send({ error: 'internal error' });
}

export function useStallsErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(stallsErrorHandler);
}
