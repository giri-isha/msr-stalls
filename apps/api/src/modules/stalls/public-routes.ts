// The module's ENTIRE unauthenticated surface. Everything a person without a
// session can reach lives in this file and nowhere else, so the boundary is one
// screen to review.
//
// Every route here is gated by one of exactly three credentials:
//
//   • a signed access LINK  — status page, bank form, FSSAI upload. The token
//     names the request; nothing in a body ever does, so holding one link can
//     never write to another vendor's record.
//   • a staff COUPON        — staff registration. Same rule: the coupon names
//     the stall.
//   • a requester SESSION   — the stall request form, the submission behind it,
//     and that account's own requests read back. A password today, the host's
//     Isha OIDC when it lands; `session.ts` is the seam and no route here knows
//     which it was.
//
// The status LINK and the SESSION are two credentials onto one portal, not two
// portals: both end in `statusView` and `stepLink`, which take an account and
// have never known which of the two named it.
//
// Four routes take no credential: `GET /config`, which is the public form's own
// configuration and contains no vendor data; `POST /access-link`; `POST
// /register`; and `POST /password-reset`. The last three read nothing back to
// the caller and answer identically to a hit, a miss and a malformed contact —
// anything else would make them a way of asking whether a particular person has
// applied. All are rate-limited per IP.
//
// ⚠️ `POST /requests` used to be in that list. It is not any more: the account a
// request belongs to now comes from the session rather than from the email typed
// into the form.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type BankFormView,
  type ContinueStepResponse,
  type CouponView,
  type FssaiFormView,
  type PublicStatusResponse,
  type RequestAccessLinkResponse,
  type RequestCouponResponse,
  ContinueStepInput,
  PresignUploadInput,
  RATE_SCOPES,
  LoginInput,
  PasswordResetConfirmInput,
  PasswordResetInput,
  RegisterInput,
  RegisterStaffInput,
  RequestAccessLinkInput,
  RequestCouponInput,
  type SubmitRequestResponse,
  type PaymentClaimView,
  SubmitBankDetailsInput,
  SubmitPaymentClaimInput,
  SubmitFssaiInput,
  SubmitRequestInput,
  isPlaceholderEmail,
} from '@msr/stalls';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import { resolveAccessLink } from './accounts';
import { getBankForm, submitBankDetails } from './bank';
import { declarationsForForm } from './declarations';
import { submitPaymentClaim } from './payment-claims';
import { publicFormFor } from './form-builder';
import { getPublicConfig } from './config';
import type { StallsDeps } from './deps';
import { UnknownAccessLinkError } from './errors';
import { registerStaff, resolveCoupon, submitFssai, toCouponView } from './onboarding';
import { authenticate } from './credentials';
import { completePasswordReset, register, requestPasswordReset } from './registration';
import {
  REQUESTER_COOKIE,
  clearSessionCookie,
  endSession,
  requireRequester,
  setSessionCookie,
  startSession,
} from './session';
import { couponFor, sendAccessLink, statusView, stepLink } from './portal';
import { submitRequest } from './submit';
import { isOurKey, presignUpload } from './uploads';

const TokenParams = z.object({ token: z.string().min(16).max(128) });

const PublicConfigQuery = z.object({
  scope: z.enum(RATE_SCOPES).default('VENDOR'),
});

export function registerStallsPublicRoutes(app: FastifyInstance, deps: StallsDeps): void {
  const zod = app.withTypeProvider<ZodTypeProvider>();

  /** What the form needs to render. No backoffice data.
   *
   *  ⚠️ `scope` is not optional decoration. The same bay is priced differently
   *  for trade and for local welfare, and A3 and B2 are priced for one and
   *  closed to the other — so "the rent for this zone" cannot be answered
   *  without knowing which form is asking. Defaulting silently to VENDOR is
   *  what quoted a village trader the trade rent and told them the two bays
   *  they are most likely to want were unavailable. */
  zod.get('/config', { schema: { querystring: PublicConfigQuery } }, async (req) =>
    getPublicConfig(prisma, req.query.scope),
  );

  /** Registration.
   *
   *  ⚠️ 202 `{ ok: true }` for a free contact, for one that already has an
   *  account, and for a string that is not a contact at all. Only the second
   *  sends anything, and it sends to the contact the ACCOUNT already held —
   *  see `registration.ts`. A route that answered "that number is already
   *  registered" would be a way of asking whether a particular shopkeeper had
   *  applied.
   *
   *  ⚠️ The credential this creates works immediately, but the caller is NOT
   *  signed in: a response that started a session would distinguish the free
   *  contact from the taken one, which is the one thing this route may not do.
   *  They log in on the next screen. */
  zod.post(
    '/register',
    {
      schema: { body: RegisterInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await register(prisma, deps, req.body);
      reply.status(202);
      return { ok: true };
    },
  );

  /** ⚠️ One 401 for every way this fails — see `InvalidCredentialsError`. The
   *  route does not know which half was wrong and must not learn. */
  zod.post(
    '/login',
    {
      schema: { body: LoginInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const cred = await authenticate(prisma, req.body);
      setSessionCookie(reply, await startSession(prisma, cred.accountId));
      return { ok: true };
    },
  );

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[REQUESTER_COOKIE];
    if (token) await endSession(prisma, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  /** Who is logged in, for a page that has to render either way.
   *
   *  ⚠️ 404 rather than 401 with no session. The apply page asks this on every
   *  render and is public; a 401 would tell the browser it must authenticate
   *  to read a form that anyone may read. */
  app.get('/session', async (req, reply) => {
    const account = await requireRequester(prisma, req).catch(() => null);
    if (!account) return reply.status(404).send({ error: 'no session' });
    return {
      accountId: account.id,
      displayName: account.displayName,
      // A placeholder address is not an address. Reporting it would put
      // `mobile+9840012399@stalls.invalid` in a form field a vendor then has
      // to clear by hand.
      email: isPlaceholderEmail(account.email) ? '' : account.email,
      phone: account.phone,
    };
  });

  /** ⚠️ 202 whatever happens, for the same reason `/register` does. Exactly one
   *  message goes out — to the contact that has an account behind it. */
  zod.post(
    '/password-reset',
    {
      schema: { body: PasswordResetInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await requestPasswordReset(prisma, deps, req.body.contact);
      reply.status(202);
      return { ok: true };
    },
  );

  zod.post(
    '/password-reset/confirm',
    {
      schema: { body: PasswordResetConfirmInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { accountId } = await completePasswordReset(prisma, req.body.token, req.body.password);
      setSessionCookie(reply, await startSession(prisma, accountId));
      return { ok: true };
    },
  );

  /** The one public write. Per-IP rate limit on top of the global one: a
   *  script cannot fill the pipeline with junk, and a real vendor never hits
   *  the cap. Strict Zod; nothing in the body reaches status, stage or money. */
  zod.post(
    '/requests',
    {
      schema: { body: SubmitRequestInput },
      config: {
        rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' },
      },
    },
    async (req, reply): Promise<SubmitRequestResponse> => {
      const requester = await requireRequester(prisma, req);
      const { reference, statusToken } = await submitRequest(
        prisma,
        req.body,
        { mail: deps.mail, whatsapp: deps.whatsapp, statusUrl: deps.statusUrl },
        requester.id,
      );
      reply.status(201);
      return { reference, statusToken };
    },
  );

  /** That vendor's own requests, and nothing else. A wrong token is a 404 —
   *  never a 403, which would confirm the token exists. Fields backoffice use
   *  internally (flag reason, reject reason, notes) are not here. */
  zod.get(
    '/status/:token',
    { schema: { params: TokenParams } },
    async (req): Promise<PublicStatusResponse> => {
      const link = await resolveAccessLink(prisma, req.params.token, 'STATUS');
      return statusView(prisma, link.account);
    },
  );

  /** The same view, for a requester who is logged in.
   *
   *  ⚠️ `statusView`, not a second opinion about what a request owes. The
   *  emailed link and the session are two credentials onto ONE portal; a page
   *  that answered this question for itself is how a vendor gets told they are
   *  all set here and stopped at the counter.
   *
   *  404 with no session, matching the link routes beside it — a requester who
   *  is signed out and one holding a token of the wrong purpose learn the same
   *  nothing. */
  app.get('/requests', async (req): Promise<PublicStatusResponse> => {
    const account = await requireRequester(prisma, req);
    return statusView(prisma, account);
  });

  /** "I applied but I cannot find the email." The requirement's register-and-
   *  login by email or phone number, in a module that has no passwords: the
   *  link goes to the account, never to the caller.
   *
   *  Always 202 with the same body — a different response for an unknown
   *  contact would make this a way to ask whether somebody applied. */
  zod.post(
    '/access-link',
    {
      schema: { body: RequestAccessLinkInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply): Promise<RequestAccessLinkResponse> => {
      await sendAccessLink(prisma, deps, req.body.contact);
      reply.status(202);
      return { ok: true };
    },
  );

  /** Opens an outstanding step from the vendor's own portal — the way back to
   *  the bank form or the FSSAI upload for a vendor who no longer has the
   *  letter that first carried it. The status link is the credential; the
   *  reference only picks which of that account's requests is meant. */
  zod.post(
    '/status/:token/continue',
    {
      schema: { params: TokenParams, body: ContinueStepInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req): Promise<ContinueStepResponse> => {
      const link = await resolveAccessLink(prisma, req.params.token, 'STATUS');
      return stepLink(prisma, deps, link.accountId, req.body);
    },
  );

  /** The same step, opened from the logged-in list rather than from the letter.
   *
   *  The session is the credential and `reference` only picks which of that
   *  account's requests is meant — so a reference belonging to somebody else
   *  404s exactly as one that never existed does, and a step that is not
   *  outstanding is a 409 rather than a link. */
  zod.post(
    '/requests/continue',
    {
      schema: { body: ContinueStepInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req): Promise<ContinueStepResponse> => {
      const account = await requireRequester(prisma, req);
      return stepLink(prisma, deps, account.id, req.body);
    },
  );

  /** What a requester says they transferred.
   *
   *  🔴 A CLAIM, not a receipt. It lands PENDING and moves nothing: the stage
   *  advances when finance verifies it and the payment record is written. A
   *  stage that moved on submission would tell the backoffice list a stall had
   *  paid because the stall said so.
   *
   *  This replaces "please send transfer details on E-mail IDs
   *  finance.support@… once you make the payment" — a mailbox, matched by hand.
   *
   *  ⚠️ The SESSION is the credential and `reference` only picks which of that
   *  account's requests is meant, exactly as `/requests/continue` does. */
  zod.post(
    '/requests/payment-claim',
    {
      schema: { body: SubmitPaymentClaimInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req): Promise<PaymentClaimView> => {
      const account = await requireRequester(prisma, req);
      const request = await prisma.stallRequest.findFirst({
        where: { accountId: account.id, reference: req.body.reference },
        select: { id: true },
      });
      if (!request) throw new UnknownAccessLinkError();
      return submitPaymentClaim(prisma, request.id, req.body);
    },
  );

  /** The staff coupon, asked for by the vendor rather than waited on.
   *
   *  🔴 Until this existed, a coupon arrived only when a backoffice member
   *  pressed Issue Coupon or sent the FSSAI-and-staff letter — so a vendor who
   *  never got that letter could not register their team at all, and staff
   *  registration is the one step that is never skipped, because an
   *  unregistered person cannot be let onto the venue.
   *
   *  Idempotent: pressing it twice, or pressing it after the letter went out,
   *  returns the code already in hand. See `couponFor`. */
  zod.post(
    '/status/:token/coupon',
    {
      schema: { params: TokenParams, body: RequestCouponInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req): Promise<RequestCouponResponse> => {
      const link = await resolveAccessLink(prisma, req.params.token, 'STATUS');
      return couponFor(prisma, link.accountId, req.body);
    },
  );

  /** The same coupon, asked for from the logged-in list rather than the letter. */
  zod.post(
    '/requests/coupon',
    {
      schema: { body: RequestCouponInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req): Promise<RequestCouponResponse> => {
      const account = await requireRequester(prisma, req);
      return couponFor(prisma, account.id, req.body);
    },
  );

  // ── Uploads ───────────────────────────────────────────────────────────────

  /** Presigns a PUT for a vendor holding a live bank-form or FSSAI link.
   *
   *  The link is what authorises the upload, and the purpose must match what
   *  that link is for — a FSSAI link cannot presign a cheque. Keys are minted
   *  by `presignUpload` from a UUID, never from the vendor's filename, so
   *  nothing a person types reaches a path. */
  zod.post(
    '/uploads/:token',
    {
      schema: { params: TokenParams, body: PresignUploadInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req) => {
      const purpose = req.body.purpose;
      if (purpose === 'TEMPLATE_ATTACHMENT') throw new UnknownAccessLinkError();
      const linkPurpose = purpose === 'FSSAI' ? 'FSSAI_UPLOAD' : 'BANK_FORM';
      await resolveAccessLink(prisma, req.params.token, linkPurpose);
      return presignUpload(deps.files, req.body);
    },
  );

  // ── Bank details and requirements (vendors only) ──────────────────────────

  zod.get(
    '/bank/:token',
    { schema: { params: TokenParams } },
    async (req): Promise<BankFormView> => {
      const link = await resolveAccessLink(prisma, req.params.token, 'BANK_FORM');
      if (!link.requestId) throw new UnknownAccessLinkError();
      return getBankForm(prisma, link.requestId);
    },
  );

  zod.post(
    '/bank/:token',
    {
      schema: { params: TokenParams, body: SubmitBankDetailsInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const link = await resolveAccessLink(prisma, req.params.token, 'BANK_FORM');
      if (!link.requestId) throw new UnknownAccessLinkError();
      await submitBankDetails(prisma, link.requestId, req.body);
      reply.status(204);
    },
  );

  // ── FSSAI certificate ─────────────────────────────────────────────────────

  zod.get(
    '/fssai/:token',
    { schema: { params: TokenParams } },
    async (req): Promise<FssaiFormView> => {
      const link = await resolveAccessLink(prisma, req.params.token, 'FSSAI_UPLOAD');
      if (!link.requestId) throw new UnknownAccessLinkError();
      const r = await prisma.stallRequest.findUnique({
        where: { id: link.requestId },
        include: { fssai: { include: { files: true } } },
      });
      if (!r) throw new UnknownAccessLinkError();
      const [form, declarations] = await Promise.all([
        publicFormFor(prisma, r.editionId, 'FSSAI'),
        declarationsForForm(prisma, r.editionId, 'FSSAI'),
      ]);
      return {
        form,
        declarations,
        reference: r.reference,
        stallName: r.stallName,
        requesterName: r.requesterName,
        uploadedAt: r.fssai?.submittedAt.toISOString() ?? null,
        verifiedAt: r.fssai?.verifiedAt?.toISOString() ?? null,
        files: (r.fssai?.files ?? []).map((f) => ({
          name: f.fileName,
          uploadedAt: f.uploadedAt.toISOString(),
        })),
      };
    },
  );

  zod.post(
    '/fssai/:token',
    {
      schema: { params: TokenParams, body: SubmitFssaiInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const link = await resolveAccessLink(prisma, req.params.token, 'FSSAI_UPLOAD');
      if (!link.requestId) throw new UnknownAccessLinkError();
      // Same rule as the bank form: a key the browser sends back must be one
      // this module handed out, for this purpose.
      if (!req.body.files.every((f) => isOurKey(f.key, 'FSSAI'))) {
        throw new UnknownAccessLinkError();
      }
      await submitFssai(prisma, link.requestId, req.body);
      reply.status(204);
    },
  );

  // ── Staff registration (coupon-gated) ─────────────────────────────────────

  zod.get(
    '/staff-registration/:code',
    { schema: { params: z.object({ code: z.string().trim().min(6).max(40) }) } },
    async (req): Promise<CouponView> => {
      const { request, coupon } = await resolveCoupon(prisma, req.params.code);
      // ⚠️ Scoped to the code that was typed. A stall can hold more than one,
      // and the team holding a caterer's code is not shown the vendor's roster.
      return toCouponView(prisma, request, coupon);
    },
  );

  zod.post(
    '/staff-registration',
    {
      schema: { body: RegisterStaffInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply): Promise<CouponView> => {
      reply.status(201);
      return registerStaff(prisma, req.body);
    },
  );
}
