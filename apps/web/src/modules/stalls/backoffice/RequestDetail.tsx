import type { OnboardingDetail, RequestAllocation, RequestDetail as Detail } from '@stalls/core';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api-client';
import * as api from '../api';
import { StagePill, StatusPill, TypeBadge, hasStage } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Dialog,
  Empty,
  ErrorBox,
  Facts,
  Icon,
  Loading,
  Section,
  Tag,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tabs,
  type TabDef,
  Textarea,
  toolBtnStyle,
  useEscape,
  useIsMobile,
  useToast,
  titleCase,
} from '../ui';
import { AmendDialog } from './AmendDialog';
import { MoveAllocationDialog } from './MoveAllocationDialog';
import { SelectDialog } from './SelectDialog';

const USAGE: Record<string, string> = {
  DEPT_DISPLAY: 'Used by Department for Display',
  DEPT_SALES: 'Used by Department for Sales',
  VENDOR_SALES: 'Giving to Vendor for sales',
  SPONSOR: 'Giving to Sponsor',
  OTHER: 'Other — see remarks',
};

/** Where the back link goes, and what it is called. The record hangs one
 *  segment under the list that opened it, so the list path is the pathname
 *  with the id taken off — no prop, and a pasted URL lands with a working back
 *  link rather than a dead one. */
const LIST_LABEL: Record<string, string> = {
  requests: 'All Requests',
};

type Fact = [string, React.ReactNode];

/**
 * Drops the facts there is nothing to say about.
 *
 * ⚠️ Zero counts go too — "Gas stoves 0" on a handicrafts stall is a row that
 * takes a reader's eye and gives it nothing, and there are a dozen of them on
 * the average non-food application. A count that matters is never zero.
 */
function facts(items: Array<Fact | null | undefined | false>): Fact[] {
  return items.filter(
    (f): f is Fact => !!f && f[1] !== null && f[1] !== undefined && f[1] !== '' && f[1] !== 0,
  );
}

/** The record's own page: the whole application, every form the requester has
 *  since filled, and every action the caller is allowed to take. Actions call
 *  the API and then reload; the API decides what is allowed, the buttons only
 *  reflect it.
 *
 *  🔴 A PAGE, reached at `…/all/:id`, where this was a 600px drawer over the
 *  list. The application is forty-odd fields and the drawer showed perhaps
 *  eight at a time, so reading one meant scrolling a column while the table it
 *  belonged to sat greyed out behind. The page also gives the record a URL,
 *  which is what a coordinator needs when they are asked about a stall on the
 *  phone and want to send someone the record rather than describe the clicks.
 *
 *  ⚠️ The list's filters ride along in the query string and the back link
 *  carries them home. Without that, opening a record from a filtered list and
 *  coming back landed on the unfiltered pipeline — the drawer never lost the
 *  list, so this is a cost of the page that has to be paid explicitly.
 */
export function RequestDetail() {
  const { id = '' } = useParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { can } = useMe();
  const toast = useToast();
  const mobile = useIsMobile();
  const { data: r, error, loading, reload } = useLoad(() => api.getRequest(id), [id]);
  // The forms the requester filled AFTER applying — bank, FSSAI, backoffice. A
  // second call rather than a fatter `/requests/:id`, because this is the
  // shape Onboarding already reads and a second copy of it on the request
  // would be two answers to "what has come back" waiting to disagree.
  const { data: forms } = useLoad(() => api.getOnboarding(id), [id]);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<'reject' | 'flag' | null>(null);
  const [reason, setReason] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [amending, setAmending] = useState(false);
  // ⚠️ Held here rather than in `Allocations` for the Escape gate below: this
  // page closes on Escape, and a dialog whose open state it cannot see would
  // be dismissed together with the record behind it.
  const [moving, setMoving] = useState<RequestAllocation | null>(null);
  const [tab, setTab] = useState('application');

  const listPath = pathname.slice(0, pathname.lastIndexOf('/'));
  const listTo = { pathname: listPath, search };
  const listLabel = LIST_LABEL[listPath.split('/').pop() ?? ''] ?? 'Requests';

  // ⚠️ Only while nothing is stacked on top. The reason prompt and the stall
  // picker are `Dialog`s with their own Escape handler; without this gate one
  // key press closes both, so dismissing a confirm also walks off the record
  // behind it.
  useEscape(() => navigate(listTo), reasonFor === null && !selecting && !amending && !moving);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.ok(label);
      reload();
    } catch (e) {
      toast.fail(e instanceof ApiError ? e : new Error('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const submitReason = async () => {
    if (!r || !reasonFor || !reason.trim()) return;
    const text = reason.trim();
    setReasonFor(null);
    setReason('');
    if (reasonFor === 'reject') await run('Rejected', () => api.reject(r.id, text));
    else await run('Flagged', () => api.flagRequest(r.id, text));
  };

  const canSelect = can('selection.write');
  const canWrite = can('requests.write');
  /** 🔴 The rail's stall button goes away once the request holds everything it
   *  was given. It stayed, reading "Add stall", onto a dialog that could only
   *  say "release one first" — an action offered and then refused, on the
   *  screen where the refusal is least obvious. Correcting a number that is
   *  already there is Edit, in the allocation row itself, where the stall being
   *  corrected is named. */
  const fullyAllocated = !!r && r.allocations.length >= r.numStallsRequested;

  /**
   * ⚠️ A tab is present when the form is part of THIS requester's flow, not
   * when it has come back. The API has already resolved both questions into
   * `NOT_APPLICABLE` versus `PENDING`, and the difference is the whole point:
   * an absent Bank tab says the ashram department was never asked, an empty
   * one says the vendor was asked and has not answered. Collapsing them would
   * make a chased vendor look identical to one nobody has to chase.
   */
  const tabs: TabDef[] = [{ key: 'application', label: 'Application', glyph: 'clipboard-list' }];
  if (forms && forms.bankDetails !== 'NOT_APPLICABLE')
    tabs.push({ key: 'bank', label: 'Bank Form', glyph: 'file-text' });
  if (forms && forms.fssai !== 'NOT_APPLICABLE')
    tabs.push({ key: 'fssai', label: 'FSSAI', glyph: 'shield' });
  if (forms && (forms.staffExpected > 0 || forms.staff.length > 0)) {
    tabs.push({ key: 'staff', label: 'Staff', glyph: 'users' });
  }
  if (tabs.length > 1) tabs.push({ key: 'all', label: 'All Details', glyph: 'list-view' });
  // A tab can vanish under the reader — the forms arrive a moment after the
  // application, and an amendment can take a stall out of the food category.
  const active = tabs.some((t) => t.key === tab) ? tab : 'application';

  return (
    <section aria-label='Request Detail'>
      {/* The way back, above the record rather than an × floating over its
          corner: on a page the reader's question is "where does this return me
          to", and the answer is a named link they can see before they commit
          to it. */}
      <Link
        to={listTo}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 12,
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--mfg)',
          textDecoration: 'none',
        }}
      >
        <Icon name='chevron-left' size={14} />
        {listLabel}
      </Link>

      {r && (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              fontSize: 12,
              color: 'var(--mfg)',
            }}
          >
            {r.reference}
          </div>
          <h1
            style={{
              margin: '3px 0 0',
              fontFamily: 'var(--font-display)',
              fontSize: mobile ? 22 : 28,
              fontWeight: 600,
              letterSpacing: '-.5px',
              lineHeight: 1.15,
            }}
          >
            {r.stallName}
          </h1>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 7,
              marginTop: 9,
            }}
          >
            <TypeBadge type={r.requestType} />
            <StatusPill status={r.status} />
            {hasStage(r.status) && <StagePill stage={r.stage} />}
            {r.flagged && (
              <Tag tone='warn' size='sm' title={r.flagReason ?? undefined}>
                <Icon name='alert-triangle' size={11} />
                {r.flagReason}
              </Tag>
            )}
          </div>
        </div>
      )}

      {loading && <Loading />}
      {error && <ErrorBox>{error.message}</ErrorBox>}

      {r && (
        <>
          {/* The action rail, on its own plate above the record. Every button
              carries its glyph — the rail is eight verbs of near-identical
              length, and at a glance they were one grey wall; the icon is what
              a coordinator actually aims at once they have used the screen
              twice. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              padding: 12,
              marginBottom: 16,
              borderRadius: 'var(--r3)',
              border: '1px solid var(--bd)',
              background: 'var(--rail)',
            }}
          >
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'BACKUP') && (
              <Btn disabled={busy} onClick={() => run('Shortlisted', () => api.shortlist(r.id))}>
                <Icon name='check-square' size={14} />
                Shortlist
              </Btn>
            )}
            {canSelect && r.status === 'SHORTLISTED' && (
              <Btn
                disabled={busy}
                onClick={() => run('Back to submitted', () => api.unshortlist(r.id))}
              >
                <Icon name='arrow-left-right' size={14} />
                Unshortlist
              </Btn>
            )}
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'SHORTLISTED') && (
              <Btn disabled={busy} onClick={() => run('Moved to backup', () => api.backup(r.id))}>
                <Icon name='layers' size={14} />
                Backup
              </Btn>
            )}
            {canSelect &&
              r.status !== 'REJECTED' &&
              r.status !== 'CANCELLED' &&
              !(r.status === 'SELECTED' && fullyAllocated) && (
                <Btn kind='primary' disabled={busy} onClick={() => setSelecting(true)}>
                  <Icon name={r.status === 'SELECTED' ? 'plus' : 'map-pin'} size={14} />
                  {r.status === 'SELECTED' ? 'Add stall' : 'Select'}
                </Btn>
              )}
            {canSelect && r.status !== 'REJECTED' && r.status !== 'CANCELLED' && (
              <Btn kind='danger' disabled={busy} onClick={() => setReasonFor('reject')}>
                <Icon name='ban' size={14} />
                Reject
              </Btn>
            )}
            {canSelect && r.status === 'SELECTED' && (
              <Btn disabled={busy} onClick={() => run('Cancelled', () => api.cancel(r.id))}>
                <Icon name='x' size={14} />
                Cancel
              </Btn>
            )}
            {canWrite && (
              <Btn disabled={busy} onClick={() => setAmending(true)}>
                <Icon name='pencil' size={14} />
                Amend
              </Btn>
            )}
            {canWrite &&
              (r.flagged ? (
                <Btn
                  disabled={busy}
                  onClick={() => run('Unflagged', () => api.unflagRequest(r.id))}
                >
                  <Icon name='check' size={14} />
                  Unflag
                </Btn>
              ) : (
                <Btn disabled={busy} onClick={() => setReasonFor('flag')}>
                  <Icon name='alert-triangle' size={14} />
                  Flag for Follow-Up
                </Btn>
              ))}
          </div>

          {r.allocations.length > 0 && (
            <Allocations r={r} busy={busy} canSelect={canSelect} run={run} onMove={setMoving} />
          )}

          {/* The shared underlined rail, the way Admin draws its sections. */}
          <Tabs label='Record Sections' tabs={tabs} active={active} onPick={setTab} />

          <Card pad={0}>
            {(active === 'application' || active === 'all') && <ApplicationPanel r={r} />}
            {(active === 'bank' || active === 'all') && <BankPanel forms={forms} />}
            {(active === 'fssai' || active === 'all') && <FssaiPanel forms={forms} />}
            {(active === 'staff' || active === 'all') && <StaffPanel forms={forms} />}
          </Card>
        </>
      )}

      {reasonFor !== null && (
        <Dialog
          title={reasonFor === 'reject' ? 'Reject this request' : 'Flag for follow-up'}
          note={
            reasonFor === 'reject'
              ? 'The reason is kept on the record and is not shown to the vendor.'
              : 'A short note for whoever picks this up next.'
          }
          onClose={() => setReasonFor(null)}
          footer={
            <>
              <Btn onClick={() => setReasonFor(null)}>Back</Btn>
              <Btn
                kind={reasonFor === 'reject' ? 'danger' : 'primary'}
                disabled={!reason.trim()}
                onClick={submitReason}
              >
                <Icon name={reasonFor === 'reject' ? 'ban' : 'alert-triangle'} size={14} />
                {reasonFor === 'reject' ? 'Reject' : 'Flag'}
              </Btn>
            </>
          }
        >
          <Textarea
            aria-label='Reason'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            // A one-field prompt, opened by an explicit click: focus belongs in
            // the box the reader came here to type in. `Dialog`'s focus trap
            // sees the focus is already inside and leaves it alone.
            autoFocus
          />
        </Dialog>
      )}

      {r && selecting && (
        <SelectDialog
          request={r}
          onClose={() => setSelecting(false)}
          onDone={() => {
            setSelecting(false);
            reload();
          }}
        />
      )}

      {r && moving && (
        <MoveAllocationDialog
          allocation={moving}
          stallName={r.stallName}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            reload();
          }}
        />
      )}

      {r && amending && (
        <AmendDialog
          request={r}
          onClose={() => setAmending(false)}
          onDone={() => {
            setAmending(false);
            reload();
          }}
        />
      )}
    </section>
  );
}

/** The stall numbers this request holds, and the two controls that change
 *  one. Above the tabs rather than inside Application: an allocation is what
 *  the team decided, not something the requester filled in.
 *
 *  ⚠️ Edit and Release are different acts and are worth keeping apart. Release
 *  gives the pitch back to the pool because the vendor is not taking it; Edit
 *  keeps it and corrects WHICH pitch it is, which is the common case — a number
 *  typed against the wrong row, or a bay re-laid after the letter went out.
 *  Doing the second with the first cost the vendor their place in the gap. */
function Allocations({
  r,
  busy,
  canSelect,
  run,
  onMove,
}: {
  r: Detail;
  busy: boolean;
  canSelect: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  onMove: (allocation: RequestAllocation) => void;
}) {
  return (
    <Card pad={0} style={{ marginBottom: 16 }}>
      <Section icon='map-pin' title='Allocation' count={r.allocations.length} last>
        <div style={{ display: 'grid', gap: 8 }}>
          {r.allocations.map((a) => (
            <div
              key={a.id}
              style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}
            >
              <span
                style={{
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: 'var(--ok-fg)',
                }}
              >
                {a.stallNumber}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--mfg)' }}>
                {titleCase(a.category)} · {formatDateTime(a.allocatedAt)}
              </span>
              {canSelect && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn disabled={busy} onClick={() => onMove(a)}>
                    <Icon name='pencil' size={13} />
                    Edit
                  </Btn>
                  <Btn
                    disabled={busy}
                    onClick={() => run('Released', () => api.releaseAllocation(a.id))}
                  >
                    <Icon name='x' size={13} />
                    Release
                  </Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
    </Card>
  );
}

/** The form the requester themselves filled in, in the order it was asked. */
function ApplicationPanel({ r }: { r: Detail }) {
  return (
    <>
      {r.rejectReason && (
        <Section icon='ban' title='Rejection'>
          <Facts items={[['Reason', r.rejectReason]]} />
        </Section>
      )}

      <Section icon='clipboard-list' title='Application' note='What the requester filled in.'>
        <Facts
          items={facts([
            ['Requester', r.requesterName],
            ['Email', r.email],
            ['Contact', r.contactNumber],
            ['Address', r.address],
            ['Stall Type', r.stallType === 'FOOD' ? 'Food' : 'Non-Food'],
            ['Bay Requested', r.preferredZoneCode],
            // 🔴 What the stall is PRICED at once the team and the requester
            // have settled it — routinely not the bay that was asked for, and
            // settled before any stall number exists.
            [
              'Bay Agreed',
              r.agreedZoneCode ? (
                <>
                  {r.agreedZoneCode}
                  {r.agreedZoneCode !== r.preferredZoneCode && (
                    <Tag tone='warn' size='sm' style={{ marginLeft: 7 }}>
                      moved from {r.preferredZoneCode}
                    </Tag>
                  )}
                </>
              ) : null,
            ],
            ['Stalls Requested', r.numStallsRequested],
            ['Items', r.itemsSelling],
            ['Remarks', r.remarks],
            ['Submitted', formatDateTime(r.submittedAt)],
            ['Deposit Acknowledged', r.depositAcknowledgedAt ? 'Yes' : null],
          ])}
        />
      </Section>

      {r.ashram && (
        <Section icon='home' title='Department'>
          <Facts
            items={facts([
              ['Department', r.ashram.department],
              ['Department Head', `${r.ashram.departmentHead} · ${r.ashram.departmentHeadContact}`],
              ['Requested By', `${r.ashram.requestedBy} · ${r.ashram.requesterContact}`],
              ['Usage', USAGE[r.ashram.usage] ?? r.ashram.usage],
              ['Credit Card Facility', r.ashram.creditCardNeeded ? 'Yes' : 'No'],
              ['Tamil Thembu (11 Days)', r.ashram.wantsThembu ? 'Yes' : 'No'],
              [
                'FSSAI Expected',
                r.ashram.fssaiExpected === null ? null : r.ashram.fssaiExpected ? 'Yes' : 'No',
              ],
            ])}
          />
        </Section>
      )}

      {(r.plugs5a || r.plugs15a || r.gasStoves || r.appliances.length) > 0 && (
        <Section icon='sliders' title='Electrical'>
          <Facts
            items={facts([
              ['5 A Plug Points', r.plugs5a],
              ['15 A Plug Points', r.plugs15a],
              ['Gas Stoves', r.gasStoves],
              r.appliances.length > 0 && [
                'Appliances',
                <ul key='ap' style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                  {r.appliances.map((a, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: display only
                    <li key={i}>
                      {a.name} <span style={{ color: 'var(--mfg)' }}>— {a.watts} W</span>
                    </li>
                  ))}
                  <li
                    style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--mfg)', marginTop: 3 }}
                  >
                    Total {r.appliances.reduce((n, a) => n + a.watts, 0)} W
                  </li>
                </ul>,
              ],
            ])}
          />
        </Section>
      )}

      {(r.tablesNeeded || r.chairsNeeded || r.passes2w || r.passes4w || r.passesStaff) > 0 && (
        <Section icon='layout-grid' title='Logistics'>
          <Facts
            items={facts([
              ['Tables', r.tablesNeeded],
              ['Chairs', r.chairsNeeded],
              ['2-Wheeler Passes', r.passes2w],
              ['4-Wheeler Passes', r.passes4w],
              ['Staff Passes', r.passesStaff],
            ])}
          />
        </Section>
      )}

      {r.customValues.length > 0 && (
        <Section icon='list-view' title='Additional' last>
          <Facts items={r.customValues.map((v) => [v.label, v.value] as Fact)} />
        </Section>
      )}
    </>
  );
}

/** A file the requester uploaded. `url` is a short-lived presigned link, and
 *  null when the media store is not configured — a dev machine, usually — so
 *  the name is still listed and simply does not open. */
function FileLinks({ files }: { files: Array<{ name: string; url: string | null }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {files.map((f) =>
        f.url ? (
          <a
            key={f.name}
            href={f.url}
            target='_blank'
            rel='noreferrer'
            style={{ ...toolBtnStyle(false), textDecoration: 'none' }}
          >
            <Icon name='download' size={13} />
            {f.name}
          </a>
        ) : (
          <Tag key={f.name} size='sm'>
            {f.name}
          </Tag>
        ),
      )}
    </div>
  );
}

/** ⚠️ The empty state says WHO is being waited on, not "no data". The tab is
 *  only drawn when the form was asked for, so an empty one always means the
 *  requester has not answered — which is the sentence the coordinator reading
 *  it is about to act on. */
function NotYet({ what }: { what: string }) {
  return <Empty>{what} has been asked for and has not come back yet.</Empty>;
}

function BankPanel({ forms }: { forms: OnboardingDetail | null }) {
  const bank = forms?.bank;
  return (
    <Section icon='file-text' title='Bank Form' note='Submitted by the vendor for payment.' last>
      {bank ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <Facts
            items={facts([
              ['Invoice Name', bank.invoiceName],
              ['Account Holder', bank.accountHolder],
              ['Bank', bank.bankName],
              ['Branch', bank.branch],
              ['Account Number', bank.accountNumber],
              ['IFSC', bank.ifsc],
              ['MICR', bank.micr],
              ['PAN', bank.panNumber],
              ['GST', bank.gstNumber],
              ['Address', bank.address],
              ['Pincode', bank.pincode],
              ['Mobile', bank.mobile],
              ['Submitted', formatDateTime(bank.submittedAt)],
            ])}
          />
          {bank.files.length > 0 && <FileLinks files={bank.files} />}
        </div>
      ) : (
        <NotYet what='The bank form' />
      )}
    </Section>
  );
}

const FSSAI_TONE = { VERIFIED: 'ok', UPLOADED: 'info', PENDING: 'warn' } as const;
const FSSAI_LABEL = {
  VERIFIED: 'Verified',
  UPLOADED: 'Uploaded, Not Yet Verified',
  PENDING: 'Not Uploaded',
} as const;

function FssaiPanel({ forms }: { forms: OnboardingDetail | null }) {
  const state = forms?.fssai;
  return (
    <Section icon='shield' title='FSSAI' note='The food licence, and who has checked it.' last>
      {forms && state && state !== 'NOT_APPLICABLE' ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <Facts
            items={[
              [
                'Certificate',
                <Tag key='s' tone={FSSAI_TONE[state]}>
                  {FSSAI_LABEL[state]}
                </Tag>,
              ],
            ]}
          />
          {forms.fssaiFiles.length > 0 ? (
            <FileLinks files={forms.fssaiFiles} />
          ) : (
            <NotYet what='The certificate' />
          )}
        </div>
      ) : (
        <NotYet what='The certificate' />
      )}
    </Section>
  );
}

function StaffPanel({ forms }: { forms: OnboardingDetail | null }) {
  if (!forms) return null;
  return (
    <Section
      icon='users'
      title='Backoffice'
      note='Who the stall has registered against its coupon.'
      count={forms.staff.length}
      last
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Facts
          items={facts([
            // A stall can hold more than one live code — a caterer's beside the
            // vendor's own — so this names them all rather than the first.
            ['Coupon', forms.coupons.map((c) => c.code).join(', ') || null],
            // ⚠️ A ceiling, not a quota: the second number is what the coupons
            // admit between them, never what the stall owes.
            ['Registered', `${forms.staffRegistered} (up to ${forms.staffExpected})`],
          ])}
        />
        {forms.staff.length === 0 ? (
          <NotYet what='Staff registration' />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Mobile</TH>
                <TH>ID</TH>
                <TH>Role</TH>
                <TH>Registered</TH>
              </TR>
            </THead>
            <TBody>
              {forms.staff.map((s) => (
                <TR key={s.id}>
                  <TD style={{ fontWeight: 600 }}>{s.name}</TD>
                  <TD mono>{s.mobile}</TD>
                  <TD muted>
                    {s.idType} · {s.idNumber}
                  </TD>
                  <TD muted>{s.role ?? '—'}</TD>
                  <TD muted style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(s.registeredAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Section>
  );
}

export type { Detail };
