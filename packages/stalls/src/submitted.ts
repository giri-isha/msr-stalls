import type { StallRequestType } from './reference';

/**
 * What a requester filled in, as their own page reads it back to them.
 *
 * 🔴 This exists because the portal could tell a requester the DECISION on
 * their request and nothing about the request itself. A vendor who filed in
 * June and is asked in October how many 15 A points they said they needed had
 * one place to look — the form they no longer have — and the stall team fielded
 * the call. The answers are on the row; nothing but a view was missing.
 *
 * ⚠️ PURE, and here rather than on either side of the wire, for the reason the
 * rest of this package exists: the API composes the sections from Prisma rows
 * and the requester's page draws them, so the labels a requester reads back are
 * the labels one function chose. A second copy on the web is how "Items" and
 * "Items selling" end up naming the same column on two screens.
 *
 * ⚠️ It reads back ONLY what the requester themselves submitted. Nothing the
 * team has since decided is here — no flag, no note, no reject reason, no
 * agreed bay — because this block answers "what did I send you", and a
 * requester's own page must not become a window onto the triage of it.
 */
export interface SubmittedFact {
  label: string;
  /** Already formatted. A number arrives as a string because these are read,
   *  never summed, and a `0` that survived filtering is a real answer. */
  value: string;
}

export interface SubmittedSection {
  title: string;
  /** A name from the shared icon registry — presentation the web reads, the
   *  same way `StallsNavItem.glyph` is. */
  glyph: string;
  facts: SubmittedFact[];
}

/** One appliance line, as the form asked for it. */
export interface SubmittedAppliance {
  name: string;
  watts: number;
}

/** The department block, present only on an ashram request. */
export interface SubmittedAshram {
  department: string;
  departmentHead: string;
  departmentHeadContact: string;
  requestedBy: string;
  requesterContact: string;
  usage: string;
  usageOther: string | null;
  creditCardNeeded: boolean;
  wantsThembu: boolean;
  /** Null for a non-food stall, which is never asked. */
  fssaiExpected: boolean | null;
}

/** The answers, in the shape the API can hand over without deciding anything
 *  about how they read. */
export interface SubmittedRequest {
  requestType: StallRequestType;
  stallName: string;
  requesterName: string;
  email: string;
  contactNumber: string;
  address: string | null;
  /** `'FOOD'` or `'NON_FOOD'` — see `StallTypeValue`. */
  stallType: string;
  preferredZoneCode: string;
  itemsSelling: string;
  numStallsRequested: number;
  remarks: string | null;
  plugs5a: number;
  plugs15a: number;
  gasStoves: number;
  appliances: SubmittedAppliance[];
  tablesNeeded: number;
  chairsNeeded: number;
  passes2w: number;
  passes4w: number;
  passesStaff: number;
  depositAcknowledged: boolean;
  ashram: SubmittedAshram | null;
  /** The edition's appended questions, already resolved to label and answer. */
  custom: SubmittedFact[];
}

/**
 * What each `AshramUsage` means in words.
 *
 * ⚠️ Exported because the backoffice record draws the same value — it had its
 * own copy of this map, and a department reading "Giving to Sponsor" on their
 * own page while a coordinator read something else about the same row is the
 * drift this package is for.
 */
export const USAGE_LABEL: Record<string, string> = {
  DEPT_DISPLAY: 'Used by Department for Display',
  DEPT_SALES: 'Used by Department for Sales',
  VENDOR_SALES: 'Giving to Vendor for sales',
  SPONSOR: 'Giving to Sponsor',
  OTHER: 'Other — see remarks',
};

/** Drops the answers there is nothing to say about.
 *
 *  ⚠️ A zero count goes with them, the same rule the backoffice record follows:
 *  "Gas stoves 0" on a handicrafts stall takes a reader's eye and gives it
 *  nothing, and there are a dozen such rows on the average non-food form. */
function kept(items: Array<[string, string | number | null | undefined] | null>): SubmittedFact[] {
  const out: SubmittedFact[] = [];
  for (const item of items) {
    if (!item) continue;
    const [label, raw] = item;
    if (raw === null || raw === undefined || raw === '' || raw === 0) continue;
    out.push({ label, value: String(raw) });
  }
  return out;
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/**
 * The submitted answers, grouped the way the form asked them.
 *
 * ⚠️ A section with nothing in it is not returned at all. A heading over an
 * empty grid reads as an answer that went missing, and on a non-food retail
 * stall three of these five sections are genuinely empty.
 */
export function submittedSections(r: SubmittedRequest): SubmittedSection[] {
  const sections: SubmittedSection[] = [
    {
      title: 'Your Request',
      glyph: 'clipboard-list',
      facts: kept([
        ['Stall Name', r.stallName],
        ['Stall Type', r.stallType === 'FOOD' ? 'Food' : 'Non-Food'],
        // 🔴 The bay ASKED FOR, and the label says so. What the team settled on
        // is a different column and a different conversation; printing it here
        // as "your bay" would have a requester reading a move they were never
        // told about off their own answer.
        ['Location Requested', r.preferredZoneCode],
        ['Stalls Requested', r.numStallsRequested],
        ['Items', r.itemsSelling],
        ['Remarks', r.remarks],
      ]),
    },
    {
      title: 'Your Details',
      glyph: 'user',
      facts: kept([
        ['Name', r.requesterName],
        ['Email', r.email],
        ['Mobile', r.contactNumber],
        ['Address', r.address],
      ]),
    },
  ];

  if (r.ashram) {
    const a = r.ashram;
    sections.push({
      title: 'Department',
      glyph: 'home',
      facts: kept([
        ['Department', a.department],
        ['Department Head', a.departmentHead],
        ['Department Head Contact', a.departmentHeadContact],
        ['Requested By', a.requestedBy],
        ['Contact', a.requesterContact],
        ['Usage', USAGE_LABEL[a.usage] ?? a.usage],
        ['Usage — Other', a.usageOther],
        ['Credit Card Facility', yesNo(a.creditCardNeeded)],
        ['Tamil Thembu (11 Days)', yesNo(a.wantsThembu)],
        // ⚠️ `null` is not "No" — it is a question a non-food stall was never
        // asked — so it drops out rather than recording a refusal nobody made.
        ['FSSAI Expected', a.fssaiExpected === null ? null : yesNo(a.fssaiExpected)],
      ]),
    });
  }

  const electrical = kept([
    ['5 A Plug Points', r.plugs5a],
    ['15 A Plug Points', r.plugs15a],
    ['Gas Stoves', r.gasStoves],
  ]);
  for (const a of r.appliances) electrical.push({ label: a.name, value: `${a.watts} W` });
  if (electrical.length > 0) {
    sections.push({ title: 'Electrical', glyph: 'sliders', facts: electrical });
  }

  const logistics = kept([
    ['Tables', r.tablesNeeded],
    ['Chairs', r.chairsNeeded],
    ['2-Wheeler Passes', r.passes2w],
    ['4-Wheeler Passes', r.passes4w],
    ['Staff Passes', r.passesStaff],
  ]);
  if (logistics.length > 0) {
    sections.push({ title: 'Logistics', glyph: 'layout-grid', facts: logistics });
  }

  const custom = r.custom.filter((f) => f.value !== '');
  if (custom.length > 0) {
    sections.push({ title: 'Additional', glyph: 'list-view', facts: custom });
  }

  return sections;
}
