import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { MyRequests } from './MyRequests';

afterEach(() => vi.unstubAllGlobals());

const routes = [
  { path: '/stalls/requests', element: <MyRequests /> },
  { path: '/stalls/login', element: <div>the login page</div> },
  { path: '/stalls/apply', element: <div>the form picker</div> },
];

const render = (path = '/stalls/requests') => renderAt(path, routes, { requester: true });

const SESSION = {
  accountId: 'a-1',
  displayName: 'Priya Venkat',
  requesterType: 'VENDOR',
  email: 'priya@greenleaf.example',
  phone: '9840012345',
};

/** What the API reads back off the row — see `submittedSections`. */
const SUBMITTED = [
  {
    title: 'Your Request',
    glyph: 'clipboard-list',
    facts: [
      { label: 'Stall Name', value: 'Green Leaf Organics' },
      { label: 'Location Requested', value: 'C1' },
      { label: 'Items', value: 'Organic spices, cold-pressed oils, honey' },
    ],
  },
  {
    title: 'Electrical',
    glyph: 'sliders',
    facts: [{ label: '15 A Plug Points', value: '2' }],
  },
];

/** One selected request with whatever is outstanding on it. */
/** ⚠️ `open` and `blockedBy` are OPTIONAL here on purpose, and the assertions
 *  below mostly leave them out. The API and the web deploy separately, so a
 *  page served ahead of an API that does not send them must keep drawing the
 *  tabs it always drew — `portalTabs` reads `open !== false` for exactly that,
 *  and these fixtures are what holds it. The sequencing tests at the bottom
 *  pass them explicitly. */
const withPending = (
  pending: Array<{ step: string; label: string; open?: boolean; blockedBy?: string[] }>,
  extra: Record<string, unknown> = {},
) => ({
  displayName: 'Priya Venkat',
  requests: [
    {
      reference: 'VEN-2026-0001',
      requestType: 'VENDOR',
      stallName: 'Green Leaf Organics',
      status: 'SELECTED',
      submittedAt: '2026-09-01T10:00:00.000Z',
      allocatedZone: 'C1',
      allocatedStalls: ['C1-4'],
      pending,
      payment: null,
      paymentClaims: [],
      staff: null,
      submitted: SUBMITTED,
      ...extra,
    },
  ],
});

/** Two requests on one account, newest first — the order the API sends. */
const TWO = {
  displayName: 'Priya Venkat',
  requests: [
    {
      reference: 'VEN-2026-0002',
      requestType: 'VENDOR',
      stallName: 'Second Stall',
      status: 'SUBMITTED',
      submittedAt: '2026-09-02T10:00:00.000Z',
      allocatedZone: null,
      allocatedStalls: [],
      pending: [],
    },
    {
      reference: 'VEN-2026-0001',
      requestType: 'VENDOR',
      stallName: 'Green Leaf Organics',
      status: 'SELECTED',
      submittedAt: '2026-09-01T10:00:00.000Z',
      allocatedZone: 'C1',
      allocatedStalls: ['C1-4'],
      pending: [],
    },
  ],
};

const PAYMENT = {
  feePaise: 11_800_000, // ₹1,18,000
  depositPaise: 2_000_000, // ₹20,000
  totalPaise: 13_800_000, // ₹1,38,000
  // The arithmetic behind the fee — what a vendor querying their bill actually
  // asks about. See `PublicPaymentDue.breakdown`.
  breakdown: {
    lines: [
      {
        key: 'stall',
        group: 'stall',
        label: 'Rent for the stall',
        count: 1,
        unitRatePaise: 9_000_000,
        days: null,
        amountPaise: 9_000_000,
      },
      {
        key: 'plugs5a',
        group: 'plugs',
        label: '5 Amp',
        count: 0,
        unitRatePaise: 50_000,
        days: null,
        amountPaise: 0,
      },
      {
        key: 'plugs15a',
        group: 'plugs',
        label: '15 Amp',
        count: 4,
        unitRatePaise: 100_000,
        days: null,
        amountPaise: 400_000,
      },
      {
        key: 'chairs',
        group: 'equipment',
        label: 'Chair',
        count: 2,
        unitRatePaise: 10_000,
        days: 1,
        amountPaise: 20_000,
      },
      {
        key: 'tables',
        group: 'equipment',
        label: 'Table',
        count: 0,
        unitRatePaise: 40_000,
        days: 1,
        amountPaise: 0,
      },
    ],
    netPaise: 9_420_000,
    gstPaise: 1_695_600,
    gstPercent: 18,
    feeTotalPaise: 11_115_600,
  },
  stallDepositPaise: 1_600_000, // ₹16,000
  equipmentDepositPaise: 400_000, // ₹4,000
  virtualAccountRent: 'STALLR9840012345',
  virtualAccountDeposit: 'STALLD9840012345',
  beneficiary: {
    accountName: 'ISHA FOUNDATION',
    address: 'Isha Yoga Center, Semmedu Post, Coimbatore 641114',
    accountType: 'Savings',
    bankName: 'HDFC Bank Ltd',
    ifsc: 'HDFC0004989',
    branch: 'Kanjurmarg Branch, Mumbai',
  },
};

const signedIn = (requests: unknown) =>
  installFetch([
    ['GET', /\/public\/session$/, () => SESSION],
    ['GET', /\/public\/requests$/, () => requests],
  ]);

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const noTab = (name: RegExp) => expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();

describe('MyRequests', () => {
  test('shows the newest request first, with the one sentence a new applicant comes back for', async () => {
    signedIn(TWO);
    render();

    expect(await screen.findByText(/Received. The stall team will review it./)).toBeInTheDocument();
    // The reference is in the band and again on its own pill in the switcher.
    expect(screen.getAllByText('VEN-2026-0002')).toHaveLength(2);
    // The other request is in the switcher, not on the page.
    expect(screen.queryByText('C1-4')).not.toBeInTheDocument();
  });

  test('two requests draw a switcher, with the one on screen pressed', async () => {
    signedIn(TWO);
    render();

    const group = await screen.findByRole('group', { name: 'Your Requests' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(within(group).getByRole('button', { name: /Second Stall/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a lone request has no switcher to choose from', async () => {
    signedIn(withPending([]));
    render();

    await screen.findByText('VEN-2026-0001');
    expect(screen.queryByRole('group', { name: 'Your Requests' })).not.toBeInTheDocument();
  });

  test('the switcher moves between requests and keeps the choice in the URL', async () => {
    signedIn(TWO);
    const { router } = render();

    await userEvent.click(await screen.findByRole('button', { name: /Green Leaf Organics/ }));

    expect(await screen.findByText('C1-4')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?ref=VEN-2026-0001');
  });

  test('?ref in the URL picks the request, so a refresh lands where it was', async () => {
    signedIn(TWO);
    render('/stalls/requests?ref=VEN-2026-0001');

    expect(await screen.findByText('C1-4')).toBeInTheDocument();
    expect(screen.queryByText(/Received. The stall team/)).not.toBeInTheDocument();
  });

  test('carries no token in the URL it asks on — the cookie is the credential', async () => {
    const fx = signedIn({ displayName: 'Priya Venkat', requests: [] });
    render();

    await screen.findByText(/have not requested a stall/i);
    expect(fx.calls.map((c) => `${c.method} ${c.url}`)).toContain(
      'GET /api/m/stalls/public/requests',
    );
  });

  test('sends somebody who is not logged in to the login page', async () => {
    installFetch([['GET', /\/public\/session$/, () => [404, { error: 'no session' }]]]);
    const { router } = render();

    await waitFor(() => expect(router.state.location.pathname).toBe('/stalls/login'));
  });

  test('offers an empty account the way to the forms', async () => {
    signedIn({ displayName: 'Priya Venkat', requests: [] });
    render();

    expect(await screen.findByText(/have not requested a stall/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Request a Stall/ })).toHaveAttribute(
      'href',
      '/stalls/apply',
    );
  });

  test('a tab exists for a step the API says is outstanding, and not otherwise', async () => {
    signedIn(
      withPending([
        { step: 'BANK_FORM', label: 'Bank details pending' },
        { step: 'PAYMENT', label: 'Payment pending' },
      ]),
    );
    render();

    await screen.findByRole('tab', { name: /Overview/ });
    tab(/Bank Details/);
    tab(/Payment/);
    noTab(/FSSAI/);
    // ⚠️ `staff` is null here, so no Staff tab either — the tab set is what the
    // API sent, nothing more.
    noTab(/Staff/);
  });

  test('the overview lists what is still to do, with a way in only where there is one', async () => {
    signedIn(
      withPending([
        { step: 'BANK_FORM', label: 'Bank details pending' },
        { step: 'PAYMENT', label: 'Payment pending' },
      ]),
    );
    render();

    expect(await screen.findByText('Bank details pending')).toBeInTheDocument();
    // Payment shows — the requester should know the team is waiting on it —
    // but its row leads to the figures, because Finance moves the step and
    // this page cannot.
    expect(screen.getByText('Payment pending')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open the Form/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /See Payment/ })).toBeInTheDocument();
  });

  test('"See Payment" on the overview opens the Payment tab', async () => {
    signedIn(withPending([{ step: 'PAYMENT', label: 'Payment pending' }], { payment: PAYMENT }));
    render();

    await userEvent.click(await screen.findByRole('button', { name: /See Payment/ }));

    expect(screen.getByRole('tab', { name: /Payment/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Total caution deposit')).toBeInTheDocument();
  });

  test('the Bank Details tab stays after the step is done, and reads the details back', async () => {
    // 🔴 The tab used to VANISH when the details went in, because "not
    // outstanding" covered both "you have sent it" and "we never asked you".
    // A vendor checking which account their deposit comes back to had the form
    // they no longer had, and nothing else.
    signedIn(
      withPending([], {
        bank: {
          submittedAt: '2026-09-10T10:00:00.000Z',
          accountHolder: 'Green Leaf Organics Pvt Ltd',
          bankName: 'HDFC Bank',
          branch: 'RS Puram',
          accountNumberMasked: '••••••••••6789',
          ifsc: 'HDFC0001234',
          panMasked: '••••••234F',
          invoiceName: 'Green Leaf Organics Pvt Ltd',
          gstNumber: '33AABCU9603R1ZM',
        },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Bank Details/ }));

    expect(screen.getByText('HDFC0001234')).toBeInTheDocument();
    // ⚠️ Masked, and shown masked. The last four is what a person checks their
    // own account against; this page is reached by a link that lives in an
    // inbox for a year.
    expect(screen.getByText('••••••••••6789')).toBeInTheDocument();
    // And no form to fill, because there is nothing outstanding.
    expect(screen.queryByRole('button', { name: /Open the Form/ })).not.toBeInTheDocument();
  });

  test('a reopened bank step offers the form rather than the old details', async () => {
    // ⚠️ Outstanding beats submitted. A vendor asked to redo this must be given
    // the form, not a read-back of what is being replaced.
    signedIn(
      withPending([{ step: 'BANK_FORM', label: 'Bank details pending' }], {
        bank: {
          submittedAt: '2026-09-10T10:00:00.000Z',
          accountHolder: 'Green Leaf Organics Pvt Ltd',
          bankName: 'HDFC Bank',
          branch: null,
          accountNumberMasked: '••••••••••6789',
          ifsc: 'HDFC0001234',
          panMasked: null,
          invoiceName: null,
          gstNumber: null,
        },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Bank Details/ }));

    expect(screen.getByRole('button', { name: /Open the Form/ })).toBeInTheDocument();
    expect(screen.queryByText('••••••••••6789')).not.toBeInTheDocument();
  });

  test('the FSSAI tab says received, and says verified once it has been', async () => {
    const fssai = {
      submittedAt: '2026-09-11T10:00:00.000Z',
      ownerName: 'Priya Venkat',
      mobile: '9840012345',
      files: [{ fileName: 'fssai-page-1.jpg', uploadedAt: '2026-09-11T10:00:00.000Z' }],
      verified: false,
    };
    signedIn(withPending([], { fssai }));
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /FSSAI/ }));

    expect(screen.getByText('fssai-page-1.jpg')).toBeInTheDocument();
    // "Received, not yet checked" is not a thing to chase, and saying so is the
    // difference between a vendor who waits and one who rings the office.
    expect(screen.getByText(/will check it before the event/)).toBeInTheDocument();
  });

  test('opens a step on the click, naming its own request', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([{ step: 'FSSAI', label: 'FSSAI certificate pending' }]),
      ],
      [
        'POST',
        /\/public\/requests\/continue$/,
        () => ({ url: 'http://web.test/stalls/fssai/tok' }),
      ],
    ]);
    render();

    await userEvent.click(await screen.findByRole('button', { name: /Open the Form/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://web.test/stalls/fssai/tok'));
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001', step: 'FSSAI' });
  });

  test("the step's own tab opens the form too", async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([{ step: 'BANK_FORM', label: 'Bank details pending' }]),
      ],
      ['POST', /\/public\/requests\/continue$/, () => ({ url: 'http://web.test/stalls/bank/tok' })],
    ]);
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Bank Details/ }));
    await userEvent.click(screen.getByRole('button', { name: /Open the Form/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://web.test/stalls/bank/tok'));
  });

  test('names the amount and the accounts on the Payment tab', async () => {
    // 🔴 The whole point: these figures used to exist only in a letter, and a
    // vendor who never got it had a chip saying "payment pending" and no way on
    // this earth to find out what to pay or where.
    signedIn(withPending([{ step: 'PAYMENT', label: 'Payment pending' }], { payment: PAYMENT }));
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    // 🔴 The fee is the RENT panel's total and the deposit is the other
    // panel's. There is deliberately no one figure summing the two: they go to
    // two accounts, and a vendor who transfers the sum into either has paid an
    // amount that reconciles against neither.
    expect(screen.getAllByText('₹1,18,000').length).toBeGreaterThan(0);
    expect(screen.getByText('₹20,000')).toBeInTheDocument();
    expect(screen.queryByText('₹1,38,000')).not.toBeInTheDocument();
    expect(screen.getByText('STALLR9840012345')).toBeInTheDocument();
    expect(screen.getByText('STALLD9840012345')).toBeInTheDocument();
  });

  test('shows the arithmetic behind the fee, the way the letter does', async () => {
    // 🔴 A vendor querying their bill asks about the MULTIPLICATION, not the
    // total. This page used to carry the total alone, so the one question it
    // was built to answer sent them back to the letter it replaced.
    signedIn(withPending([{ step: 'PAYMENT', label: 'Payment pending' }], { payment: PAYMENT }));
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    expect(screen.getByText('15 Amp : 4 × 1000')).toBeInTheDocument();
    expect(screen.getByText('Chair : 2 × 100')).toBeInTheDocument();
    expect(screen.getByText('GST 18%')).toBeInTheDocument();
    // ⚠️ Zero rows are dropped. A stall that took no tables must not read a
    // line billing it nothing — a reader deciding whether ₹0 is a bug rings up.
    expect(screen.queryByText(/^Table :/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^5 Amp :/)).not.toBeInTheDocument();
  });

  test('splits the deposit the way it is refunded, and names the bank', async () => {
    signedIn(withPending([{ step: 'PAYMENT', label: 'Payment pending' }], { payment: PAYMENT }));
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    // Two deposits, because a fine comes off one and unreturned furniture off
    // the other — a vendor reading one figure cannot tell which is at risk.
    expect(screen.getByText('Deposit — stall')).toBeInTheDocument();
    expect(screen.getByText('Deposit — chairs and tables')).toBeInTheDocument();
    // And who the transfer is actually made to. An account number without an
    // IFSC is an account nobody can send an NEFT to.
    expect(screen.getByText('HDFC0004989')).toBeInTheDocument();
    expect(screen.getByText('ISHA FOUNDATION')).toBeInTheDocument();
  });

  test('a concession suppresses the breakdown rather than showing what was quoted', async () => {
    // 🔴 The lines add up to the CARD rate; the fee beside them is what the
    // team agreed to take instead. Printing both shows a trader the figure they
    // were talked down from, and a breakdown that does not sum to the total
    // above it is worse than none. The API sends `breakdown: null`.
    signedIn(
      withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
        payment: { ...PAYMENT, breakdown: null, feePaise: 500_000 },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    expect(screen.queryByText('15 Amp : 4 × 1000')).not.toBeInTheDocument();
    expect(screen.getAllByText('₹5,000').length).toBeGreaterThan(0);
  });

  test('says where to ask rather than printing a blank account number', async () => {
    signedIn(
      withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
        payment: { ...PAYMENT, virtualAccountRent: null, virtualAccountDeposit: null },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    // A vendor transferring to a half-remembered account is the expensive
    // failure here, so a missing number is said out loud.
    expect(screen.getAllByText(/ask the stall team for the account/i)).toHaveLength(2);
  });

  test('a confirmed transfer keeps the Payment tab after the step has cleared', async () => {
    signedIn(
      withPending([], {
        payment: PAYMENT,
        paymentClaims: [
          {
            id: 'pc-1',
            purpose: 'RENT',
            amountPaise: 11_800_000,
            referenceNo: 'UTR123',
            paidOn: '2026-09-05',
            status: 'VERIFIED',
            rejectReason: null,
          },
        ],
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/UTR123/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Report Another Transfer/ })).toBeInTheDocument();
  });

  test('a rejected transfer shows its reason', async () => {
    // 🔴 That reason is the only thing telling the requester what to correct.
    signedIn(
      withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
        payment: PAYMENT,
        paymentClaims: [
          {
            id: 'pc-1',
            purpose: 'RENT',
            amountPaise: 11_800_000,
            referenceNo: 'UTR999',
            paidOn: '2026-09-05',
            status: 'REJECTED',
            rejectReason: 'No credit with this reference on the statement.',
          },
        ],
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.getByText(/No credit with this reference/)).toBeInTheDocument();
  });

  test('reporting a transfer opens a dialog, sends the claim, and re-reads', async () => {
    let reads = 0;
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => {
          reads += 1;
          return withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
            payment: PAYMENT,
          });
        },
      ],
      ['POST', /\/public\/requests\/payment-claim$/, () => ({ id: 'pc-1' })],
    ]);
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await userEvent.click(screen.getByRole('button', { name: /Report a Transfer/ }));

    const dialog = screen.getByRole('dialog', { name: 'Report a transfer' });
    await userEvent.type(within(dialog).getByLabelText(/UTR or reference number/), 'UTR123');
    await userEvent.type(within(dialog).getByLabelText(/Amount transferred/), '118000');
    await userEvent.type(within(dialog).getByLabelText(/Date of transfer/), '2026-09-05');
    await userEvent.click(within(dialog).getByRole('button', { name: /Report It/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = fx.calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({
      reference: 'VEN-2026-0001',
      purpose: 'RENT',
      referenceNo: 'UTR123',
      amountPaise: 11_800_000,
      paidOn: '2026-09-05',
    });
    await waitFor(() => expect(reads).toBe(2));
  });

  test('shows the coupon and the way to register on the Staff tab', async () => {
    signedIn(
      withPending([{ step: 'STAFF_REGISTRATION', label: 'Staff not registered' }], {
        staff: {
          coupons: [{ id: 'c-1', code: 'GLO-2026-K7Q4M2X9', capacity: 8, registered: 0 }],
          capacity: 8,
          registered: 0,
        },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Staff/ }));

    expect(screen.getByText('Staff not registered')).toBeInTheDocument();
    expect(screen.getByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    // ⚠️ Never "0 of 8": the cap is what the coupon admits, not what the stall
    // owes. Reading it as a quota is the misreading this wording exists to stop.
    expect(screen.getByText('up to 8 people')).toBeInTheDocument();
    expect(screen.queryByText('0 of 8')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Register Staff/ })).toHaveAttribute(
      'href',
      '/stalls/staff/GLO-2026-K7Q4M2X9',
    );
  });

  test('offers a coupon to a vendor who has none, without inventing a chore', async () => {
    signedIn(withPending([], { staff: { coupons: [], capacity: 0, registered: 0 } }));
    render();

    // ⚠️ `pendingSteps` said nothing is outstanding — it cannot, with no coupon
    // to register against — so the overview must not say otherwise.
    expect(await screen.findByText(/Nothing is outstanding/)).toBeInTheDocument();
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Staff/ }));
    expect(screen.getByRole('button', { name: /Get Your Coupon/ })).toBeInTheDocument();
  });

  test('asking for a coupon names its own request and reveals the code', async () => {
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([], { staff: { coupons: [], capacity: 0, registered: 0 } }),
      ],
      ['POST', /\/public\/requests\/coupon$/, () => ({ code: 'GLO-2026-K7Q4M2X9' })],
    ]);
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Staff/ }));
    await userEvent.click(screen.getByRole('button', { name: /Get Your Coupon/ }));

    expect(await screen.findByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001' });
    expect(screen.getByRole('link', { name: /Register Staff/ })).toHaveAttribute(
      'href',
      '/stalls/staff/GLO-2026-K7Q4M2X9',
    );
  });

  test('a stall holding two codes gets a way in for each of them', async () => {
    // 🔴 The vendor forwards one code to their kitchen team and the other to a
    // caterer. One button beside a list of codes would not say which is which.
    signedIn(
      withPending([{ step: 'STAFF_REGISTRATION', label: 'Staff not registered' }], {
        staff: {
          coupons: [
            { id: 'c-1', code: 'GLO-2026-K7Q4M2X9', capacity: 8, registered: 2 },
            { id: 'c-2', code: 'GLO-2026-B4K2M7PW', capacity: 4, registered: 0 },
          ],
          capacity: 12,
          registered: 2,
        },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Staff/ }));

    expect(screen.getByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(screen.getByText('GLO-2026-B4K2M7PW')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: /Register Staff/ });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/stalls/staff/GLO-2026-K7Q4M2X9',
      '/stalls/staff/GLO-2026-B4K2M7PW',
    ]);

    // Each code's own usage, and the stall's ceiling as the two added up.
    expect(screen.getByText('2 registered, up to 8')).toBeInTheDocument();
    expect(screen.getByText('0 registered, up to 4')).toBeInTheDocument();
    expect(screen.getByText('up to 12 people')).toBeInTheDocument();
  });

  test('reads back what the requester submitted, on its own tab', async () => {
    // 🔴 What they filled in, read back to them — the question the portal could
    // not answer at all. Not the default tab: the page's job first is to say
    // what has been decided and what is outstanding.
    signedIn(withPending([]));
    render();

    await screen.findByRole('tab', { name: /Overview/ });
    expect(screen.queryByText('Location Requested')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /What You Submitted/ }));

    expect(screen.getByText('Location Requested')).toBeInTheDocument();
    expect(screen.getByText('Organic spices, cold-pressed oils, honey')).toBeInTheDocument();
    expect(screen.getByText('15 A Plug Points')).toBeInTheDocument();
    expect(screen.getByText('Electrical')).toBeInTheDocument();
  });

  test('draws no such tab for a payload that carries no answers', async () => {
    // The API and the web deploy separately: a page served ahead of the API
    // that fills this block must still show the status a requester came for.
    signedIn(withPending([], { submitted: undefined }));
    render();

    await screen.findByText('Green Leaf Organics');
    noTab(/What You Submitted/);
  });

  test('a request still under consideration is given no list of future chores', async () => {
    signedIn({
      displayName: 'Priya Venkat',
      requests: [
        {
          reference: 'VEN-2026-0002',
          requestType: 'VENDOR',
          stallName: 'Second Stall',
          status: 'SHORTLISTED',
          submittedAt: '2026-09-02T10:00:00.000Z',
          allocatedZone: null,
          allocatedStalls: [],
          pending: [],
        },
      ],
    });
    render();

    await screen.findByText('Second Stall');
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is outstanding/)).not.toBeInTheDocument();
  });
});

// ── Steps that open in an order ─────────────────────────────────────────────
//
// An edition may number its steps, and a step the ordering has not reached is
// outstanding but not yet the requester's to act on. It gets no tab — a door
// that is not yet a door — and sits on the Overview saying what opens it.

describe('a step the edition has not opened yet', () => {
  const sequenced = () =>
    withPending([
      { step: 'BANK_FORM', label: 'Bank details pending', open: true, blockedBy: [] },
      { step: 'PAYMENT', label: 'Payment pending', open: false, blockedBy: ['BANK_FORM'] },
      {
        step: 'FSSAI',
        label: 'FSSAI certificate pending',
        open: false,
        blockedBy: ['BANK_FORM'],
      },
    ]);

  test('draws a tab for the open step and none for the locked ones', async () => {
    signedIn(sequenced());
    render();

    expect(await screen.findByRole('tab', { name: /bank details/i })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /fssai/i })).toBeNull();
    // ⚠️ Payment's tab is absent too. It appears on its own terms when the API
    // sends figures or a claim exists; a locked PAYMENT step alone does not
    // conjure one.
    expect(screen.queryByRole('tab', { name: /^payment$/i })).toBeNull();
  });

  test('lists the locked steps on the Overview, saying what opens them', async () => {
    signedIn(sequenced());
    render();

    // 🔴 Still visible. The requester reads the whole road — hiding the step
    // entirely is how somebody writes in asking why a form vanished.
    expect(await screen.findByText('Payment pending')).toBeTruthy();
    expect(screen.getByText('FSSAI certificate pending')).toBeTruthy();
    expect(screen.getAllByText(/opens once your bank details is done/i).length).toBe(2);
  });

  test('offers no way in for a locked step', async () => {
    signedIn(sequenced());
    render();

    await screen.findByText('Payment pending');
    // The open step keeps its button; the locked ones have none — and nothing
    // switches to a Payment tab that does not exist.
    expect(screen.getAllByRole('button', { name: /open the form/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /see payment/i })).toBeNull();
  });

  test('draws no Staff tab while the staff step is shut', async () => {
    // 🔴 The one step `pending` cannot speak for. STAFF_REGISTRATION is silent
    // there until a coupon has been issued, so this tab drew itself off `staff`
    // alone — and its Get Your Coupon button pressed straight into the refusal
    // the coupon route hands back for a locked step. The staff block carries
    // the answer now, and the tab reads it like every other one.
    signedIn(
      withPending(
        [{ step: 'BANK_FORM', label: 'Bank details pending', open: true, blockedBy: [] }],
        {
          staff: {
            coupons: [],
            capacity: 0,
            registered: 0,
            open: false,
            blockedBy: ['BANK_FORM'],
          },
        },
      ),
    );
    render();

    await screen.findByRole('tab', { name: /bank details/i });
    noTab(/staff/i);
  });

  test('the Staff tab is back, coupon offer and all, once the step is open', async () => {
    signedIn(
      withPending([], {
        staff: { coupons: [], capacity: 0, registered: 0, open: true, blockedBy: [] },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /staff/i }));
    expect(screen.getByRole('button', { name: /Get Your Coupon/ })).toBeInTheDocument();
  });

  test('all-at-once is unchanged — every step keeps its tab and its button', async () => {
    signedIn(
      withPending([
        { step: 'BANK_FORM', label: 'Bank details pending', open: true, blockedBy: [] },
        { step: 'FSSAI', label: 'FSSAI certificate pending', open: true, blockedBy: [] },
      ]),
    );
    render();

    expect(await screen.findByRole('tab', { name: /bank details/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /fssai/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /open the form/i })).toHaveLength(2);
  });
});
