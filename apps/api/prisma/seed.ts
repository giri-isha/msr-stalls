// Development seed: a 2026 edition, four staff, a plan applied across every
// zone, and a realistic spread of requests drawn from the 2025 prototype data
// — some shortlisted, some selected onto real stalls, one flagged.
//
// Refuses to run against a database that already has an edition, so it can
// never double-seed. Pass --force to wipe the stalls tables first.
import { STALL_CATEGORIES, SubmitRequestInput, type ZoneCode } from '@msr/stalls';
import type { StallCategory } from '@prisma/client';
import { LogMailer } from '../src/email';
import { createEdition } from '../src/modules/stalls/config';
import { applyPlan, writePlan } from '../src/modules/stalls/planning';
import { flagRequest } from '../src/modules/stalls/requests';
import { selectRequest, shortlist } from '../src/modules/stalls/selection';
import { submitRequest } from '../src/modules/stalls/submit';
import { prisma } from '../src/prisma';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const force = process.argv.includes('--force');

const STAFF = [
  { email: 'vikram.s@ishafoundation.org', displayName: 'Vikram Sethu', roles: ['stalls_admin'] },
  { email: 'deepa.r@ishafoundation.org', displayName: 'Deepa Ramanathan', roles: ['stalls_lead'] },
  { email: 'kavya.n@ishafoundation.org', displayName: 'Kavya Nair', roles: ['stalls_volunteer'] },
  { email: 'meena.k@ishafoundation.org', displayName: 'Meena Krishnan', roles: ['stalls_finance'] },
  { email: 'arjun.b@ishafoundation.org', displayName: 'Arjun Balaji', roles: [] },
];

/** The 2025 planning sheet, per zone × category (from the prototype). */
const PLAN: Record<ZoneCode, Partial<Record<StallCategory, number>>> = {
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
/** The ashram forms have no vendor name or contact of their own; like the web
 *  form, the requester is the person named in the department block. */
const ashram = (o: Record<string, unknown>, block: Record<string, unknown>) => ({
  requestType: 'ASHRAM',
  stallType: 'NON_FOOD',
  numStallsRequested: 1,
  agreed: true,
  requesterName: block.requestedBy,
  contactNumber: block.requesterContact,
  plugs5a: 1,
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
    email: 'priya@greenleaf.example',
    contactNumber: '9840012345',
    preferredZoneCode: 'C1',
    itemsSelling: 'Organic spices, cold-pressed oils, honey',
  }),
  vendor({
    stallName: 'Coastal Spice Kitchen',
    requesterName: 'Rajendran',
    email: 'orders@coastalspice.example',
    contactNumber: '9840023456',
    preferredZoneCode: 'B4',
    itemsSelling: 'Seafood biryani, fish fry, prawn curry',
    numStallsRequested: 2,
    remarks: 'Requires extra ventilation',
  }),
  vendor({
    stallName: 'Little Wonders Toys',
    requesterName: 'Suresh Kumar',
    email: 'hello@littlewonders.example',
    contactNumber: '9840034567',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'A4',
    itemsSelling: 'Wooden toys, puzzles',
  }),
  vendor({
    stallName: 'Bliss Bites Cafe',
    requesterName: 'Kavya Nair',
    email: 'bliss@bites.example',
    contactNumber: '9840045678',
    preferredZoneCode: 'C2',
    itemsSelling: 'Sandwiches, smoothies, cold coffee',
  }),
  vendor({
    stallName: 'Mahalakshmi Handicrafts',
    requesterName: 'Lakshmi Narayan',
    email: 'shop@mahalakshmi.example',
    contactNumber: '9840056789',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'C1',
    itemsSelling: 'Brass idols, handwoven baskets',
  }),
  vendor({
    stallName: 'Rashi Sandwich Corner',
    requesterName: 'Rashi',
    email: 'rashi@sandwich.example',
    contactNumber: '9840067890',
    preferredZoneCode: 'B3',
    itemsSelling: 'Grilled sandwiches',
  }),
  vendor({
    stallName: 'Waffles Spot',
    requesterName: 'Arjun',
    email: 'waffles@spot.example',
    contactNumber: '9840078901',
    preferredZoneCode: 'A4',
    itemsSelling: 'Waffles, ice cream',
  }),
  lw({
    stallName: 'Seva Health Trust — Free Health Camp',
    requesterName: 'Gopal Krishnan',
    email: 'seva@health.example',
    contactNumber: '9840089012',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'A3',
    itemsSelling: 'Free BP & sugar check-up',
    appliances: [{ name: 'Laptop', watts: 100 }],
  }),
  lw({
    stallName: 'School Fundraiser Stall',
    requesterName: 'Deepa Ramanathan',
    email: 'cps@school.example',
    contactNumber: '9840090123',
    stallType: 'NON_FOOD',
    preferredZoneCode: 'C2',
    itemsSelling: 'Handmade crafts, greeting cards',
  }),
  lw({
    stallName: 'Kodiveli Amman Idli Kadai',
    requesterName: 'Meena',
    email: 'idli@kadai.example',
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
    email: 'sks@juice.example',
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
      email: 'ashram.pub@example.org',
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
      email: 'wellness@example.org',
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
      email: 'bhiksha@example.org',
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
        email: 'annapurna@example.org',
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
    requestType: 'ASHRAM_FOOD',
    stallType: 'FOOD',
  },
];

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

  // Staff
  const people = new Map<string, string>();
  for (const s of STAFF) {
    const p = await prisma.person.upsert({
      where: { email: s.email },
      create: { email: s.email, displayName: s.displayName },
      update: { displayName: s.displayName },
    });
    people.set(s.email, p.personId);
    for (const roleKey of s.roles) {
      await prisma.stallStaffRole.upsert({
        where: { personRef_roleKey: { personRef: p.personId, roleKey } },
        create: { personRef: p.personId, roleKey, grantedBy: SYSTEM },
        update: {},
      });
    }
  }
  const lead = people.get('deepa.r@ishafoundation.org') ?? SYSTEM;
  console.log(`Staff: ${STAFF.length}`);

  // Edition + plan
  const edition = await createEdition(
    prisma,
    { year: 2026, name: 'MSR 2026', activate: true },
    SYSTEM,
  );
  await writePlan(
    prisma,
    edition.id,
    {
      rows: (Object.keys(PLAN) as ZoneCode[]).map((zoneCode) => ({
        zoneCode,
        counts: Object.fromEntries(
          STALL_CATEGORIES.map((c) => [c, PLAN[zoneCode][c] ?? 0]),
        ) as Record<StallCategory, number>,
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
    const r = await submitRequest(prisma, SubmitRequestInput.parse(body), {
      mail,
      statusUrl: (t) => `http://localhost:5173/stalls/status/${t}`,
    });
    ids.push(r.requestId);
  }
  console.log(`Requests: ${ids.length}`);

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
    'Possible duplicate of a 2025 vendor — confirm GST number',
    lead,
  );
  console.log('Pipeline: 2 shortlisted, 4 selected, 1 flagged');

  const first = mail.sent[0];
  if (first)
    console.log(`\nA vendor status link (Green Leaf):\n  ${first.text.match(/http\S+/)?.[0]}`);
  console.log('\nSign in at http://localhost:5173/m/stalls as any of:');
  for (const s of STAFF)
    console.log(`  ${s.displayName.padEnd(18)} ${s.email}  ${s.roles.join(', ') || '(no role)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
