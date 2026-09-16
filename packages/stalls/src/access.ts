import { z } from 'zod';
import type { OnboardingStep } from './onboarding';
import { STALL_REQUEST_TYPES } from './reference';

/** How a vendor gets back in.
 *
 *  The requirement asks for "register & login (SSO) using email or phone
 *  number". There is no password and no OTP anywhere in this module — a
 *  submission mints a long signed link and the receipt email carries it — so
 *  "login" here means: prove you can read the mailbox or own the number the
 *  request was filed under, and a fresh link is sent to that mailbox.
 *
 *  This file is the pure half: what counts as a contact, and which outstanding
 *  steps a vendor can open for themselves. The lookup and the mail live in the
 *  API module.
 */

export type Contact =
  /** Normalised the same way `findOrCreateAccount` normalises it, so the
   *  lookup cannot miss an account over a capital letter. */
  | { kind: 'EMAIL'; value: string }
  /** Bare 10 digits, as `IndianMobile` stores them. */
  | { kind: 'MOBILE'; value: string };

/** `null` for anything that is neither — the caller answers "if we have a
 *  request under that, the link is on its way" either way, so a malformed
 *  contact must not be a different response from an unknown one. */
export function parseContact(raw: string): Contact | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const value = trimmed.toLowerCase();
    // Deliberately loose: the address either matches an account or it does
    // not, and a stricter pattern here would only reject addresses that the
    // form already accepted at submission time.
    return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value) ? { kind: 'EMAIL', value } : null;
  }

  const digits = trimmed.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? { kind: 'MOBILE', value: digits } : null;
}

/** The outstanding steps a vendor can act on alone, from their own portal.
 *
 *  PAYMENT is not here — money arrives by NEFT and Finance confirms it, so
 *  there is nothing for the vendor to open. STAFF_REGISTRATION is not here
 *  either: it is done by the vendor's team on a coupon the vendor forwards,
 *  not by the account holder on their own link. */
export const SELF_SERVE_STEPS = ['BANK_FORM', 'FSSAI'] as const;
export type SelfServeStep = (typeof SELF_SERVE_STEPS)[number];

export function isSelfServe(step: OnboardingStep): step is SelfServeStep {
  return (SELF_SERVE_STEPS as readonly string[]).includes(step);
}

/* ── The requester login ────────────────────────────────────────────────────
 *
 * ⚠️ TEMPORARY. A password stands in until the host's Isha OIDC arrives — see
 * `docs/superpowers/specs/2026-09-15-stalls-vendor-login-design.md`. Everything
 * below is written to be deleted rather than grown.
 */

/** 8 is a floor, not a policy. A rule demanding a symbol and a digit would
 *  outlive the mechanism it protects and buy nothing the floor does not. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Which of the three forms an account is registered against.
 *
 * 🔴 Asked at registration, and it is what the account may FILL. A trader, a
 * village welfare requester and an ashram department are three different
 * populations asked three different sets of questions, priced off three
 * different rate scopes; an account that could open any of the three forms
 * could file itself as whichever one it liked, and the scope a request is
 * quoted at is not a thing a requester chooses.
 *
 * ⚠️ Built from `STALL_REQUEST_TYPES` rather than reusing `RequestType` in
 * `contracts.ts`, which imports THIS file — `contracts` may depend on `access`
 * and not the other way round. Both read the same list, so they cannot
 * disagree about what the three are.
 */
export const RequesterTypeValue = z.enum(STALL_REQUEST_TYPES);
export type RequesterTypeValue = z.infer<typeof RequesterTypeValue>;

export const RegisterInput = z.object({
  contact: z.string().min(1).max(254),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  displayName: z.string().min(1).max(160),
  /** ⚠️ Required. An account with no type is a legacy row — see
   *  `RequesterSession.requesterType` — never one this route creates. */
  requesterType: RequesterTypeValue,
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  contact: z.string().min(1).max(254),
  /** No minimum. A short password is a failed login, not a validation error —
   *  a 400 here would tell a caller their guess was too short to be anyone's,
   *  which is one bit more than the login route is willing to say. */
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const PasswordResetInput = z.object({ contact: z.string().min(1).max(254) });
export type PasswordResetInput = z.infer<typeof PasswordResetInput>;

export const PasswordResetConfirmInput = z.object({
  token: z.string().min(16).max(128),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});
export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmInput>;

/**
 * A password the BACKOFFICE chooses for a requester, over the phone.
 *
 * ⚠️ The one place in the module where a way in is handed to somebody other
 * than the account holder, and it is deliberate: the vendor on the phone who
 * cannot follow a link being read out to them is real, and until Isha SSO
 * arrives the alternative is that they never get in. It is gated by its own
 * `passwords.write`, never by `users.write` — see the note on that privilege —
 * and every use is written to the activity trail with the actor.
 *
 * ⚠️ It goes with the rest of the password login. When the host signs
 * requesters in, there is no password here for anyone to set.
 */
export const SetRequesterPasswordInput = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});
export type SetRequesterPasswordInput = z.infer<typeof SetRequesterPasswordInput>;

/** Who is logged in on the public side.
 *
 *  ⚠️ NOT `MeResponse`. That is the BACKOFFICE session and it answers `can()` about
 *  roles a requester will never hold. Conflating the two is how a requester
 *  ends up being asked what they are allowed to do. */
export interface RequesterSession {
  accountId: string;
  displayName: string;
  /**
   * Which form this account may fill — the one thing on this session that
   * changes what the apply page offers.
   *
   * 🔴 Null only for an account that pre-dates the question and has never
   * filed anything. Where such an account HAS filed, the type of what it filed
   * is the answer — the account came in through that form, so that is what it
   * is — and the API resolves that before this leaves the route. A page reading
   * null therefore means "nothing has decided yet", which is the one case where
   * all three forms are offered.
   */
  requesterType: RequesterTypeValue | null;
  /** Empty when the account was registered on a mobile and has no real
   *  address — the column holds a placeholder and nothing sends to it. */
  email: string;
  phone: string;
}

/**
 * The domain an account registered on a mobile number carries instead of an
 * address.
 *
 * `StallAccount.email` is non-null and unique, and a village trader
 * registering on a number has no address. A namespaced placeholder keeps the
 * column honest without pretending it is reachable — `.invalid` is reserved by
 * RFC 2606 precisely so it can never resolve.
 *
 * ⚠️ Here rather than in the API module because BOTH sides need it: the API to
 * decide it must not send mail there, and the Users screen to name the contact
 * a support action will actually reach. A second copy of this string on the
 * web is how a screen comes to promise a letter to an address nothing delivers.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'stalls.invalid';

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
