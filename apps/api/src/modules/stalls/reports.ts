// The reports behind Reports & Dashboards.
//
// One loader per catalog entry, each returning columns and rows. The route
// renders them or writes them as CSV; neither it nor the web knows anything
// about any particular report beyond what comes back here, which is why adding
// one is an entry in `REPORT_CATALOG` and a function in this table.
//
// 🔴 Every loader narrows on the caller's `scope`. A report is the easiest place
// in a module to leak a row somebody may not see — it aggregates, so nobody
// notices a request that should not have been in the count. The catalog's
// privilege decides whether a report opens at all; the scope decides whose rows
// are in it, and both apply to every one of them.
import { REPORT_BY_KEY, type ReportColumn, type ReportView } from '@stalls/core';
import { UnknownReportError } from './errors';
import type { Db } from './editions';
import { type RequestScope, scopeWhere } from './scope';

const TYPES = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM'] as const;
const TYPE_LABEL: Record<string, string> = {
  VENDOR: 'Vendor',
  LOCAL_WELFARE: 'Local Welfare',
  ASHRAM: 'Ashram',
};

const STATUSES = [
  'SUBMITTED',
  'SHORTLISTED',
  'SELECTED',
  'BACKUP',
  'REJECTED',
  'CANCELLED',
] as const;
const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Submitted',
  SHORTLISTED: 'Shortlisted',
  SELECTED: 'Selected',
  BACKUP: 'Backup',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const CALL_OUTCOME_LABEL: Record<string, string> = {
  CALL_COMPLETED: 'Call Completed',
  NOT_ANSWERED: 'Not Answered',
  NOT_REACHABLE: 'Not Reachable',
  CALLBACK: 'Callback Requested',
  WRONG_NUMBER: 'Wrong Number',
  NA: 'Not Recorded',
};

type Row = Record<string, string | number | null>;

interface Loaded {
  columns: ReportColumn[];
  rows: Row[];
  total?: Row;
}

type Loader = (db: Db, editionId: string, scope: RequestScope) => Promise<Loaded>;

/** Sums a numeric column across the rows. The totals row is computed rather
 *  than queried a second time, so the foot can never disagree with the body. */
function sumRows(rows: Row[], keys: string[], label: Row): Row {
  const total: Row = { ...label };
  for (const key of keys) {
    total[key] = rows.reduce(
      (n, r) => n + (typeof r[key] === 'number' ? (r[key] as number) : 0),
      0,
    );
  }
  return total;
}

const LOADERS: Record<string, Loader> = {
  /** Status down the side, requester type across — the shape the selection
   *  meeting actually asks for. */
  requests_by_status: async (db, editionId, scope) => {
    const rows = await db.stallRequest.groupBy({
      by: ['status', 'requestType'],
      where: { editionId, ...scopeWhere(scope) },
      _count: { _all: true },
    });
    const at = (status: string, type: string) =>
      rows.find((r) => r.status === status && r.requestType === type)?._count._all ?? 0;

    const body: Row[] = STATUSES.map((status) => {
      const row: Row = { status: STATUS_LABEL[status] ?? status };
      let all = 0;
      for (const t of TYPES) {
        const n = at(status, t);
        row[t] = n;
        all += n;
      }
      row.all = all;
      return row;
    });

    return {
      columns: [
        { key: 'status', label: 'Status', kind: 'text' },
        ...TYPES.map((t) => ({ key: t, label: TYPE_LABEL[t], kind: 'number' as const })),
        { key: 'all', label: 'All', kind: 'number' },
      ],
      rows: body,
      total: sumRows(body, [...TYPES, 'all'], { status: 'Total' }),
    };
  },

  /**
   * One row per bay.
   *
   * ⚠️ "Requested" counts the PREFERRED bay and "Agreed" the agreed one, and a
   * request appears in both columns under different bays when the team moved it.
   * That is the report: the gap between the two columns is the negotiation, and
   * collapsing them into one number would hide exactly what it is for.
   */
  requests_by_zone: async (db, editionId, scope) => {
    const [zones, preferred, agreed, planned, allocated] = await Promise.all([
      db.stallZone.findMany({
        where: { editionId },
        orderBy: { sortOrder: 'asc' },
        select: { code: true, name: true },
      }),
      db.stallRequest.groupBy({
        by: ['preferredZoneCode'],
        where: { editionId, ...scopeWhere(scope) },
        _count: { _all: true },
      }),
      db.stallRequest.groupBy({
        by: ['agreedZoneCode'],
        where: { editionId, ...scopeWhere(scope), agreedZoneCode: { not: null } },
        _count: { _all: true },
      }),
      db.stall.groupBy({ by: ['zoneId'], where: { zone: { editionId } }, _count: { _all: true } }),
      db.stall.groupBy({
        by: ['zoneId'],
        where: { zone: { editionId }, status: 'ALLOCATED' },
        _count: { _all: true },
      }),
    ]);

    // The stall counts come back keyed by zone id, and everything else by code.
    const zoneRows = await db.stallZone.findMany({
      where: { editionId },
      select: { id: true, code: true },
    });
    const codeOfId = new Map(zoneRows.map((z) => [z.id, z.code]));
    const byCode = (groups: Array<{ zoneId: string; _count: { _all: number } }>) => {
      const out = new Map<string, number>();
      for (const g of groups) {
        const code = codeOfId.get(g.zoneId);
        if (code) out.set(code, (out.get(code) ?? 0) + g._count._all);
      }
      return out;
    };
    const plannedBy = byCode(planned);
    const allocatedBy = byCode(allocated);

    const body: Row[] = zones.map((z) => ({
      code: z.code,
      name: z.name,
      requested: preferred.find((p) => p.preferredZoneCode === z.code)?._count._all ?? 0,
      agreed: agreed.find((a) => a.agreedZoneCode === z.code)?._count._all ?? 0,
      planned: plannedBy.get(z.code) ?? 0,
      allocated: allocatedBy.get(z.code) ?? 0,
    }));

    return {
      columns: [
        { key: 'code', label: 'Bay', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'requested', label: 'Requested', kind: 'number' },
        { key: 'agreed', label: 'Agreed', kind: 'number' },
        { key: 'planned', label: 'Stalls Planned', kind: 'number' },
        { key: 'allocated', label: 'Allocated', kind: 'number' },
      ],
      rows: body,
      total: sumRows(body, ['requested', 'agreed', 'planned', 'allocated'], {
        code: 'Total',
        name: '',
      }),
    };
  },

  /** Requester type down the side, the funnel across. */
  selection_funnel: async (db, editionId, scope) => {
    const rows = await db.stallRequest.groupBy({
      by: ['requestType', 'status'],
      where: { editionId, ...scopeWhere(scope) },
      _count: { _all: true },
    });
    const at = (type: string, status: string) =>
      rows.find((r) => r.requestType === type && r.status === status)?._count._all ?? 0;

    const body: Row[] = TYPES.map((t) => {
      const row: Row = { type: TYPE_LABEL[t] };
      let all = 0;
      for (const s of STATUSES) {
        const n = at(t, s);
        row[s] = n;
        all += n;
      }
      row.all = all;
      return row;
    });

    return {
      columns: [
        { key: 'type', label: 'Requester Type', kind: 'text' },
        ...STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], kind: 'number' as const })),
        { key: 'all', label: 'Filed', kind: 'number' },
      ],
      rows: body,
      total: sumRows(body, [...STATUSES, 'all'], { type: 'Total' }),
    };
  },

  /** One row per onboarding step: how many selected stalls owe it, and how many
   *  have done it. The two always add to the same figure, which is the check. */
  onboarding_progress: async (db, editionId, scope) => {
    const selected = { editionId, ...scopeWhere(scope), status: 'SELECTED' as const };
    const [total, food, bank, payment, fssai, staff] = await Promise.all([
      db.stallRequest.count({ where: selected }),
      db.stallRequest.count({ where: { ...selected, stallType: 'FOOD' } }),
      db.stallRequest.count({ where: { ...selected, bankDetail: { isNot: null } } }),
      db.stallRequest.count({ where: { ...selected, payments: { some: { voidedAt: null } } } }),
      db.stallRequest.count({ where: { ...selected, stallType: 'FOOD', fssai: { isNot: null } } }),
      db.stallRequest.count({ where: { ...selected, staff: { some: {} } } }),
    ]);

    // ⚠️ FSSAI is asked only of food stalls, so its "asked" figure is the food
    // count and not the selected count. A step measured against a denominator
    // it was never asked of reports a backlog nobody can clear.
    const body: Row[] = [
      { step: 'Bank & Contract Details', asked: total, done: bank, pending: total - bank },
      { step: 'Payment Confirmed', asked: total, done: payment, pending: total - payment },
      { step: 'FSSAI Certificate', asked: food, done: fssai, pending: food - fssai },
      { step: 'Staff Registration', asked: total, done: staff, pending: total - staff },
    ];

    return {
      columns: [
        { key: 'step', label: 'Step', kind: 'text' },
        { key: 'asked', label: 'Asked Of', kind: 'number' },
        { key: 'done', label: 'Done', kind: 'number' },
        { key: 'pending', label: 'Pending', kind: 'number' },
      ],
      rows: body,
    };
  },

  collections: async (db, editionId, scope) => {
    const body: Row[] = [];
    for (const type of TYPES) {
      const mine = { editionId, ...scopeWhere(scope), requestType: type };
      const [quoted, collected] = await Promise.all([
        db.stallPaymentPlan.aggregate({
          where: { request: mine },
          _sum: { feeTotalPaise: true, depositTotalPaise: true },
        }),
        db.stallPaymentRecord.aggregate({
          where: { request: mine, voidedAt: null },
          _sum: { amountPaise: true },
        }),
      ]);
      const quotedPaise = (quoted._sum.feeTotalPaise ?? 0) + (quoted._sum.depositTotalPaise ?? 0);
      const collectedPaise = collected._sum.amountPaise ?? 0;
      body.push({
        type: TYPE_LABEL[type],
        quoted: quotedPaise,
        collected: collectedPaise,
        // ⚠️ NOT floored here, unlike the home card. A report is read by somebody
        // reconciling, and a bay that has overpaid is a fact they need — the
        // card hides it because a negative on a landing page reads as a bug.
        due: quotedPaise - collectedPaise,
      });
    }

    return {
      columns: [
        { key: 'type', label: 'Requester Type', kind: 'text' },
        { key: 'quoted', label: 'Quoted', kind: 'money' },
        { key: 'collected', label: 'Collected', kind: 'money' },
        { key: 'due', label: 'Outstanding', kind: 'money' },
      ],
      rows: body,
      total: sumRows(body, ['quoted', 'collected', 'due'], { type: 'Total' }),
    };
  },

  call_outcomes: async (db, editionId, scope) => {
    const rows = await db.stallReminderCall.groupBy({
      by: ['outcome'],
      where: { request: { editionId, ...scopeWhere(scope) } },
      _count: { _all: true },
    });
    const body: Row[] = Object.entries(CALL_OUTCOME_LABEL).map(([key, label]) => ({
      outcome: label,
      // A call logged before the outcome dropdown existed has a null outcome,
      // and it is counted under "Not Recorded" rather than dropped: it happened.
      calls:
        rows.find((r) => (r.outcome ?? 'NA') === key)?._count._all ??
        (key === 'NA' ? (rows.find((r) => r.outcome === null)?._count._all ?? 0) : 0),
    }));

    return {
      columns: [
        { key: 'outcome', label: 'Outcome', kind: 'text' },
        { key: 'calls', label: 'Calls', kind: 'number' },
      ],
      rows: body,
      total: sumRows(body, ['calls'], { outcome: 'Total' }),
    };
  },

  /** Expected against arrived, by the bay a stall was AGREED — which is where it
   *  actually stands. A stall with no agreed bay has not been placed and is
   *  counted under the bay it asked for, because that is where the marshal will
   *  look for it. */
  checkin_status: async (db, editionId, scope) => {
    const [zones, requests] = await Promise.all([
      db.stallZone.findMany({
        where: { editionId },
        orderBy: { sortOrder: 'asc' },
        select: { code: true, name: true },
      }),
      db.stallRequest.findMany({
        where: { editionId, ...scopeWhere(scope), status: 'SELECTED' },
        select: {
          preferredZoneCode: true,
          agreedZoneCode: true,
          checkIn: { select: { requestId: true } },
        },
      }),
    ]);

    const expected = new Map<string, number>();
    const arrived = new Map<string, number>();
    for (const r of requests) {
      const code = r.agreedZoneCode ?? r.preferredZoneCode;
      expected.set(code, (expected.get(code) ?? 0) + 1);
      if (r.checkIn) arrived.set(code, (arrived.get(code) ?? 0) + 1);
    }

    const body: Row[] = zones.map((z) => {
      const n = expected.get(z.code) ?? 0;
      const seen = arrived.get(z.code) ?? 0;
      return {
        code: z.code,
        name: z.name,
        expected: n,
        checkedIn: seen,
        pending: n - seen,
      };
    });

    return {
      columns: [
        { key: 'code', label: 'Bay', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'expected', label: 'Expected', kind: 'number' },
        { key: 'checkedIn', label: 'Checked In', kind: 'number' },
        { key: 'pending', label: 'Still Expected', kind: 'number' },
      ],
      rows: body,
      total: sumRows(body, ['expected', 'checkedIn', 'pending'], { code: 'Total', name: '' }),
    };
  },

  equipment_ledger: async (db, editionId, scope) => {
    const issues = await db.stallEquipmentIssue.findMany({
      where: { request: { editionId, ...scopeWhere(scope) } },
      select: {
        chairsRequested: true,
        tablesRequested: true,
        extraChairs: true,
        extraTables: true,
        distributedAt: true,
        collectedAt: true,
        missingChairs: true,
        missingTables: true,
        damagedChairs: true,
        damagedTables: true,
        request: { select: { preferredZoneCode: true, agreedZoneCode: true } },
      },
    });

    const zones = await db.stallZone.findMany({
      where: { editionId },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true },
    });

    const blank = () => ({ issued: 0, returned: 0, missing: 0, damaged: 0, chairs: 0, tables: 0 });
    const by = new Map<string, ReturnType<typeof blank>>();
    for (const i of issues) {
      const code = i.request.agreedZoneCode ?? i.request.preferredZoneCode;
      const acc = by.get(code) ?? blank();
      if (i.distributedAt) acc.issued += 1;
      if (i.collectedAt) acc.returned += 1;
      acc.missing += i.missingChairs + i.missingTables;
      acc.damaged += i.damagedChairs + i.damagedTables;
      acc.chairs += i.chairsRequested + i.extraChairs;
      acc.tables += i.tablesRequested + i.extraTables;
      by.set(code, acc);
    }

    const body: Row[] = zones.map((z) => {
      const acc = by.get(z.code) ?? blank();
      return { code: z.code, name: z.name, ...acc };
    });

    return {
      columns: [
        { key: 'code', label: 'Bay', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'chairs', label: 'Chairs', kind: 'number' },
        { key: 'tables', label: 'Tables', kind: 'number' },
        { key: 'issued', label: 'Stalls Issued', kind: 'number' },
        { key: 'returned', label: 'Stalls Returned', kind: 'number' },
        { key: 'missing', label: 'Missing', kind: 'number' },
        { key: 'damaged', label: 'Damaged', kind: 'number' },
      ],
      rows: body,
      total: sumRows(body, ['chairs', 'tables', 'issued', 'returned', 'missing', 'damaged'], {
        code: 'Total',
        name: '',
      }),
    };
  },
};

/** One report, rendered.
 *
 *  ⚠️ The guard is the ROUTE's, not this function's: the caller's privileges
 *  decide whether the key is offered at all, and a key that reaches here has
 *  already been checked. What this raises is "no such report", which is a typed
 *  URL, not a refusal. */
export async function runReport(
  db: Db,
  key: string,
  editionId: string,
  editionLabel: string,
  scope: RequestScope,
): Promise<ReportView> {
  const def = REPORT_BY_KEY.get(key);
  const load = LOADERS[key];
  if (!def || !load) throw new UnknownReportError(key);

  const { columns, rows, total } = await load(db, editionId, scope);
  return {
    key: def.key,
    title: def.title,
    note: def.note,
    columns,
    rows,
    editionLabel,
    ...(total ? { total } : {}),
  };
}
