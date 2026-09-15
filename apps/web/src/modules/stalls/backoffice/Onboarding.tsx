import type { OnboardingRow } from '@msr/stalls';
import { formatInr } from '@msr/stalls';
import { useMemo, useState } from 'react';
import {
  getOnboarding,
  issueCoupon,
  removeVendorStaff,
  setCouponCapacity,
  verifyFssai,
} from '../api';
import { ONBOARDING_STEPS } from '@msr/stalls';
import { TYPE_LABEL, TypeBadge } from '../components/StatusPill';
import { formatDate, formatDateTime, useLoad } from '../hooks';
import { listOnboarding } from '../api';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Dialog,
  DialogButtons,
  EditBtn,
  Empty,
  ErrorBox,
  Facts,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  Search,
  Section,
  Select,
  Toolbar,
  ColumnsButton,
  useColumns,
  type ColumnDef,
  Tag,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  type Tone,
  useIsMobile,
  useToast,
} from '../ui';

/**
 * Who is holding the team up, and what is outstanding for each of them.
 *
 * The four status columns read `RECEIVED / PENDING / NOT_APPLICABLE`, and the
 * third value is the one that matters: a local welfare stall is not *pending* a
 * bank form, it is never asked for one. Collapsing "not applicable" into
 * "pending" is what turns this table into a list of things that will never be
 * ticked off.
 */
/** ⚠️ The four step columns are what this screen IS — the question it answers
 *  is "who is holding us up" — so none of them is optional. `requestType` and
 *  `reference` are the two facts the table never showed and readers kept going
 *  to the pipeline for, and they ship hidden rather than making a seven-column
 *  table a nine-column one for everybody. */
const COLUMNS: ColumnDef[] = [
  { key: 'vendor', label: 'Vendor', locked: true },
  { key: 'reference', label: 'Reference', optional: true },
  { key: 'stall', label: 'Stall' },
  { key: 'requestType', label: 'Type', optional: true },
  { key: 'bank', label: 'Bank' },
  { key: 'gst', label: 'GST' },
  { key: 'payment', label: 'Payment' },
  { key: 'fssai', label: 'FSSAI' },
  { key: 'staff', label: 'Backoffice' },
];

/** What is still outstanding, as a filter.
 *
 *  ⚠️ Built from `ONBOARDING_STEPS`, not retyped. The step keys are the shared
 *  vocabulary `pendingSteps` emits — four of them, and GST is NOT one: it
 *  arrives with the bank form and has a column but never its own step. A
 *  hand-written list here would offer "waiting on GST", match nothing ever, and
 *  read as an empty queue rather than as a filter that cannot work. */
const STEP_FILTER_LABEL: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  BANK_FORM: 'bank details',
  PAYMENT: 'payment',
  FSSAI: 'FSSAI',
  STAFF_REGISTRATION: 'staff registration',
};

export function Onboarding() {
  const { data, error, loading, reload } = useLoad(listOnboarding);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [outstanding, setOutstanding] = useState('');
  const [requestType, setRequestType] = useState('');
  const mobile = useIsMobile();
  const columns = useColumns('onboarding', COLUMNS);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (
        term &&
        !r.stallName.toLowerCase().includes(term) &&
        !r.requesterName.toLowerCase().includes(term) &&
        !r.reference.toLowerCase().includes(term) &&
        !r.stallNumbers.some((n) => n.toLowerCase().includes(term))
      ) {
        return false;
      }
      if (requestType && r.requestType !== requestType) return false;
      // ⚠️ Read off `pending`, which the API already computes, rather than
      // re-deriving "is this step outstanding" from the four status fields.
      // The rule for what counts as pending — NOT_APPLICABLE is not pending,
      // UPLOADED-but-unverified is — lives there and must not be guessed at
      // twice.
      if (outstanding && !r.pending.some((step) => step.step === outstanding)) return false;
      return true;
    });
  }, [data, q, outstanding, requestType]);

  return (
    <div>
      <H1
        icon={<Icon name='clipboard-list' size={18} />}
        sub='Bank details, payment, FSSAI and staff registration for every selected stall.'
      >
        Vendor Onboarding
      </H1>

      <Toolbar>
        <Search value={q} onChange={setQ} placeholder='Search stall, vendor or stall number…' />
        <Select
          aria-label='Outstanding'
          value={outstanding}
          onChange={(e) => setOutstanding(e.target.value)}
          style={{ width: 'auto', minWidth: 170 }}
        >
          <option value=''>Anything outstanding</option>
          {ONBOARDING_STEPS.map((step) => (
            <option key={step} value={step}>
              Waiting on {STEP_FILTER_LABEL[step]}
            </option>
          ))}
        </Select>
        <Select
          aria-label='Type'
          value={requestType}
          onChange={(e) => setRequestType(e.target.value)}
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value=''>All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <div style={{ flex: 1 }} />
        {/* Cards on a phone read a fixed set of fields, so the picker is drawn
            only where it changes something. */}
        {!mobile && <ColumnsButton state={columns} />}
      </Toolbar>

      {error && <ErrorBox>{error.message}</ErrorBox>}
      {loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No selected stalls to onboard yet.</Empty>
      ) : mobile ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <Card
              key={r.requestId}
              pad={14}
              onAct={() => setOpen(r.requestId)}
              label={`${r.stallName}, onboarding`}
              style={{ display: 'grid', gap: 8 }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.stallName}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                    {r.stallNumbers.join(', ') || '—'}
                  </div>
                </div>
                <TypeBadge type={r.requestType} />
              </div>
              <PendingChips row={r} />
            </Card>
          ))}
        </div>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                {columns.shown('reference') && <TH>Reference</TH>}
                {columns.shown('stall') && <TH>Stall</TH>}
                {columns.shown('requestType') && <TH>Type</TH>}
                {columns.shown('bank') && <TH>Bank</TH>}
                {columns.shown('gst') && <TH>GST</TH>}
                {columns.shown('payment') && <TH>Payment</TH>}
                {columns.shown('fssai') && <TH>FSSAI</TH>}
                {columns.shown('staff') && <TH align='right'>Backoffice</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.requestId} onClick={() => setOpen(r.requestId)}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.stallName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.requesterName}</div>
                  </TD>
                  {columns.shown('reference') && (
                    <TD mono style={{ fontSize: 11.5 }}>
                      {r.reference}
                    </TD>
                  )}
                  {columns.shown('stall') && (
                    <TD mono style={{ fontSize: 11.5 }}>
                      {r.stallNumbers.join(', ') || '—'}
                    </TD>
                  )}
                  {columns.shown('requestType') && (
                    <TD>
                      <TypeBadge type={r.requestType} />
                    </TD>
                  )}
                  {columns.shown('bank') && (
                    <TD>
                      <StatusTag value={r.bankDetails} />
                    </TD>
                  )}
                  {columns.shown('gst') && (
                    <TD>
                      <StatusTag value={r.gst} />
                    </TD>
                  )}
                  {columns.shown('payment') && (
                    <TD>
                      <StatusTag value={r.payment} />
                    </TD>
                  )}
                  {columns.shown('fssai') && (
                    <TD>
                      <StatusTag value={r.fssai} />
                    </TD>
                  )}
                  {columns.shown('staff') && (
                    <TD align='right'>
                      <StaffCount row={r} />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {open && (
        <OnboardingDetailDialog id={open} onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </div>
  );
}

const TONE_FOR: Record<string, Tone> = {
  RECEIVED: 'ok',
  CONFIRMED: 'ok',
  VERIFIED: 'ok',
  UPLOADED: 'info',
  PENDING: 'warn',
  NOT_APPLICABLE: 'neutral',
};

const LABEL_FOR: Record<string, string> = {
  RECEIVED: 'Received',
  CONFIRMED: 'Confirmed',
  VERIFIED: 'Verified',
  UPLOADED: 'Uploaded',
  PENDING: 'Pending',
  // Not "—": a dash reads as missing data. This says the question was never
  // asked of this vendor.
  NOT_APPLICABLE: 'N/A',
};

function StatusTag({ value }: { value: string }) {
  return (
    <Tag tone={TONE_FOR[value] ?? 'neutral'} size='sm'>
      {LABEL_FOR[value] ?? value}
    </Tag>
  );
}

function StaffCount({ row }: { row: OnboardingRow }) {
  if (row.staffExpected === 0) return <span style={{ color: 'var(--mfg)' }}>—</span>;
  const done = row.staffRegistered >= row.staffExpected;
  return (
    <Tag tone={done ? 'ok' : 'warn'} size='sm'>
      {row.staffRegistered} of {row.staffExpected}
    </Tag>
  );
}

function PendingChips({ row }: { row: OnboardingRow }) {
  if (row.pending.length === 0) {
    return (
      <Tag tone='ok' size='sm'>
        All clear
      </Tag>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {row.pending.map((p) => (
        <Tag key={p.step} tone='warn' size='sm'>
          {p.label}
        </Tag>
      ))}
    </div>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────

function OnboardingDetailDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(() => getOnboarding(id), [id]);

  const refresh = () => {
    reload();
    onChanged();
  };

  return (
    <Dialog title={data?.stallName ?? 'Onboarding'} onClose={onClose} width={680}>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox>{error.message}</ErrorBox>
      ) : !data ? null : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <TypeBadge type={data.requestType} />
            <Tag size='sm'>{data.reference}</Tag>
            {data.stallNumbers.length > 0 && (
              <Tag tone='ok' size='sm'>
                <Icon name='map-pin' size={11} /> {data.stallNumbers.join(', ')}
              </Tag>
            )}
          </div>

          <PendingChips row={data} />

          {data.quote && !data.quote.exempt && !data.quote.unpriced && (
            <Section title='Amount'>
              <Facts
                items={[
                  ['Fee, incl. GST', formatInr(data.quote.feeTotalPaise)],
                  ['Refundable deposit', formatInr(data.quote.depositTotalPaise)],
                  ['Total', formatInr(data.quote.grandTotalPaise)],
                ]}
              />
            </Section>
          )}

          <Section title='Bank details'>
            {data.bank ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <Facts
                  items={[
                    ['Invoice name', data.bank.invoiceName],
                    ['Account holder', data.bank.accountHolder],
                    ['Bank', `${data.bank.bankName} — ${data.bank.branch}`],
                    ['Account number', data.bank.accountNumber],
                    ['IFSC', data.bank.ifsc],
                    ['MICR', data.bank.micr ?? '—'],
                    ['PAN', data.bank.panNumber],
                    ['GST', data.bank.gstNumber],
                    ['Submitted', formatDateTime(data.bank.submittedAt)],
                  ]}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {data.bank.files.map((f) =>
                    // The URL is presigned and short-lived, so it is rendered as
                    // a link and never stored anywhere.
                    f.url ? (
                      <a
                        key={f.label}
                        href={f.url}
                        target='_blank'
                        rel='noreferrer'
                        style={{ textDecoration: 'none' }}
                      >
                        <Tag tone='info' size='sm'>
                          <Icon name='eye' size={11} /> {f.label}
                        </Tag>
                      </a>
                    ) : (
                      <Tag key={f.label} size='sm'>
                        {f.label} (unavailable)
                      </Tag>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <Empty>
                {data.bankDetails === 'NOT_APPLICABLE'
                  ? 'This requester type is not asked for bank details.'
                  : 'Not submitted yet.'}
              </Empty>
            )}
          </Section>

          <Section title='FSSAI certificate'>
            {data.fssaiFiles.length > 0 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {data.fssaiFiles.map((f) =>
                    f.url ? (
                      <a
                        key={f.name}
                        href={f.url}
                        target='_blank'
                        rel='noreferrer'
                        style={{ textDecoration: 'none' }}
                      >
                        <Tag tone='info' size='sm'>
                          <Icon name='file-text' size={11} /> {f.name}
                        </Tag>
                      </a>
                    ) : (
                      <Tag key={f.name} size='sm'>
                        {f.name}
                      </Tag>
                    ),
                  )}
                </div>
                {can('onboarding.write') && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn
                      kind={data.fssai === 'VERIFIED' ? 'ghost' : 'primary'}
                      onClick={async () => {
                        try {
                          await verifyFssai(id, data.fssai !== 'VERIFIED');
                          toast.ok(
                            data.fssai === 'VERIFIED'
                              ? 'Verification removed.'
                              : 'FSSAI marked verified.',
                          );
                          refresh();
                        } catch (e) {
                          toast.fail(e);
                        }
                      }}
                    >
                      <Icon name={data.fssai === 'VERIFIED' ? 'x' : 'check'} size={14} />
                      {data.fssai === 'VERIFIED' ? 'Remove verification' : 'Mark verified'}
                    </Btn>
                  </div>
                )}
              </div>
            ) : (
              <Empty>
                {data.fssai === 'NOT_APPLICABLE'
                  ? 'A non-food stall does not need an FSSAI certificate.'
                  : 'Not uploaded yet.'}
              </Empty>
            )}
          </Section>

          <Section title='Staff registration' count={data.staff.length}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  fontSize: 12.5,
                  color: 'var(--mfg)',
                }}
              >
                {data.couponCode ? (
                  <span>
                    Coupon{' '}
                    <strong style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>
                      {data.couponCode}
                    </strong>{' '}
                    — registrations made with it are recorded against this stall.
                  </span>
                ) : (
                  <span>
                    No coupon issued yet. One is created automatically when the FSSAI and staff
                    letter goes out.
                  </span>
                )}
                {can('onboarding.write') && !data.couponCode && (
                  <Btn
                    onClick={async () => {
                      try {
                        const { code } = await issueCoupon(id);
                        toast.ok(`Coupon ${code} issued.`);
                        refresh();
                      } catch (e) {
                        toast.fail(e);
                      }
                    }}
                  >
                    <Icon name='key' size={13} />
                    Issue coupon
                  </Btn>
                )}
                {data.couponCode && (
                  <CouponCapacity
                    requestId={id}
                    capacity={data.couponCapacity ?? 0}
                    registered={data.staffRegistered}
                    writable={can('onboarding.write')}
                    onSaved={refresh}
                  />
                )}
              </div>
              {data.staff.length === 0 ? (
                <Empty>Nobody registered yet.</Empty>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Mobile</TH>
                      <TH>ID</TH>
                      <TH>Registered</TH>
                      <TH> </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.staff.map((s) => (
                      <TR key={s.id}>
                        <TD>{s.name}</TD>
                        <TD mono style={{ fontSize: 12 }}>
                          {s.mobile}
                        </TD>
                        <TD muted style={{ fontSize: 11.5 }}>
                          {s.idType.replace('_', ' ').toLowerCase()} ···{s.idNumber}
                        </TD>
                        <TD muted style={{ fontSize: 11.5 }}>
                          {formatDate(s.registeredAt)}
                        </TD>
                        <TD align='right'>
                          {can('onboarding.write') && (
                            <Btn
                              kind='danger'
                              onClick={async () => {
                                try {
                                  await removeVendorStaff(s.id);
                                  toast.ok(`${s.name} removed.`);
                                  refresh();
                                } catch (e) {
                                  toast.fail(e);
                                }
                              }}
                            >
                              <Icon name='trash' size={14} />
                              Remove
                            </Btn>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </Section>
        </div>
      )}
    </Dialog>
  );
}

/**
 * What one coupon may register.
 *
 * 🔴 Eight by default — "as a default we raise the coupon code with eight staff
 * members for each stall" — and moved case by case from here: "if they want
 * more staff members, in the back end we raise that capacity to 10, 12". The
 * change lands on the coupon the vendor already holds, so nobody has to be
 * sent a new code.
 *
 * ⚠️ It is the COUPON's number, never the vendor's own "staff passes" answer.
 * That answer was a request made on a form months earlier; this is what the
 * stall team has agreed to let through the gate, and the gate is what the
 * counter enforces. Reading the vendor's figure also meant zero for every local
 * welfare stall, whose form never asks — and a cap of zero read as "no limit"
 * is how a stall with eight passes registered eighty.
 */
/**
 * How many people the stall's coupon admits: read here, changed in a box.
 *
 * 🔴 Was a number field and a Save sitting in the middle of a panel. The figure
 * is a CAP that the registration form enforces — lower it below the people
 * already registered and the stall is over its own limit with no reading of the
 * number that makes sense any more — and a bare input invites that as a typo
 * rather than as a decision. `EditBtn` is the same pencil every other record in
 * the module is changed through.
 */
function CouponCapacity({
  requestId,
  capacity,
  registered,
  writable,
  onSaved,
}: {
  requestId: string;
  capacity: number;
  registered: number;
  writable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span>
        Admits <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{capacity}</strong>
        {capacity === 1 ? ' person' : ' people'}
      </span>
      <EditBtn what='coupon capacity' writable={writable} onClick={() => setEditing(true)} />
      {editing && (
        <CouponCapacityDialog
          requestId={requestId}
          capacity={capacity}
          registered={registered}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </span>
  );
}

function CouponCapacityDialog({
  requestId,
  capacity,
  registered,
  onClose,
  onSaved,
}: {
  requestId: string;
  capacity: number;
  registered: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState(String(capacity));
  const [saving, setSaving] = useState(false);

  const next = Math.floor(Number(value));
  // ⚠️ Lowering below what is already registered would leave the stall over its
  // own cap with no way to read the number as a limit again. Refused here, in
  // front of the person, rather than by the API after the box has closed.
  const tooLow = next < registered;
  const valid = next >= 1 && !tooLow;

  const save = async () => {
    setSaving(true);
    try {
      await setCouponCapacity(requestId, next);
      toast.ok(`Coupon now admits ${next}.`);
      onSaved();
    } catch (e) {
      toast.fail(e);
      setSaving(false);
    }
  };

  return (
    <Dialog
      title='Coupon capacity'
      note={`How many of the stall's own team the coupon will register. ${registered} ${registered === 1 ? 'person has' : 'people have'} registered so far.`}
      onClose={onClose}
      width={420}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={save}
          disabled={saving || !valid || next === capacity}
        />
      }
    >
      <FormField id='coupon-capacity' label='Admits (people)'>
        <Input
          id='coupon-capacity'
          type='number'
          min={1}
          max={200}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {tooLow && (
          <div style={{ fontSize: 12, color: 'var(--warn-fg)', marginTop: 6 }}>
            {registered} already registered — the cap cannot go below that.
          </div>
        )}
      </FormField>
    </Dialog>
  );
}
