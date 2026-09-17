// The audit vocabulary: every action the module records, with the words a
// reader sees for it, and the wire shapes the two audit screens read.
//
// 🔴 The vocabulary is TYPED. `audit()` on the API takes `AuditAction`, so an
// action nobody labelled does not compile — the same trick `STALL_PRIVILEGES`
// plays with `requirePrivilege`. A row written under a name this file does not
// know cannot happen from the module's own code, and the two screens can rely
// on `describeAuditAction` having a real answer for every row they draw.
import { z } from 'zod';

export const AUDIT_ACTOR_KINDS = ['BACKOFFICE', 'REQUESTER', 'SYSTEM'] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

/** Where the action came from. `PORTAL` is the requester's own side (a signed
 *  link, a coupon or a session); `BACKOFFICE` is a signed-in member; `SYSTEM`
 *  is the seed, a decorator or a job with nobody at a keyboard. */
export const AUDIT_CHANNELS = ['BACKOFFICE', 'PORTAL', 'SYSTEM'] as const;
export type AuditChannel = (typeof AUDIT_CHANNELS)[number];

export const AUDIT_OUTCOMES = ['OK', 'FAILED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** The seed's and the tests' "nobody in particular". `actorFrom(by)` on the
 *  API reads it as the SYSTEM actor. */
export const SYSTEM_ACTOR_REF = '00000000-0000-0000-0000-000000000000';

export const AUDIT_FAMILIES = [
  'request',
  'selection',
  'allocation',
  'form',
  'money',
  'comms',
  'onboarding',
  'checkin',
  'equipment',
  'config',
  'access',
  'account',
  'session',
  'outbound',
  'other',
] as const;
export type AuditFamily = (typeof AUDIT_FAMILIES)[number];

export type AuditTone = 'neutral' | 'ok' | 'des' | 'warn' | 'info' | 'violet' | 'teal';

export interface AuditActionInfo {
  label: string;
  family: AuditFamily;
  /** A name from the web's `ui/icons` registry. An unknown name draws a dot. */
  glyph: string;
  tone: AuditTone;
}

const info = (label: string, family: AuditFamily, glyph: string, tone: AuditTone) =>
  ({ label, family, glyph, tone }) satisfies AuditActionInfo;

/** Every action, with its words.
 *
 *  ⚠️ `stall_request.submitted` is the STATUS TRANSITION back to SUBMITTED
 *  (unshortlist), because `selection.ts` names transitions after the status
 *  they land on. Filing a new request is `stall_request.filed`. */
export const AUDIT_ACTION_INFO = {
  // ── The request itself ─────────────────────────────────────────────────
  'stall_request.filed': info('Request Filed', 'request', 'clipboard-list', 'info'),
  'stall_request.amended': info('Request Amended', 'request', 'pencil', 'neutral'),
  'stall_request.flagged': info('Flagged for Follow-Up', 'request', 'alert-triangle', 'warn'),
  'stall_request.unflagged': info('Flag Cleared', 'request', 'check', 'neutral'),
  // ── Selection: one per status the transition lands on ──────────────────
  'stall_request.submitted': info('Back to Submitted', 'selection', 'arrow-left-right', 'neutral'),
  'stall_request.shortlisted': info('Shortlisted', 'selection', 'check-square', 'info'),
  'stall_request.selected': info('Selected', 'selection', 'map-pin', 'ok'),
  'stall_request.backup': info('Moved to Backup', 'selection', 'layers', 'neutral'),
  'stall_request.rejected': info('Rejected', 'selection', 'ban', 'des'),
  'stall_request.cancelled': info('Cancelled', 'selection', 'x', 'des'),
  'stall_allocation.released': info('Stall Released', 'allocation', 'undo', 'warn'),
  'stall_allocation.moved': info('Stall Number Corrected', 'allocation', 'arrow-right', 'neutral'),
  // ── Forms the requester (or somebody for them) filled ──────────────────
  'stall_bank_detail.submitted': info('Bank Form Submitted', 'form', 'file-text', 'info'),
  'stall_fssai.submitted': info('FSSAI Certificate Uploaded', 'form', 'shield', 'info'),
  'stall_fssai.verified': info('FSSAI Verified', 'onboarding', 'shield', 'ok'),
  'stall_fssai.unverified': info('FSSAI Verification Cleared', 'onboarding', 'shield', 'warn'),
  'stall_vendor_staff.registered': info('Staff Registered', 'form', 'user-plus', 'info'),
  'stall_vendor_staff.removed': info('Staff Removed', 'onboarding', 'trash', 'warn'),
  'stall_staff_coupon.issued': info('Staff Coupon Issued', 'onboarding', 'ticket', 'info'),
  'stall_staff_coupon.capacity_set': info(
    'Coupon Capacity Set',
    'onboarding',
    'sliders',
    'neutral',
  ),
  'stall_payment_claim.submitted': info('Transfer Reported', 'form', 'rupee', 'info'),
  'stall_payment_claim.rejected': info('Transfer Not Found', 'money', 'ban', 'des'),
  'stall_signature.sent': info('Agreement Sent for Signature', 'onboarding', 'scroll', 'info'),
  // ── Money ──────────────────────────────────────────────────────────────
  'stall_payment.confirmed': info('Payment Confirmed', 'money', 'rupee', 'ok'),
  // ⚠️ Kept for the editions already audited under it. Nothing writes it any
  // more — a mistaken credit is WITHDRAWN now, and the row survives.
  'stall_payment.removed': info('Payment Record Removed', 'money', 'trash', 'warn'),
  'stall_payment.withdrawn': info('Payment Entry Withdrawn', 'money', 'undo', 'warn'),
  'stall_payment_plan.concession_set': info('Concession Agreed', 'money', 'rupee', 'warn'),
  'stall_payment_plan.concession_cleared': info('Concession Cleared', 'money', 'undo', 'neutral'),
  'stall_refund.submitted': info('Refund Sent to Finance', 'money', 'send', 'info'),
  'stall_refund.paid': info('Refund Voucher Recorded', 'money', 'circle-check', 'ok'),
  // ── Communication ──────────────────────────────────────────────────────
  'stall_message.sent': info('Letter Sent', 'comms', 'megaphone', 'info'),
  'stall_email.unsent': info('Letter Marked Unsent', 'comms', 'undo', 'warn'),
  'stall_email_template.updated': info('Letter Template Edited', 'comms', 'pencil', 'neutral'),
  'stall_reminder.logged': info('Reminder Call Logged', 'comms', 'phone-call', 'neutral'),
  // ── Event operations ───────────────────────────────────────────────────
  'stall_request.checked_in': info('Checked In', 'checkin', 'circle-check', 'ok'),
  'stall_request.check_in_undone': info('Check-In Undone', 'checkin', 'undo', 'warn'),
  'stall_equipment.updated': info('Chairs & Tables Edited', 'equipment', 'layout-grid', 'neutral'),
  'stall_equipment.distribute': info('Furniture Distributed', 'equipment', 'package', 'info'),
  'stall_equipment.undistribute': info('Distribution Undone', 'equipment', 'undo', 'warn'),
  'stall_equipment.collect_extra_payment': info('Extra Furniture Paid', 'equipment', 'rupee', 'ok'),
  'stall_equipment.collect': info('Furniture Collected', 'equipment', 'circle-check', 'ok'),
  'stall_equipment.uncollect': info('Collection Undone', 'equipment', 'undo', 'warn'),
  // ── Configuration ──────────────────────────────────────────────────────
  'stall_edition.created': info('Edition Created', 'config', 'calendar', 'info'),
  'stall_edition.copied': info('Edition Copied From', 'config', 'copy', 'info'),
  'stall_edition.settings_updated': info(
    'Edition Settings Changed',
    'config',
    'settings',
    'neutral',
  ),
  'stall_zone.created': info('Bay Added', 'config', 'map-pin', 'info'),
  'stall_zone.updated': info('Bay Edited', 'config', 'map-pin', 'neutral'),
  'stall_zone.deleted': info('Bay Removed', 'config', 'trash', 'warn'),
  'stall_plan.written': info('Plan Saved', 'config', 'layers', 'neutral'),
  'stall_plan.applied': info('Plan Applied', 'config', 'layers', 'ok'),
  'stall_plan_category.replaced': info('Plan Columns Replaced', 'config', 'layout-grid', 'neutral'),
  'stall_rate_card.replaced': info('Rate Card Replaced', 'config', 'rupee', 'neutral'),
  'stall_charges.updated': info('Charges Changed', 'config', 'rupee', 'neutral'),
  'stall_flow.updated': info('Onboarding Steps Changed', 'config', 'sliders', 'neutral'),
  'stall_fine_type.upserted': info('Fine Type Saved', 'config', 'alert-triangle', 'neutral'),
  // ── Access ─────────────────────────────────────────────────────────────
  'stall_role.created': info('Role Created', 'access', 'shield', 'info'),
  'stall_role.updated': info('Role Edited', 'access', 'shield', 'neutral'),
  'stall_role.deleted': info('Role Deleted', 'access', 'trash', 'warn'),
  'stall_backoffice_role.granted': info('Role Granted', 'access', 'key', 'ok'),
  'stall_backoffice_role.revoked': info('Role Revoked', 'access', 'lock', 'warn'),
  'person.updated': info('Member Details Edited', 'access', 'user', 'neutral'),
  'stall_backoffice.signed_in': info('Backoffice Sign-In', 'session', 'log-in', 'neutral'),
  // ── Requester accounts ─────────────────────────────────────────────────
  'stall_account.registered': info('Account Registered', 'account', 'user-plus', 'info'),
  'stall_account.logged_in': info('Requester Signed In', 'session', 'log-in', 'neutral'),
  'stall_account.login_failed': info('Requester Sign-In Failed', 'session', 'lock', 'warn'),
  'stall_account.logged_out': info('Requester Signed Out', 'session', 'log-out', 'neutral'),
  'stall_account.password_reset_requested': info(
    'Password Reset Requested',
    'account',
    'key',
    'neutral',
  ),
  'stall_account.password_reset': info('Password Reset', 'account', 'key', 'ok'),
  'stall_account.access_link_requested': info(
    'Access Link Requested',
    'account',
    'mail',
    'neutral',
  ),
  'stall_account.access_link_sent': info('Access Link Sent by Desk', 'account', 'mail', 'info'),
  'stall_account.updated': info('Requester Details Edited', 'account', 'pencil', 'neutral'),
  'stall_account.unlocked': info('Account Unlocked', 'account', 'lock-open', 'ok'),
  'stall_account.password_set': info('Password Set by Desk', 'account', 'key', 'warn'),
  // ── Outbound ───────────────────────────────────────────────────────────
  'stall_email.sent': info('Email Sent', 'outbound', 'mail', 'neutral'),
  'stall_email.failed': info('Email Failed', 'outbound', 'mail', 'des'),
  'stall_whatsapp.sent': info('WhatsApp Sent', 'outbound', 'message-circle', 'neutral'),
  'stall_whatsapp.failed': info('WhatsApp Failed', 'outbound', 'message-circle', 'des'),
} as const satisfies Record<string, AuditActionInfo>;

export type AuditAction = keyof typeof AUDIT_ACTION_INFO;
export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_INFO) as AuditAction[];

export function isAuditAction(s: string): s is AuditAction {
  return Object.hasOwn(AUDIT_ACTION_INFO, s);
}

/** The words for an action. A row written under a name this build does not
 *  know — one from a later release, read by an older bundle — still reads as
 *  words rather than as a key, and sits in the `other` family. */
export function describeAuditAction(action: string): AuditActionInfo {
  if (isAuditAction(action)) return AUDIT_ACTION_INFO[action];
  const words = action
    .replace('.', ' ')
    .split('_')
    .join(' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  return { label: words.join(' '), family: 'other', glyph: 'circle-dot', tone: 'neutral' };
}

/* ── Change sets ────────────────────────────────────────────────────────────*/

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What changed, field by field. Only fields PRESENT in `after` are compared —
 *  a patch that omits a field is leaving it alone, not clearing it — and
 *  `fields` narrows the comparison further when the caller knows which columns
 *  it wrote. `undefined` and `null` are one absence. */
export function changeSet(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: readonly string[],
): AuditChange[] {
  const keys = fields ?? Object.keys(after);
  const out: AuditChange[] = [];
  for (const field of keys) {
    if (!(field in after)) continue;
    const a = after[field];
    const b = before[field];
    if (!same(a, b)) out.push({ field, before: b ?? null, after: a ?? null });
  }
  return out;
}

/** The last four digits, or nothing. The record is the source; the log must
 *  never become a second readable copy of a bank account number. */
export function maskAccountNumber(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = v.replace(/\s/g, '');
  return digits.length <= 4 ? '••••' : `••••${digits.slice(-4)}`;
}

/* ── Wire ───────────────────────────────────────────────────────────────────*/

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date as YYYY-MM-DD');

export const ListAuditQuery = z.object({
  /** Matches the actor's name, the request's reference, or the action. */
  q: z.string().trim().max(200).optional(),
  action: z.string().max(80).optional(),
  actorKind: z.enum(AUDIT_ACTOR_KINDS).optional(),
  actorRef: z.string().max(80).optional(),
  requestId: z.uuid().optional(),
  /** Inclusive, in the server's day. */
  from: IsoDate.optional(),
  /** Inclusive. */
  to: IsoDate.optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAuditQuery = z.infer<typeof ListAuditQuery>;

export interface AuditEventView {
  id: string;
  occurredAt: string;
  action: string;
  label: string;
  family: AuditFamily;
  glyph: string;
  tone: AuditTone;
  actorKind: AuditActorKind;
  actorRef: string;
  actorName: string;
  onBehalfOf: { accountId: string; displayName: string } | null;
  channel: AuditChannel;
  subjectType: string;
  subjectRef: string;
  requestId: string | null;
  reference: string | null;
  requestType: string | null;
  changes: AuditChange[] | null;
  detail: Record<string, unknown>;
  outcome: AuditOutcome;
}

export interface AuditPage {
  items: AuditEventView[];
  total: number;
  page: number;
  pageSize: number;
}
