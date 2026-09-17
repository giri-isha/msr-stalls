import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import {
  authenticate,
  createCredential,
  hashPassword,
  verifyPassword,
} from '../src/modules/stalls/credentials';
import { mintAccessLink, resolveAccessLink } from '../src/modules/stalls/accounts';
import { InvalidCredentialsError, UnknownAccessLinkError } from '../src/modules/stalls/errors';
import {
  endAllSessions,
  endSession,
  requireRequester,
  startSession,
} from '../src/modules/stalls/session';
import {
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  seedRequester,
  vendorBody,
} from './helpers/db';
import { recordingWhatsApp } from './helpers/onboarding';

let app: FastifyInstance;
const mail = new LogMailer();
const whatsapp = recordingWhatsApp();
beforeAll(async () => {
  app = await buildApp({ logger: false, mail, whatsapp, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
});

const url = (p: string) => `/api/m/stalls/public/${p}`;
/** ⚠️ `requesterType` is defaulted rather than spelled out in every body: the
 *  tests below are about the CONTACT and the silence around it, and the type is
 *  a required field they would otherwise all have to carry. The tests that are
 *  about the type pass their own. */
const postRegister = (body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: url('register'),
    payload: { requesterType: 'VENDOR', ...body },
  });

async function account(email = 'priya@greenleaf.example', phone = '9840012345') {
  return prisma.stallAccount.create({
    data: { email, phone, displayName: 'Priya Venkat' },
  });
}

async function credentialFor(contact: { kind: 'EMAIL' | 'MOBILE'; value: string }) {
  const acct = await account();
  return createCredential(prisma, {
    accountId: acct.id,
    contact,
    password: 'hunter2hunter2',
  });
}

describe('password hashing', () => {
  test('a hash verifies against its own password and nothing else', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batteries', stored)).toBe(false);
  });

  // 🔴 A per-hash salt. Two people who pick the same password must not be
  // visibly the same row in a leaked dump.
  test('the same password hashes differently every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  test('a stored value in an unknown format verifies nothing', async () => {
    expect(await verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('authenticate', () => {
  test('returns the credential for the right password', async () => {
    const cred = await credentialFor({ kind: 'EMAIL', value: 'priya@greenleaf.example' });

    const got = await authenticate(prisma, {
      contact: 'Priya@GreenLeaf.Example',
      password: 'hunter2hunter2',
    });
    expect(got.id).toBe(cred.id);
  });

  // 🔴 The three ways to fail must be ONE error. Anything else turns login into
  // a way of asking whether a given number has applied — the question decision
  // 17 exists to refuse.
  test('unknown contact, wrong password and locked out are one error', async () => {
    const acct = await account();
    const cred = await createCredential(prisma, {
      accountId: acct.id,
      contact: { kind: 'MOBILE', value: '9840012345' },
      password: 'hunter2hunter2',
    });
    const locked = await createCredential(prisma, {
      accountId: acct.id,
      contact: { kind: 'EMAIL', value: 'priya@greenleaf.example' },
      password: 'hunter2hunter2',
    });
    await prisma.stallCredential.update({
      where: { id: locked.id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });
    expect(cred.id).not.toBe(locked.id);

    // ⚠️ Thunks, not promises. Three rejections built up front reject before
    // anything is awaiting them, which vitest reports as an unhandled error
    // even though every one is caught a line later.
    const attempts = [
      () => authenticate(prisma, { contact: '9000000000', password: 'hunter2hunter2' }),
      () => authenticate(prisma, { contact: '9840012345', password: 'nope' }),
      () =>
        authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'hunter2hunter2' }),
    ];

    const messages: string[] = [];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(InvalidCredentialsError);
      messages.push(
        await attempt().then(
          () => 'resolved',
          (e: Error) => e.message,
        ),
      );
    }
    expect(new Set(messages).size).toBe(1);
  });

  test('a contact that is not a contact at all is that same error', async () => {
    await expect(
      authenticate(prisma, { contact: 'not a contact', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('locks out after repeated failures, with that same error', async () => {
    await credentialFor({ kind: 'EMAIL', value: 'priya@greenleaf.example' });

    for (let i = 0; i < 10; i++) {
      await expect(
        authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'wrong' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    // The RIGHT password now fails too — that is what a lockout is.
    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('a good login clears the failure count', async () => {
    const cred = await credentialFor({ kind: 'EMAIL', value: 'priya@greenleaf.example' });

    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'hunter2hunter2',
    });

    const after = await prisma.stallCredential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(after.failedCount).toBe(0);
  });
});

describe('session', () => {
  test('a started session resolves back to its account', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    const got = await requireRequester(prisma, { cookies: { stall_requester: token } });
    expect(got.id).toBe(acct.id);
  });

  test('no cookie is refused', async () => {
    await expect(requireRequester(prisma, { cookies: {} })).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );
  });

  test('ending a session revokes it', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    await endSession(prisma, token);
    await expect(
      requireRequester(prisma, { cookies: { stall_requester: token } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });

  test('ending every session evicts them all at once', async () => {
    const acct = await account();
    const first = await startSession(prisma, acct.id);
    const second = await startSession(prisma, acct.id);
    await endAllSessions(prisma, acct.id);
    for (const token of [first, second]) {
      await expect(
        requireRequester(prisma, { cookies: { stall_requester: token } }),
      ).rejects.toBeInstanceOf(UnknownAccessLinkError);
    }
  });

  // 🔴 The purpose is the wall between the two credentials. A session cookie
  // must not open a bank form, and a bank-form token must not act as a session.
  // `resolveAccessLink` already refuses to cross; this is the test that says so
  // out loud, because the whole SSO swap rests on that one function.
  test('a session token cannot open a bank form, and a bank token is not a session', async () => {
    const acct = await account();
    const session = await startSession(prisma, acct.id);
    await expect(resolveAccessLink(prisma, session, 'BANK_FORM')).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );

    const { token: bank } = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'BANK_FORM',
      ttlDays: 180,
    });
    await expect(
      requireRequester(prisma, { cookies: { stall_requester: bank } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });

  test('an expired session is refused', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    await prisma.stallAccessLink.updateMany({
      where: { accountId: acct.id, purpose: 'SESSION' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      requireRequester(prisma, { cookies: { stall_requester: token } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });
});

describe('POST /public/register', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  // A free contact sends NOTHING. There is no confirmation step, and the
  // silence is also what keeps the three register outcomes indistinguishable
  // from outside — only the taken one puts a message anywhere.
  test('a free email creates an account and a credential, and sends nothing', async () => {
    const res = await postRegister({
      contact: 'new@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'New Vendor',
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });

    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    expect(cred.loginKind).toBe('EMAIL');
    expect(mail.sent).toHaveLength(0);
    expect(whatsapp.sent).toHaveLength(0);
  });

  test('a free mobile registers under a placeholder address', async () => {
    const res = await postRegister({
      contact: '98400 12399',
      password: 'hunter2hunter2',
      displayName: 'Trader',
    });
    expect(res.statusCode).toBe(202);
    expect(whatsapp.sent).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);

    // The address column is non-null and unique, so a mobile registration gets
    // a placeholder. Nothing may ever send to it.
    const acct = await prisma.stallAccount.findFirstOrThrow();
    expect(acct.email).toBe('mobile+9840012399@stalls.invalid');
    expect(acct.phone).toBe('9840012399');
    expect(
      await prisma.stallCredential.findUniqueOrThrow({ where: { loginValue: '9840012399' } }),
    ).toMatchObject({ loginKind: 'MOBILE' });
  });

  // 🔴 THE test for this feature. A taken contact, a free one and a string that
  // is not a contact must be one response. Anything else and the route answers
  // "has this shopkeeper applied?"
  test('taken, free and malformed are byte-identical responses', async () => {
    await account('taken@vendor.example', '9840012345');

    const free = await postRegister({
      contact: 'free@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'A',
    });
    const taken = await postRegister({
      contact: 'taken@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'B',
    });
    const junk = await postRegister({
      contact: 'not a contact',
      password: 'hunter2hunter2',
      displayName: 'C',
    });

    expect(taken.statusCode).toBe(free.statusCode);
    expect(junk.statusCode).toBe(free.statusCode);
    expect(taken.body).toBe(free.body);
    expect(junk.body).toBe(free.body);
  });

  /** 🔴 Which form the account may fill, asked here and enforced on the write.
   *
   *  The three populations are asked different questions and priced off
   *  different rate scopes, so this is not a preference — see
   *  `WrongRequesterTypeError`. */
  test('stores the form the account registered for', async () => {
    await postRegister({
      contact: 'welfare@village.example',
      password: 'hunter2hunter2',
      displayName: 'Village Welfare',
      requesterType: 'LOCAL_WELFARE',
    });

    const acct = await prisma.stallAccount.findUniqueOrThrow({
      where: { email: 'welfare@village.example' },
    });
    expect(acct.requesterType).toBe('LOCAL_WELFARE');
  });

  test('refuses a body with no form on it, and one naming a form that does not exist', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: url('register'),
      payload: {
        contact: 'new@vendor.example',
        password: 'hunter2hunter2',
        displayName: 'New Vendor',
      },
    });
    const nonsense = await postRegister({
      contact: 'new2@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'New Vendor',
      requesterType: 'ASHRAM_FOOD',
    });

    expect(missing.statusCode).toBe(400);
    expect(nonsense.statusCode).toBe(400);
    expect(await prisma.stallAccount.count()).toBe(0);
  });

  // 🔴 The refusal is real, it just travels by the account's own channel.
  test('registering on a taken contact warns the ACCOUNT and makes no credential', async () => {
    await account('taken@vendor.example', '9840012345');
    await postRegister({
      contact: 'taken@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'Impostor',
    });

    expect(await prisma.stallCredential.count()).toBe(0);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('taken@vendor.example');
    expect(mail.sent[0].subject.toLowerCase()).toContain('stall team');
    // The account also has a number, and the channel that works is the one the
    // person attempting it did not choose.
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].to).toBe('9840012345');
  });

  test('a taken MOBILE warns the account behind it', async () => {
    await account('taken@vendor.example', '9840012345');
    await postRegister({
      contact: '9840012345',
      password: 'hunter2hunter2',
      displayName: 'Impostor',
    });
    expect(await prisma.stallCredential.count()).toBe(0);
    expect(mail.sent[0].to).toBe('taken@vendor.example');
  });

  test('a malformed contact sends nothing at all', async () => {
    await postRegister({
      contact: 'not a contact',
      password: 'hunter2hunter2',
      displayName: 'C',
    });
    expect(mail.sent).toHaveLength(0);
    expect(whatsapp.sent).toHaveLength(0);
    expect(await prisma.stallAccount.count()).toBe(0);
  });

  test('a second registration on the same contact does not replace the first', async () => {
    await postRegister({
      contact: 'first@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'First',
    });
    const before = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'first@vendor.example' },
    });

    await postRegister({
      contact: 'first@vendor.example',
      password: 'adifferentpassword',
      displayName: 'Second',
    });
    const after = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'first@vendor.example' },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await prisma.stallCredential.count()).toBe(1);
  });

  test('a password under the floor is a validation error, not a silent 202', async () => {
    const res = await postRegister({
      contact: 'short@vendor.example',
      password: 'short',
      displayName: 'Short',
    });
    expect(res.statusCode).toBe(400);
  });
});

/** The reset token, taken from the message that carried it — the way a vendor
 *  gets it. Only the hash is stored, so there is no reading it back out of the
 *  table, and that is the point of storing it that way. */
function tokenFromLastMessage(): string {
  const text = mail.sent.at(-1)?.text ?? whatsapp.sent.at(-1)?.text ?? '';
  const found = text.match(/https?:\/\/\S+\/reset\/([A-Za-z0-9_-]+)/);
  if (!found) throw new Error(`no link in: ${text}`);
  return found[1];
}

async function registered(contact = 'new@vendor.example', password = 'hunter2hunter2') {
  mail.sent.length = 0;
  whatsapp.sent.length = 0;
  await postRegister({ contact, password, displayName: 'New Vendor' });
}

async function loggedIn(contact = 'new@vendor.example', password = 'hunter2hunter2') {
  await registered(contact, password);
  const res = await app.inject({
    method: 'POST',
    url: url('login'),
    payload: { contact, password },
  });
  return res.cookies.find((c) => c.name === 'stall_requester')?.value ?? '';
}

describe('login and logout', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  // There is no confirmation step: what was registered a moment ago logs in.
  test('a fresh registration can log in straight away', async () => {
    await registered();
    const res = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(200);

    const cookie = res.cookies.find((c) => c.name === 'stall_requester');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
  });

  // ⚠️ Registering must not sign anyone in. A session on this response would
  // distinguish the free contact from the taken one, which is the one thing
  // the register route may not do.
  test('registering does not hand back a session', async () => {
    const res = await postRegister({
      contact: 'new@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'New Vendor',
    });
    expect(res.cookies.find((c) => c.name === 'stall_requester')).toBeUndefined();
  });

  test('login sets the session cookie and the session route answers', async () => {
    const value = await loggedIn();
    await app.inject({
      method: 'POST',
      url: url('logout'),
      cookies: { stall_requester: value },
    });

    const res = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(200);
    const fresh = res.cookies.find((c) => c.name === 'stall_requester')?.value ?? '';

    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: fresh },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ displayName: 'New Vendor', email: 'new@vendor.example' });
  });

  /** The session carries the form the account may fill, because the apply page
   *  draws its tiles from it. */
  test('the session names the form the account registered for', async () => {
    const value = await loggedIn();
    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(me.json().requesterType).toBe('VENDOR');
  });

  /** 🔴 The accounts that pre-date the question. An account which has FILED
   *  came in through one of the three forms, and that is what it is — resolved
   *  on the way out rather than left null, or such a requester would be offered
   *  three forms and refused two of them on submit. */
  test('an account with no stored type is told the type of what it filed', async () => {
    const value = await loggedIn();
    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'new@vendor.example' }),
      cookies: { stall_requester: value },
    });
    // Back to the state a row created before the column was added is in.
    await prisma.stallAccount.update({
      where: { id: cred.accountId },
      data: { requesterType: null },
    });

    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(me.json().requesterType).toBe('VENDOR');
  });

  /** Null only for an account that has never applied — the one state in which
   *  all three forms are offered. */
  test('an account that has never applied has no type resolved for it', async () => {
    const value = await loggedIn();
    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    await prisma.stallAccount.update({
      where: { id: cred.accountId },
      data: { requesterType: null },
    });

    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(me.json().requesterType).toBeNull();
  });

  /**
   * 🔴 What is LEFT of the edition's request cap, on the session.
   *
   * The two places that act on it — the header's New Request button and the
   * apply page — are not looking at a request, so neither could read it off
   * one. Without this, an account at its limit found out by filling in a whole
   * form and being refused on the post.
   *
   * ⚠️ `countedAs` is the wording `TooManyOpenRequestsError` refuses with,
   * resolved here rather than looked up again by the page, so the sentence on
   * the apply page and the sentence on the refusal cannot drift apart.
   */
  test('the session says what is left of the edition’s request cap', async () => {
    const edition = await prisma.stallEdition.findFirstOrThrow({ where: { isActive: true } });
    await prisma.stallEdition.update({
      where: { id: edition.id },
      data: { maxOpenRequests: 2, requestCapScope: 'OPEN' },
    });
    const value = await loggedIn();

    const before = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(before.json().allowance).toEqual({ used: 0, max: 2, countedAs: 'still open' });

    await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'new@vendor.example' }),
      cookies: { stall_requester: value },
    });

    const after = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(after.json().allowance).toEqual({ used: 1, max: 2, countedAs: 'still open' });
  });

  /** ⚠️ Counted by the SAME function the submit path refuses on, so the page
   *  and the post cannot disagree about one account. This asserts the seam by
   *  its consequence: the session reads spent at exactly the point the next
   *  submission is refused. */
  test('the count it reports is the count the submit path refuses on', async () => {
    const edition = await prisma.stallEdition.findFirstOrThrow({ where: { isActive: true } });
    await prisma.stallEdition.update({
      where: { id: edition.id },
      data: { maxOpenRequests: 1, requestCapScope: 'OPEN' },
    });
    const value = await loggedIn();

    await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'new@vendor.example' }),
      cookies: { stall_requester: value },
    });

    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(me.json().allowance).toEqual({ used: 1, max: 1, countedAs: 'still open' });

    const second = await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'new@vendor.example' }),
      cookies: { stall_requester: value },
    });
    expect(second.statusCode).toBe(422);
  });

  /** ⚠️ Which statuses count is the EDITION's setting, and the session obeys it
   *  as the write does. Under UNDECIDED a selection frees the slot; the session
   *  has to say so, or the button stays hidden for somebody who may file. */
  test('the scope the edition set is the scope the session counts by', async () => {
    const edition = await prisma.stallEdition.findFirstOrThrow({ where: { isActive: true } });
    await prisma.stallEdition.update({
      where: { id: edition.id },
      data: { maxOpenRequests: 2, requestCapScope: 'UNDECIDED' },
    });
    const value = await loggedIn();
    await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'new@vendor.example' }),
      cookies: { stall_requester: value },
    });
    await prisma.stallRequest.updateMany({ data: { status: 'SELECTED' } });

    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    // Selected is no longer awaiting a decision, so the slot is free again.
    expect(me.json().allowance).toEqual({ used: 0, max: 2, countedAs: 'awaiting a decision' });
  });

  // 🔴 Two different failures, one response, down to the byte.
  test('a wrong password and an unknown contact are the same 401', async () => {
    await loggedIn();
    const unknown = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'nobody@vendor.example', password: 'hunter2hunter2' },
    });
    const wrong = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'wrongwrongwrong' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  // ⚠️ 404, not 401. A public page asks this on every render; a 401 would make
  // the browser treat the apply form as something it must authenticate for.
  test('the session route without a cookie is 404, not a hint', async () => {
    const res = await app.inject({ method: 'GET', url: url('session') });
    expect(res.statusCode).toBe(404);
  });

  test('a mobile registration reports no address, not a placeholder', async () => {
    const value = await loggedIn('9840012399');
    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(me.json().email).toBe('');
    expect(me.json().phone).toBe('9840012399');
  });

  test('logout revokes the session', async () => {
    const value = await loggedIn();
    await app.inject({
      method: 'POST',
      url: url('logout'),
      cookies: { stall_requester: value },
    });
    const after = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(after.statusCode).toBe(404);
  });
});

describe('password reset', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  const ask = (contact: string) =>
    app.inject({ method: 'POST', url: url('password-reset'), payload: { contact } });

  // 🔴 Same rule as registration. "No account on that address" would be an
  // answer to a question this route refuses to be asked.
  test('an unknown contact gets the same 202 as a known one, and no mail', async () => {
    await loggedIn();
    mail.sent.length = 0;

    const known = await ask('new@vendor.example');
    const unknown = await ask('nobody@vendor.example');
    const junk = await ask('not a contact');

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(junk.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(junk.body).toBe(known.body);
    // Exactly one went out: the one with an account behind it.
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('new@vendor.example');
  });

  test('a reset sets the new password and evicts every live session', async () => {
    const stale = await loggedIn();
    mail.sent.length = 0;

    await ask('new@vendor.example');
    const token = tokenFromLastMessage();
    const res = await app.inject({
      method: 'POST',
      url: url('password-reset/confirm'),
      payload: { token, password: 'brandnewpassword' },
    });
    expect(res.statusCode).toBe(200);

    // The session that asked for the reset is gone — that is most of the point.
    const dead = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: stale },
    });
    expect(dead.statusCode).toBe(404);

    const old = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'hunter2hunter2' },
    });
    expect(old.statusCode).toBe(401);

    const fresh = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'brandnewpassword' },
    });
    expect(fresh.statusCode).toBe(200);
  });

  test('a reset link works once', async () => {
    await loggedIn();
    mail.sent.length = 0;
    await ask('new@vendor.example');
    const token = tokenFromLastMessage();

    await app.inject({
      method: 'POST',
      url: url('password-reset/confirm'),
      payload: { token, password: 'brandnewpassword' },
    });
    const again = await app.inject({
      method: 'POST',
      url: url('password-reset/confirm'),
      payload: { token, password: 'thirdpasswordhere' },
    });
    expect(again.statusCode).toBe(404);
  });
});

describe('the apply gate', () => {
  test('submitting without a session is refused, and writes nothing', async () => {
    const res = await app.inject({ method: 'POST', url: url('requests'), payload: vendorBody() });
    expect(res.statusCode).toBe(404);
    expect(await prisma.stallRequest.count()).toBe(0);
  });

  // 🔴 The hole this closes. Before the gate, the account came from
  // `findOrCreateAccount(input.email)` — the address TYPED INTO THE FORM — so
  // typing a known vendor's address attached the request to their account and
  // mailed them the receipt, status link and all.
  test('a typed email cannot choose an account', async () => {
    const victim = await account('victim@vendor.example', '9840011111');
    const { accountId, cookies } = await seedRequester(app, 'attacker@vendor.example');

    const res = await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'victim@vendor.example' }),
      cookies,
    });
    expect(res.statusCode).toBe(201);

    const created = await prisma.stallRequest.findFirstOrThrow();
    expect(created.accountId).toBe(accountId);
    expect(created.accountId).not.toBe(victim.id);
    // The typed address still lives on the row — it is a fact about this
    // request, and backoffice need it. It just no longer selects anything.
    expect(created.email).toBe('victim@vendor.example');
  });

  // The receipt carries a status link, which is a credential for the whole
  // account. It must not follow a typed address.
  test('the receipt goes to the account, not to the address typed in the form', async () => {
    const { cookies } = await seedRequester(app, 'owner@vendor.example');
    mail.sent.length = 0;

    await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'somebody-else@vendor.example' }),
      cookies,
    });

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('owner@vendor.example');
  });

  test('a requester registered on a mobile gets the receipt on WhatsApp', async () => {
    const { cookies } = await seedRequester(app, '9840012399');
    mail.sent.length = 0;
    whatsapp.sent.length = 0;

    await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody(),
      cookies,
    });

    expect(mail.sent).toHaveLength(0);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].to).toBe('9840012399');
  });

  test('two requests from one login sit under one account', async () => {
    const { accountId, cookies } = await seedRequester(app);
    for (const stallName of ['First Stall', 'Second Stall']) {
      const res = await app.inject({
        method: 'POST',
        url: url('requests'),
        payload: vendorBody({ stallName }),
        cookies,
      });
      expect(res.statusCode).toBe(201);
    }
    expect(await prisma.stallRequest.count({ where: { accountId } })).toBe(2);
  });

  /** 🔴 The type gate. The apply page offers an account only its own form, so
   *  a requester never meets this — what it stops is a post that did not come
   *  from that page, and the cost of not stopping it is a trader priced off the
   *  local welfare rate card. */
  test('a form the account is not registered for is refused, and writes nothing', async () => {
    const { cookies } = await seedRequester(
      app,
      'welfare@village.example',
      'hunter2hunter2',
      'Village Welfare',
      'LOCAL_WELFARE',
    );

    const res = await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'welfare@village.example' }),
      cookies,
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.stallRequest.count()).toBe(0);
  });

  /** The other half of the answer for a row that pre-dates the question: the
   *  type of what you file is what you are, written back so the next post is
   *  checked against it. */
  test('an account with no type adopts the one it files, and is held to it after', async () => {
    const { accountId, cookies } = await seedRequester(app);
    await prisma.stallAccount.update({ where: { id: accountId }, data: { requesterType: null } });

    const first = await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody(),
      cookies,
    });
    expect(first.statusCode).toBe(201);
    expect(
      (await prisma.stallAccount.findUniqueOrThrow({ where: { id: accountId } })).requesterType,
    ).toBe('VENDOR');

    const second = await app.inject({
      method: 'POST',
      url: url('requests'),
      // ⚠️ `depositAcknowledged`, or the schema refuses a local welfare body
      // with a 400 before the gate this test is about ever runs.
      payload: vendorBody({
        requestType: 'LOCAL_WELFARE',
        stallName: 'Village Stall',
        depositAcknowledged: true,
      }),
      cookies,
    });
    expect(second.statusCode).toBe(403);
  });
});
