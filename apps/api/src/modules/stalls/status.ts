import { STAGE_LABEL, type StatusStep, formatInr, stageSteps } from '@msr/stalls';
import { resolveAccessLink } from './accounts';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { publicUrl } from './links';
import { flowCtxFor } from './stage';

/** One request as the vendor's status page shows it. Extends the Phase 1 shape
 *  with the onboarding steps and whichever signed links are open right now. */
export interface PublicRequestStatusFull {
  reference: string;
  requestType: string;
  stallName: string;
  status: string;
  stage: string;
  submittedAt: string;
  allocatedStalls: string[];
  steps: StatusStep[];
  /** Open when the bank form is awaited or may be edited. */
  bankFormUrl: string | null;
  /** Open once payment is confirmed for a food stall without a verified certificate. */
  fssaiUploadUrl: string | null;
  /** Open once a coupon exists. */
  staffUrl: string | null;
  paymentDuePaise: number | null;
  paymentDue: string | null;
}

export async function statusView(
  db: Db,
  token: string,
  deps: Pick<StallsDeps, 'linkUrl'>,
): Promise<{ displayName: string; requests: PublicRequestStatusFull[] }> {
  const link = await resolveAccessLink(db, token, 'STATUS');
  const requests = await db.stallRequest.findMany({
    where: { accountId: link.accountId },
    orderBy: { submittedAt: 'desc' },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: true } },
      bankDetails: { select: { submittedAt: true } },
      payment: { select: { totalPayablePaise: true, confirmedAt: true, emailSentAt: true } },
      fssai: { select: { verifiedAt: true } },
      staffCoupon: { select: { code: true } },
    },
  });

  const out: PublicRequestStatusFull[] = [];
  for (const r of requests) {
    const selected = r.status === 'SELECTED';
    const ctx = await flowCtxFor(db, r);
    const path = stageSteps(ctx);
    const at = path.indexOf(r.stage);
    const steps: StatusStep[] = selected
      ? path
          .filter((s) => s !== 'NEW')
          .map((s) => ({
            stage: s,
            label: STAGE_LABEL[s],
            state: path.indexOf(s) < at ? 'done' : path.indexOf(s) === at ? 'current' : 'todo',
          }))
      : [];

    const bankOpen =
      selected &&
      !ctx.isAshram &&
      ctx.bankStepEnabled &&
      (r.stage === 'BANK_FORM_SENT' || r.stage === 'BANK_FORM_FILLED');
    const fssaiOpen =
      selected &&
      ctx.isFood &&
      ctx.fssaiStepEnabled &&
      r.stage === 'FSSAI_PENDING' &&
      !r.fssai?.verifiedAt;
    const staffOpen = selected && r.staffCoupon !== null;
    const paymentDue =
      selected && r.payment && r.payment.emailSentAt && !r.payment.confirmedAt
        ? r.payment.totalPayablePaise
        : null;

    out.push({
      reference: r.reference,
      requestType: r.requestType,
      stallName: r.stallName,
      status: r.status,
      stage: r.stage,
      submittedAt: r.submittedAt.toISOString(),
      allocatedStalls: selected ? r.allocations.map((a) => a.stall.number) : [],
      steps,
      bankFormUrl: bankOpen ? await publicUrl(db, r, 'BANK_FORM', deps) : null,
      fssaiUploadUrl: fssaiOpen ? await publicUrl(db, r, 'FSSAI_UPLOAD', deps) : null,
      staffUrl: staffOpen ? await publicUrl(db, r, 'STAFF_REGISTRATION', deps) : null,
      paymentDuePaise: paymentDue,
      paymentDue: paymentDue === null ? null : formatInr(paymentDue),
    });
  }
  return { displayName: link.account.displayName, requests: out };
}
