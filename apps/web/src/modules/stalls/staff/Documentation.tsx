import { ROLES, type StallAction } from '@msr/stalls';
import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { STATUS_LABEL } from '../components/StatusPill';
import { useMe } from '../me';
import {
  Card,
  H1,
  Icon,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tag,
  TONE,
  type Tone,
  useIsMobile,
  useIsNarrow,
} from '../ui';
import { Tabs } from './Communication';

/**
 * The manual, inside the app.
 *
 * The process this module runs is nine months long, touches four kinds of
 * requester and five staff roles, and every year it is handed to volunteers who
 * were not there for the last one. A README in a repository is read by whoever
 * deploys the thing; the person at the chairs counter at six in the morning
 * needs the same answer on the screen in front of them.
 *
 * ⚠️ Content is DATA here, not prose in JSX. Four tabs of paragraphs written
 * inline is a file nobody edits — a line about the refund rule ends up
 * three levels inside a `<div>` whose indentation says nothing about what it
 * holds. The arrays below are what a coordinator edits when the process
 * changes; the components under them only decide how a step, a screen or a rule
 * is drawn.
 *
 * ⚠️ Anything the app already knows is IMPORTED rather than retyped: the role
 * table is `ROLES` from `@msr/stalls`, the status words are the same
 * `STATUS_LABEL` the pills use. Documentation that restates a constant is
 * documentation that goes stale on the first commit that changes it, silently,
 * because nothing tests prose.
 */

// ── The process, in one column ──────────────────────────────────────────────

interface Phase {
  glyph: string;
  title: string;
  who: string;
  body: string;
}

/** The whole requirement as nine moves, in the order they happen. Every screen
 *  in the nav belongs to exactly one of these. */
const PHASES: Phase[] = [
  {
    glyph: 'clipboard-list',
    title: 'They apply',
    who: 'Vendor · Ashram · Local Welfare',
    body: 'A requester fills one of the four public forms. Submitting creates an account on their email address, mints a reference like VEN-2026-0042, and emails them a receipt carrying a private link to their own status page.',
  },
  {
    glyph: 'layers',
    title: 'The bays are planned',
    who: 'Stall coordinator',
    body: 'Expected crowd per zone, divided by a people-per-stall figure, suggests how many stalls each bay should carry. The coordinator adjusts that by category and then generates the stall numbers.',
  },
  {
    glyph: 'check-square',
    title: 'Requests are decided',
    who: 'Stall coordinator',
    body: 'Triage the queue: flag what needs a call, shortlist what is worth considering, then select onto a specific stall number, reject with a reason, or hold as backup.',
  },
  {
    glyph: 'megaphone',
    title: 'Everyone is told',
    who: 'Stall coordinator',
    body: 'The selection letter goes out in bulk or one at a time, carrying the stall numbers and the links for whichever steps apply to that requester. A letter goes out once.',
  },
  {
    glyph: 'file-text',
    title: 'Vendors send their details',
    who: 'Vendor',
    body: 'Bank account, GST, the signed agreement and the supporting documents, on the vendor’s own form reached from the link in that letter.',
  },
  {
    glyph: 'bar-chart',
    title: 'Money moves',
    who: 'Vendor · Finance',
    body: 'The payment letter carries the fee itemised as the 2025 sheet itemises it, and the figures freeze at that moment. The vendor pays by NEFT; Finance confirms the credit against its reference, amount and date.',
  },
  {
    glyph: 'sliders',
    title: 'The event is prepared',
    who: 'Vendor · Electrical · Venue',
    body: 'Food stalls upload FSSAI and the team verifies it. Each stall forwards a coupon so its own people can register. The electrical sheet prints per bay on A4.',
  },
  {
    glyph: 'circle-check',
    title: 'The stalls open',
    who: 'Volunteer',
    body: 'Check-in records who arrived and what is still outstanding — shown, never blocking. Chairs and tables go out against a printed two-part challan.',
  },
  {
    glyph: 'arrow-left-right',
    title: 'Accounts are settled',
    who: 'Volunteer · Finance',
    body: 'What came back short or broken becomes a deduction, penalties are itemised, and the refund voucher is prepared and then recorded once Finance pays it out.',
  },
];

/** The rules that decide how the screens behave. Each one is a thing a person
 *  discovers by being surprised by it, which is the definition of a line that
 *  belongs in the manual. */
const RULES: Array<{ title: string; body: string; tone: Tone }> = [
  {
    tone: 'info',
    title: 'Status and stage are two different questions',
    body: 'Status is the selection decision — submitted, shortlisted, selected, backup, rejected, cancelled. Stage is how far a selected request has travelled towards the event. A request can be Selected and still be at Bank form sent.',
  },
  {
    tone: 'warn',
    title: 'A letter goes out once',
    body: 'The database refuses a second copy of the same letter to the same request, so a bulk send and an individual send racing each other end with one email and a reported skip. An admin can clear that record when an address was wrong.',
  },
  {
    tone: 'teal',
    title: 'Money is frozen when the vendor is told',
    body: 'The payment letter snapshots the figures it carried. Finance reconciles a bank credit against what is in the vendor’s inbox, not against a quote that moves when a rate is edited in February.',
  },
  {
    tone: 'ok',
    title: 'Nothing blocks a check-in',
    body: 'Outstanding steps show as chips at the counter and gate nothing. A volunteer who cannot record what happened stops recording anything at all.',
  },
  {
    tone: 'violet',
    title: 'Not applicable is not the same as pending',
    body: 'A local welfare stall is never asked for bank details; a non-food stall never needs FSSAI. Those steps are absent from their row rather than sitting there unticked forever.',
  },
  {
    tone: 'des',
    title: 'Every vendor page is reached by a link or a coupon',
    body: 'There is no vendor password, so there is nothing to reset. A lost link is replaced by re-sending the letter that carried it.',
  },
];

// ── The vendor's side ───────────────────────────────────────────────────────

interface JourneyStep {
  title: string;
  /** Where it happens: a path for a page, or the word for a letter. */
  where: string;
  body: string;
  /** What the staff side should know about this step. */
  note?: string;
}

const JOURNEY: JourneyStep[] = [
  {
    title: 'Choose a form',
    where: '/stalls/apply',
    body: 'Four forms — Vendor, Local Welfare, Ashram and Ashram Food — each transcribed from the 2025 Google Form with its Tamil labels intact, plus any extra questions an admin has appended.',
    note: 'Which form they pick decides the reference prefix, the questions they are asked, and which of the later steps will ever apply to them.',
  },
  {
    title: 'Fill it in and submit',
    where: '/stalls/apply/:type',
    body: 'Who they are, what they sell, the zone they would like, plug points and appliances, gas stoves, chairs, tables and passes, and the two consent lines. No password and no OTP: submitting is the signup.',
    note: 'Appliances are rows, not four fixed boxes — the electrical sheet sums whatever is listed.',
  },
  {
    title: 'The receipt lands',
    where: 'Email',
    body: 'The submission creates or matches an account keyed on the email address, mints the reference, and emails a receipt carrying a long unguessable link to that vendor’s own status page.',
    note: 'Only the hash of that link is stored, so a database copy hands out no live links.',
  },
  {
    title: 'They watch their own status',
    where: '/stalls/status/:token',
    body: 'Their requests, where each has reached, and what they have to do next — the outstanding steps are listed, and the two a vendor can act on alone (the bank form, the FSSAI upload) open straight from there. This is the only read path into vendor data in the whole system.',
    note: 'Lost the email? /stalls/status with no token takes an email address or mobile number and sends the link to the address on the account — never to whoever asked.',
  },
  {
    title: 'The selection letter',
    where: 'Email',
    body: 'Once selected, the letter names their stall numbers and carries the links for the steps that apply to them — the bank form for a vendor, FSSAI and staff registration for a food stall.',
  },
  {
    title: 'Bank, GST and contract',
    where: '/stalls/bank/:token',
    body: 'Vendors only. Account holder, account number, IFSC, MICR, invoice name, GST, the supporting documents, and the agreement as a checkbox — which is how 2025 collected it.',
    note: 'Documents are presigned and uploaded straight to object storage; the API never handles the bytes.',
  },
  {
    title: 'Payment details',
    where: 'Email',
    body: 'The fee itemised line by line, the refundable deposit kept separate from it, and the total to transfer. Payment is NEFT to the virtual account — the app collects no money.',
  },
  {
    title: 'FSSAI certificate',
    where: '/stalls/fssai/:token',
    body: 'Food stalls upload up to five files. Re-uploading replaces what was there and clears any verification the team had already given.',
  },
  {
    title: 'Their own staff register',
    where: '/stalls/staff/:code',
    body: 'Each stall gets a coupon it forwards to its team, and each person registers themselves against it. A refreshed form does not inflate the count, because one mobile number registers once per stall.',
    note: 'Only the last four digits of an Aadhaar are stored — what a gate volunteer actually compares against a card.',
  },
  {
    title: 'The event, and the money back',
    where: 'At the venue',
    body: 'Check-in at the counter, chairs and tables against a printed challan, and after the event the deposit back less anything short, broken or penalised — itemised, so a vendor disputing a deduction can be shown the list.',
  },
];

// ── The staff side, screen by screen ────────────────────────────────────────

interface ScreenDoc {
  label: string;
  to: string;
  glyph: string;
  /** The action the nav item is gated on, where it has one. */
  requires?: StallAction;
  purpose: string;
  steps: string[];
  notes?: string[];
}

const SCREENS: ScreenDoc[] = [
  {
    label: 'Dashboard',
    to: '/m/stalls',
    glyph: 'home',
    purpose: 'One reading of where the edition stands.',
    steps: [
      'Read the tiles: how many requests came in, how they split across the four forms, and how far selection has got.',
      'Every tile is a link — picking one opens the request list already filtered to it.',
      'The flagged count is the queue to clear before a selection meeting.',
    ],
  },
  {
    label: 'Stall Requests',
    to: '/m/stalls/requests',
    glyph: 'clipboard-list',
    purpose: 'The triage queue — everything still waiting on a decision.',
    steps: [
      'Filter by type, zone or status, or search a reference, stall name, requester or phone number.',
      'Open a row for the whole application: what they sell, their appliances and load, passes, chairs and tables, the answers to any custom questions, and the consent stamps.',
      'Flag a request with a reason when it needs a call before any decision. The reason shows in the list.',
      'Shortlist what is worth considering, then Select onto a zone AND a stall number, Reject with a reason, or hold as Backup.',
      'The stalls offered when selecting are the ones still free in that zone.',
    ],
    notes: [
      'One stall holds one occupant, and that is enforced by the database rather than by a check on the screen. Two coordinators selecting onto the same stall at the same moment end with one allocation and one clear refusal.',
      'A request for three stalls becomes three allocation rows, so re-allocating leaves a trail.',
    ],
  },
  {
    label: 'All Requests',
    to: '/m/stalls/all',
    glyph: 'list-view',
    purpose: 'The same list, decided rows included.',
    steps: [
      'Use this when you have a reference in hand, or when you want to see rejected and cancelled requests alongside the live ones.',
      'The filters and the detail view are the triage screen’s.',
    ],
  },
  {
    label: 'Planning & Zones',
    to: '/m/stalls/planning',
    glyph: 'layers',
    requires: 'planning:read',
    purpose: 'How many stalls each bay should carry, and the numbers themselves.',
    steps: [
      'Enter the expected crowd for a zone and the people-per-stall divisor. The suggestion is crowd ÷ divisor, rounded up.',
      'Adjust the count per category in the grid — vendor food, ashram food, LW food, the non-food categories, help desk, backup.',
      'Save the plan, then generate the stall numbers (A4-17 and so on) for the zones you have settled.',
      'Zones closed to vendors stay closed: 2025 ran with A3 and B2 shut.',
    ],
    notes: [
      'The suggestion is a starting point, not the answer — the coordinator still has to reconcile it with what the bay physically fits.',
      'Regenerating never removes a stall that is already allocated. Numbers grow; they do not renumber under a vendor who has been told where to stand.',
    ],
  },
  {
    label: 'Communication',
    to: '/m/stalls/communication',
    glyph: 'megaphone',
    requires: 'comms:write',
    purpose: 'The letters, who has had which, and the calls chasing the rest.',
    steps: [
      'Templates: edit the subject and body for this edition and attach one file. Placeholders such as {{stallNumbers}} are filled per recipient, and the editor warns about a placeholder it does not recognise.',
      'Send letters: pick the letter, tick the recipients — one, or two hundred — and send. The template suggested on each row is the one that fits where that request has reached.',
      'A row that has already had this letter shows its sent stamp instead of a tick box.',
      'Reminder calls: the two chase lists, pending bank details and pending payment, with a log of who called whom and when.',
    ],
    notes: [
      'Bulk and individual send are the same operation — a list of one is an individual send — so the "once only" rule has one place to be right.',
      'An admin can arm Allow re-send on a row, which clears the record for that letter. Two clicks and admin-only, on purpose: it is for the day an address was wrong, not a second Send button.',
    ],
  },
  {
    label: 'Vendor Onboarding',
    to: '/m/stalls/onboarding',
    glyph: 'clipboard-list',
    purpose: 'Who is holding us up — every outstanding step in one table.',
    steps: [
      'Each row carries bank details, payment, FSSAI and staff registration as pending, received, verified, or absent where the step does not apply.',
      'Open a row for the vendor’s bank and GST details, their uploaded documents and the staff they have registered.',
      'The staff-registration coupon is minted when the FSSAI and staff letter goes out; the row shows it, and Issue coupon creates one where a stall has none yet.',
      'Mark an FSSAI certificate verified once you have read it, or remove that verification.',
      'Remove a staff row registered in error.',
    ],
    notes: [
      'A step that does not apply is absent, not unticked: local welfare stalls are not invoiced through the vendor flow, ashram departments are billed internally, and a non-food stall never needs FSSAI.',
      'A re-uploaded certificate clears the tick. Verify the new one.',
    ],
  },
  {
    label: 'Finance',
    to: '/m/stalls/finance',
    glyph: 'bar-chart',
    requires: 'finance:read',
    purpose: 'What is due, what has landed, and what goes back.',
    steps: [
      'Payment details: the quote per selected request — stall fee, plug points, chairs and tables, GST on the fee, then the refundable deposit kept separate. Send the payment letter from here; the figures freeze at that moment.',
      'Payment confirmation: record a credit with its reference number, amount and date. Several credits can settle one request, and the row shows what is still short.',
      'Refunds & deductions: the deposit, less what chairs and tables cost in shortfalls or damage, less any penalty, each itemised. Submit it, then record the voucher reference once Finance has paid it.',
    ],
    notes: [
      'No money is collected in the app. Payment is NEFT, exactly as in 2025; this screen records what a bank statement already shows.',
      'GST applies to the fee and never to the deposit — a taxed deposit would refund more than was taken.',
      'The same reference number cannot be recorded twice against one request. A pasted duplicate would double-count and shrink the refund.',
      'A refund is never negative. Deductions beyond the deposit floor it at zero and surface as a shortfall to chase separately.',
    ],
  },
  {
    label: 'Electrical & Venue',
    to: '/m/stalls/electrical',
    glyph: 'sliders',
    requires: 'planning:read',
    purpose: 'The stall-wise plug and appliance sheet, per bay.',
    steps: [
      'Pick a zone. The sheet lists every allocated stall in it with its 5A and 15A plugs, gas stoves, the appliances the vendor declared and the total load.',
      'Print it. The page is laid out for A4 and the app’s chrome is hidden from the printout.',
    ],
    notes: [
      'The 5A count printed here INCLUDES the one free plug every stall gets. The request form asked for plugs excluding it, so the two sheets show different numbers for the same stall on purpose.',
    ],
  },
  {
    label: 'Check-in',
    to: '/m/stalls/checkin',
    glyph: 'circle-check',
    purpose: 'The counter on the morning of the event, usually on a phone.',
    steps: [
      'Search by stall number, reference, stall name or the requester’s phone.',
      'The row shows how many of their staff registered against how many were expected, the passes they asked for, and chips for anything outstanding.',
      'Check them in. Add a note when something needs saying — a certificate in a folder rather than in the system, a vehicle pass short.',
      'Undo a check-in recorded against the wrong row.',
    ],
    notes: [
      'Nothing here blocks a check-in. The chips inform and gate nothing.',
      'Those chips come from the same rule the vendor’s own status page uses, so the vendor at the counter and the volunteer facing them are reading the same answer.',
    ],
  },
  {
    label: 'Chairs & Tables',
    to: '/m/stalls/equipment',
    glyph: 'layout-grid',
    purpose: 'Distribution, extras at the counter, and what came back.',
    steps: [
      'Find the stall. The row carries what they ordered, copied when the row opened.',
      'Distribute, and it moves to the issued list.',
      'Extras are charged at the counter: enter the extra chairs or tables, take the cash, and mark it collected.',
      'Print the two-part challan — vendor copy and office copy.',
      'After the event, collect: record anything short or damaged, which becomes a deduction on that vendor’s refund.',
      'Flag a row that still needs chasing.',
    ],
    notes: [
      'The counter snapshots what was ordered when the row opens. The vendor is holding a printed challan; if the request were edited that evening the paper and the screen would disagree, and the paper is what was signed.',
    ],
  },
  {
    label: 'Admin',
    to: '/m/stalls/admin',
    glyph: 'settings',
    requires: 'config:read',
    purpose: 'Everything the edition is configured with.',
    steps: [
      'Zones: the bays, their expected crowd, and whether they are closed to vendors.',
      'Rates: the rent per zone group and food type.',
      'Charges: deposits, chair and table rates, plug rates, GST percent and the number of equipment days.',
      'Fines: penalty reasons and their default amounts, offered when a refund is prepared.',
      'Custom fields: extra questions appended to any of the four request forms, with a Tamil label where you have one.',
      'Flow: three switches for the whole edition — bank step, payment step, FSSAI step.',
      'Users: grant a staff member one of the four roles.',
      'Editions: the year everything else hangs off.',
    ],
    notes: [
      'Staff registration has no switch. An unregistered person cannot be let onto the venue, so that step is never skipped.',
      'The four base forms are coded from the 2025 PDFs and cannot be rebuilt here — custom fields append to them.',
    ],
  },
];

// ── Reference ───────────────────────────────────────────────────────────────

const STATUS_MEANING: Array<[keyof typeof STATUS_LABEL, string]> = [
  ['SUBMITTED', 'It came in and nobody has decided anything yet.'],
  ['SHORTLISTED', 'Worth considering. Not promised anything.'],
  ['SELECTED', 'They have a stall. Everything in Onboarding & Money follows from here.'],
  ['BACKUP', 'Held against a drop-out. No stall allocated.'],
  ['REJECTED', 'Our decision, with a reason on the record.'],
  ['CANCELLED', 'Their decision, or a withdrawal.'],
];

const STAGE_MEANING: Array<[string, string]> = [
  ['New', 'Selected, but the selection letter has not gone out.'],
  ['Bank form sent', 'The letter is out; the bank form has not come back.'],
  ['Bank form filled', 'Bank details are in; the payment letter has not gone out.'],
  ['Payment sent', 'The payment letter is out; no credit confirmed yet.'],
  ['Payment confirmed', 'Money settled. Only staff registration is still trickling in.'],
  ['FSSAI pending', 'A food stall with no certificate on file.'],
  ['Ready', 'Nothing outstanding.'],
  ['Checked in', 'Recorded at the counter — an event, not a derivation.'],
];

const TROUBLE: Array<{ q: string; a: string }> = [
  {
    q: 'The vendor says the letter never arrived.',
    a: 'Check the sent stamp on their row in Communication → Send letters. Sending again is refused by design; an admin arms Allow re-send on that row, which clears the record, and then the letter can go out once more with its links.',
  },
  {
    q: 'Selecting says the stall has already gone.',
    a: 'Someone allocated it moments earlier. Pick another stall — the refusal is the database keeping one occupant per stall, and it is the reason nobody ever quietly overwrites a colleague’s allocation.',
  },
  {
    q: 'A row is asking for bank details it should not need.',
    a: 'Only external vendors are asked. If the whole edition should skip a step, the three switches are in Admin → Flow.',
  },
  {
    q: 'An upload says documents are unavailable.',
    a: 'Object storage is not configured for this environment. The bank and FSSAI forms say so rather than failing silently — the rest of the flow keeps working.',
  },
  {
    q: 'A deduction is larger than the deposit.',
    a: 'The refund floors at zero and the balance shows as a shortfall. Finance cannot process a negative voucher, so that amount is chased separately.',
  },
  {
    q: 'A verified FSSAI certificate lost its tick.',
    a: 'The vendor re-uploaded. New files replace the old ones and clear the verification, because the tick belonged to the document somebody read.',
  },
  {
    q: 'Someone cannot see a screen in the nav.',
    a: 'The nav hides what a role does not grant, and the API refuses it regardless. Grants are made in Admin → Users; the Roles table on this page says what each one carries.',
  },
];

// ── Flow charts ─────────────────────────────────────────────────────────────

/**
 * The diagrams, and the small engine that draws them.
 *
 * ⚠️ Data, laid out by the browser — not hand-placed SVG. A chart with fixed
 * coordinates is a chart nobody amends: moving one box means re-measuring every
 * arrow after it, so the diagram stops matching the process on the first change
 * and quietly becomes a lie on the wall. A flow here is a list; the layout is
 * the flex box’s problem.
 *
 * ⚠️ Top to bottom, always. A left-to-right chart has to shrink or scroll
 * sideways on a phone, and this is read on phones — the counter screens are.
 * Down the page a branch becomes a stacked pair of columns and nothing is lost.
 */

type Actor = 'requester' | 'staff' | 'system' | 'finance' | 'volunteer' | 'guard';

/** Who acts, in the colour they wear everywhere in these charts. `guard` is not
 *  a person: it is the system refusing something, which is worth its own colour
 *  because half the questions about this pipeline are "why did it not let me". */
const ACTOR: Record<Actor, { label: string; tone: Tone }> = {
  requester: { label: 'Requester', tone: 'violet' },
  staff: { label: 'Stall team', tone: 'info' },
  system: { label: 'Automatic', tone: 'teal' },
  finance: { label: 'Finance', tone: 'ok' },
  volunteer: { label: 'At the counter', tone: 'warn' },
  guard: { label: 'The system refuses', tone: 'des' },
};

interface FlowNode {
  actor: Actor;
  glyph: string;
  title: string;
  detail?: string;
  /** The status or stage this step leaves behind, where it leaves one. */
  lands?: string;
}

interface FlowFork {
  /** The question being asked at this point in the flow. */
  fork: string;
  branches: Array<{ label: string; nodes: FlowNode[]; outcome?: string }>;
}

type FlowItem = FlowNode | FlowFork;

const isFork = (item: FlowItem): item is FlowFork => 'fork' in item;

function Flow({ items }: { items: FlowItem[] }) {
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 0 }}>
      {items.map((item, i) => (
        <Fragment key={isFork(item) ? item.fork : item.title}>
          {i > 0 && <Arrow />}
          {isFork(item) ? <ForkBlock fork={item} /> : <NodeBox node={item} />}
        </Fragment>
      ))}
    </div>
  );
}

function NodeBox({ node, dense = false }: { node: FlowNode; dense?: boolean }) {
  const [tint, fg, bd] = TONE[ACTOR[node.actor].tone];
  return (
    <div style={{ ...nodeBox, maxWidth: dense ? 300 : 360 }}>
      {/* The actor's colour as a bar down the side rather than a wash behind
          the text: a tinted plate under 12px grey detail loses the contrast the
          tone tokens were measured for. */}
      <div style={{ width: 4, alignSelf: 'stretch', background: bd, flex: 'none' }} />
      <div style={{ display: 'flex', gap: 9, padding: '9px 12px', minWidth: 0, flex: 1 }}>
        <span style={{ ...nodeGlyph, background: tint, color: fg }}>
          <Icon name={node.glyph} size={13} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3 }}>{node.title}</div>
          {node.detail && (
            <div style={{ fontSize: 11.5, color: 'var(--mfg)', lineHeight: 1.45, marginTop: 2 }}>
              {node.detail}
            </div>
          )}
          {node.lands && (
            <div style={{ marginTop: 5 }}>
              <Tag size='sm' tone={ACTOR[node.actor].tone}>
                {node.lands}
              </Tag>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The line between two steps. The chevron is the arrowhead — a glyph rather
 *  than a CSS triangle, so it takes the same stroke weight as everything else
 *  on the page and does not go fuzzy at 2x. */
function Arrow({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '1px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 2, height: 11, background: 'var(--line)' }} />
        <Icon name='chevron-down' size={12} color='var(--mfg)' />
      </div>
      {label && <span style={{ fontSize: 11, color: 'var(--mfg)' }}>{label}</span>}
    </div>
  );
}

function ForkBlock({ fork }: { fork: FlowFork }) {
  const narrow = useIsNarrow();
  return (
    <>
      <div style={questionPill}>
        <Icon name='arrow-left-right' size={13} />
        {fork.fork}
      </div>
      <Arrow />
      <div
        style={{
          display: 'flex',
          flexDirection: narrow ? 'column' : 'row',
          alignItems: narrow ? 'center' : 'flex-start',
          justifyContent: 'center',
          gap: narrow ? 16 : 14,
          width: '100%',
        }}
      >
        {fork.branches.map((b) => (
          <div key={b.label} style={branchCol}>
            <div style={branchLabel}>{b.label}</div>
            {b.nodes.map((n, i) => (
              <Fragment key={n.title}>
                {i > 0 && <Arrow />}
                <NodeBox node={n} dense />
              </Fragment>
            ))}
            {b.outcome && (
              <>
                <Arrow />
                <Tag size='sm' tone='neutral'>
                  {b.outcome}
                </Tag>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {(Object.keys(ACTOR) as Actor[]).map((a) => (
        <Tag key={a} size='sm' tone={ACTOR[a].tone}>
          {ACTOR[a].label}
        </Tag>
      ))}
    </div>
  );
}

// The charts themselves. One per stage, in the order the stages happen.

const END_TO_END: FlowItem[] = [
  {
    actor: 'requester',
    glyph: 'clipboard-list',
    title: 'A request is submitted',
    detail: 'One of the four public forms.',
    lands: 'Status: Submitted',
  },
  {
    actor: 'staff',
    glyph: 'check-square',
    title: 'Triaged, then selected onto a stall',
    detail: 'Shortlist, then a zone and a stall number.',
    lands: 'Status: Selected',
  },
  {
    actor: 'staff',
    glyph: 'megaphone',
    title: 'The selection letter goes out',
    detail: 'Once per request, carrying the links that apply to them.',
    lands: 'Stage: Bank form sent',
  },
  {
    actor: 'requester',
    glyph: 'file-text',
    title: 'Bank, GST and contract come back',
    detail: 'Vendors only.',
    lands: 'Stage: Bank form filled',
  },
  {
    actor: 'finance',
    glyph: 'bar-chart',
    title: 'Quoted, paid by NEFT, confirmed',
    detail: 'The figures freeze when the payment letter is sent.',
    lands: 'Stage: Payment confirmed',
  },
  {
    actor: 'requester',
    glyph: 'shield',
    title: 'Certificate and staff registration',
    detail: 'FSSAI for food stalls; the stall’s own team registers on a coupon.',
    lands: 'Stage: Ready',
  },
  {
    actor: 'volunteer',
    glyph: 'circle-check',
    title: 'Check-in, chairs and tables',
    detail: 'Recorded at the counter on the day.',
    lands: 'Stage: Checked in',
  },
  {
    actor: 'finance',
    glyph: 'arrow-left-right',
    title: 'The deposit goes back',
    detail: 'Less anything short, broken or penalised.',
  },
];

const INTAKE: FlowItem[] = [
  {
    actor: 'requester',
    glyph: 'layout-grid',
    title: 'Picks a form',
    detail: 'Vendor · Local Welfare · Ashram · Ashram Food.',
  },
  {
    actor: 'requester',
    glyph: 'pencil',
    title: 'Fills it in and submits',
    detail: 'Bilingual labels, appliances as rows, the two consent lines.',
  },
  {
    actor: 'system',
    glyph: 'user-plus',
    title: 'Account matched or created',
    detail: 'Keyed on the normalised email. No password and no OTP.',
  },
  {
    actor: 'system',
    glyph: 'ticket',
    title: 'Reference minted',
    detail: 'VEN · LWS · ASH · AFD, then the year and a sequence.',
  },
  {
    actor: 'system',
    glyph: 'message-square',
    title: 'Receipt emailed',
    detail: 'Carries the signed status link. Only its hash is stored.',
    lands: 'Status: Submitted',
  },
  {
    actor: 'staff',
    glyph: 'search',
    title: 'Triaged in Stall Requests',
    detail: 'Filtered, searched, and read in full.',
  },
  {
    fork: 'What does the coordinator decide?',
    branches: [
      {
        label: 'Needs a call first',
        nodes: [
          {
            actor: 'staff',
            glyph: 'phone-call',
            title: 'Flagged with a reason',
            detail: 'The reason shows in the list until it is cleared.',
          },
        ],
        outcome: 'Back to triage',
      },
      {
        label: 'Worth a stall',
        nodes: [
          { actor: 'staff', glyph: 'check', title: 'Shortlisted' },
          {
            actor: 'staff',
            glyph: 'map-pin',
            title: 'Selected onto a stall number',
            detail: 'The stalls offered are the ones still free in that zone.',
          },
          {
            actor: 'guard',
            glyph: 'ban',
            title: 'A taken stall is refused',
            detail: 'One occupant per stall, held by the database — not by a check on the screen.',
          },
        ],
        outcome: 'Status: Selected',
      },
      {
        label: 'No room',
        nodes: [
          {
            actor: 'staff',
            glyph: 'clock',
            title: 'Held as backup, or rejected',
            detail: 'A reason is recorded either way.',
          },
        ],
        outcome: 'Status: Backup / Rejected',
      },
    ],
  },
];

const LETTERS: FlowItem[] = [
  {
    actor: 'staff',
    glyph: 'megaphone',
    title: 'Selection letter sent',
    detail: 'Communication → Send letters. A list of one is an individual send.',
  },
  {
    actor: 'guard',
    glyph: 'ban',
    title: 'A second copy is refused',
    detail:
      'One row per request and letter. The loser of a race is reported as a skip; the rest of the batch still goes.',
  },
  {
    fork: 'Who is the requester?',
    branches: [
      {
        label: 'External vendor',
        nodes: [
          {
            actor: 'requester',
            glyph: 'key',
            title: 'Opens the bank form from the letter',
            detail: 'The link is the whole credential — the page never asks who they are.',
          },
          {
            actor: 'requester',
            glyph: 'file-text',
            title: 'Account, IFSC, GST, documents, agreement',
            detail: 'Files are presigned and PUT straight at the store.',
          },
        ],
        outcome: 'Stage: Bank form filled',
      },
      {
        label: 'Local welfare',
        nodes: [
          {
            actor: 'system',
            glyph: 'arrow-left-right',
            title: 'No bank step at all',
            detail: 'They pay a caution deposit but are not invoiced through the vendor flow.',
          },
        ],
        outcome: 'Straight to payment',
      },
      {
        label: 'Ashram department',
        nodes: [
          {
            actor: 'system',
            glyph: 'heart-handshake',
            title: 'Billed internally',
            detail: 'Neither bank details nor payment are ever asked for.',
          },
        ],
        outcome: 'Stage: FSSAI pending / Ready',
      },
    ],
  },
  {
    actor: 'staff',
    glyph: 'phone',
    title: 'Whoever has not come back is called',
    detail: 'Communication → Reminder calls keeps the log: who rang whom, and when.',
  },
];

const MONEY: FlowItem[] = [
  {
    actor: 'finance',
    glyph: 'bar-chart',
    title: 'The quote is assembled',
    detail:
      'Stall fee + plug points + chairs and tables, GST on that total only. The deposit stays out of the tax.',
  },
  {
    actor: 'finance',
    glyph: 'message-square',
    title: 'Payment letter sent',
    detail:
      'The figures freeze here. A rate edited in February does not move what this vendor was told.',
    lands: 'Stage: Payment sent',
  },
  {
    actor: 'requester',
    glyph: 'arrow-left-right',
    title: 'NEFT to the virtual account',
    detail: 'No gateway. The application collects nothing.',
  },
  {
    actor: 'finance',
    glyph: 'check-square',
    title: 'The credit is confirmed',
    detail: 'Reference number, amount and date, read off the bank statement.',
  },
  {
    actor: 'guard',
    glyph: 'ban',
    title: 'The same reference twice is refused',
    detail: 'A pasted duplicate would double-count and shrink the refund.',
  },
  {
    fork: 'Does what landed cover the total?',
    branches: [
      {
        label: 'Yes',
        nodes: [
          {
            actor: 'system',
            glyph: 'circle-check',
            title: 'Settled',
            detail: 'Fee and deposit both accounted for.',
          },
        ],
        outcome: 'Stage: Payment confirmed',
      },
      {
        label: 'Short',
        nodes: [
          {
            actor: 'finance',
            glyph: 'alert-triangle',
            title: 'The row shows what is outstanding',
            detail: 'Several credits can settle one request.',
          },
          {
            actor: 'staff',
            glyph: 'phone-call',
            title: 'Chased on the pending-payment list',
          },
        ],
        outcome: 'Back to confirmation',
      },
    ],
  },
];

const EVENT: FlowItem[] = [
  {
    actor: 'staff',
    glyph: 'message-square',
    title: 'The FSSAI and staff letter goes out',
    detail: 'It carries the upload link and mints the stall’s coupon.',
  },
  {
    fork: 'What does this stall still owe?',
    branches: [
      {
        label: 'It sells food',
        nodes: [
          {
            actor: 'requester',
            glyph: 'file-text',
            title: 'FSSAI certificate uploaded',
            detail: 'Up to five files.',
          },
          {
            actor: 'staff',
            glyph: 'shield',
            title: 'Read, then marked verified',
            detail: 'A re-upload replaces the files and clears the tick.',
          },
        ],
      },
      {
        label: 'Every stall',
        nodes: [
          {
            actor: 'requester',
            glyph: 'users',
            title: 'Their own team registers on the coupon',
            detail:
              'One mobile number registers once, so a refreshed form does not inflate the count.',
          },
          {
            actor: 'system',
            glyph: 'shield',
            title: 'Only the last four Aadhaar digits are kept',
            detail: 'What a gate volunteer compares against a card, and nothing more.',
          },
        ],
      },
    ],
  },
  {
    actor: 'staff',
    glyph: 'sliders',
    title: 'The electrical sheet is printed per bay',
    detail: 'A4, chrome hidden. 5A counts include the free plug the form excluded.',
    lands: 'Stage: Ready',
  },
  {
    actor: 'volunteer',
    glyph: 'circle-check',
    title: 'Checked in at the counter',
    detail:
      'Outstanding steps show as chips and gate nothing. A note carries whatever needs saying.',
    lands: 'Stage: Checked in',
  },
  {
    actor: 'volunteer',
    glyph: 'layout-grid',
    title: 'Chairs and tables distributed',
    detail:
      'Against the printed two-part challan. Extras are entered, charged and collected in cash.',
  },
];

const SETTLE: FlowItem[] = [
  {
    actor: 'volunteer',
    glyph: 'arrow-left-right',
    title: 'Equipment collected back',
    detail: 'Anything short or damaged is recorded on the row it went out on.',
  },
  {
    actor: 'staff',
    glyph: 'alert-triangle',
    title: 'Penalties itemised',
    detail:
      'From the fine types in Admin. Rows, not a total — a vendor disputing a deduction is owed the list.',
  },
  {
    actor: 'finance',
    glyph: 'bar-chart',
    title: 'The refund is prepared',
    detail: 'Deposit, less the equipment deduction, less the penalties.',
  },
  {
    fork: 'Do the deductions exceed the deposit?',
    branches: [
      {
        label: 'No',
        nodes: [
          {
            actor: 'finance',
            glyph: 'check-square',
            title: 'Voucher recorded',
            detail: 'The reference is stored once Finance has paid out.',
          },
        ],
        outcome: 'Closed',
      },
      {
        label: 'Yes',
        nodes: [
          {
            actor: 'guard',
            glyph: 'ban',
            title: 'The refund floors at zero',
            detail: 'Finance cannot process a negative voucher.',
          },
          {
            actor: 'staff',
            glyph: 'phone-call',
            title: 'The balance is chased as a shortfall',
            detail: 'Outside the app, with the itemised list in hand.',
          },
        ],
        outcome: 'Closed with a shortfall',
      },
    ],
  },
];

/** `pendingSteps`, drawn. Four questions, asked in this order, about every
 *  selected request. */
const APPLIES: FlowItem[] = [
  {
    fork: 'Is the requester an external vendor?',
    branches: [
      {
        label: 'Yes',
        nodes: [
          {
            actor: 'staff',
            glyph: 'file-text',
            title: 'Bank details, GST and contract are asked for',
          },
        ],
      },
      {
        label: 'No',
        nodes: [
          {
            actor: 'system',
            glyph: 'ban',
            title: 'The step is absent, not unticked',
            detail:
              '"Not applicable" is a third value — a step that will never be ticked off is not a task.',
          },
        ],
      },
    ],
  },
  {
    fork: 'Is it a vendor or a local welfare stall?',
    branches: [
      {
        label: 'Yes',
        nodes: [{ actor: 'finance', glyph: 'bar-chart', title: 'Money is collected from them' }],
      },
      {
        label: 'No — an ashram department',
        nodes: [{ actor: 'system', glyph: 'heart-handshake', title: 'Billed internally' }],
      },
    ],
  },
  {
    fork: 'Does the stall sell food?',
    branches: [
      {
        label: 'Yes',
        nodes: [{ actor: 'requester', glyph: 'shield', title: 'An FSSAI certificate is required' }],
      },
      {
        label: 'No',
        nodes: [{ actor: 'system', glyph: 'ban', title: 'FSSAI never applies' }],
      },
    ],
  },
  {
    fork: 'Were staff passes asked for?',
    branches: [
      {
        label: 'Yes',
        nodes: [
          {
            actor: 'requester',
            glyph: 'users',
            title: 'Registration runs until the count is met',
            detail: 'This one has no switch: an unregistered person cannot be let onto the venue.',
          },
        ],
      },
      {
        label: 'None',
        nodes: [{ actor: 'system', glyph: 'check', title: 'Nothing outstanding' }],
      },
    ],
  },
];

/** How the stage on a row is arrived at. The order matters: the FIRST
 *  outstanding step names the stage, which is why a food stall with no bank
 *  details reads "Bank form sent" rather than "FSSAI pending". */
const STAGE_FLOW: FlowItem[] = [
  {
    fork: 'Are bank details still outstanding?',
    branches: [
      {
        label: 'Yes, and the letter has gone',
        nodes: [{ actor: 'system', glyph: 'circle-dot', title: 'Stage: Bank form sent' }],
      },
      {
        label: 'Yes, no letter yet',
        nodes: [{ actor: 'system', glyph: 'circle-dot', title: 'Stage: New' }],
      },
    ],
  },
  {
    fork: 'Otherwise — is payment still outstanding?',
    branches: [
      {
        label: 'Yes, and the letter has gone',
        nodes: [{ actor: 'system', glyph: 'circle-dot', title: 'Stage: Payment sent' }],
      },
      {
        label: 'Yes, no letter yet',
        nodes: [{ actor: 'system', glyph: 'circle-dot', title: 'Stage: Bank form filled' }],
      },
    ],
  },
  {
    fork: 'Otherwise — is the certificate or the staff count short?',
    branches: [
      {
        label: 'No certificate',
        nodes: [{ actor: 'system', glyph: 'circle-dot', title: 'Stage: FSSAI pending' }],
      },
      {
        label: 'Staff still registering',
        nodes: [
          {
            actor: 'system',
            glyph: 'circle-dot',
            title: 'Stage: Payment confirmed',
            detail:
              'Money and certificates are settled; the counter has to be able to tell that apart from Ready at a glance.',
          },
        ],
      },
    ],
  },
  {
    actor: 'system',
    glyph: 'circle-check',
    title: 'Otherwise — nothing outstanding',
    lands: 'Stage: Ready',
  },
  {
    actor: 'volunteer',
    glyph: 'log-in',
    title: 'And then the counter records an arrival',
    detail:
      'The one stage that is written rather than derived: it happened, so it cannot be recomputed away.',
    lands: 'Stage: Checked in',
  },
];

const CHARTS: Array<{ title: string; note: string; items: FlowItem[] }> = [
  {
    title: 'Stage 1 — Intake and selection',
    note: 'From the public form to a stall number. Ends at status Selected.',
    items: INTAKE,
  },
  {
    title: 'Stage 2 — Letters, and the vendor’s own details',
    note: 'What the selection letter starts, and how it differs by who applied.',
    items: LETTERS,
  },
  {
    title: 'Stage 3 — Money',
    note: 'Quoted, frozen, transferred by NEFT, confirmed against the statement.',
    items: MONEY,
  },
  {
    title: 'Stage 4 — Preparing, and the day itself',
    note: 'Certificates, the stall’s own staff, the electrical sheet, and the counter.',
    items: EVENT,
  },
  {
    title: 'Stage 5 — Settlement',
    note: 'What came back, what it cost, and what goes to the vendor.',
    items: SETTLE,
  },
];

function FlowPanel() {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='How to read these'
        note='Top to bottom. A question splits the flow; each column under it is one way through.'
      >
        <Prose>
          Every box is one move, coloured by who makes it. A red box is not a person — it is the
          system refusing something, which is the half of this pipeline people otherwise meet by
          surprise.
        </Prose>
        <Legend />
      </Panel>

      {CHARTS.map((c) => (
        <Panel key={c.title} title={c.title} note={c.note}>
          <Flow items={c.items} />
        </Panel>
      ))}

      <Panel
        title='Which steps apply to whom'
        note='The same four questions the vendor’s status page, the onboarding table and the check-in counter all ask.'
      >
        <Flow items={APPLIES} />
      </Panel>

      <Panel
        title='How the stage is decided'
        note='Recomputed after every change, in this order. The first outstanding step names the stage.'
      >
        <Flow items={STAGE_FLOW} />
      </Panel>
    </div>
  );
}

// ── The screen ──────────────────────────────────────────────────────────────

const TAB_LIST: [string, string][] = [
  ['overview', 'Overview'],
  ['flows', 'Flow charts'],
  ['vendor', 'The vendor’s journey'],
  ['screens', 'Staff screens'],
  ['reference', 'Reference'],
];

export function Documentation() {
  // ⚠️ The tab lives in the URL, not in state. Half of what this page is for is
  // being pointed at — "it is on the Reference tab" has to survive being pasted
  // into a message, and the back button has to leave the page rather than
  // silently undo three tab clicks.
  const [params, setParams] = useSearchParams();
  const active = TAB_LIST.some(([k]) => k === params.get('tab'))
    ? (params.get('tab') as string)
    : 'overview';

  return (
    <div>
      <H1
        icon={<Icon name='file-text' size={19} />}
        sub='What this application does, in the order it happens, and how each screen is used.'
      >
        Documentation
      </H1>

      <Tabs
        tabs={TAB_LIST}
        active={active}
        onPick={(key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}
      />

      {active === 'overview' && <OverviewPanel />}
      {active === 'flows' && <FlowPanel />}
      {active === 'vendor' && <VendorPanel />}
      {active === 'screens' && <ScreensPanel />}
      {active === 'reference' && <ReferencePanel />}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewPanel() {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='What this replaces'
        note='Four Google Forms and the spreadsheets that grew around them.'
      >
        <Prose>
          Everything from a stall request to the deposit going back lives here: the four public
          forms, the planning of the bays, selection onto a numbered stall, the letters, the
          vendor’s bank and GST details, the fee, the certificates, the passes, the counter on the
          day, and the refund afterwards.
        </Prose>
        <Prose>
          There are two sides to it. <b>Staff</b> sign in and work the pipeline from the screens in
          the sidebar. <b>Requesters</b> — vendors, ashram departments and local welfare stalls —
          never sign in at all: they meet a public form once, and after that every page they need
          arrives as a private link in an email.
        </Prose>
      </Panel>

      <Panel
        title='The whole flow at a glance'
        note='Nine months in one column. Each stage is drawn in full on the Flow charts tab.'
      >
        <Flow items={END_TO_END} />
      </Panel>

      <Panel title='The process' note='Nine moves. Every screen in the nav belongs to one of them.'>
        <div style={{ display: 'grid', gap: 0 }}>
          {PHASES.map((p, i) => (
            <PhaseRow key={p.title} phase={p} index={i + 1} last={i === PHASES.length - 1} />
          ))}
        </div>
      </Panel>

      <Panel
        title='Rules worth knowing before you start'
        note='Each of these is something people otherwise discover by being surprised by it.'
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {RULES.map((r) => (
            <div key={r.title} style={ruleRow}>
              <Tag tone={r.tone} size='sm'>
                Rule
              </Tag>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{r.title}</div>
                <div style={bodyText}>{r.body}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function PhaseRow({ phase, index, last }: { phase: Phase; index: number; last: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      {/* The glyph and the thread running down to the next move. The line is
          what makes this a sequence rather than nine unrelated cards. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
        <div style={phaseChip}>
          <Icon name={phase.glyph} size={15} />
        </div>
        {!last && <div style={{ flex: 1, width: 2, background: 'var(--line)', marginTop: 4 }} />}
      </div>
      <div style={{ minWidth: 0, paddingBottom: last ? 0 : 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            {index}. {phase.title}
          </span>
          <Tag size='sm'>{phase.who}</Tag>
        </div>
        <div style={{ ...bodyText, marginTop: 3 }}>{phase.body}</div>
      </div>
    </div>
  );
}

// ── The vendor's journey ────────────────────────────────────────────────────

function VendorPanel() {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='What a requester actually sees'
        note='Ten steps, from the form to the deposit coming back.'
      >
        <Prose>
          A requester has no account to manage and no password to forget. Their receipt carries a
          long unguessable link to their own status page, and every later form — bank details,
          FSSAI, staff registration — is reached the same way. The link IS the credential, which is
          why none of these pages ever asks who you are. Losing it is not losing the account: the
          email address or mobile number on the request gets a fresh link emailed to the account's
          own address, which is the whole of "log in" here.
        </Prose>
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {JOURNEY.map((s, i) => (
            <JourneyRow key={s.title} step={s} index={i + 1} />
          ))}
        </div>
      </Panel>

      <Panel title='Helping a requester on the phone' note='The four questions that actually come.'>
        <Bullets
          items={[
            '“I have lost my link.” — There is nothing to reset. Send them to /stalls/status, where an email address or mobile number gets the link emailed back to them. If the address on the account is itself wrong, find them in All Requests and re-send the letter (an admin arms Allow re-send first).',
            '“What is my reference?” — The prefix says which form they used: VEN for vendor, LWS for local welfare, ASH for ashram, AFD for ashram food.',
            '“Has my payment reached you?” — Finance → Payment confirmation shows every credit recorded against the request, and what is still short.',
            '“What else do you need from me?” — Their status page lists it, and so does their row in Vendor Onboarding. Both are computed by the same rule, so they cannot disagree.',
          ]}
        />
      </Panel>
    </div>
  );
}

function JourneyRow({ step, index }: { step: JourneyStep; index: number }) {
  return (
    <div style={{ display: 'flex', gap: 11 }}>
      <span style={numberChip}>{index}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{step.title}</span>
          <code style={pathChip}>{step.where}</code>
        </div>
        <div style={{ ...bodyText, marginTop: 3 }}>{step.body}</div>
        {step.note && (
          <div style={noteRow}>
            <Icon name='info' size={13} color='var(--mfg)' />
            <span>{step.note}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Staff screens ───────────────────────────────────────────────────────────

function ScreensPanel() {
  const { can } = useMe();
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='How to read this'
        note='One block per item in the sidebar, in the order the sidebar shows them.'
      >
        <Prose>
          Each block says what the screen is for, how it is used, and anything about it that is
          deliberate rather than incidental. A screen your role does not grant is still documented
          here — it is marked, and it is simply missing from your nav.
        </Prose>
      </Panel>

      {SCREENS.map((s) => (
        <ScreenBlock key={s.to} doc={s} allowed={!s.requires || can(s.requires)} />
      ))}
    </div>
  );
}

function ScreenBlock({ doc, allowed }: { doc: ScreenDoc; allowed: boolean }) {
  const mobile = useIsMobile();
  return (
    <Card pad={0}>
      <div style={{ ...panelHead, alignItems: 'center' }}>
        <div style={screenChip}>
          <Icon name={doc.glyph} size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{doc.label}</div>
          <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 1 }}>{doc.purpose}</div>
        </div>
        {doc.requires && (
          <Tag size='sm' tone={allowed ? 'ok' : 'neutral'} title='The action this screen needs'>
            {doc.requires}
          </Tag>
        )}
        {/* Open it, rather than describe where it lives. A manual that makes you
            go and find the thing it just explained has spent the reader's
            attention twice. */}
        {allowed ? (
          <Link to={doc.to} style={openLink}>
            Open
            <Icon name='chevron-right' size={13} />
          </Link>
        ) : (
          <Tag size='sm' tone='warn'>
            No access
          </Tag>
        )}
      </div>

      <div style={{ padding: mobile ? '13px' : '14px 16px' }}>
        <SubHead>Using it</SubHead>
        <ol style={olReset}>
          {doc.steps.map((text, i) => (
            <li key={text} style={{ display: 'flex', gap: 10, marginBottom: 7 }}>
              <span style={numberChip}>{i + 1}</span>
              <span style={{ ...bodyText, flex: 1, minWidth: 0 }}>{text}</span>
            </li>
          ))}
        </ol>

        {doc.notes && (
          <>
            <SubHead>Worth knowing</SubHead>
            <Bullets items={doc.notes} />
          </>
        )}
      </div>
    </Card>
  );
}

// ── Reference ───────────────────────────────────────────────────────────────

function ReferencePanel() {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='Status — the selection decision'
        note='Where a request stands with the coordinators.'
      >
        <Table>
          <THead>
            <TR>
              <TH>Status</TH>
              <TH>What it means</TH>
            </TR>
          </THead>
          <TBody>
            {STATUS_MEANING.map(([key, meaning]) => (
              <TR key={key}>
                <TD>
                  <Tag size='sm'>{STATUS_LABEL[key]}</Tag>
                </TD>
                <TD>{meaning}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel
        title='Stage — how far onboarding has travelled'
        note='Only a selected request has one. It is recomputed from the facts after every change, never typed in — the Flow charts tab draws the order those checks run in.'
      >
        <Table>
          <THead>
            <TR>
              <TH>Stage</TH>
              <TH>What it means</TH>
            </TR>
          </THead>
          <TBody>
            {STAGE_MEANING.map(([label, meaning]) => (
              <TR key={label}>
                <TD>
                  <Tag size='sm' tone='info'>
                    {label}
                  </Tag>
                </TD>
                <TD>{meaning}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel
        title='Roles'
        note='Granted in Admin → Users. The nav hides what a role does not carry, and the API refuses it regardless.'
      >
        <div style={{ display: 'grid', gap: 12 }}>
          {ROLES.map((role) => (
            <div key={role.roleKey}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{role.name}</span>
                <code style={pathChip}>{role.roleKey}</code>
              </div>
              <div style={{ ...bodyText, margin: '2px 0 6px' }}>{role.description}</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {role.actions.map((a) => (
                  <Tag key={a} size='sm'>
                    {a}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title='Money' note='All of it, in six lines.'>
        <Bullets
          items={[
            'Amounts are held as whole paise. Nothing in the system stores a rupee float.',
            'The fee is the stall rent, plus plug points, plus chairs and tables, plus GST on that total.',
            'GST applies to the fee and never to the refundable deposit.',
            'The first 5A plug point is free. The request form asks for plugs excluding it; the electrical sheet prints the total including it.',
            'The quote freezes when the payment letter goes out, so a rate edited later does not move what a vendor was told to pay.',
            'A refund is the deposit less itemised deductions and penalties, floored at zero — the balance beyond that is a shortfall, chased outside the app.',
          ]}
        />
      </Panel>

      <Panel title='Access and privacy' note='Why the vendor pages look the way they do.'>
        <Bullets
          items={[
            'Every public page is reached by a signed link or a coupon. Typing an email address alone grants nothing.',
            'Only the hash of a link is stored, so a copy of the database hands out no live links.',
            'Uploaded documents are presigned in the browser and PUT straight at the store. The API never sees the bytes, and a key it is handed back must be one it issued.',
            'Aadhaar is reduced to its last four digits — what a gate volunteer compares against a card.',
            'Staff sign-in in this standalone build is a development stand-in. In the host it is Isha SSO; the roles above are this module’s own either way.',
          ]}
        />
      </Panel>

      <Panel title='When something looks wrong' note='The answers people ask for twice.'>
        <div style={{ display: 'grid', gap: 11 }}>
          {TROUBLE.map((t) => (
            <div key={t.q}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Icon name='message-circle' size={14} color='var(--pri)' />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t.q}</span>
              </div>
              <div style={{ ...bodyText, marginTop: 3, paddingLeft: 22 }}>{t.a}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ── Small shared pieces ─────────────────────────────────────────────────────

/** A titled card. The same pattern the Admin screen draws for its panels —
 *  written once here rather than eleven times down this file. */
function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const mobile = useIsMobile();
  return (
    <Card pad={0}>
      <div style={panelHead}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
          {note && <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>{note}</div>}
        </div>
      </div>
      <div style={{ padding: mobile ? '13px' : '14px 16px' }}>{children}</div>
    </Card>
  );
}

function Prose({ children }: { children: ReactNode }) {
  // ⚠️ `maxWidth` in characters rather than pixels. This is the one screen in
  // the module that is read as text rather than scanned as rows, and a 1600px
  // monitor otherwise gives it 180-character lines nobody can track back from.
  return <p style={{ ...bodyText, maxWidth: '68ch', margin: '0 0 10px' }}>{children}</p>;
}

function SubHead({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '.9px',
        textTransform: 'uppercase',
        color: 'var(--mfg)',
        margin: '2px 0 8px',
      }}
    >
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={olReset}>
      {items.map((text) => (
        <li key={text} style={{ display: 'flex', gap: 9, marginBottom: 7 }}>
          <span style={{ flex: 'none', marginTop: 5 }}>
            <Icon name='circle-dot' size={12} color='var(--pri)' />
          </span>
          <span style={{ ...bodyText, flex: 1, minWidth: 0 }}>{text}</span>
        </li>
      ))}
    </ul>
  );
}

const bodyText: CSSProperties = { fontSize: 13, lineHeight: 1.55, color: 'var(--fg)' };

const panelHead: CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: '13px 16px',
  borderBottom: '1px solid var(--line)',
};

const olReset: CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };

const numberChip: CSSProperties = {
  width: 20,
  height: 20,
  flex: 'none',
  borderRadius: 'var(--r2)',
  background: 'var(--pri-t)',
  color: 'var(--pri)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  marginTop: 1,
};

const phaseChip: CSSProperties = {
  width: 30,
  height: 30,
  flex: 'none',
  borderRadius: 'var(--r3)',
  background: 'var(--pri-t)',
  color: 'var(--pri)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const screenChip: CSSProperties = { ...phaseChip, width: 32, height: 32 };

const ruleRow: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start' };

const noteRow: CSSProperties = {
  display: 'flex',
  gap: 7,
  alignItems: 'flex-start',
  marginTop: 5,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--mfg)',
};

const pathChip: CSSProperties = {
  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
  fontSize: 11.5,
  padding: '2px 7px',
  borderRadius: 'var(--r2)',
  background: 'var(--bg)',
  border: '1px solid var(--bd)',
  color: 'var(--mfg)',
};

const nodeBox: CSSProperties = {
  display: 'flex',
  width: '100%',
  background: 'var(--card)',
  border: '1px solid var(--bd)',
  borderRadius: 'var(--r3)',
  boxShadow: 'var(--sh-1)',
  overflow: 'hidden',
};

const nodeGlyph: CSSProperties = {
  width: 24,
  height: 24,
  flex: 'none',
  borderRadius: 'var(--r2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: 1,
};

const questionPill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '7px 14px',
  borderRadius: 999,
  border: '1px dashed var(--bd)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 12.5,
  fontWeight: 700,
  textAlign: 'center',
};

const branchCol: CSSProperties = {
  display: 'grid',
  justifyItems: 'center',
  gap: 0,
  flex: 1,
  minWidth: 0,
  maxWidth: 320,
};

const branchLabel: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: 'var(--mfg)',
  marginBottom: 7,
  textAlign: 'center',
};

const openLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flex: 'none',
  fontSize: 12.5,
  fontWeight: 600,
  color: 'var(--pri)',
  textDecoration: 'none',
};
