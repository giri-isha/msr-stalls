import type { ElectricalRow, ElectricalSheet } from '@stalls/core';
import { plugs5aIncludingDefault } from '@stalls/core';
import type { Db } from './editions';

/** The stall-wise electrical layout, in the shape the 2025 spreadsheet had it.
 *
 *  `Electrical data Stall_bay wise 2025.xlsx` is one sheet per bay, and its
 *  columns are these: Stall no, Category, Stall Name, total 5 amp plug
 *  (including 1 default), total 15 amp, then the appliances with their wattage.
 *  The electrical team reads it on paper, so the row order is stall-number
 *  order within a zone and the API does the sorting — a printed sheet sorted by
 *  whatever the browser felt like is a sheet nobody can walk a bay with.
 *
 *  Note the plug column: the FORM asks for plugs excluding the free one, the
 *  SHEET prints the total including it. That conversion is
 *  `plugs5aIncludingDefault`, and doing it here rather than in the component is
 *  what keeps the screen and the printout agreeing.
 */

/** Stall numbers sort by their numeric part, so A4-9 precedes A4-10. A plain
 *  string sort puts A4-10 first, which sends a person walking the bay back on
 *  themselves. */
function byStallNumber(a: string, b: string): number {
  const [az, an] = a.split('-');
  const [bz, bn] = b.split('-');
  return az === bz ? Number(an) - Number(bn) : az.localeCompare(bz);
}

export async function electricalSheet(
  db: Db,
  editionId: string,
  zoneCode?: string,
): Promise<ElectricalSheet> {
  const edition = await db.stallEdition.findUniqueOrThrow({ where: { id: editionId } });

  // Driven from ALLOCATIONS, not from requests: an unallocated request has no
  // stall number and cannot appear on a bay sheet, and a stall that changed
  // hands must show its current occupant.
  const allocations = await db.stallAllocation.findMany({
    where: {
      releasedAt: null,
      stall: { zone: { editionId, ...(zoneCode ? { code: zoneCode } : {}) } },
      request: { status: 'SELECTED' },
    },
    include: {
      stall: { include: { zone: true, category: { select: { key: true } } } },
      request: { include: { appliances: { orderBy: { sortOrder: 'asc' } } } },
    },
  });

  const rows: ElectricalRow[] = allocations
    .map((a) => {
      const appliances = a.request.appliances.map((ap) => ({ name: ap.name, watts: ap.watts }));
      return {
        stallNumber: a.stall.number,
        zoneCode: a.stall.zone.code,
        stallName: a.request.stallName,
        category: a.stall.category.key,
        requestType: a.request.requestType,
        plugs5aTotal: plugs5aIncludingDefault(a.request.plugs5a),
        plugs15a: a.request.plugs15a,
        gasStoves: a.request.gasStoves,
        appliances,
        totalWatts: appliances.reduce((t, ap) => t + ap.watts, 0),
      };
    })
    .sort((x, y) => byStallNumber(x.stallNumber, y.stallNumber));

  return {
    editionName: edition.name,
    zoneCode: zoneCode ?? null,
    rows,
    totals: {
      stalls: rows.length,
      plugs5a: rows.reduce((t, r) => t + r.plugs5aTotal, 0),
      plugs15a: rows.reduce((t, r) => t + r.plugs15a, 0),
      watts: rows.reduce((t, r) => t + r.totalWatts, 0),
    },
  };
}
