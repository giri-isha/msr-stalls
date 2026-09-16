import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NotAuthorizedError, ValidationFailedError } from '../../errors';
import {
  AccountEmailTakenError,
  BankDetailsLockedError,
  CannotSetPasswordError,
  CategoryInUseError,
  CouponFullError,
  CustomFieldInUseError,
  DuplicatePaymentError,
  InvalidCredentialsError,
  InvalidTransitionError,
  LastAdminError,
  PersonAboveYouError,
  PersonEmailTakenError,
  PrivilegeEscalationError,
  RoleAboveYouError,
  RoleCycleError,
  ArchivedDeclarationError,
  BadDeclarationKeyError,
  DeclarationExistsError,
  DeclarationsChangedError,
  BuiltInFieldLockedError,
  ClaimAlreadyReviewedError,
  MissingRejectReasonError,
  StructuralFieldLockedError,
  UnauthorableFieldTypeError,
  BadFieldMediaError,
  BadFieldRuleError,
  BuiltInDecimalsError,
  FieldShapeChangeError,
  RoleInUseError,
  RoleKeyTakenError,
  UnknownDeclarationError,
  UnknownFormError,
  UnknownFormFieldError,
  UnknownRoleError,
  SystemRoleError,
  NoActiveEditionError,
  NothingToSendError,
  StallAlreadyAllocatedError,
  StallBlockedError,
  RefundAlreadySubmittedError,
  RequestTypeForbiddenError,
  ZoneForbiddenError,
  EditionForbiddenError,
  StepNotOpenError,
  TooManyStallsError,
  TooManyStallsRequestedError,
  UnknownAccessLinkError,
  UnknownAccountError,
  UnknownCouponError,
  UnknownPersonError,
  UnknownRequestError,
  UnknownStallError,
  UnknownTemplateError,
  SignatureProviderError,
  UnknownZoneError,
  UnknownEditionError,
  SameEditionCopyError,
  UploadsUnavailableError,
  WrongTemplateError,
  ZoneExistsError,
  ZoneInUseError,
} from './errors';
import { NotSignedInError } from './roles';

/** Domain error → status, in one place. A handler throws; this maps. Adding a
 *  condition means a class in `errors.ts` and a line here — never a status
 *  code constructed inside a route. */
function statusFor(err: unknown): number | null {
  if (err instanceof NotSignedInError) return 401;
  // Every way a requester's password login can fail. One status, one body —
  // see `InvalidCredentialsError`.
  if (err instanceof InvalidCredentialsError) return 401;
  // A role that reaches some requester types but not this one. 403, the same
  // as holding no grant at all — the caller may not, and which half of the
  // rule stopped them is not their business.
  // A role or an account that sits above the caller in the role hierarchy.
  // 403 like any other refusal: the caller may not, and the tree that stopped
  // them is explained in the message rather than in the status.
  if (
    err instanceof NotAuthorizedError ||
    err instanceof RequestTypeForbiddenError ||
    err instanceof ZoneForbiddenError ||
    err instanceof EditionForbiddenError ||
    err instanceof RoleAboveYouError ||
    err instanceof PersonAboveYouError ||
    err instanceof PrivilegeEscalationError
  ) {
    return 403;
  }
  if (
    err instanceof UnknownAccessLinkError ||
    err instanceof UnknownRequestError ||
    err instanceof UnknownStallError ||
    err instanceof UnknownZoneError ||
    err instanceof UnknownEditionError ||
    err instanceof UnknownPersonError ||
    err instanceof UnknownRoleError ||
    err instanceof UnknownDeclarationError ||
    err instanceof UnknownFormError ||
    err instanceof UnknownFormFieldError ||
    err instanceof UnknownAccountError ||
    err instanceof UnknownCouponError ||
    err instanceof UnknownTemplateError
  ) {
    return 404;
  }
  if (
    err instanceof StallAlreadyAllocatedError ||
    err instanceof StallBlockedError ||
    err instanceof InvalidTransitionError ||
    err instanceof LastAdminError ||
    err instanceof RoleKeyTakenError ||
    err instanceof RoleInUseError ||
    err instanceof DeclarationExistsError ||
    err instanceof ArchivedDeclarationError ||
    err instanceof DeclarationsChangedError ||
    err instanceof BuiltInFieldLockedError ||
    err instanceof StructuralFieldLockedError ||
    err instanceof ClaimAlreadyReviewedError ||
    err instanceof MissingRejectReasonError ||
    err instanceof SystemRoleError ||
    err instanceof RoleCycleError ||
    err instanceof CustomFieldInUseError ||
    err instanceof WrongTemplateError ||
    err instanceof CouponFullError ||
    err instanceof BankDetailsLockedError ||
    err instanceof StepNotOpenError ||
    err instanceof RefundAlreadySubmittedError ||
    err instanceof DuplicatePaymentError ||
    err instanceof NothingToSendError ||
    err instanceof AccountEmailTakenError ||
    err instanceof PersonEmailTakenError ||
    err instanceof CannotSetPasswordError ||
    // Configuration that cannot be applied because something already stands on
    // it. A 409 rather than a 500 so the Admin screen can say "this bay has
    // stalls planned against it" instead of showing an error page.
    err instanceof ZoneExistsError ||
    err instanceof ZoneInUseError ||
    err instanceof CategoryInUseError ||
    err instanceof SameEditionCopyError
  ) {
    return 409;
  }
  // A key the vocabulary will not take is a malformed request, not a conflict:
  // there is nothing on the server it collides with.
  if (err instanceof BadDeclarationKeyError) return 400;
  if (err instanceof UnauthorableFieldTypeError) return 400;
  if (err instanceof BadFieldMediaError) return 400;
  // A limit that cannot be met, or a retype the field's column cannot hold.
  // Malformed rather than conflicting: nothing on the server stands on it, the
  // rule simply does not describe a question anybody could answer.
  if (err instanceof BadFieldRuleError) return 400;
  if (err instanceof BuiltInDecimalsError) return 400;
  if (err instanceof FieldShapeChangeError) return 400;
  if (
    err instanceof TooManyStallsError ||
    err instanceof TooManyStallsRequestedError ||
    err instanceof ValidationFailedError
  ) {
    return 422;
  }
  // 503, not 500. "No provider is wired up in this environment" and "the
  // provider refused this document" are both conditions the caller can retry
  // once somebody configures or fixes the service — not a bug in the request.
  if (
    err instanceof NoActiveEditionError ||
    err instanceof UploadsUnavailableError ||
    err instanceof SignatureProviderError
  ) {
    return 503;
  }
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
