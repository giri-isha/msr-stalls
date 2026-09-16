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
import { declarationsForForm, recordConsent, sameDeclarations } from './declarations';
import { allowedCustomValues, replaceCustomValues } from './custom-values';
import { publicFormFor } from './form-builder';
import type { Db } from './editions';
import {
  CouponFullError,
  DeclarationsChangedError,
  UnknownCouponError,
  UnknownRequestError,
} from './errors';
import { DEFAULT_STAFF_COUPON_CAPACITY } from '@msr/stalls';
import {
  allocatedNumbers,
  factsInclude,
  factsOf,
  paymentConfirmed,
  pendingFor,
  refreshStage,
  type RequestWithFacts,
  registeredOn,
  staffExpected,
} from './facts';
import { quoteContext, quoteFor, toQuoteView } from './quotes';
import { MODULE_KEY } from './roles';
import { type RequestScope, UNSCOPED, scopeWhere } from './scope';

/** Everything between "you are selected" and "you are all set": the coupon a
 *  vendor's staff register with, the FSSAI certificate, and the table that
 *  shows who is holding the team up. */

// ── Staff registration coupons ──────────────────────────────────────────────

/** The stall's live coupons, oldest first. The first is the one the letters
 *  name and the one a vendor is handed by default. */
export function liveCoupons(db: Db, requestId: string): Promise<StallStaffCoupon[]> {
  return db.stallStaffCoupon.findMany({
    where: { requestId, revokedAt: null },
    orderBy: { issuedAt: 'asc' },
  });
}

/** Mints a coupon on first use and returns the existing one afterwards.
 *
 *  Idempotent by design: the coupon is printed in two different letters and
 *  shown on two screens, and minting a second one THERE would leave staff
 *  registering against a code nobody is counting. When a stall genuinely needs
 *  another, that is `issueCoupon` below — a deliberate act, not a side effect of
 *  sending a letter twice. */
export async function ensureCoupon(
  db: PrismaClient,
  requestId: string,
  stallName: string,
  year: number,
  by: string,
): Promise<StallStaffCoupon> {
  const [existing] = await liveCoupons(db, requestId);
  if (existing) return existing;
  return issueCoupon(db, requestId, stallName, year, by);
}

/** Mints ANOTHER coupon for a stall that already has one.
 *
 *  🔴 The team's second lever, beside raising a capacity: a caterer gets their
 *  own code rather than a share of the vendor's, and the two are counted apart,
 *  so "who did this person come in with" has an answer at the gate. Raising one
 *  coupon from 8 to 12 cannot say that.
 *
 *  ⚠️ NOT idempotent, and must not be — every call is a new code by definition.
 *  Everything that runs on its own (a letter going out, a vendor pressing Get
 *  Your Coupon) calls `ensureCoupon` instead. This one is reached only by a
 *  backoffice member pressing a button.
 *
 *  The randomness comes from `randomBytes` here so the code itself stays pure
 *  and testable — see `coupons.ts`. */
export async function issueCoupon(
  db: PrismaClient,
  requestId: string,
  stallName: string,
  year: number,
  by: string,
): Promise<StallStaffCoupon> {
  // A collision is vanishingly unlikely at 40 bits over a few hundred coupons,
  // but `code` is a unique column and a retry is three lines.
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
        detail: { code },
      });
      return created;
    } catch {
      // Only a duplicate CODE is worth retrying. Anything else — a request that
      // does not exist — fails the same way on the next attempt and falls out
      // of the loop below.
    }
  }
  throw new Error(`could not mint a staff coupon for request ${requestId}`);
}

/** Resolves what a person typed on the public registration page.
 *
 *  Shape is checked before the database is touched, and an unknown, revoked or
 *  wrong-shaped coupon all produce the SAME error — the page must not be usable
 *  to confirm that a code exists. */
export async function resolveCoupon(
  db: Db,
  raw: string,
): Promise<{ request: RequestWithFacts; coupon: StallStaffCoupon }> {
  const code = normalizeCouponCode(raw);
  if (!code) throw new UnknownCouponError();
  const coupon = await db.stallStaffCoupon.findUnique({
    where: { code },
    include: { request: { include: factsInclude } },
  });
  if (!coupon || coupon.revokedAt) throw new UnknownCouponError();
  if (coupon.request.status !== 'SELECTED') throw new UnknownCouponError();
  // ⚠️ Both halves come back. A stall can hold several codes now, and the CAP
  // that applies is the one on the code in this person's hand — not the stall's
  // total, which would let one coupon spend another's room.
  const { request, ...rest } = coupon;
  return { request, coupon: rest };
}

/** ⚠️ Async now, because the view carries the edition's own definition of the
 *  staff form. The page has to draw what THIS year asks — including a question
 *  an admin appended — and that is a read. */
export async function toCouponView(
  db: Db,
  r: RequestWithFacts,
  coupon: StallStaffCoupon,
): Promise<CouponView> {
  const [form, declarations] = await Promise.all([
    publicFormFor(db, r.editionId, 'STAFF'),
    declarationsForForm(db, r.editionId, 'STAFF'),
  ]);
  // ⚠️ Scoped to the coupon in the reader's hand. The page is seen by the
  // vendor's team and, where a stall holds two codes, by a caterer's team as
  // well — neither is owed the other's roster or the other's remaining room.
  const mine = r.staff.filter((st) => st.couponId === coupon.id);
  return {
    form,
    declarations,
    stallName: r.stallName,
    reference: r.reference,
    // ⚠️ Withheld until the stall checks in, like everywhere else the requester
    // can see. This page is read by the vendor's whole team, which is the last
    // place a stall number should leak early.
    stallNumbers: r.checkIn ? allocatedNumbers(r) : [],
    registered: mine.length,
    maxStaff: coupon.capacity,
    staff: mine
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
  couponId: string,
  capacity: number,
  by: string,
) {
  const coupon = await db.stallStaffCoupon.findUnique({ where: { id: couponId } });
  // ⚠️ The coupon has to belong to the request the caller was scoped against.
  // Without this, somebody allowed to touch one stall could raise the cap on
  // another's coupon by naming its id — the route's scope check only ever saw
  // the request in the path.
  if (!coupon || coupon.requestId !== requestId) throw new UnknownCouponError();
  const updated = await db.stallStaffCoupon.update({
    where: { id: couponId },
    data: { capacity },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_staff_coupon.capacity_set',
    subjectRef: coupon.requestId,
    detail: { code: coupon.code, from: coupon.capacity, to: capacity },
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
  const { request, coupon } = await resolveCoupon(db, input.couponCode);
  // 🔴 THIS coupon's cap against THIS coupon's registrations. A stall holding a
  // code for its kitchen and another for a caterer must not have the first spend
  // the second's room — and the stall's total is not the number either team was
  // given.
  const cap = coupon.capacity;
  const already = request.staff.some((s) => s.mobile === input.mobile);
  // ⚠️ Always enforced. The old cap read the request's own staff-pass count and
  // skipped the check when it was zero, which is how a stall with eight passes
  // — or a local welfare stall, whose form never asks — could register
  // unlimited people. A coupon always carries a real capacity.
  if (registeredOn(coupon.id, request.staff) >= cap && !already) {
    throw new CouponFullError(cap);
  }

  // One transaction, so a person's row and their own consent are written
  // together or not at all. A registration recorded without the consent it was
  // given under is exactly the gap this work closes.
  await db.$transaction(async (tx) => {
    const row = await tx.stallVendorStaff.upsert({
      // ⚠️ Still keyed on the STALL and the mobile, not on the coupon. One
      // person, one registration per stall — somebody handed both codes must
      // not appear twice and be counted twice at the gate.
      where: { requestId_mobile: { requestId: request.id, mobile: input.mobile } },
      create: {
        requestId: request.id,
        couponId: coupon.id,
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

    const live = await declarationsForForm(tx, request.editionId, 'STAFF');
    if (!sameDeclarations(live, input.declarationIds)) throw new DeclarationsChangedError();
    // 🔴 `staffId` is THIS person's. Eight people register against one coupon
    // and share a request id, and the consent is the individual's — they are
    // the one carrying the photo ID through the gate. Filed against the request
    // alone, seven of the eight would collapse into the first person's row.
    await recordConsent(tx, { requestId: request.id, formType: 'STAFF', staffId: row.id }, live);
  });
  await refreshStage(db, request.id);

  const fresh = await db.stallRequest.findUniqueOrThrow({
    where: { id: request.id },
    include: factsInclude,
  });
  return toCouponView(db, fresh, coupon);
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
  const r = await db.stallRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { editionId: true },
  });

  await db.$transaction(async (tx) => {
    // The same staleness refusal the request and bank forms make. The FSSAI
    // upload seeds no wording of its own, so `live` is empty until the team
    // authors some — at which point this starts gating without a code change.
    const live = await declarationsForForm(tx, r.editionId, 'FSSAI');
    if (!sameDeclarations(live, input.declarationIds)) throw new DeclarationsChangedError();
    await recordConsent(tx, { requestId, formType: 'FSSAI' }, live);

    await replaceCustomValues(
      tx,
      { requestId },
      await allowedCustomValues(tx, r.editionId, 'FSSAI', input.customFields),
    );

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
  // ⚠️ A GST number that was never ASKED FOR is not applicable either — the
  // edition can switch that question off, and a missing answer then means the
  // same thing the literal "NONE" means: there is no GST registration to chase.
  const gst = r.bankDetail.gstNumber;
  if (!gst) return 'NOT_APPLICABLE';
  return gst.toUpperCase() === 'NONE' ? 'NOT_APPLICABLE' : 'RECEIVED';
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
    coupons: r.coupons.map((c) => ({
      id: c.id,
      code: c.code,
      capacity: c.capacity,
      registered: registeredOn(c.id, r.staff),
    })),
    stage: r.stage,
    pending: pendingFor(r, flow),
  };
}

export async function listOnboarding(
  db: Db,
  editionId: string,
  scope: RequestScope = UNSCOPED,
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
