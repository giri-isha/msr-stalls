import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { BankForm } from './BankForm';
import { FssaiForm } from './FssaiForm';
import { StaffRegistration } from './StaffRegistration';

/** The three pages a vendor reaches with nothing but a link or a coupon. What
 *  matters on each is the same thing: the credential in the URL is the only
 *  thing that says who this is, and a bad one must read as "not valid" rather
 *  than as an error to debug. */

const TOKEN = 'a'.repeat(32);

beforeEach(() => {
  vi.unstubAllGlobals();
  // jsdom has no upload target; the presigned PUT is the one call that leaves
  // the API, so it is stubbed at the network edge like everything else.
});

const BANK_VIEW = {
  reference: 'VEN-2026-0001',
  stallName: 'Green Leaf Organics',
  requesterName: 'Priya Venkat',
  email: 'priya@greenleaf.example',
  stallNumbers: ['C1-4'],
  zoneCode: 'C1',
  editionName: 'MSR 2026',
  current: {
    plugs5a: 4,
    plugs15a: 5,
    gasStoves: 1,
    tablesNeeded: 2,
    chairsNeeded: 6,
    passes2w: 1,
    passes4w: 1,
    passesStaff: 3,
    appliances: [{ name: 'Deep fryer', watts: 2500 }],
  },
  submittedAt: null as string | null,
};

describe('the bank details form', () => {
  const render = () =>
    renderAt(`/stalls/bank/${TOKEN}`, [{ path: '/stalls/bank/:token', element: <BankForm /> }]);

  test('prefills the requirements the vendor gave when they applied', async () => {
    installFetch([['GET', /\/public\/bank\//, () => BANK_VIEW]]);
    render();

    expect(await screen.findByText(/VEN-2026-0001/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Chairs needed/)).toHaveValue(6);
    expect(screen.getByLabelText(/Staff passes/)).toHaveValue(3);
    expect(screen.getByDisplayValue('Deep fryer')).toBeInTheDocument();
  });

  test('carries the Tamil from the 2025 sheet beside the English', async () => {
    installFetch([['GET', /\/public\/bank\//, () => BANK_VIEW]]);
    render();

    expect(await screen.findByText('வங்கி பெயர்')).toBeInTheDocument();
    expect(screen.getByText('கைபேசி எண்')).toBeInTheDocument();
  });

  test('will not submit until both documents and both agreements are in', async () => {
    installFetch([['GET', /\/public\/bank\//, () => BANK_VIEW]]);
    render();
    const user = userEvent.setup();

    const submit = await screen.findByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText(/I agree — Isha Foundation/));
    await user.click(screen.getByLabelText(/deposit will be returned/));
    // Still missing the cheque and the PAN.
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  test('an already-submitted form reads back rather than offering a second go', async () => {
    installFetch([
      ['GET', /\/public\/bank\//, () => ({ ...BANK_VIEW, submittedAt: '2026-01-10T10:00:00.000Z' })],
    ]);
    render();

    expect(await screen.findByText(/we have your details/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  test('a dead link says so in the vendor’s own terms', async () => {
    installFetch([['GET', /\/public\/bank\//, () => [404, { error: 'this link is not valid' }]]]);
    render();

    expect(await screen.findByText(/This link is not valid/)).toBeInTheDocument();
  });
});

describe('the FSSAI upload', () => {
  const render = () =>
    renderAt(`/stalls/fssai/${TOKEN}`, [{ path: '/stalls/fssai/:token', element: <FssaiForm /> }]);

  test('will not submit with no file attached', async () => {
    installFetch([
      [
        'GET',
        /\/public\/fssai\//,
        () => ({
          reference: 'VEN-2026-0001',
          stallName: 'Green Leaf Organics',
          requesterName: 'Priya Venkat',
          uploadedAt: null,
          verifiedAt: null,
          files: [],
        }),
      ],
    ]);
    render();

    expect(await screen.findByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  test('says that a re-upload replaces what is already there', async () => {
    installFetch([
      [
        'GET',
        /\/public\/fssai\//,
        () => ({
          reference: 'VEN-2026-0001',
          stallName: 'Green Leaf Organics',
          requesterName: 'Priya Venkat',
          uploadedAt: '2026-01-20T10:00:00.000Z',
          verifiedAt: '2026-01-21T10:00:00.000Z',
          files: [{ name: 'cert.pdf', uploadedAt: '2026-01-20T10:00:00.000Z' }],
        }),
      ],
    ]);
    render();

    expect(await screen.findByText(/Uploading again replaces them/)).toBeInTheDocument();
    expect(screen.getByText(/it has been verified/)).toBeInTheDocument();
  });
});

describe('staff registration', () => {
  const COUPON = {
    stallName: 'Green Leaf Organics',
    reference: 'VEN-2026-0001',
    stallNumbers: ['C1-4'],
    registered: 1,
    maxStaff: 3,
    staff: [{ name: 'Ravi Kumar', mobile: '98••••555', registeredAt: '2026-02-01T10:00:00.000Z' }],
  };

  const renderWithCode = (code: string) =>
    renderAt(`/stalls/staff/${code}`, [
      { path: '/stalls/staff/:code', element: <StaffRegistration /> },
    ]);

  test('a coupon in the link opens the stall straight away', async () => {
    installFetch([['GET', /\/public\/staff-registration\//, () => COUPON]]);
    renderWithCode('GRE-2026-K7Q4M2X9');

    expect(await screen.findByText('Green Leaf Organics')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 registered')).toBeInTheDocument();
  });

  test('the roster it shows back is masked', async () => {
    installFetch([['GET', /\/public\/staff-registration\//, () => COUPON]]);
    renderWithCode('GRE-2026-K7Q4M2X9');

    expect(await screen.findByText('98••••555')).toBeInTheDocument();
    expect(screen.queryByText('9840055555')).not.toBeInTheDocument();
  });

  test('registers a person and clears the form for the next one', async () => {
    const fetch = installFetch([
      ['GET', /\/public\/staff-registration\//, () => COUPON],
      ['POST', /\/public\/staff-registration$/, () => [201, { ...COUPON, registered: 2 }]],
    ]);
    renderWithCode('GRE-2026-K7Q4M2X9');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Full name/), 'Meena S');
    await user.type(screen.getByLabelText(/Mobile number/), '9840066666');
    await user.type(screen.getByLabelText(/ID number/), '123456789012');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toMatchObject({
        couponCode: 'GRE-2026-K7Q4M2X9',
        name: 'Meena S',
        mobile: '9840066666',
        idType: 'AADHAAR',
      });
    });
    expect(await screen.findByText('2 of 3 registered')).toBeInTheDocument();
    expect(screen.getByLabelText(/Full name/)).toHaveValue('');
  });

  test('says only the last four Aadhaar digits are kept', async () => {
    installFetch([['GET', /\/public\/staff-registration\//, () => COUPON]]);
    renderWithCode('GRE-2026-K7Q4M2X9');

    expect(await screen.findByText('Only the last four digits are stored.')).toBeInTheDocument();
  });

  test('a full coupon refuses rather than silently admitting one more', async () => {
    installFetch([
      [
        'GET',
        /\/public\/staff-registration\//,
        () => ({ ...COUPON, registered: 3, maxStaff: 3 }),
      ],
    ]);
    renderWithCode('GRE-2026-K7Q4M2X9');

    expect(await screen.findByText(/have been used/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
  });

  test('a bad coupon gives one message that reveals nothing', async () => {
    installFetch([
      ['GET', /\/public\/staff-registration\//, () => [404, { error: 'this coupon is not valid' }]],
    ]);
    renderAt('/stalls/staff', [{ path: '/stalls/staff', element: <StaffRegistration /> }]);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Stall coupon'), 'GRE-2026-ZZZZZZZZ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/That coupon is not valid/)).toBeInTheDocument();
  });
});
