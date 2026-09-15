// Consent declarations: what a form shows, what a save does to the history, and
// what ends up in the log.
//
// 🔴 The point of the whole feature is that "what did they agree to?" has an
// answer that does not change when somebody edits a paragraph. These tests are
// that promise.
import type { FastifyInstance } from 'fastify';
import { SubmitRequestInput } from '@msr/stalls';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import {
  consentsFor,
  createDeclaration,
  declarationsForForm,
  updateDeclaration,
} from '../src/modules/stalls/declarations';
import {
  ArchivedDeclarationError,
  BadDeclarationKeyError,
  DeclarationExistsError,
  DeclarationsChangedError,
} from '../src/modules/stalls/errors';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
  SYSTEM,
  type Backoffice,
  vendorBody,
} from './helpers/db';

let app: FastifyInstance;
let editionId: string;
let admin: Backoffice;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  editionId = (await seedEdition()).id;
  admin = await seedBackoffice(['stalls_admin']);
});

const submit = async (body: Record<string, unknown> = {}) =>
  submitRequest(
    prisma,
    SubmitRequestInput.parse(vendorBody(body)),
    { mail: new LogMailer(), statusUrl: (t) => t },
    await accountFor(body),
  );

describe('seeded with the edition', () => {
  /** ⚠️ Read out of `FORM_DEFINITIONS`, not retyped — those strings were
   *  transcribed character-for-character from the printed 2025 forms. */
  test('every form opens with the disclaimer that was printed on it', async () => {
    for (const type of ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'] as const) {
      const shown = await declarationsForForm(prisma, editionId, type);
      expect(shown).toHaveLength(1);
      expect(shown[0]?.body.length).toBeGreaterThan(20);
    }
  });

  test('the two public forms carry the Tamil, the two ashram ones do not', async () => {
    const vendor = await declarationsForForm(prisma, editionId, 'VENDOR');
    const ashram = await declarationsForForm(prisma, editionId, 'ASHRAM');
    expect(vendor[0]?.bodyTa).not.toBeNull();
    expect(ashram[0]?.bodyTa).toBeNull();
  });
});

describe('writing one', () => {
  test('a key the vocabulary will not take is refused, not slugified', async () => {
    await expect(
      createDeclaration(
        prisma,
        editionId,
        {
          key: 'Request Submission',
          requestType: null,
          title: 'x',
          body: 'y',
          bodyTa: null,
          isActive: true,
        },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(BadDeclarationKeyError);
  });

  /** Reusing a key with a different form is the documented way to add a
   *  variant, so the clash is the key AND the variant together.
   *
   *  ⚠️ A key the SEED has not used. `request_submission` ships with all four
   *  variants already written — one per printed form — so it is the wrong key
   *  to test "adding a variant" against. */
  test('the same key on a different form is a variant, not a clash', async () => {
    const make = (requestType: 'VENDOR' | 'ASHRAM' | null, body: string) =>
      createDeclaration(
        prisma,
        editionId,
        { key: 'deposit_terms', requestType, title: 'Deposit', body, bodyTa: null, isActive: true },
        SYSTEM,
      );

    expect((await make(null, 'The default wording.')).version).toBe(1);
    expect((await make('VENDOR', 'Vendor wording.')).version).toBe(1);
    await expect(make('VENDOR', 'Again')).rejects.toBeInstanceOf(DeclarationExistsError);
  });

  test('and the variant is what that form shows, while the others keep the default', async () => {
    const make = (requestType: 'VENDOR' | null, body: string) =>
      createDeclaration(
        prisma,
        editionId,
        { key: 'deposit_terms', requestType, title: 'Deposit', body, bodyTa: null, isActive: true },
        SYSTEM,
      );
    await make(null, 'The default wording.');
    await make('VENDOR', 'Vendor wording.');

    const bodyFor = async (type: 'VENDOR' | 'ASHRAM') =>
      (await declarationsForForm(prisma, editionId, type)).find((d) => d.key === 'deposit_terms')
        ?.body;

    expect(await bodyFor('VENDOR')).toBe('Vendor wording.');
    expect(await bodyFor('ASHRAM')).toBe('The default wording.');
  });
});

describe('editing one', () => {
  const current = async () =>
    prisma.stallDeclaration.findFirstOrThrow({
      where: { editionId, key: 'request_submission', requestType: 'VENDOR', isCurrent: true },
    });

  test('a changed title edits the version in place', async () => {
    const before = await current();
    const after = await updateDeclaration(
      prisma,
      editionId,
      before.id,
      { title: 'Renamed', body: before.body, bodyTa: before.bodyTa, isActive: true },
      SYSTEM,
    );
    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version);
  });

  /** 🔴 The reason declarations stopped being a constant in `forms.ts`. */
  test('a changed body cuts a new version and archives the old one', async () => {
    const before = await current();
    const after = await updateDeclaration(
      prisma,
      editionId,
      before.id,
      { title: before.title, body: 'Entirely new wording.', bodyTa: null, isActive: true },
      SYSTEM,
    );

    expect(after.id).not.toBe(before.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.isCurrent).toBe(true);

    const old = await prisma.stallDeclaration.findUniqueOrThrow({ where: { id: before.id } });
    expect(old.isCurrent).toBe(false);
    expect(old.archivedAt).not.toBeNull();
    // ⚠️ And the old words are still the old words.
    expect(old.body).toBe(before.body);
  });

  test('an archived version cannot be edited — it is a record, not a draft', async () => {
    const before = await current();
    await updateDeclaration(
      prisma,
      editionId,
      before.id,
      { title: before.title, body: 'New.', bodyTa: null, isActive: true },
      SYSTEM,
    );
    await expect(
      updateDeclaration(
        prisma,
        editionId,
        before.id,
        { title: before.title, body: 'Newer.', bodyTa: null, isActive: true },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(ArchivedDeclarationError);
  });

  /** 🔴 Enforced by a partial unique index, not by the writer — two concurrent
   *  writers would both pass an application-level check. */
  test('the database refuses a second current version outright', async () => {
    const live = await current();
    await expect(
      prisma.stallDeclaration.create({
        data: {
          editionId,
          key: live.key,
          requestType: live.requestType,
          version: live.version + 1,
          title: 'Sneaked in',
          body: 'A second live version.',
          isCurrent: true,
        },
      }),
    ).rejects.toThrow();
  });

  test('switching one off takes it off the form without touching its history', async () => {
    const live = await current();
    await updateDeclaration(
      prisma,
      editionId,
      live.id,
      { title: live.title, body: live.body, bodyTa: live.bodyTa, isActive: false },
      SYSTEM,
    );
    expect(await declarationsForForm(prisma, editionId, 'VENDOR')).toHaveLength(0);
    expect(await prisma.stallDeclaration.count({ where: { id: live.id } })).toBe(1);
  });
});

describe('the consent log', () => {
  test('a submission records the exact version that was live', async () => {
    const live = (await declarationsForForm(prisma, editionId, 'VENDOR'))[0];
    const { requestId } = await submit();

    const consents = await consentsFor(prisma, requestId);
    expect(consents).toHaveLength(1);
    expect(consents[0]?.version).toBe(live?.version);
    expect(consents[0]?.body).toBe(live?.body);
  });

  /** 🔴 The whole promise. Editing the wording afterwards must not change what
   *  an existing requester is recorded as having agreed to. */
  test('and rewriting the wording afterwards does not change what they agreed to', async () => {
    const { requestId } = await submit();
    const was = (await consentsFor(prisma, requestId))[0]?.body;

    const live = await prisma.stallDeclaration.findFirstOrThrow({
      where: { editionId, key: 'request_submission', requestType: 'VENDOR', isCurrent: true },
    });
    await updateDeclaration(
      prisma,
      editionId,
      live.id,
      { title: live.title, body: 'Completely different terms.', bodyTa: null, isActive: true },
      SYSTEM,
    );

    const after = await consentsFor(prisma, requestId);
    expect(after[0]?.body).toBe(was);
    expect(after[0]?.body).not.toBe('Completely different terms.');
  });

  /** ⚠️ Deleting wording somebody agreed to would leave the agreement meaning
   *  nothing, so the foreign key refuses it. Retire it instead. */
  test('a declaration somebody consented to cannot be deleted', async () => {
    await submit();
    const live = await prisma.stallDeclaration.findFirstOrThrow({
      where: { editionId, key: 'request_submission', requestType: 'VENDOR', isCurrent: true },
    });
    await expect(prisma.stallDeclaration.delete({ where: { id: live.id } })).rejects.toThrow();
  });
});

describe('wording that moved while the form was open', () => {
  test('a stale page is refused rather than logged against wording nobody saw', async () => {
    await expect(
      submit({ declarationIds: ['11111111-1111-4111-8111-111111111111'] }),
    ).rejects.toBeInstanceOf(DeclarationsChangedError);
  });

  test('a page that claims it showed none is refused too, when one is live', async () => {
    await expect(submit({ declarationIds: [] })).rejects.toBeInstanceOf(DeclarationsChangedError);
  });

  test('the versions it actually displayed go through', async () => {
    const live = await declarationsForForm(prisma, editionId, 'VENDOR');
    const { requestId } = await submit({ declarationIds: live.map((d) => d.id) });
    expect(await consentsFor(prisma, requestId)).toHaveLength(1);
  });

  /** ⚠️ Absent is not a claim. A server-side caller that does not participate
   *  gets the live wording logged, which is what every caller did before this
   *  existed — the check catches a stale BROWSER, and refusing a script for not
   *  sending a field would refuse it for no reason. */
  test('a caller that says nothing at all gets the live wording logged', async () => {
    const { requestId } = await submit();
    expect(await consentsFor(prisma, requestId)).toHaveLength(1);
  });
});

describe('over HTTP', () => {
  test('an admin writes one and reads back every version', async () => {
    const made = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/config/declarations',
      headers: admin.headers,
      payload: {
        key: 'deposit_terms',
        requestType: null,
        title: 'Deposit',
        body: 'The advance is refundable after the event.',
      },
    });
    expect(made.statusCode).toBe(201);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/config/declarations/${made.json().id}`,
      headers: admin.headers,
      payload: {
        title: 'Deposit',
        body: 'The advance is refundable after the event, less deductions.',
        isActive: true,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().version).toBe(2);

    const list = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config/declarations',
      headers: admin.headers,
    });
    const deposit = list
      .json()
      .declarations.filter((d: { key: string }) => d.key === 'deposit_terms');
    expect(deposit.map((d: { version: number }) => d.version).sort()).toEqual([1, 2]);
  });

  test('a volunteer may neither read them nor write one', async () => {
    const volunteer = await seedBackoffice(['stalls_volunteer']);
    const read = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config/declarations',
      headers: volunteer.headers,
    });
    expect(read.statusCode).toBe(403);
  });
});
