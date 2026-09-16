import { beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@msr/stalls';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  appendField,
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  vendorBody,
} from './helpers/db';

beforeEach(resetDatabase);

const deps = () => {
  const mail = new LogMailer();
  return {
    mail,
    deps: { mail, statusUrl: (t: string) => `http://web.example/stalls/status/${t}` },
  };
};

const submit = async (body: Record<string, unknown> = {}) =>
  submitRequest(
    prisma,
    SubmitRequestInput.parse(vendorBody(body)),
    deps().deps,
    await accountFor(body),
  );

describe('submitRequest', () => {
  test('ten concurrent submissions take ten distinct, consecutive references', async () => {
    await seedEdition();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => submit({ email: `v${i}@example.com` })),
    );
    const refs = results.map((r) => r.reference).sort();
    expect(new Set(refs).size).toBe(10);
    expect(refs[0]).toBe('VEN-2026-0001');
    expect(refs[9]).toBe('VEN-2026-0010');
  });

  test('always lands as SUBMITTED / NEW, whatever the body carried', async () => {
    await seedEdition();
    const r = await submit({ status: 'SELECTED', stage: 'READY' });
    const row = await prisma.stallRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(row.status).toBe('SUBMITTED');
    expect(row.stage).toBe('NEW');
  });

  test('writes appliances as child rows in the order given', async () => {
    await seedEdition();
    const r = await submit({
      requestType: 'LOCAL_WELFARE',
      depositAcknowledged: true,
      appliances: [
        { name: 'Deep freezer', watts: 900 },
        { name: 'Mixie', watts: 1000 },
        { name: 'Induction', watts: 2000 },
      ],
    });
    const rows = await prisma.stallRequestAppliance.findMany({
      where: { requestId: r.requestId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(rows.map((a) => a.name)).toEqual(['Deep freezer', 'Mixie', 'Induction']);
    expect(rows.map((a) => a.watts)).toEqual([900, 1000, 2000]);
  });

  test('stores custom values only for fields of that form type, and drops the rest', async () => {
    const e = await seedEdition();
    const mine = await appendField(e.id, 'VENDOR', 'Instagram');
    const other = await appendField(e.id, 'ASHRAM', 'Cost centre');
    const r = await submit({
      customFields: { [mine.id]: '@greenleaf', [other.id]: 'CC-42', junk: 'x' },
    });
    const values = await prisma.stallCustomFieldValue.findMany({
      where: { requestId: r.requestId },
    });
    expect(values.map((v) => v.customFieldId)).toEqual([mine.id]);
    expect(values[0].value).toBe('@greenleaf');
  });

  test('two submissions from one email land on one account', async () => {
    await seedEdition();
    await submit({ stallName: 'First' });
    await submit({ stallName: 'Second', email: 'PRIYA@greenleaf.example' });
    expect(await prisma.stallAccount.count()).toBe(1);
    expect(await prisma.stallRequest.count()).toBe(2);
  });

  test('sends a receipt to the normalised address carrying the reference and the status link', async () => {
    await seedEdition();
    const { mail, deps: d } = deps();
    const r = await submitRequest(
      prisma,
      SubmitRequestInput.parse(vendorBody({ email: 'Priya@GreenLeaf.example' })),
      d,
      await accountFor({ email: 'Priya@GreenLeaf.example' }),
    );
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('priya@greenleaf.example');
    expect(mail.sent[0].text).toContain(r.reference);
    expect(mail.sent[0].text).toContain(`/stalls/status/${r.statusToken}`);
  });

  test('a mail failure does not undo a request that is already committed', async () => {
    await seedEdition();
    const failing = {
      send: async () => {
        throw new Error('smtp down');
      },
    };
    const r = await submitRequest(
      prisma,
      SubmitRequestInput.parse(vendorBody()),
      { mail: failing, statusUrl: (t) => t },
      await accountFor(),
    );
    expect(await prisma.stallRequest.findUnique({ where: { id: r.requestId } })).not.toBeNull();
  });

  test('writes the ashram block for an ashram request', async () => {
    await seedEdition();
    const r = await submit({
      requestType: 'ASHRAM',
      // ⚠️ The body's default is FOOD, and a food ashram stall is asked
      // `fssaiExpected`. This department sells books.
      stallType: 'NON_FOOD',
      ashram: {
        departmentHead: 'Ravi Shankar',
        departmentHeadContact: '9840012345',
        department: 'Publications',
        requestedBy: 'Meera Iyer',
        requesterContact: '9840023456',
        creditCardNeeded: false,
        usage: 'DEPT_SALES',
        wantsThembu: true,
      },
    });
    const detail = await prisma.stallRequestAshramDetail.findUnique({
      where: { requestId: r.requestId },
    });
    expect(detail?.department).toBe('Publications');
    expect(detail?.wantsThembu).toBe(true);
    expect(r.reference).toMatch(/^ASH-2026-/);
  });
});
