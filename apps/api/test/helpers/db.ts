import type { StallEdition } from '@prisma/client';
import { LogMailer } from '../../src/email';
import { createEdition } from '../../src/modules/stalls/config';
import { prisma } from '../../src/prisma';

/** Wipes every table the module and the Foundation stubs own. Discovers them
 *  from the catalogue rather than listing them, so a new model cannot be
 *  forgotten here and leak rows between tests. */
export async function resetDatabase(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ table_schema: string; table_name: string }>>`
    select table_schema, table_name
    from information_schema.tables
    where table_schema in ('stalls', 'foundation')
      and table_type = 'BASE TABLE'
      and table_name <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.table_schema}"."${r.table_name}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const SYSTEM = '00000000-0000-0000-0000-000000000000';

/** A 2026 edition with all defaults — zones, rates, charges, sequences. */
export async function seedEdition(year = 2026): Promise<StallEdition> {
  return createEdition(prisma, { year, name: `MSR ${year}`, activate: true }, SYSTEM);
}

export interface Staff {
  personId: string;
  email: string;
  /** Pass as `headers` on `app.inject` to act as this person. */
  headers: { cookie: string };
}

/** A signed-in staff member holding the given stalls roles. */
export async function seedStaff(roleKeys: string[], email?: string): Promise<Staff> {
  const addr = email ?? `staff-${Math.random().toString(36).slice(2, 8)}@example.org`;
  const person = await prisma.person.create({
    data: { email: addr, displayName: addr.split('@')[0] },
  });
  for (const roleKey of roleKeys) {
    await prisma.stallStaffRole.create({
      data: { personRef: person.personId, roleKey, grantedBy: SYSTEM },
    });
  }
  return {
    personId: person.personId,
    email: person.email,
    headers: { cookie: `msr_session=${person.personId}` },
  };
}

/** A well-formed vendor submission body, overridable per test. */
export function vendorBody(overrides: Record<string, unknown> = {}) {
  return {
    requestType: 'VENDOR',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    contactNumber: '9840012345',
    address: '12 Mettupalayam Road, Coimbatore',
    stallType: 'FOOD',
    preferredZoneCode: 'C1',
    itemsSelling: 'Organic spices, cold-pressed oils, honey',
    numStallsRequested: 1,
    agreed: true,
    ...overrides,
  };
}

export { LogMailer, prisma };
