import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, publicConfigFor, renderAt } from '../test-utils';
import { REQUEST_FORM_ROUTES } from './request-forms';

afterEach(() => vi.unstubAllGlobals());

/** ⚠️ The module's OWN route table, under the path the shell mounts it at —
 *  not a `:type` pattern written out again here. Each form has its own route
 *  now, and a test that declared its own would go on passing after one was
 *  renamed or dropped. */
const routes = [
  ...REQUEST_FORM_ROUTES.map((r) => ({ ...r, path: `/stalls/${r.path}` })),
  { path: '/stalls/submitted', element: <div>submitted-page</div> },
];

/** The form sits behind a session now, so every render here is signed in. The
 *  signed-OUT case is `RequesterAuth.test.tsx`'s — it is about the gate, and
 *  this file is about the form. */
const session = () =>
  [
    'GET',
    /\/public\/session$/,
    () => ({
      accountId: 'a-1',
      displayName: 'Priya Venkat',
      email: 'priya@greenleaf.example',
      phone: '9840012345',
    }),
  ] as const;

// The form asks at its own scope; the stub answers at the scope it was asked.
const config = () =>
  [
    'GET',
    /\/public\/config$/,
    (url: URL) => publicConfigFor(url.searchParams.get('scope')),
  ] as const;

/** ⚠️ `retype`, not `type`, on the three fields the account prefills — name,
 *  email and contact number. Typing into a field that already holds a value
 *  appends to it, which is what a user would see too; clearing first is what
 *  one would actually do. */
async function retype(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, value: string) {
  await user.clear(field);
  await user.type(field, value);
}

async function fillVendor(user: ReturnType<typeof userEvent.setup>) {
  await retype(user, screen.getByLabelText(/^Email/), 'priya@greenleaf.example');
  await user.type(screen.getByLabelText(/Stall Name/), 'Green Leaf Organics');
  await retype(user, screen.getByLabelText(/Vendor Name/), 'Priya Venkat');
  await user.type(screen.getByLabelText(/^Address/), '12 Mettupalayam Road');
  await retype(user, screen.getByLabelText(/Contact Number/), '+91 98400 12345');
  await user.selectOptions(screen.getByLabelText(/Type of stall/), 'FOOD');
  await user.click(screen.getByLabelText(/Category C1/));
  await user.type(screen.getByLabelText(/What items are you selling/), 'Spices');
  await user.type(screen.getByLabelText(/Number of stalls required/), '1');
}

/** The consent tick, found by its own wording — which is the label now, rather
 *  than a bare "I Agree" beside a plate at the top of the page.
 *
 *  ⚠️ `findBy`, not `getBy`. The declarations arrive with the public config,
 *  while the Submit button renders immediately — so a synchronous query here
 *  races the load and finds nothing. */
const tickDeclaration = () =>
  screen.findByRole('checkbox', { name: /does not guarantee stall allocation/i });

describe('RequestForm — vendor', () => {
  test('renders the Tamil label beside the English one', async () => {
    installFetch([config(), session()]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    expect(await screen.findByText('ஸ்டால் பெயர்')).toBeInTheDocument();
    expect(screen.getByText('Stall Name')).toBeInTheDocument();
  });

  /** 🔴 The wording IS the tick's label now. It used to be an information plate
   *  at the top of the form with a bare "I Agree" box thirty questions below —
   *  by the time the box was in reach the words had been off screen for
   *  minutes, and nothing on the page connected them. */
  test('submit stays disabled until the declaration is ticked, beside its own wording', async () => {
    installFetch([config(), session()]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    const btn = await screen.findByRole('button', { name: /submit request/i });
    const tick = await tickDeclaration();
    // ⚠️ Asserted AFTER the config has landed, so this proves the tick gates
    // submission — not merely that the button starts out disabled while the
    // page is still loading.
    expect(btn).toBeDisabled();

    const wording = screen.getByText(/does not guarantee stall allocation/i);
    // The wording sits inside the tick's own label, not merely near it.
    expect(tick.closest('label')?.contains(wording)).toBe(true);

    await userEvent.setup().click(tick);
    expect(btn).toBeEnabled();
  });

  /** The bare "I Agree" field is retired: its wording is a declaration row and
   *  asking it here too would be the same consent asked twice. */
  test('there is no bare "I Agree" question left on the form', async () => {
    installFetch([config(), session()]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    await screen.findByRole('button', { name: /submit request/i });
    expect(screen.queryByLabelText(/^I Agree$/)).not.toBeInTheDocument();
  });

  test('quotes the rent per open zone and does not offer closed zones to vendors', async () => {
    installFetch([config(), session()]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    // ⚠️ Wait for the ZONE, not for the form's first label. The form now
    // renders behind the session load as well as the config load, and the
    // Tamil caption arrives with the former while the bays arrive with the
    // latter — so the old wait could pass with no bays on screen yet.
    const c1 = (await screen.findByLabelText(/Category C1/)).closest('label') as HTMLElement;
    // The form renders before /config resolves; the rent arrives with it. With
    // no stall type chosen yet it quotes the non-food rate…
    expect(await within(c1).findByText(/₹12,000 \+ GST/)).toBeInTheDocument();
    // …and follows the stall type once one is picked.
    await userEvent.setup().selectOptions(screen.getByLabelText(/Type of stall/), 'FOOD');
    expect(await within(c1).findByText(/₹15,000 \+ GST/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Category A3/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Category B2/)).not.toBeInTheDocument();
  });

  test('appends the admin-configured custom field', async () => {
    installFetch([config(), session()]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    expect(await screen.findByLabelText(/Instagram handle/)).toBeInTheDocument();
  });

  test('posts the normalised body and navigates to the confirmation', async () => {
    const fx = installFetch([
      config(),
      session(),
      [
        'POST',
        /\/public\/requests$/,
        () => [201, { reference: 'VEN-2026-0042', statusToken: 't'.repeat(43) }],
      ],
    ]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    const user = userEvent.setup();
    await screen.findByText('ஸ்டால் பெயர்');
    await fillVendor(user);
    await user.type(screen.getByLabelText(/Instagram handle/), '@greenleaf');
    await user.click(await tickDeclaration());
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    expect(await screen.findByText('submitted-page')).toBeInTheDocument();
    const post = fx.calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({
      requestType: 'VENDOR',
      contactNumber: '9840012345',
      stallType: 'FOOD',
      preferredZoneCode: 'C1',
      numStallsRequested: 1,
      agreed: true,
      customFields: { '11111111-1111-4111-8111-111111111111': '@greenleaf' },
    });
    expect(post?.body).not.toHaveProperty('status');
  });

  test('marks required fields instead of posting an incomplete form', async () => {
    const fx = installFetch([config(), session()]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    const user = userEvent.setup();
    await screen.findByText('ஸ்டால் பெயர்');
    await user.click(await tickDeclaration());
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(1);
    expect(fx.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('puts a server field error on the field that caused it', async () => {
    installFetch([
      config(),
      session(),
      [
        'POST',
        /\/public\/requests$/,
        () => [400, { error: 'contactNumber: expected a 10-digit Indian mobile number' }],
      ],
    ]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    const user = userEvent.setup();
    await screen.findByText('ஸ்டால் பெயர்');
    await fillVendor(user);
    await user.click(await tickDeclaration());
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Contact Number/)).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByText(/expected a 10-digit/)).toBeInTheDocument();
  });

  test('explains a 503 as "not open" rather than as an error', async () => {
    installFetch([
      config(),
      session(),
      ['POST', /\/public\/requests$/, () => [503, { error: 'no active stall edition' }]],
    ]);
    renderAt('/stalls/apply/vendor', routes, { requester: true });
    const user = userEvent.setup();
    await screen.findByText('ஸ்டால் பெயர்');
    await fillVendor(user);
    await user.click(await tickDeclaration());
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/not open right now/)).toBeInTheDocument();
  });
});

describe('RequestForm — local welfare', () => {
  test('requires the caution deposit acknowledgement and offers A3', async () => {
    installFetch([config(), session()]);
    renderAt('/stalls/apply/local-welfare', routes, { requester: true });
    expect(await screen.findByText('திரும்பப்பெறக்கூடிய எச்சரிக்கை வைப்பு')).toBeInTheDocument();
    // The bays arrive with /config, which resolves after the session — wait for
    // the bay itself rather than for a caption that is already on screen.
    expect(await screen.findByLabelText(/Category A3/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Category A3/)).toBeEnabled();
    expect(screen.getByLabelText(/How many Gas stoves/)).toBeInTheDocument();
  });
});

describe('RequestForm — ashram', () => {
  test('asks the department questions and posts them as a nested block', async () => {
    const fx = installFetch([
      config(),
      session(),
      [
        'POST',
        /\/public\/requests$/,
        () => [201, { reference: 'ASH-2026-0001', statusToken: 't'.repeat(43) }],
      ],
    ]);
    renderAt('/stalls/apply/ashram', routes, { requester: true });
    const user = userEvent.setup();
    // Required labels end in a visual "*", so anchor before it.
    await screen.findByLabelText(/^Department Head\*?$/);
    await retype(user, screen.getByLabelText(/^Email/), 'pub@ashram.example');
    await user.type(screen.getByLabelText(/^Department Head\*?$/), 'Ravi Shankar');
    await user.type(screen.getByLabelText(/Department Head Contact/), '9840012345');
    await user.type(screen.getByLabelText(/^Department\*?$/), 'Publications');
    await retype(user, screen.getByLabelText(/Requested By/), 'Meera Iyer');
    await retype(user, screen.getByLabelText(/Requester Contact/), '9840023456');
    await user.type(screen.getByLabelText(/Stall Name/), 'Publications Stall');
    // 🔴 The question that replaced the second ashram form. It used to be
    // implied by which of two pages the department had opened.
    await user.selectOptions(screen.getByLabelText(/Type of stall/), 'NON_FOOD');
    await user.selectOptions(screen.getByLabelText(/Credit card/), 'NO');
    await user.click(screen.getByLabelText(/Used by Department for Sales/));
    await user.type(screen.getByLabelText(/displaying\/Selling/), 'Books');
    // Preferred location is the zone radio list on every form.
    await user.click(screen.getByLabelText(/Category A4/));
    await user.type(screen.getByLabelText(/Number of stalls required/), '1');
    await user.selectOptions(screen.getByLabelText(/Tamil Thembu/), 'NO');
    for (const f of [
      /^Number of 5 AMP/,
      /15 AMP/,
      /Gas stoves/,
      /tables/,
      /chairs/,
      /2 wheeler/,
      /4 wheeler/,
      /Staff passes/,
    ]) {
      await user.type(screen.getByLabelText(f), '0');
    }
    await user.click(await tickDeclaration());
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    expect(await screen.findByText('submitted-page')).toBeInTheDocument();
    const post = fx.calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({
      requestType: 'ASHRAM',
      requesterName: 'Meera Iyer',
      contactNumber: '9840023456',
      stallType: 'NON_FOOD',
      ashram: {
        department: 'Publications',
        usage: 'DEPT_SALES',
        creditCardNeeded: false,
        wantsThembu: false,
      },
    });
    // ⚠️ Not asked of a non-food stall, so not posted for one. The API applies
    // the same rule, which is what stops a hidden question being refused.
    expect(post?.body).not.toHaveProperty('ashram.fssaiExpected');
  });

  /** 🔴 The whole of what the merge cost the form: one question, answered on
   *  the page instead of at the picker. FSSAI follows from the answer rather
   *  than from which of two forms somebody happened to open. */
  test('asks about FSSAI only once the stall is said to sell food', async () => {
    installFetch([config(), session()]);
    renderAt('/stalls/apply/ashram', routes, { requester: true });
    const user = userEvent.setup();
    const stallType = await screen.findByLabelText(/Type of stall/);

    // Unanswered, the question is drawn: one that appears when you tick a box
    // above it reads as a form that grew.
    expect(screen.getByLabelText(/hold an FSSAI certificate/)).toBeInTheDocument();

    await user.selectOptions(stallType, 'NON_FOOD');
    expect(screen.queryByLabelText(/hold an FSSAI certificate/)).not.toBeInTheDocument();

    await user.selectOptions(stallType, 'FOOD');
    expect(screen.getByLabelText(/hold an FSSAI certificate/)).toBeInTheDocument();
  });
});
