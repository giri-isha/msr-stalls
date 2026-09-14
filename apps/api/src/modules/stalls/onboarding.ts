import { randomBytes } from 'node:crypto';
import type { PrismaClient, StallStaffCoupon } from '@prisma/client';
import {
  COUPON_RANDOM_LENGTH,
  type CouponView,
  type OnboardingDetail,
  type OnboardingRow,
  type RegisterStaffInput,
  type SubmitFssaiInput,
  type VendorStaffView,
  formatCouponCode,
  needsBankStep,
  needsPaymentStep,
  normalizeCouponCode,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import type { MediaStore } from '../../storage/media-namespace';
import { flowFor } from './config';
import type { Db } from './editions';
import { CouponFullError, UnknownCouponError, UnknownRequestError } from './errors';
import { DEFAULT_STAFF_COUPON_CAPACITY } from '@msr/stalls';
import {
  allocatedNumbers,
  factsInclude,
  factsOf,
  paymentConfirmed,
  pendingFor,
  refreshStage,
  type RequestWithFacts,
  staffExpected,
} from './facts';
import { quoteContext, quoteFor, toQuoteView } from './quotes';
import { MODULE_KEY } from './roles';
import { type RequestScope, scopeWhere } from './scope';

/** Everything between "you are selected" and "you are all set": the coupon a
 *  vendor's staff register with, the FSSAI certificate, and the table that
 *  shows who is holding the team up. */

// ── Staff registration coupons ──────────────────────────────────────────────

/** Mints the coupon on first use and returns the existing one afterwards.
 *
 *  Idempotent by design: the coupon is printed in two different letters and
 *  shown on two screens, and a second one would leave staff registering against
 *  a code nobody is counting. The randomness comes from `randomBytes` here so
 *  the code itself stays pure and testable — see `coupons.ts`. */
export async function ensureCoupon(
  db: PrismaClient,
  requestId: string,
  stallName: string,
  year: number,
  by: string,
): Promise<StallStaffCoupon> {
  const existing = await db.stallStaffCoupon.findUnique({ where: { requestId } });
  if (existing) return existing;

  // A collision is vanishingly unlikely at 40 bits over a few hundred coupons,
  // but it is a unique column and a retry is three lines.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = formatCouponCode(stallName, year, randomBytes(COUPON_RANDOM_LENGTH));
    try {
      const created = await db.stallStaffCoupon.create({
        data: { requestId, code, issuedBy: by, capacity: DEFAULT_STAFF_COUPON_CAPACITY },
      });
      await recordActivity(db, {
        actorRef: by,
        moduleKey: MODULE_KEY,
        action: 'stall_staff_coupon.issued',
        subjectRef: requestId,
      });
      return created;
    } catch {
      const now = await db.stallStaffCoupon.findUnique({ where: { requestId } });
      if (now) return now;
    }
  }
  throw new Error(`could not mint a staff coupon for request ${requestId}`);
}

/** Resolves what a person typed on the public registration page.
 *
 *  Shape is checked before the database is touched, and an unknown, revoked or
 *  wrong-shaped coupon all produce the SAME error — the page must not be usable
 *  to confirm that a code exists. */
export async function resolveCoupon(db: Db, raw: string): Promise<RequestWithFacts> {
  const code = normalizeCouponCode(raw);
  if (!code) throw new UnknownCouponError();
  const coupon = await db.stallStaffCoupon.findUnique({
    where: { code },
    include: { request: { include: factsInclude } },
  });
  if (!coupon || coupon.revokedAt) throw new UnknownCouponError();
  if (coupon.request.status !== 'SELECTED') throw new UnknownCouponError();
  return coupon.request;
}

export function toCouponView(r: RequestWithFacts): CouponView {
  return {
    stallName: r.stallName,
    reference: r.reference,
    // ⚠️ Withheld until the stall checks in, like everywhere else the requester
    // can see. This page is read by the vendor's whole team, which is the last
    // place a stall number should leak early.
    stallNumbers: r.checkIn ? allocatedNumbers(r) : [],
    registered: r.staff.length,
    maxStaff: staffExpected(r),
    staff: r.staff
      .slice()
      .sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime())
      .map((s) => ({
        name: s.name,
        // Partly masked: this list is shown to anyone holding the coupon, which
        // is the vendor's whole team, and a full roster of numbers is not
        // theirs to collect.
        mobile: `${s.mobile.slice(0, 2)}••••${s.mobile.slice(-3)}`,
        registeredAt: s.registeredAt.toISOString(),
      })),
  };
}

/** Raises (or lowers) what one coupon may register.
 *
 *  The team's own workflow: eight by default, "and if they want more staff
 *  members, in the back end we raise that capacity to 10, 12" — case by case,
 *  against a stall they know.
 *
 *  ⚠️ Lowering below what is already registered is allowed and does NOT remove
 *  anybody. Those people are registered, some are holding wristbands, and a
 *  capacity is not a reason to un-register them; it stops the next one. The
 *  screen shows the overshoot rather than hiding it. */
export async function setCouponCapacity(
  db: PrismaClient,
  requestId: string,
  capacity: number,
  by: string,
) {
  const coupon = await db.stallStaffCoupon.findUnique({ where: { requestId } });
  if (!coupon) throw new UnknownCouponError();
  const updated = await db.stallStaffCoupon.update({
    where: { requestId },
    data: { capacity },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_staff_coupon.capacity_set',
    subjectRef: requestId,
    detail: { from: coupon.capacity, to: capacity },
  });
  return updated;
}

/** Aadhaar is reduced to its last four digits and never stored whole. The gate
 *  volunteer compares four digits against the card in a person's hand; the
 *  system has no use for the other eight and every reason not to hold them. */
function narrowId(idType: RegisterStaffInput['idType'], idNumber: string): string {
  const cleaned = idNumber.replace(/\s+/g, '').toUpperCase();
  return idType === 'AADHAAR' ? cleaned.slice(-4) : cleaned;
}

export async function registerStaff(
  db: PrismaClient,
  input: RegisterStaffInput,
): Promise<CouponView> {
  const request = await resolveCoupon(db, input.couponCode);
  const cap = staffExpected(request);
  const already = request.staff.some((s) => s.mobile === input.mobile);
  // ⚠️ Always enforced. The old cap read the request's own staff-pass count and
  // skipped the check when it was zero, which is how a stall with eight passes
  // — or a local welfare stall, whose form never asks — could register
  // unlimited people. A coupon always carries a real capacity.
  if (request.staff.length >= cap && !already) {
    throw new CouponFullError(cap);
  }

  await db.stallVendorStaff.upsert({
    where: { requestId_mobile: { requestId: request.id, mobile: input.mobile } },
    create: {
      requestId: request.id,
      name: input.name,
      mobile: input.mobile,
      idType: input.idType,
      idNumber: narrowId(input.idType, input.idNumber),
      role: input.role ?? null,
    },
    update: {
      name: input.name,
      idType: input.idType,
      idNumber: narrowId(input.idType, input.idNumber),
      role: input.role ?? null,
    },
  });
  await refreshStage(db, request.id);

  const fresh = await db.stallRequest.findUniqueOrThrow({
    where: { id: request.id },
    include: factsInclude,
  });
  return toCouponView(fresh);
}

export async function listStaffFor(db: Db, requestId: string): Promise<VendorStaffView[]> {
  const rows = await db.stallVendorStaff.findMany({
    where: { requestId },
    orderBy: { registeredAt: 'asc' },
  });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    mobile: s.mobile,
    idType: s.idType,
    idNumber: s.idNumber,
    role: s.role,
    registeredAt: s.registeredAt.toISOString(),
  }));
}

export async function removeStaff(db: PrismaClient, id: string, by: string): Promise<void> {
  const row = await db.stallVendorStaff.findUnique({ where: { id } });
  if (!row) throw new UnknownRequestError(id);
  await db.stallVendorStaff.delete({ where: { id } });
  await refreshStage(db, row.requestId);
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_vendor_staff.removed',
    subjectRef: row.requestId,
    detail: { name: row.name },
  });
}

// ── FSSAI ───────────────────────────────────────────────────────────────────

export async function submitFssai(
  db: PrismaClient,
  requestId: string,
  input: SubmitFssaiInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.stallFssaiCertificate.upsert({
      where: { requestId },
      create: {
        requestId,
        ownerName: input.ownerName ?? null,
        mobile: input.mobile ?? null,
      },
      update: {
        ownerName: input.ownerName ?? null,
        mobile: input.mobile ?? null,
        submittedAt: new Date(),
        // A re-upload is a NEW certificate and is unverified until somebody
        // looks at it. Keeping the old verification would let a vendor swap a
        // valid certificate for an expired one after the fact.
        verifiedAt: null,
        verifiedBy: null,
      },
    });
    await tx.stallFssaiFile.deleteMany({ where: { requestId } });
    await tx.stallFssaiFile.createMany({
      data: input.files.map((f) => ({ requestId, fileKey: f.key, fileName: f.name })),
    });
  });
  await refreshStage(db, requestId);
}

export async function verifyFssai(
  db: PrismaClient,
  requestId: string,
  verified: boolean,
  by: string,
): Promise<void> {
  const row = await db.stallFssaiCertificate.findUnique({ where: { requestId } });
  if (!row) throw new UnknownRequestError(requestId);
  await db.stallFssaiCertificate.update({
    where: { requestId },
    data: { verifiedAt: verified ? new Date() : null, verifiedBy: verified ? by : null },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: verified ? 'stall_fssai.verified' : 'stall_fssai.unverified',
    subjectRef: requestId,
  });
}

// ── The Onboarding table ────────────────────────────────────────────────────

type Status3 = 'RECEIVED' | 'PENDING' | 'NOT_APPLICABLE';

function bankStatus(r: RequestWithFacts): Status3 {
  if (!needsBankStep(r.requestType)) return 'NOT_APPLICABLE';
  return r.bankDetail ? 'RECEIVED' : 'PENDING';
}

/** GST is only ever "received" when a number that is not the literal "NONE"
 *  was given. A vendor who is not registered is not pending anything. */
function gstStatus(r: RequestWithFacts): Status3 {
  if (!needsBankStep(r.requestType)) return 'NOT_APPLICABLE';
  if (!r.bankDetail) return 'PENDING';
  return r.bankDetail.gstNumber.toUpperCase() === 'NONE' ? 'NOT_APPLICABLE' : 'RECEIVED';
}

function paymentStatus(r: RequestWithFacts): 'CONFIRMED' | 'PENDING' | 'NOT_APPLICABLE' {
  if (!needsPaymentStep(r.requestType)) return 'NOT_APPLICABLE';
  return paymentConfirmed(r) ? 'CONFIRMED' : 'PENDING';
}

function fssaiStatus(r: RequestWithFacts): 'VERIFIED' | 'UPLOADED' | 'PENDING' | 'NOT_APPLICABLE' {
  if (r.stallType !== 'FOOD') return 'NOT_APPLICABLE';
  if (!r.fssai || r.fssai.files.length === 0) return 'PENDING';
  return r.fssai.verifiedAt ? 'VERIFIED' : 'UPLOADED';
}

function toRow(r: RequestWithFacts, flow: Awaited<ReturnType<typeof flowFor>>): OnboardingRow {
  return {
    requestId: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    requestType: r.requestType,
    stallNumbers: allocatedNumbers(r),
    bankDetails: bankStatus(r),
    gst: gstStatus(r),
    payment: paymentStatus(r),
    fssai: fssaiStatus(r),
    staffRegistered: r.staff.length,
    staffExpected: staffExpected(r),
    couponCode: r.coupon?.code ?? null,
    couponCapacity: r.coupon?.capacity ?? null,
    stage: r.stage,
    pending: pendingFor(r, flow),
  };
}

export async function listOnboarding(
  db: Db,
  editionId: string,
  scope: RequestScope = null,
): Promise<OnboardingRow[]> {
  const [rows, flow] = await Promise.all([
    db.stallRequest.findMany({
      where: { editionId, status: 'SELECTED', ...scopeWhere(scope) },
      include: factsInclude,
      orderBy: [{ requestType: 'asc' }, { stallName: 'asc' }],
    }),
    flowFor(db, editionId),
  ]);
  return rows.map((r) => toRow(r, flow));
}

const FILE_LABEL: Record<string, string> = {
  chequeKey: 'Cancelled cheque / passbook',
  panKey: 'PAN card',
  gstKey: 'GST certificate',
};

/** One vendor, with the bank details read back and short-lived links to the
 *  files. The URLs are presigned on every read and expire in minutes, so a
 *  screenshot of this page is not a permanent handle on somebody's PAN card. */
export async function getOnboarding(
  db: Db,
  requestId: string,
  files: MediaStore,
): Promise<OnboardingDetail> {
  const r = await db.stallRequest.findUnique({ where: { id: requestId }, include: factsInclude });
  if (!r) throw new UnknownRequestError(requestId);
  const flow = await flowFor(db, r.editionId);

  const viewUrl = async (key: string | null | undefined) => {
    if (!key || !files.configured()) return null;
    try {
      return await files.presignView(key, 300);
    } catch {
      return null;
    }
  };

  const bank = r.bankDetail
    ? {
        invoiceName: r.bankDetail.invoiceName,
        accountHolder: r.bankDetail.accountHolder,
        bankName: r.bankDetail.bankName,
        branch: r.bankDetail.branch,
        accountNumber: r.bankDetail.accountNumber,
        ifsc: r.bankDetail.ifsc,
        micr: r.bankDetail.micr,
        panNumber: r.bankDetail.panNumber,
        gstNumber: r.bankDetail.gstNumber,
        address: r.bankDetail.address,
        pincode: r.bankDetail.pincode,
        mobile: r.bankDetail.mobile,
        submittedAt: r.bankDetail.submittedAt.toISOString(),
        files: await Promise.all(
          (['chequeKey', 'panKey', 'gstKey'] as const)
            .filter((k) => r.bankDetail?.[k])
            .map(async (k) => ({
              label: FILE_LABEL[k],
              name: FILE_LABEL[k],
              url: await viewUrl(r.bankDetail?.[k]),
            })),
        ),
      }
    : null;

  const ctx = await quoteContext(db, r.editionId);

  return {
    ...toRow(r, flow),
    bank,
    staff: await listStaffFor(db, requestId),
    fssaiFiles: await Promise.all(
      (r.fssai?.files ?? []).map(async (f) => ({
        name: f.fileName,
        uploadedAt: f.uploadedAt.toISOString(),
        url: await viewUrl(f.fileKey),
      })),
    ),
    quote: toQuoteView(quoteFor(r, ctx)),
  };
}

export { factsOf };
