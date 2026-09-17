/** This module's own access control.
 *
 *  Host ADR 0016: the Foundation records only THAT a person uses a module; which
 *  role they hold is the module's own fact, granted on the module's own Users
 *  screen against its own table. Nothing here is stored by the host, so nothing
 *  here can go stale against it.
 *
 *  ⚠️ **Roles are DATA now, not code.** What a role grants lives in
 *  `StallRole` / `StallRolePrivilege` and an admin edits it without a deploy
 *  (host ADR 0018, which superseded ADR 0005 once that requirement became real).
 *  What survives in this file is the half that must stay code:
 *
 *    - the **privilege vocabulary** — a privilege means nothing unless a route
 *      enforces it, so you compose roles at runtime, you never invent privileges;
 *    - the **seed** the six shipped roles are built from;
 *    - the **rules** — union, scope, and who may hand out which role — kept pure
 *      so they are testable without a database.
 *
 *  Nothing here reads a table. The API resolves rows and hands them in. */
export const MODULE_KEY = 'stalls';

/* ── The vocabulary ─────────────────────────────────────────────────────────*/

/** `sensitive` is deliberately distinct from `action`: a read that reaches bank
 *  details gates differently from an ordinary one, and the role editor says so. */
export const PRIVILEGE_KINDS = ['view', 'action', 'config', 'sensitive', 'export'] as const;
export type PrivilegeKind = (typeof PRIVILEGE_KINDS)[number];

/** Every privilege code, as literals.
 *
 *  ⚠️ **Declared, not computed.** msr builds its codes at runtime
 *  (`${prefix}.${slug(label)}`), which is why its ~40 call sites pass bare
 *  strings that no compiler checks. These codes are a literal union threaded
 *  through `requirePrivilege`, the web's `can()`, the nav registry and the
 *  documentation screen, so a rename is a type error rather than a silent
 *  mismatch. That is worth more than deriving them from the labels, and it is
 *  why `PRIVILEGE_CATEGORIES` below repeats each code instead of generating it —
 *  a test asserts the two lists cannot drift apart. */
export const STALL_PRIVILEGES = [
  'requests.read',
  'requests.write',
  'planning.read',
  'planning.write',
  'electrical.read',
  'selection.read',
  'selection.write',
  'comms.read',
  'comms.write',
  'onboarding.read',
  'onboarding.write',
  'finance.read',
  'finance.write',
  'concession.write',
  'refunds.write',
  'checkin.read',
  'checkin.write',
  'equipment.read',
  'equipment.write',
  'config.read',
  'config.write',
  'users.write',
  'roles.write',
  'passwords.write',
  'audit.read',
  'filing.request',
  'filing.bank',
  'filing.fssai',
  'filing.staff',
  'filing.claim',
] as const;
export type StallPrivilege = (typeof STALL_PRIVILEGES)[number];

export interface PrivilegeDef {
  code: StallPrivilege;
  label: string;
  kind: PrivilegeKind;
  description: string;
}

export interface PrivilegeCategory {
  key: string;
  name: string;
  items: readonly PrivilegeDef[];
}

/** The privileges, grouped the way a role is granted them.
 *
 *  A category is the unit somebody hands over whole, which is why the grouping
 *  is not merely cosmetic — see `electrical` below. `kind` gates nothing at
 *  runtime; it is what the role editor colours and sorts by. */
export const PRIVILEGE_CATEGORIES: readonly PrivilegeCategory[] = [
  {
    key: 'requests',
    name: 'Requests',
    items: [
      {
        code: 'requests.read',
        label: 'View requests',
        kind: 'view',
        description: 'Open the request list and any request record.',
      },
      {
        code: 'requests.write',
        label: 'Amend requests',
        kind: 'action',
        // ⚠️ Amending, not filing. Entering a request FOR somebody is
        // `filing.request` — its own privilege in its own category, because
        // speaking for a requester is not the same power as correcting a
        // number they gave you.
        description: 'Amend a request after it was filed, and flag one for follow-up.',
      },
    ],
  },
  {
    key: 'planning',
    name: 'Planning',
    items: [
      {
        code: 'planning.read',
        label: 'View the planning grid',
        kind: 'view',
        description: 'The bay-by-bay plan and what is allotted where.',
      },
      {
        code: 'planning.write',
        label: 'Plan and allot stalls',
        kind: 'action',
        description: 'Write a zone plan, apply it, and move allotments.',
      },
    ],
  },
  {
    /** 🔴 Its own category, never a corner of Planning.
     *
     *  The requirement is to SHARE the stall-wise electrical and layout sheet
     *  with the electrical and venue-prep teams, who are not the stalls team.
     *  A category is the unit a role is granted whole, so folding this in would
     *  quietly undo the reason the privilege exists: it would hand them the
     *  planning grid, the allotments and every requester's details to get a
     *  plug-point count — which is what gets the sheet printed and emailed
     *  instead, which is what this replaces. */
    key: 'electrical',
    name: 'Electrical & Venue Prep',
    items: [
      {
        code: 'electrical.read',
        label: 'View the electrical sheet',
        kind: 'view',
        description: 'The stall-wise electrical and layout sheet, and the bay list.',
      },
    ],
  },
  {
    key: 'selection',
    name: 'Selection',
    items: [
      {
        code: 'selection.read',
        label: 'View shortlisting and selection',
        kind: 'view',
        description: 'Who is shortlisted, selected, waitlisted or declined.',
      },
      {
        code: 'selection.write',
        label: 'Shortlist, select and decline',
        kind: 'action',
        description: 'Move a request through selection, and reverse it.',
      },
    ],
  },
  {
    key: 'comms',
    name: 'Communication',
    items: [
      {
        /** 🔴 The reads on this screen were gated on `comms.write`, so "let me
         *  see which letters have gone out" could only be answered by handing
         *  somebody the button that emails every vendor in the edition. */
        code: 'comms.read',
        label: 'View letters and what has been sent',
        kind: 'view',
        description: 'The letter templates, the recipient list, and the log of reminder calls.',
      },
      {
        code: 'comms.write',
        label: 'Send messages and reminders',
        kind: 'action',
        description: 'Send a templated email or WhatsApp message, and log a reminder.',
      },
    ],
  },
  {
    /** Its own category rather than a corner of Requests.
     *
     *  🔴 Every onboarding read was gated on `requests.read`, which opens ANY
     *  request record in full — what a vendor sells, their appliances, their
     *  contacts. Chasing a bank form and an FSSAI certificate needs none of
     *  that, and a desk doing the chasing should not have to be handed it. */
    key: 'onboarding',
    name: 'Vendor Onboarding',
    items: [
      {
        code: 'onboarding.read',
        label: 'View onboarding',
        kind: 'view',
        description: 'What each selected stall still owes: bank form, contract, FSSAI, staff.',
      },
      {
        code: 'onboarding.write',
        label: 'Issue coupons and verify documents',
        kind: 'action',
        description:
          'Issue a staff coupon and set what it admits, tick an FSSAI certificate as seen, and remove a staff registration.',
      },
    ],
  },
  {
    key: 'finance',
    name: 'Finance',
    items: [
      {
        code: 'finance.read',
        label: 'View payments and bank details',
        kind: 'sensitive',
        description: "Payment status, the virtual accounts, and a requester's bank details.",
      },
      {
        code: 'finance.write',
        label: 'Confirm payments',
        kind: 'action',
        description: 'Match a credit to a request and confirm it.',
      },
      {
        /** 🔴 Its OWN privilege, and not part of `finance.write`.
         *
         *  Agreeing the fee is not the same act as confirming a payment.
         *  "For A3 the cost is 10,000 — for the coconut wala, probably we will
         *  give that stall at 5,000" is a judgement made by whoever is
         *  negotiating with the trader, in the same conversation as the bay and
         *  the number of stalls. Matching a credit against a bank statement is
         *  a different job done by different people, and folding the two
         *  together meant the person who actually agrees the figure could not
         *  record it without also being handed the payment ledger.
         *
         *  ⚠️ It implies NO read — see `IMPLIED_READ`. Every other write there
         *  unlocks its own screen, and the screen this one would unlock is
         *  `finance.read`, which is `sensitive`: it carries a requester's bank
         *  account. Conceding one figure is not a reason to be shown that, and
         *  the roles that hold this privilege hold `finance.read` on their own
         *  terms where they need it. */
        code: 'concession.write',
        label: 'Agree a different fee for one stall',
        kind: 'action',
        description:
          'Record the fee agreed with one requester where it differs from the rate card, and the reason it was reduced. The quoted figure is kept beside it.',
      },
      {
        code: 'refunds.write',
        label: 'Issue refunds',
        kind: 'action',
        description: 'Return the refundable advance at the end of the edition.',
      },
    ],
  },
  {
    key: 'checkin',
    name: 'Check-in',
    items: [
      {
        /** 🔴 The check-in LIST was gated on `requests.read`. A volunteer on
         *  the gate held `checkin.write` and still could not see the screen
         *  they were there to work, unless they were also handed every
         *  requester's application. */
        code: 'checkin.read',
        label: 'View the check-in list',
        kind: 'view',
        description: 'Who has arrived, who has not, and what is outstanding against them.',
      },
      {
        code: 'checkin.write',
        label: 'Check stalls in and out',
        kind: 'action',
        description: 'Record an arrival or reverse one.',
      },
    ],
  },
  {
    /** 🔴 Split out of `checkin.write`, which used to cover both.
     *
     *  These are two desks. The gate marks people present; the stores counter
     *  hands out furniture, takes cash for extras, prints a challan and notes
     *  what came back broken — and the cash makes it the one the module should
     *  be most careful about handing over. A category is the unit a role is
     *  granted whole (see `electrical`), so as long as they shared a code
     *  staffing one meant staffing the other. */
    key: 'equipment',
    name: 'Chairs & Tables',
    items: [
      {
        code: 'equipment.read',
        label: 'View chairs and tables',
        kind: 'view',
        description: 'What each stall is owed, what it has taken, and what came back.',
      },
      {
        code: 'equipment.write',
        label: 'Distribute, collect and charge',
        kind: 'action',
        description:
          'Hand furniture out, take cash for extras, print a challan, and record what returned short or damaged.',
      },
    ],
  },
  {
    key: 'config',
    name: 'Configuration',
    items: [
      {
        code: 'config.read',
        label: 'View configuration',
        kind: 'view',
        description: 'Editions, zones, rate cards, charges, fines and form fields.',
      },
      {
        code: 'config.write',
        label: 'Change configuration',
        kind: 'config',
        description: 'Create an edition and set the rates, charges and forms it runs on.',
      },
    ],
  },
  {
    key: 'access',
    name: 'Access',
    items: [
      {
        code: 'users.write',
        label: 'Grant and revoke access',
        kind: 'config',
        description: 'Add a backoffice member, grant a role, and revoke one.',
      },
      {
        /** ⚠️ The privilege that composes privileges. Whoever holds this can
         *  build a role and — if they also hold `users.write` — hand it to
         *  themselves, so the writes behind it refuse to put a privilege into a
         *  role that the author does not already hold. Without that rule this
         *  one line is a route to every other. */
        code: 'roles.write',
        label: 'Author roles',
        kind: 'config',
        description: 'Create roles, retune what they grant, and place them in the hierarchy.',
      },
      {
        /** ⚠️ TEMPORARY, and the only privilege in the module that will not
         *  survive the move into the host — see `credentials.ts` and step 3b of
         *  `docs/migration-to-host.md`. The host signs requesters in through
         *  Isha SSO, where no password is this module's to set, so this code
         *  and everything it guards is deleted rather than carried across.
         *
         *  ⚠️ Its own privilege, and NOT folded into `users.write`. Every other
         *  support action sends a link to the contact the ACCOUNT already
         *  holds, which is why a desk can be trusted with all of them — they
         *  can cause a vendor to receive their own way in, never obtain it.
         *  This one hands the desk a password that works, which is a different
         *  power, and it is `sensitive` for the same reason `finance.read` is. */
        code: 'passwords.write',
        label: "Set a requester's password",
        kind: 'sensitive',
        description:
          'Choose a password for a requester who cannot get in, and read it to them. Temporary — it goes when Isha SSO does the signing in.',
      },
    ],
  },
  {
    /** 🔴 Its own category, never five more items under Requests.
     *
     *  A category is the unit a role is granted whole, and these hand a
     *  backoffice member the power to speak FOR a requester — to file the
     *  form, to tick the declarations on their word, to upload their
     *  documents. Bundled with "amend a request" they would arrive with every
     *  role that corrects a phone number. */
    key: 'filing',
    name: 'Filing on behalf',
    items: [
      {
        code: 'filing.request',
        label: 'File a request for a requester',
        kind: 'action',
        description:
          'Enter a stall request on behalf of a vendor, department or trader, creating their account if they have none.',
      },
      {
        code: 'filing.bank',
        label: 'Enter a bank form for a requester',
        kind: 'action',
        description:
          'Fill in the bank, GST and contract form and upload its documents on their behalf.',
      },
      {
        code: 'filing.fssai',
        label: 'Upload an FSSAI certificate for a requester',
        kind: 'action',
        description: 'Upload the food licence a vendor sent by some other means.',
      },
      {
        code: 'filing.staff',
        label: 'Register staff for a stall',
        kind: 'action',
        description: "Register the people working a stall, against the stall's own coupon.",
      },
      {
        code: 'filing.claim',
        label: 'Record a transfer a requester reported',
        kind: 'action',
        description: 'Record a payment a requester reported by phone, for Finance to verify.',
      },
    ],
  },
  {
    /** 🔴 `sensitive`, like `finance.read`, and for the same kind of reason:
     *  the log carries the change sets of every record, so a reader of it sees
     *  what a bank form said before it was corrected. */
    key: 'audit',
    name: 'Audit',
    items: [
      {
        code: 'audit.read',
        label: 'Read the audit log',
        kind: 'sensitive',
        description:
          'Open the Audit Logs page and the Activity Log on a request: who did what, when, and what it said before.',
      },
    ],
  },
];

/**
 * The name a reader sees for the category a privilege row stores.
 *
 * ⚠️ The table holds the KEY (`finance`), because a name is copy and a key is
 * an identity; the screens that group by it — the role editor's tree and the
 * privilege catalogue — resolve it here rather than each keeping a map, which
 * is how two headings for one category start to drift.
 *
 * A key the code no longer names falls back to itself. A category can be
 * retired from the vocabulary while rows still carry it, and an ugly-but-true
 * heading keeps those rows readable where a blank one would lose them.
 */
export function privilegeCategoryName(key: string): string {
  return PRIVILEGE_CATEGORIES.find((c) => c.key === key)?.name ?? key;
}

/* ── The seed ───────────────────────────────────────────────────────────────*/

/** A role as it ships. The table is authoritative once seeded — this is the
 *  starting point an admin edits, not a mirror kept in step with it. */
export interface SeedRole {
  roleKey: string;
  name: string;
  /** Where the shipped tree puts it. 0 is the top. */
  level: number;
  description: string;
  /** The role this one sits under. `null` is the root of a branch. */
  parentKey: string | null;
  privileges: readonly StallPrivilege[];
  /** Carries every ACTIVE privilege, including ones added in a later release.
   *  A role holding this has no join rows at all — see `unionPrivileges`. */
  allPrivileges: boolean;
  /** May hand out this role as well as the ones under it. */
  canAssignSameLevel: boolean;
  /** Which requester types this role may see and touch. `null` is every type.
   *
   *  🔴 The local welfare team works inside this application — they file the
   *  requests, because the traders they file them for are village vendors who
   *  mostly have no email address and no way to fill a form themselves. That
   *  makes them backoffice members. It does not make them stall coordinators: they have no
   *  business reading a commercial vendor's bank details or rejecting somebody
   *  else's request. Without a scope the only way to let them enter a request
   *  is `requests.write`, which is unscoped, so the choice would be "give them
   *  everything" or "keep doing it on paper". */
  requestTypeScope: readonly string[] | null;
  sortOrder: number;
}

/** ⚠️ The reads a write implies are NOT listed — `can` resolves them (see
 *  `IMPLIED_READ`). `comms.write` is here and `comms.read` is not, because
 *  spelling out both would make the seed the second place the rule lives and
 *  the first place it goes out of step. */
const LEAD_PRIVILEGES = [
  'requests.read',
  'requests.write',
  'planning.read',
  'planning.write',
  'electrical.read',
  'selection.read',
  'selection.write',
  'comms.write',
  'onboarding.read',
  'onboarding.write',
  'finance.read',
  // 🔴 The one finance WRITE a lead holds, and deliberately not the others. A
  // lead runs the selection, and the fee is agreed in that same conversation —
  // before this existed the figure had to be carried to Finance afterwards,
  // which meant it was usually not recorded at all. Confirming payments and
  // issuing refunds remain Finance's.
  'concession.write',
  // ⚠️ Reads, no writes — which is exactly what a lead had before the split.
  // Both counter screens were gated on `requests.read`, so a lead could always
  // see them and could never work them; leaving these out would have taken
  // that away as a side effect of tidying the vocabulary.
  'checkin.read',
  'equipment.read',
  'config.read',
  'refunds.write',
  // Reads the log. Sensitive, like `finance.read`, and for the same reason.
  'audit.read',
  // Files any of the five requester forms for somebody who cannot.
  'filing.request',
  'filing.bank',
  'filing.fssai',
  'filing.staff',
  'filing.claim',
] as const;

/** The roles the module ships with.
 *
 *  Vendors are not here: an external vendor is a `StallAccount`, not a backoffice
 *  member, and never holds one of these. Keeping the two populations in
 *  separate tables is what stops a vendor ever being granted `config.write`.
 *
 *  The tree is the assignability tree. Admin sits above Lead, and everything
 *  operational hangs off Lead, so a lead can staff their own team without being
 *  able to mint another admin. */
export const SEED_ROLES: readonly SeedRole[] = [
  {
    roleKey: 'stalls_admin',
    level: 0,
    name: 'Admin',
    description: 'Full access, including module configuration',
    parentKey: null,
    privileges: [],
    allPrivileges: true,
    // An admin may appoint another admin. Nobody sits above them to do it.
    canAssignSameLevel: true,
    requestTypeScope: null,
    sortOrder: 0,
  },
  {
    roleKey: 'stalls_lead',
    level: 1,
    name: 'Lead (Stall Coordinator)',
    description: 'Planning, selection, communication and finance visibility',
    parentKey: 'stalls_admin',
    privileges: LEAD_PRIVILEGES,
    allPrivileges: false,
    canAssignSameLevel: false,
    requestTypeScope: null,
    sortOrder: 1,
  },
  {
    roleKey: 'stalls_volunteer',
    level: 2,
    name: 'Volunteer',
    description: 'Check-in, chairs and tables',
    parentKey: 'stalls_lead',
    /** 🔴 `requests.read` is GONE from this role, and that is the change, not a
     *  tidy-up. A volunteer on the gate needed it to see the check-in list at
     *  all — so staffing the gate for an evening meant handing over every
     *  requester's full application: what they sell, their appliances, their
     *  contacts. The two screens they actually work now have codes of their
     *  own, and this role holds exactly those. */
    privileges: ['checkin.write', 'equipment.write'],
    allPrivileges: false,
    canAssignSameLevel: false,
    requestTypeScope: null,
    sortOrder: 2,
  },
  {
    roleKey: 'stalls_finance',
    level: 2,
    name: 'Finance',
    description: 'Payment confirmation and refunds',
    parentKey: 'stalls_lead',
    privileges: [
      'requests.read',
      'finance.read',
      'finance.write',
      'concession.write',
      'onboarding.read',
    ],
    allPrivileges: false,
    canAssignSameLevel: false,
    requestTypeScope: null,
    sortOrder: 3,
  },
  {
    roleKey: 'stalls_electrical',
    level: 2,
    name: 'Electrical & Venue Prep',
    description: 'The stall-wise electrical and layout sheet, read only',
    parentKey: 'stalls_lead',
    privileges: ['electrical.read'],
    allPrivileges: false,
    canAssignSameLevel: false,
    requestTypeScope: null,
    sortOrder: 4,
  },
  {
    roleKey: 'stalls_local_welfare',
    level: 2,
    name: 'Local Welfare',
    description: 'Files and follows up local welfare stalls, and nothing else',
    parentKey: 'stalls_lead',
    privileges: [
      'requests.read',
      'requests.write',
      'selection.read',
      'finance.read',
      // 🔴 The team in the quote. `setDiscretionaryFee` is documented as "the
      // concession the local welfare team agreed on one stall — the judgement
      // is theirs, per trader", and this is that judgement being writable by
      // the people who make it.
      //
      // ⚠️ Contained by `requestTypeScope: ['LOCAL_WELFARE']` and the route's
      // own `requireRequestScope`: this team can concede on their own villages'
      // stalls and on nothing else.
      'concession.write',
      'comms.read',
      'onboarding.read',
      // Both counter screens, read-only and NARROWED to this team's own
      // villages by `requestTypeScope` — the reach they already had when both
      // were gated on `requests.read`. Following a stall up includes knowing
      // whether the trader turned up and what furniture they took.
      'checkin.read',
      'equipment.read',
      // 🔴 Files for the village traders who have no email address — the
      // reason this role exists at all. Never `filing.bank`: a local welfare
      // stall is not asked for bank details.
      'filing.request',
      'filing.fssai',
      'filing.staff',
      'filing.claim',
    ],
    allPrivileges: false,
    canAssignSameLevel: false,
    requestTypeScope: ['LOCAL_WELFARE'],
    sortOrder: 5,
  },
];

/* ── Resolution ─────────────────────────────────────────────────────────────*/

/** One of the caller's grants, as the API read it out of the tables.
 *
 *  Two kinds of scope meet here, and they sit on different rows. `requestTypeScope`
 *  belongs to the ROLE — it is what the role is for. `editionScope` and
 *  `zoneScope` belong to the GRANT, because two people can hold the same role
 *  for different editions or different bays. `null` means unrestricted in all
 *  three cases. */
export interface HeldRole {
  roleKey: string;
  allPrivileges: boolean;
  privileges: readonly string[];
  requestTypeScope: readonly string[] | null;
  editionScope?: readonly string[] | null;
  zoneScope?: readonly string[] | null;
}

/** Every privilege a set of held roles grants, as a UNION.
 *
 *  Host ADR 0006: a person may hold several roles in one module and their
 *  permissions are the union of them. This is the boringly-standard RBAC shape
 *  and the one this module has always had.
 *
 *  ⚠️ The `allPrivileges` branch is not optional. A role carrying the flag holds
 *  no join rows at all, so resolving it from its own `privileges` alone returns
 *  nothing and silently locks an admin out of the module. It expands against the
 *  live active list instead, which is the whole point of the flag: a privilege
 *  added in a later release reaches Admin with no seed edit. */
export function unionPrivileges(
  roles: readonly HeldRole[],
  activePrivileges: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const role of roles) {
    if (role.allPrivileges) for (const code of activePrivileges) out.add(code);
    else for (const code of role.privileges) out.add(code);
  }
  return [...out];
}

/** The read each write implies.
 *
 *  🔴 This is the answer to a whole CLASS of mistake rather than to one bug.
 *  Splitting the reads out of the writes — `comms.read` from `comms.write`,
 *  `checkin.read` from `checkin.write` — immediately raises "must every role
 *  holding the write now also be granted the read?", and answering that by
 *  hand means answering it again at every new route, in every seeded role, and
 *  in every role an admin composes on the Access screen. Get it wrong in the
 *  seed and a volunteer holds the button and cannot see the screen it is on.
 *
 *  So it is a rule instead: holding a write implies holding the matching read.
 *  There is no sensible role that may CHANGE a thing and may not LOOK at it,
 *  and the module should not be able to express one.
 *
 *  ⚠️ One direction only. A read never implies a write, which is the entire
 *  point of separating them.
 *
 *  ⚠️ `refunds.write` implies `finance.read`, which is `sensitive` — the
 *  deliberate case. Preparing a refund means reading the bank account it is
 *  paid into; there is no version of the task that does not. */
const IMPLIED_READ: Partial<Record<StallPrivilege, StallPrivilege>> = {
  'requests.write': 'requests.read',
  'planning.write': 'planning.read',
  'selection.write': 'selection.read',
  'comms.write': 'comms.read',
  'onboarding.write': 'onboarding.read',
  'finance.write': 'finance.read',
  'refunds.write': 'finance.read',
  'checkin.write': 'checkin.read',
  'equipment.write': 'equipment.read',
  'config.write': 'config.read',
};

/** Whether a resolved privilege list covers this privilege.
 *
 *  It exists so that every caller — routes, the web, the tests — asks the
 *  question the same way, and so the answer has one place to change. It stopped
 *  being a plain membership test when the reads were split out of the writes:
 *  see `IMPLIED_READ`. */
export function can(privileges: readonly string[], privilege: StallPrivilege): boolean {
  if (privileges.includes(privilege)) return true;
  return privileges.some((held) => IMPLIED_READ[held as StallPrivilege] === privilege);
}

/** The requester types these roles reach, or `null` for all of them.
 *
 *  ⚠️ Scopes UNION rather than intersect: someone holding both Lead and Local
 *  Welfare is a lead who also files local welfare stalls, not a lead confined
 *  to them. An unscoped role therefore widens the answer to `null`, and that is
 *  the whole rule — a narrow role can never take access away from a broad one,
 *  it can only be the only thing someone holds.
 *
 *  No roles at all is `[]`, not `null`: someone with no grant reaches nothing,
 *  and returning `null` there would hand them every request in the module. */
export function unionRequestTypeScope(roles: readonly HeldRole[]): string[] | null {
  if (roles.length === 0) return [];
  if (roles.some((r) => r.requestTypeScope === null)) return null;
  return [...new Set(roles.flatMap((r) => r.requestTypeScope ?? []))];
}

/** Whether a resolved scope covers this value. `null` reaches everything; `[]`
 *  reaches nothing. */
export function canReach(scope: readonly string[] | null, value: string): boolean {
  return scope === null || scope.includes(value);
}

/** Whether a resolved scope covers this requester type. */
export function canReachRequestType(scope: readonly string[] | null, requestType: string): boolean {
  return canReach(scope, requestType);
}

/**
 * The union of one scope dimension across the grants a person holds.
 *
 * ⚠️ The same widening rule as `unionRequestTypeScope`, and for the same reason:
 * a narrow grant can never take reach away from a broad one. Somebody who is a
 * bay marshal for A1 and a lead everywhere is a lead everywhere.
 *
 * Holding no grant at all is `[]` — reaches nothing — because returning `null`
 * there would hand a person with no access the whole module.
 */
export function unionScope(
  roles: readonly HeldRole[],
  pick: (role: HeldRole) => readonly string[] | null | undefined,
): string[] | null {
  if (roles.length === 0) return [];
  const picked = roles.map(pick);
  if (picked.some((s) => s === null || s === undefined)) return null;
  return [...new Set(picked.flatMap((s) => s ?? []))];
}

/** Which editions these grants reach, or `null` for every one. */
export function unionEditionScope(roles: readonly HeldRole[]): string[] | null {
  return unionScope(roles, (r) => r.editionScope);
}

/** Which bays these grants reach, by zone code, or `null` for every bay. */
export function unionZoneScope(roles: readonly HeldRole[]): string[] | null {
  return unionScope(roles, (r) => r.zoneScope);
}

/**
 * Which bay a request counts as being in, for the purpose of zone scope.
 *
 * The agreed bay once the team has settled one, and the requested bay until
 * then. ⚠️ Not simply the agreed bay: a request that has not been placed yet
 * would yield `null` and fall outside every bay-scoped person's reach, so the
 * marshal who is about to receive it could not see it coming.
 */
export function zoneOfRequest(request: {
  agreedZoneCode?: string | null;
  preferredZoneCode?: string | null;
}): string | null {
  return request.agreedZoneCode ?? request.preferredZoneCode ?? null;
}

/* ── The hierarchy ──────────────────────────────────────────────────────────*/

/** A role's place in the tree, as the API read it out of the table. */
export interface RoleNode {
  roleKey: string;
  parentKey: string | null;
  canAssignSameLevel: boolean;
}

/** Which roles a person may hand out.
 *
 *  Everything under the roles they hold, plus their own where the role says so.
 *  Never a sibling — two roles drawn level on a chart report to different
 *  people, and one team lead must not be able to backoffice another's team.
 *
 *  The walk is in memory rather than a recursive query: it is a dozen rows an
 *  admin edits by hand, and the rule has to stay testable without a database.
 *  The visited check doubles as the cycle guard — a tree an admin has tangled
 *  must not hang the request that would let them untangle it. */
export function assignableRoleKeys(
  roles: readonly RoleNode[],
  heldKeys: readonly string[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const role of roles) {
    if (!role.parentKey) continue;
    const siblings = children.get(role.parentKey) ?? [];
    siblings.push(role.roleKey);
    children.set(role.parentKey, siblings);
  }

  const held = new Set(heldKeys);
  const assignable = new Set<string>();

  // The flag lives on the grantor's OWN role and means one thing: they may hand
  // that role out as well as the ones under it.
  for (const role of roles) {
    if (held.has(role.roleKey) && role.canAssignSameLevel) assignable.add(role.roleKey);
  }

  const pending = heldKeys.flatMap((key) => children.get(key) ?? []);
  while (pending.length > 0) {
    const key = pending.pop() as string;
    if (assignable.has(key)) continue;
    assignable.add(key);
    pending.push(...(children.get(key) ?? []));
  }
  return assignable;
}

/** Which roles a person may EDIT the holder of.
 *
 *  The assignable set plus the roles they hold themselves, and that one addition
 *  is the whole difference between the two questions. Handing out your own role
 *  is a promotion and stays gated on `canAssignSameLevel`; correcting the phone
 *  number of somebody drawn level with you is not, and neither is editing your
 *  own account — which the assignable set alone would have refused, leaving the
 *  top of a branch unable to fix anything about itself. */
export function editableRoleKeys(
  roles: readonly RoleNode[],
  heldKeys: readonly string[],
): Set<string> {
  const keys = assignableRoleKeys(roles, heldKeys);
  for (const key of heldKeys) keys.add(key);
  return keys;
}

/** One wording for all three write paths. They refuse for the same reason and
 *  an admin who meets it on two screens should read the same sentence. */
export function cannotAssign(roleName: string): string {
  return `${roleName} is above you in the role hierarchy — you can assign only your own role and the ones under it.`;
}

/** The wider refusal: not "you cannot give them that role" but "you cannot touch
 *  this account". Names the role that puts them out of reach, because the admin
 *  can see the person and cannot see the tree. */
export function cannotEdit(displayName: string, roleName: string): string {
  return (
    `${displayName} holds ${roleName}, which is above you in the role hierarchy — ` +
    'only somebody above that role can edit their account.'
  );
}
