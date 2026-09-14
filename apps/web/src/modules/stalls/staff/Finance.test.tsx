import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, paymentRow, quote, renderAt } from '../test-utils';
import { Finance } from './Finance';

const routes = [{ path: '/m/stalls/finance', element: <Finance /> }];
const render = () => renderAt('/m/stalls/finance', routes, { me: true });

const CONFIG = {
  edition: { id: 'e1', year: 2026, name: 'MSR 2026', isActive: true },
  zones: [],
  rateCard: [],
  charges: {},
  flow: { bankStepEnabled: true, paymentStepEnabled: true, fssaiStepEnabled: true },
  fineTypes: [
    { id: 'f1', reason: 'Unclean stall', defaultAmountPaise: 50_000, isActive: true },
    { id: 'f2', reason: 'Retired fine', defaultAmountPaise: 10_000, isActive: false },
  ],
  customFields: [],
};

function refundRow(over: Record<string, unknown> = {}) {
  return {
    requestId: paymentRow().requestId,
    reference: 'VEN-2026-0001',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    depositHeldPaise: 800_000,
    suggestedEquipmentDeductionPaise: 195_000,
    equipmentDeductionPaise: 195_000,
    fineDeductionPaise: 0,
    fines: [] as Array<{ reason: string; amountPaise: number }>,
    refundDuePaise: 605_000,
    shortfallPaise: 0,
    submittedAt: null,
    voucherRef: null,
    ...over,
  };
}

let payments: ReturnType<typeof paymentRow>[];
let refunds: ReturnType<typeof refundRow>[];

function stub(extra: Parameters<typeof installFetch>[0] = []) {
  return installFetch([
    ['GET', /\/me$/, () => ME_ADMIN],
    ['GET', /\/finance\/payments$/, () => payments],
    ['GET', /\/finance\/refunds$/, () => refunds],
    ['GET', /\/config$/, () => CONFIG],
    ...extra,
  ]);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  payments = [paymentRow()];
  refunds = [refundRow()];
});

describe('what is due', () => {
  test('itemises the fee the way the 2025 payment sheet does', async () => {
    stub();
    render();

    expect(await screen.findByText('₹15,000')).toBeInTheDocument(); // stall fee
    expect(screen.getByText('₹7,000')).toBeInTheDocument(); // plug points
    expect(screen.getByText('₹3,960')).toBeInTheDocument(); // GST
    expect(screen.getByText('₹29,960')).toBeInTheDocument(); // fee + deposit
    expect(screen.getByText(/incl\. ₹4,000 deposit/)).toBeInTheDocument();
  });

  test('a zone with no rate says so rather than showing zero', async () => {
    payments = [paymentRow({ quote: quote({ unpriced: true, feeTotalPaise: 0 }) })];
    stub();
    render();

    expect(await screen.findByText(/No rent is quoted for this zone/)).toBeInTheDocument();
  });

  test('sending the payment email posts the payment template', async () => {
    const fetch = stub([['POST', /\/comms\/send$/, () => ({ sent: ['x'], skipped: [] })]]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Green Leaf Organics');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toMatchObject({ templateKey: 'PAYMENT_DETAILS' });
    });
  });

  test('a vendor already sent the email gets no second Send button', async () => {
    payments = [paymentRow({ paymentEmailSentAt: '2026-01-20T10:00:00.000Z' })];
    stub();
    render();

    await screen.findByText('Green Leaf Organics');
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });
});

describe('confirming a credit', () => {
  test('records the reference, amount and date', async () => {
    const fetch = stub([['POST', /\/finance\/payments\//, () => [204, null]]]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Payment confirmation' }));
    await user.click(await screen.findByRole('button', { name: 'Record credit' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reference number'), 'NEFT12345');
    await user.click(within(dialog).getByRole('button', { name: 'Record credit' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toMatchObject({
        purpose: 'RENT',
        referenceNo: 'NEFT12345',
        amountPaise: 2_596_000,
      });
    });
  });

  test('the dialog will not submit without a reference number', async () => {
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Payment confirmation' }));
    await user.click(await screen.findByRole('button', { name: 'Record credit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Record credit' })).toBeDisabled();
  });

  test('shows what has already been received', async () => {
    payments = [
      paymentRow({
        receivedRentPaise: 2_596_000,
        receivedDepositPaise: 400_000,
        fullySettled: true,
        records: [
          {
            id: 'r1',
            purpose: 'RENT',
            referenceNo: 'NEFT12345',
            eCollectCode: null,
            amountPaise: 2_596_000,
            receivedOn: '2026-02-14',
            remitterName: 'GREEN LEAF',
            mode: 'NEFT',
            note: null,
            confirmedAt: '2026-02-15T10:00:00.000Z',
          },
        ],
      }),
    ];
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Payment confirmation' }));
    expect(await screen.findByText(/1 · settled/)).toBeInTheDocument();
  });
});

describe('refunds', () => {
  test('offers the deduction the chairs counter recorded, and previews the refund', async () => {
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Refunds & deductions' }));
    await user.click(await screen.findByRole('button', { name: 'Prepare' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Chairs and tables deduction/)).toHaveValue(1950);
    expect(within(dialog).getByText('₹6,050')).toBeInTheDocument();
  });

  test('ticking a fine moves the preview', async () => {
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Refunds & deductions' }));
    await user.click(await screen.findByRole('button', { name: 'Prepare' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText(/Unclean stall/));
    expect(within(dialog).getByText('₹5,550')).toBeInTheDocument();
  });

  test('a retired fine category is not offered', async () => {
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Refunds & deductions' }));
    await user.click(await screen.findByRole('button', { name: 'Prepare' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Retired fine/)).not.toBeInTheDocument();
  });

  test('sending to Finance posts what was actually entered', async () => {
    const fetch = stub([['POST', /\/finance\/refunds\//, () => refundRow({ submittedAt: 'now' })]]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Refunds & deductions' }));
    await user.click(await screen.findByRole('button', { name: 'Prepare' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText(/Unclean stall/));
    await user.click(within(dialog).getByRole('button', { name: 'Send to Finance' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toMatchObject({
        equipmentDeductionPaise: 195_000,
        fineTypeIds: ['f1'],
      });
    });
  });

  test('a submitted refund is frozen and only takes a voucher number', async () => {
    refunds = [
      refundRow({
        submittedAt: '2026-03-01T10:00:00.000Z',
        fineDeductionPaise: 50_000,
        fines: [{ reason: 'Unclean stall', amountPaise: 50_000 }],
        refundDuePaise: 555_000,
      }),
    ];
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Refunds & deductions' }));
    await user.click(await screen.findByRole('button', { name: 'Voucher' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/frozen/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Chairs and tables deduction/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Voucher number')).toBeInTheDocument();
  });

  test('a shortfall is shown rather than rounded into a zero refund', async () => {
    refunds = [
      refundRow({
        equipmentDeductionPaise: 1_000_000,
        refundDuePaise: 0,
        shortfallPaise: 200_000,
      }),
    ];
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Refunds & deductions' }));
    expect(await screen.findByText('₹2,000 still owed')).toBeInTheDocument();
  });
});

describe('access', () => {
  test('somebody without finance:read is told, not shown an empty table', async () => {
    installFetch([['GET', /\/me$/, () => ({ ...ME_ADMIN, actions: ['requests:read'] })]]);
    render();
    expect(
      await screen.findByText(/do not have access to the finance screens/),
    ).toBeInTheDocument();
  });

  test('finance:read without finance:write can look but not record', async () => {
    installFetch([
      ['GET', /\/me$/, () => ({ ...ME_ADMIN, actions: ['requests:read', 'finance:read'] })],
      ['GET', /\/finance\/payments$/, () => payments],
      ['GET', /\/finance\/refunds$/, () => refunds],
      ['GET', /\/config$/, () => CONFIG],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Payment confirmation' }));
    await user.click(await screen.findByRole('button', { name: 'View' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Reference number')).not.toBeInTheDocument();
  });
});
