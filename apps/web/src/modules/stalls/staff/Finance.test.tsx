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
    // Two deposits, because each deduction is charged to its own: fines off the
    // stall deposit, furniture losses off the chairs-and-tables one.
    depositHeldPaise: 800_000,
    stallDepositPaise: 400_000,
    equipmentDepositPaise: 400_000,
    suggestedEquipmentDeductionPaise: 195_000,
    equipmentDeductionPaise: 195_000,
    fineDeductionPaise: 0,
    fines: [] as Array<{ reason: string; amountPaise: number }>,
    stallRefundPaise: 400_000,
    equipmentRefundPaise: 205_000,
    refundDuePaise: 605_000,
    stallShortfallPaise: 0,
    equipmentShortfallPaise: 0,
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

  test('the agreed fee is recorded beside the quote, never on top of it', async () => {
    // "For A3 the cost is 10,000 — for the coconut wala, probably we will give
    // that stall at 5,000." The card figure is what they were told; this is
    // what they owe, and Finance needs both when the season is reconciled.
    const fetch = stub([['PUT', /\/discretionary-fee$/, () => [204, null]]]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Payment confirmation' }));
    await user.click(await screen.findByRole('button', { name: 'Record credit' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Agree a different fee for this stall…' }),
    );
    await user.type(within(dialog).getByLabelText('Fee agreed (₹)'), '5000');
    await user.type(within(dialog).getByLabelText('Why'), 'Local welfare — agreed by the dept');
    await user.click(within(dialog).getByRole('button', { name: 'Save agreed fee' }));

    await waitFor(() => {
      const put = fetch.calls.find((c) => c.method === 'PUT');
      expect(put?.url).toContain('/discretionary-fee');
      expect(put?.body).toMatchObject({
        discretionaryFeePaise: 500_000,
        reason: 'Local welfare — agreed by the dept',
      });
    });
  });

  test('a figure with no reason is refused before it leaves the screen', async () => {
    const fetch = stub([['PUT', /\/discretionary-fee$/, () => [204, null]]]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Payment confirmation' }));
    await user.click(await screen.findByRole('button', { name: 'Record credit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Agree a different fee for this stall…' }),
    );
    await user.type(within(dialog).getByLabelText('Fee agreed (₹)'), '5000');
    await user.click(within(dialog).getByRole('button', { name: 'Save agreed fee' }));

    expect(await screen.findByText('Say why the amount was reduced.')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  test('a concession already agreed shows both figures and what is owed', async () => {
    payments = [
      paymentRow({
        quote: quote({
          discretionaryFeePaise: 500_000,
          discretionaryReason: 'Local welfare',
          payableFeePaise: 500_000,
          grandTotalPaise: 900_000,
        }),
      }),
    ];
    stub();
    render();

    await screen.findByText('Green Leaf Organics');
    expect(screen.getByText(/Agreed fee/)).toBeInTheDocument();
    expect(screen.getByText(/Local welfare/)).toBeInTheDocument();
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

  test('an over-run on one deposit leaves the other whole', async () => {
    // 🔴 ₹6,000 of furniture lost against a ₹4,000 furniture deposit. The stall
    // deposit is the vendor's money and comes back; the ₹2,000 is a debt to
    // recover, and the screen has to say so rather than quietly refunding less.
    refunds = [
      refundRow({
        equipmentDeductionPaise: 600_000,
        equipmentRefundPaise: 0,
        equipmentShortfallPaise: 200_000,
        stallRefundPaise: 400_000,
        refundDuePaise: 400_000,
        shortfallPaise: 200_000,
        submittedAt: '2026-03-01T10:00:00.000Z',
      }),
    ];
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Refunds & deductions' }));
    await user.click(await screen.findByRole('button', { name: 'Voucher' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('₹2,000 to recover')).toBeInTheDocument();
    // Both deposits are named, so the refund can be read line by line rather
    // than inferred from one pooled figure.
    expect(within(dialog).getByText('Stall deposit')).toBeInTheDocument();
    expect(within(dialog).getByText('Chairs and tables deposit')).toBeInTheDocument();
    // The chairs-and-tables deposit, the stall deposit and the refund due all
    // read ₹4,000: the furniture deposit was consumed entirely, and the stall
    // deposit came back whole, which is the whole point.
    expect(within(dialog).getAllByText('₹4,000')).toHaveLength(3);
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
  test('somebody without finance.read is told, not shown an empty table', async () => {
    installFetch([['GET', /\/me$/, () => ({ ...ME_ADMIN, privileges: ['requests.read'] })]]);
    render();
    expect(
      await screen.findByText(/do not have access to the finance screens/),
    ).toBeInTheDocument();
  });

  test('finance.read without finance.write can look but not record', async () => {
    installFetch([
      ['GET', /\/me$/, () => ({ ...ME_ADMIN, privileges: ['requests.read', 'finance.read'] })],
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
