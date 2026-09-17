// Development seed: one edition — `EDITION_YEAR` below, and every date here is
// that year's — four backoffice members, a plan applied across every zone, and
// a realistic spread of requests drawn from the 2025 prototype data
// — some shortlisted, some selected onto real stalls, one flagged.
//
// Refuses to run against a database that already has an edition, so it can
// never double-seed. Pass --force to wipe the stalls tables first.
import { randomUUID } from 'node:crypto';
import { SubmitRequestInput, type ZoneCode } from '@stalls/core';
import { LogMailer } from '../src/email';
import { createUnconfiguredSigner } from '../src/modules/stalls/signer';
import { createLoggingWhatsAppSender } from '../src/modules/stalls/whatsapp';
import { submitBankDetails } from '../src/modules/stalls/bank';
import { checkIn } from '../src/modules/stalls/checkin';
import { logReminder, sendTemplate } from '../src/modules/stalls/comms';
import { createEdition } from '../src/modules/stalls/config';
import { hashPassword } from '../src/modules/stalls/credentials';
import type { StallsDeps } from '../src/modules/stalls/deps';
import { actOnEquipment, patchEquipment } from '../src/modules/stalls/equipment';
import { confirmPayment } from '../src/modules/stalls/finance';
import {
  ensureCoupon,
  registerStaff,
  submitFssai,
  verifyFssai,
} from '../src/modules/stalls/onboarding';
import { applyPlan, writePlan } from '../src/modules/stalls/planning';
import { seedRbac } from '../src/modules/stalls/seed-rbac';
import { flagRequest } from '../src/modules/stalls/requests';
import { selectRequest, shortlist } from '../src/modules/stalls/selection';
import { submitRequest } from '../src/modules/stalls/submit';
import { prisma } from '../src/prisma';
import { DiskMediaStore, devMediaDir } from '../src/storage/disk-media-store';
import type { MediaStore } from '../src/storage/media-namespace';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const force = process.argv.includes('--force');

/** The edition this seed builds — Stalls 2027, the one a developer starting today
 *  is working towards. Everything dated below hangs off it — the payment dates,
 *  the bank references that carry those dates, the prior edition a flag refers
 *  back to — so rolling the seed forward a year is this one number and nothing
 *  else.
 *
 *  ⚠️ SEED DATA, not a fact the application knows. The seed activates the
 *  edition it creates because a freshly seeded database needs one active, and
 *  the module refuses to guess (`NoActiveEditionError`). Nothing outside this
 *  file may name a year: every route resolves the active edition from the
 *  database, and the year the team is running is whichever row Admin has
 *  activated. */
const EDITION_YEAR = 2027;

/** The two credits Finance confirms for the vendor walked all the way through.
 *  Mid-February, which is when the money lands in a real edition. */
const RENT_RECEIVED_ON = `${EDITION_YEAR}-02-14`;
const DEPOSIT_RECEIVED_ON = `${EDITION_YEAR}-02-18`;

/** A YES Bank e-collect reference as it reads on the statement: the bank's
 *  prefix, the date of the credit, and a serial within that day. Built from
 *  the date so the reference cannot drift away from the payment it names. */
const bankRef = (receivedOn: string, serial: number) =>
  `YESBN1${receivedOn.replaceAll('-', '')}${String(serial).padStart(2, '0')}`;

/** What every seeded requester's password is.
 *
 *  ⚠️ DEV SEED ONLY. The seed truncates the database before it runs, so it can
 *  only ever be pointed at a throwaway one — but this is still a password in a
 *  source file, and nothing outside a developer's machine may use it. Change a
 *  single account's with `npm run dev:users -- --set-password <contact> <new>`.
 */
export const DEV_PASSWORD = 'stalls-dev-password';

const BACKOFFICE = [
  { email: 'vikram.s@maildrop.cc', displayName: 'Vikram Sethu', roles: ['stalls_admin'] },
  { email: 'deepa.r@maildrop.cc', displayName: 'Deepa Ramanathan', roles: ['stalls_lead'] },
  { email: 'kavya.n@maildrop.cc', displayName: 'Kavya Nair', roles: ['stalls_volunteer'] },
  { email: 'meena.k@maildrop.cc', displayName: 'Meena Krishnan', roles: ['stalls_finance'] },
  // The two narrow roles, seeded so their limits can be seen rather than taken
  // on trust: the local welfare team sees only their own requests, and the
  // electrical team sees only the sheet.
  {
    email: 'lakshmi.p@maildrop.cc',
    displayName: 'Lakshmi Perumal',
    roles: ['stalls_local_welfare'],
  },
  {
    email: 'suresh.k@maildrop.cc',
    displayName: 'Suresh Kumar',
    roles: ['stalls_electrical'],
  },
  { email: 'arjun.b@maildrop.cc', displayName: 'Arjun Balaji', roles: [] },
];

/** The 2025 planning sheet, per zone × category (from the prototype). */
// Keyed by the edition's own category keys — the planning grid's columns are
// configuration, so the seed names the ones it wants rather than filling a
// fixed set.
const PLAN: Record<ZoneCode, Record<string, number>> = {
  A3: { ASHRAM_FOOD: 2, ASHRAM_NON_FOOD: 6 },
  A4: {
    VENDOR_FOOD: 5,
    ASHRAM_FOOD: 6,
    LW_FOOD: 5,
    VENDOR_NON_FOOD: 2,
    ASHRAM_NON_FOOD: 11,
    BACKUP: 1,
  },
  B2: { VENDOR_FOOD: 1, LW_FOOD: 2, ASHRAM_NON_FOOD: 5, BACKUP: 2 },
  B3: { VENDOR_FOOD: 1, ASHRAM_FOOD: 5, ASHRAM_NON_FOOD: 5, BACKUP: 1 },
  B4: {
    VENDOR_FOOD: 4,
    ASHRAM_FOOD: 5,
    LW_FOOD: 5,
    VENDOR_NON_FOOD: 2,
    ASHRAM_NON_FOOD: 13,
    HELP_DESK: 1,
    BACKUP: 1,
  },
  C1: { VENDOR_FOOD: 5, LW_FOOD: 8, ASHRAM_NON_FOOD: 11 },
  C2: {
    VENDOR_FOOD: 5,
    ASHRAM_FOOD: 2,
    LW_FOOD: 11,
    VENDOR_NON_FOOD: 2,
    ASHRAM_NON_FOOD: 7,
    BACKUP: 3,
  },
};

const vendor = (o: Record<string, unknown>) => ({
  requestType: 'VENDOR',
  stallType: 'FOOD',
  numStallsRequested: 1,
  agreed: true,
  address: 'Coimbatore',
  ...o,
});
const lw = (o: Record<string, unknown>) => ({
  requestType: 'LOCAL_WELFARE',
  stallType: 'FOOD',
  numStallsRequested: 1,
  agreed: true,
  depositAcknowledged: true,
  address: 'Coimbatore',
  plugs5a: 1,
  plugs15a: 0,
  gasStoves: 1,
  tablesNeeded: 1,
  chairsNeeded: 2,
  passes2w: 1,
  passes4w: 0,
  ...o,
});
/** The ashram form has no vendor name or contact of its own; like the web
 *  form, the requester is the person named in the department block.
 *
 *  ⚠️ `stallType` is the default, and a food stall overrides it. It used to be
 *  implied by `ASHRAM_FOOD` being its own request type; the one ashram form
 *  asks it. */
const ashram = (o: Record<string, unknown>, block: Record<string, unknown>) => ({
  requestType: 'ASHRAM',
  stallType: 'NON_FOOD',
  numStallsRequested: 1,
  agreed: true,
  requesterName: block.requestedBy,
  contactNumber: block.requesterContact,
  // The whole electrical block, because the ashram form asks all of it — a
  // department bringing nothing still has to answer "none".
  plugs5a: 1,
  plugs15a: 0,
  gasStoves: 0,
  tablesNeeded: 2,
  chairsNeeded: 4,
  passes2w: 2,
  passes4w: 1,
  passesStaff: 3,
  ...o,
  ashram: {
    creditCardNeeded: false,
    usage: 'DEPT_SALES',
    wantsThembu: false,
    ...block,
  },
});

const REQUESTS: Array<Record<string, unknown>> = [
  vendor({
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@maildrop.cc',
    contactNumber: '9840012345',
    preferredZoneCode: 'C1',
    itemsSelling: 'Organic spices, cold-pressed oils, honey',
  }),
  vendor({
    stallName: 'Coastal Spice Kitchen',
    requesterName: 'Rajendran',
    email: 'orders@maildrop.cc',
    contactNumber: '9840023456',
    preferredZoneCode: 'B4',
    itemsSelling: 'Seafood biryani, fish fry, prawn curry',
    numStallsRequested: 2,
    remarks: 'Requires extra ventilation',
  }),
  vendor({
    stallName: 'Little Wonders Toys',
    requesterName: 'Suresh Kumar',
    email: 'hello@maildrop.cc',
    contactNumber: '9840034567',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'A4',
    itemsSelling: 'Wooden toys, puzzles',
  }),
  vendor({
    stallName: 'Bliss Bites Cafe',
    requesterName: 'Kavya Nair',
    email: 'bliss@maildrop.cc',
    contactNumber: '9840045678',
    preferredZoneCode: 'C2',
    itemsSelling: 'Sandwiches, smoothies, cold coffee',
  }),
  vendor({
    stallName: 'Mahalakshmi Handicrafts',
    requesterName: 'Lakshmi Narayan',
    email: 'shop@maildrop.cc',
    contactNumber: '9840056789',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'C1',
    itemsSelling: 'Brass idols, handwoven baskets',
  }),
  vendor({
    stallName: 'Rashi Sandwich Corner',
    requesterName: 'Rashi',
    email: 'rashi@maildrop.cc',
    contactNumber: '9840067890',
    preferredZoneCode: 'B3',
    itemsSelling: 'Grilled sandwiches',
  }),
  vendor({
    stallName: 'Waffles Spot',
    requesterName: 'Arjun',
    email: 'waffles@maildrop.cc',
    contactNumber: '9840078901',
    preferredZoneCode: 'A4',
    itemsSelling: 'Waffles, ice cream',
  }),
  lw({
    stallName: 'Seva Health Trust — Free Health Camp',
    requesterName: 'Gopal Krishnan',
    email: 'seva@maildrop.cc',
    contactNumber: '9840089012',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'A3',
    itemsSelling: 'Free BP & sugar check-up',
    appliances: [{ name: 'Laptop', watts: 100 }],
  }),
  lw({
    stallName: 'School Fundraiser Stall',
    requesterName: 'Deepa Ramanathan',
    email: 'cps@maildrop.cc',
    contactNumber: '9840090123',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'C2',
    itemsSelling: 'Handmade crafts, greeting cards',
  }),
  lw({
    stallName: 'Kodiveli Amman Idli Kadai',
    requesterName: 'Meena',
    email: 'idli@maildrop.cc',
    contactNumber: '9840001234',
    preferredZoneCode: 'C1',
    itemsSelling: 'Idli, dosa, filter coffee',
    gasStoves: 2,
    appliances: [
      { name: 'Wet grinder', watts: 1000 },
      { name: 'Deep freezer', watts: 900 },
    ],
  }),
  lw({
    stallName: 'SKS Fresh Juice and Snack',
    requesterName: 'Sankar',
    email: 'sks@maildrop.cc',
    contactNumber: '9840011111',
    preferredZoneCode: 'B4',
    itemsSelling: 'Fresh juice, snacks',
    appliances: [
      { name: 'Mixie', watts: 1000 },
      { name: 'Cooler 400 ltr', watts: 200 },
    ],
  }),
  ashram(
    {
      stallName: 'Ashram Publications Stall',
      email: 'ashram.pub@maildrop.cc',
      preferredZoneCode: 'A4',
      itemsSelling: 'Books, calendars, audio CDs',
    },
    {
      departmentHead: 'Ravi Shankar',
      departmentHeadContact: '9840012340',
      department: 'Publications',
      requestedBy: 'Meera Iyer',
      requesterContact: '9840012341',
    },
  ),
  ashram(
    {
      stallName: 'Wellness Center Stall',
      email: 'wellness@maildrop.cc',
      preferredZoneCode: 'A4',
      itemsSelling: 'Wellness program brochures, consultation desk',
    },
    {
      departmentHead: 'Lakshmi Narayan',
      departmentHeadContact: '9840012342',
      department: 'Wellness Center',
      requestedBy: 'Suresh Kumar',
      requesterContact: '9840012343',
      creditCardNeeded: true,
      usage: 'DEPT_DISPLAY',
    },
  ),
  ashram(
    {
      stallName: 'Isha Bhiksha Promo',
      email: 'bhiksha@maildrop.cc',
      preferredZoneCode: 'B4',
      itemsSelling: 'Bhiksha — donation counter',
    },
    {
      departmentHead: 'Vikram Sethu',
      departmentHeadContact: '9840012344',
      department: 'Isha Bhiksha',
      requestedBy: 'Arjun Balaji',
      requesterContact: '9840012345',
      usage: 'SPONSOR',
      wantsThembu: true,
    },
  ),
  {
    ...ashram(
      {
        stallName: 'Annapurna Kitchen',
        email: 'annapurna@maildrop.cc',
        preferredZoneCode: 'B3',
        itemsSelling: 'South Indian meals, filter coffee',
        gasStoves: 2,
        appliances: [
          { name: 'Hot bain-marie', watts: 3000 },
          { name: 'Coffee machine', watts: 3000 },
        ],
      },
      {
        departmentHead: 'Deepa Ramanathan',
        departmentHeadContact: '9840012346',
        department: 'Annapurna',
        requestedBy: 'Kavya Nair',
        requesterContact: '9840012347',
        fssaiExpected: true,
      },
    ),
    stallType: 'FOOD',
  },
];

/** What the module needs, built the way `app.ts` builds it so the seed drives
 *  the real seams rather than writing rows behind them. */
function seedDeps(mail: LogMailer): StallsDeps {
  const dir = devMediaDir();
  const files: MediaStore = dir
    ? new DiskMediaStore(dir, 'stalls/')
    : {
        // No media directory configured: presign anyway so the seed can record
        // that documents arrived. Nothing reads the bytes back.
        configured: () => true,
        presignUpload: async (o) => ({ url: `memory://${o.key}`, headers: {}, expiresIn: 900 }),
        presignView: async (key) => `memory://${key}`,
        head: async () => null,
        deleteMany: async () => {},
      };
  const origin = 'http://localhost:5173';
  return {
    files,
    mail,
    statusUrl: (t) => `${origin}/stalls/status/${t}`,
    bankFormUrl: (t) => `${origin}/stalls/bank/${t}`,
    passwordResetUrl: (t) => `${origin}/stalls/reset/${t}`,
    fssaiUrl: (t) => `${origin}/stalls/fssai/${t}`,
    staffRegistrationUrl: (c) => `${origin}/stalls/staff/${c}`,
    signatureUrl: (t) => `${origin}/stalls/sign/${t}`,
    whatsapp: createLoggingWhatsAppSender(() => {}),
    signer: createUnconfiguredSigner(),
    publicRateLimitMax: 1000,
  };
}

/** A key of the shape `presignUpload` mints, so the seeded documents pass the
 *  same `isOurKey` check a real submission does. */
async function fakeUpload(_files: MediaStore, folder: string): Promise<string> {
  return `stalls/${folder}/${randomUUID()}.pdf`;
}

async function main() {
  const existing = await prisma.stallEdition.count();
  if (existing > 0 && !force) {
    console.log(
      `Database already has ${existing} edition(s). Pass --force to wipe stalls data and reseed.`,
    );
    return;
  }
  if (force) {
    const rows = await prisma.$queryRaw<Array<{ table_schema: string; table_name: string }>>`
      select table_schema, table_name from information_schema.tables
      where table_schema in ('stalls','foundation') and table_type='BASE TABLE' and table_name <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${rows.map((r) => `"${r.table_schema}"."${r.table_name}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    console.log('Wiped.');
  }

  // The roles themselves, before anybody is granted one.
  //
  // The migration installs them, so this is a top-up rather than the only
  // source — but the seed truncates the stalls tables when run with --force,
  // and a grant cannot be written against a role table that is not there.
  await seedRbac(prisma);

  // Backoffice
  const people = new Map<string, string>();
  for (const s of BACKOFFICE) {
    const p = await prisma.person.upsert({
      where: { email: s.email },
      create: { email: s.email, displayName: s.displayName },
      update: { displayName: s.displayName },
    });
    people.set(s.email, p.personId);
    for (const roleKey of s.roles) {
      await prisma.stallBackofficeRole.upsert({
        where: { personRef_roleKey: { personRef: p.personId, roleKey } },
        create: { personRef: p.personId, roleKey, grantedBy: SYSTEM },
        update: {},
      });
    }
  }
  const lead = people.get('deepa.r@maildrop.cc') ?? SYSTEM;
  console.log(`Backoffice members: ${BACKOFFICE.length}`);

  // Edition + plan
  const edition = await createEdition(
    prisma,
    { year: EDITION_YEAR, name: `Stalls ${EDITION_YEAR}`, activate: true },
    SYSTEM,
  );
  await writePlan(
    prisma,
    edition.id,
    {
      rows: (Object.keys(PLAN) as ZoneCode[]).map((zoneCode) => ({
        zoneCode,
        counts: PLAN[zoneCode],
      })),
    },
    lead,
  );
  const applied = await applyPlan(prisma, edition.id, lead);
  console.log(`Edition ${edition.year}: ${applied.created.length} stalls generated`);

  // Requests
  const mail = new LogMailer();
  const ids: string[] = [];
  for (const body of REQUESTS) {
    // The form is behind a session in the app; the seed has no browser, so it
    // creates the account the session would have named, and gives it a login
    // you can actually use — see DEV_PASSWORD.
    const email = String(body.email).trim().toLowerCase();
    const account = await prisma.stallAccount.upsert({
      where: { email },
      update: {},
      create: {
        email,
        phone: String(body.contactNumber),
        displayName: String(body.requesterName),
      },
    });
    await prisma.stallCredential.upsert({
      where: { loginValue: email },
      update: {},
      create: {
        accountId: account.id,
        loginValue: email,
        loginKind: 'EMAIL',
        passwordHash: await hashPassword(DEV_PASSWORD),
      },
    });
    const r = await submitRequest(
      prisma,
      SubmitRequestInput.parse(body),
      { mail, statusUrl: (t) => `http://localhost:5173/stalls/status/${t}` },
      account.id,
    );
    ids.push(r.requestId);
  }
  console.log(`Requests: ${ids.length} (each requester logs in with ${DEV_PASSWORD})`);

  // A requester who cannot get in, and one who never tried.
  //
  // ⚠️ Without these the Users directory's "Locked out" tile reads zero on
  // every developer's machine, so the state — and the support action that
  // clears it — is first seen in production, on a call from a vendor. A seed
  // that only shows the happy path hides exactly the screens built for the
  // unhappy one.
  const locked = await prisma.stallAccount.upsert({
    where: { email: 'locked.vendor@maildrop.cc' },
    update: {},
    create: {
      email: 'locked.vendor@maildrop.cc',
      phone: '9840099002',
      displayName: 'Sunita Rao',
      // ⚠️ Set, though neither of these two has ever applied. An account with
      // no type is offered all three forms — the state a row that pre-dates the
      // question is in — and seeding both of the module's spare accounts into
      // it would hide the ordinary case, which is an account that may fill one.
      requesterType: 'VENDOR',
    },
  });
  await prisma.stallCredential.upsert({
    where: { loginValue: locked.email },
    update: {},
    create: {
      accountId: locked.id,
      loginValue: locked.email,
      loginKind: 'EMAIL',
      passwordHash: await hashPassword(DEV_PASSWORD),
      failedCount: 10,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    },
  });

  // No credential at all — the ORDINARY requester, who uses the emailed status
  // link and nothing else. Here so "Link only" is visibly the common case
  // rather than an edge one.
  await prisma.stallAccount.upsert({
    where: { email: 'linkonly.vendor@maildrop.cc' },
    update: {},
    create: {
      email: 'linkonly.vendor@maildrop.cc',
      phone: '9840099003',
      displayName: 'Anand Prakash',
      requesterType: 'VENDOR',
    },
  });
  console.log('Users: 1 locked out, 1 link-only (for the Users directory)');

  // A realistic pipeline state
  await shortlist(prisma, ids[1], lead); // Coastal Spice
  await shortlist(prisma, ids[3], lead); // Bliss Bites
  await selectRequest(prisma, { requestId: ids[0], stallNumbers: ['C1-1'] }, lead); // Green Leaf
  await selectRequest(prisma, { requestId: ids[11], stallNumbers: ['A4-8'] }, lead); // Publications
  await selectRequest(prisma, { requestId: ids[12], stallNumbers: ['A4-9'] }, lead); // Wellness
  await selectRequest(prisma, { requestId: ids[7], stallNumbers: ['A3-1'] }, lead); // Health camp
  await flagRequest(
    prisma,
    ids[6],
    `Possible duplicate of a ${EDITION_YEAR - 1} vendor — confirm GST number`,
    lead,
  );
  console.log('Pipeline: 2 shortlisted, 4 selected, 1 flagged');

  // ── Phase 2: onboarding and money ─────────────────────────────────────────
  //
  // Walks ONE vendor (Green Leaf) the whole way — letter, bank form, payment
  // email, confirmed credit, certificate, staff registered — and leaves the others part
  // way, so every screen has both a finished row and an outstanding one to
  // look at. Everything below goes through the same seams the routes call; the
  // seed never writes a state the application could not have produced.
  const deps = seedDeps(mail);
  const greenLeaf = ids[0];
  const publications = ids[11];
  const healthCamp = ids[7];

  await sendTemplate(
    prisma,
    edition.id,
    { templateKey: 'SELECTION_VENDOR', requestIds: [greenLeaf] },
    deps,
    lead,
  );
  await sendTemplate(
    prisma,
    edition.id,
    { templateKey: 'SELECTION_ASHRAM', requestIds: [publications] },
    deps,
    lead,
  );

  await submitBankDetails(
    prisma,
    greenLeaf,
    {
      email: 'priya@maildrop.cc',
      invoiceName: 'Green Leaf Organics Pvt Ltd',
      accountHolder: 'Green Leaf Organics Pvt Ltd',
      mobile: '9840012345',
      address: '12 Mettupalayam Road, Coimbatore',
      pincode: '641043',
      bankName: 'HDFC Bank',
      branch: 'RS Puram',
      accountNumber: '50100123456789',
      ifsc: 'HDFC0001234',
      micr: '641240002',
      panNumber: 'ABCDE1234F',
      gstNumber: '33ABCDE1234F1Z5',
      chequeKey: await fakeUpload(deps.files, 'bank/cheque'),
      panKey: await fakeUpload(deps.files, 'bank/pan'),
      gstKey: '',
      // Consent is declaration rows now. The seed posts no `declarationIds`,
      // which is the documented "I make no claim about what I displayed" case —
      // the submit path then logs whatever is live. See `DeclarationIds`.
      plugs5a: 4,
      plugs15a: 5,
      gasStoves: 1,
      appliances: [
        { name: 'Deep fryer', watts: 2500 },
        { name: 'Freezer', watts: 1500 },
      ],
      tablesNeeded: 2,
      chairsNeeded: 6,
      passes2w: 1,
      passes4w: 1,
      passesStaff: 3,
      remarks: 'Please place us near a water point if possible.',
    },
    { actor: { kind: 'SYSTEM' } },
  );

  await sendTemplate(
    prisma,
    edition.id,
    { templateKey: 'PAYMENT_DETAILS', requestIds: [greenLeaf] },
    deps,
    lead,
  );

  const finance = people.get('meena.k@maildrop.cc') ?? SYSTEM;
  const plan = await prisma.stallPaymentPlan.findUniqueOrThrow({
    where: { requestId: greenLeaf },
  });
  await confirmPayment(
    prisma,
    greenLeaf,
    {
      purpose: 'RENT',
      referenceNo: bankRef(RENT_RECEIVED_ON, 1),
      eCollectCode: 'IFCTGE39840012345',
      amountPaise: plan.feeTotalPaise,
      receivedOn: RENT_RECEIVED_ON,
      remitterName: 'GREEN LEAF ORGANICS',
      mode: 'NEFT',
    },
    finance,
  );
  await confirmPayment(
    prisma,
    greenLeaf,
    {
      purpose: 'DEPOSIT',
      referenceNo: bankRef(DEPOSIT_RECEIVED_ON, 2),
      amountPaise: plan.depositTotalPaise,
      receivedOn: DEPOSIT_RECEIVED_ON,
      remitterName: 'GREEN LEAF ORGANICS',
      mode: 'NEFT',
    },
    finance,
  );

  // Two vendors left mid-flow, with a chasing call logged against each.
  await logReminder(
    prisma,
    healthCamp,
    { kind: 'BANK', note: 'No answer, will try tomorrow' },
    lead,
  );
  await logReminder(prisma, healthCamp, { kind: 'PAYMENT' }, lead);
  console.log('Phase 2: 2 letters sent, 1 bank form in, 1 vendor paid in full');

  // ── Phase 3: event operations ─────────────────────────────────────────────
  await sendTemplate(
    prisma,
    edition.id,
    { templateKey: 'ONBOARDING_FSSAI_STAFF', requestIds: [greenLeaf] },
    deps,
    lead,
  );
  await submitFssai(
    prisma,
    greenLeaf,
    {
      stallName: 'Green Leaf Organics',
      ownerName: 'Priya Venkat',
      mobile: '9840012345',
      files: [{ key: await fakeUpload(deps.files, 'fssai'), name: 'fssai-certificate.pdf' }],
    },
    { actor: { kind: 'SYSTEM' } },
  );
  await verifyFssai(prisma, greenLeaf, true, lead);

  const coupon = await ensureCoupon(prisma, greenLeaf, 'Green Leaf Organics', edition.year, lead);
  for (const person of [
    { name: 'Ravi Kumar', mobile: '9840055551', role: 'Cook' },
    { name: 'Meena S', mobile: '9840055552', role: 'Cashier' },
  ]) {
    await registerStaff(
      prisma,
      {
        couponCode: coupon.code,
        name: person.name,
        mobile: person.mobile,
        idType: 'AADHAAR',
        idNumber: `1234567890${person.mobile.slice(-2)}`,
        role: person.role,
      },
      { actor: { kind: 'SYSTEM' } },
    );
  }

  const volunteer = people.get('kavya.n@maildrop.cc') ?? SYSTEM;
  await actOnEquipment(prisma, greenLeaf, 'DISTRIBUTE', volunteer);
  await patchEquipment(prisma, greenLeaf, { extraChairs: 2 }, volunteer);
  await actOnEquipment(prisma, greenLeaf, 'COLLECT_EXTRA_PAYMENT', volunteer);
  await checkIn(prisma, greenLeaf, undefined, volunteer);

  // A stall that came back short, so the refund screen has something to price.
  await patchEquipment(
    prisma,
    healthCamp,
    { missingChairs: 1, damaged: true, note: '1 chair broken', flagged: true },
    volunteer,
  );
  console.log(`Phase 3: staff coupon ${coupon.code}, 2 staff registered, 1 stall checked in`);

  const first = mail.sent[0];
  if (first)
    console.log(`\nA vendor status link (Green Leaf):\n  ${first.text.match(/http\S+/)?.[0]}`);
  console.log(`Staff registration: http://localhost:5173/stalls/staff/${coupon.code}`);
  console.log('\nSign in at http://localhost:5173/m/stalls as any of:');
  for (const s of BACKOFFICE)
    console.log(`  ${s.displayName.padEnd(18)} ${s.email}  ${s.roles.join(', ') || '(no role)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
