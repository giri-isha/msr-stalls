import type { OnboardingStep } from './onboarding';

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
