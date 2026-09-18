import type { CheckInRow } from '@stalls/core';
import { useMemo, useState } from 'react';
import { checkIn, listCheckIns, undoCheckIn } from '../api';
import { TypeBadge } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Input,
  Loading,
  Pager,
  Search,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tag,
  toolBtnStyle,
  useListView,
  usePaged,
  useToast,
  ViewToggle,
} from '../ui';

/**
 * The check-in counter, at six in the morning, on a phone.
 *
 * ⚠️ **Nothing here blocks a check-in.** The pending chips are information, not
 * a gate: a stall whose FSSAI certificate is in the owner's hand rather than in
 * the system still has to be let in, and a volunteer who cannot record what
 * happened stops recording anything. The note field is what carries the reason.
 *
 * The chips come from the API, which computes them with the same function the
 * vendor's own portal and the Onboarding table use — so the volunteer and the
 * vendor standing in front of them are looking at the same answer.
 *
 * ⚠️ **Two shapes, and the tiles are no longer the only one.** The counter is a
 * phone job and the tiles are what a phone wants — but the same screen is read
 * at a desk the evening before, to answer "who is still not in", and that is a
 * question about eighty rows at once rather than about the stall in front of
 * you. `useListView` opens on the width and then remembers whichever was
 * picked, exactly as the request pipeline does.
 */
export function CheckIn() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [view, setView] = useListView('checkin');
  const { data, error, loading, reload, setData } = useLoad(
    () => listCheckIns(q || undefined),
    [q],
  );
  const { can } = useMe();

  const rows = useMemo(() => {
    const all = data ?? [];
    if (filter === 'pending') return all.filter((r) => r.checkedInAt === null);
    if (filter === 'done') return all.filter((r) => r.checkedInAt !== null);
    return all;
  }, [data, filter]);

  // ⚠️ The search and the filter both reset to page one. Narrowing while on
  // page four is how a working filter comes to look like lost rows.
  const { slice, pager } = usePaged('checkin', rows, `${q}|${filter}`);

  const done = (data ?? []).filter((r) => r.checkedInAt !== null).length;
  const canWrite = can('checkin.write');

  /** Replaces one row in place. The list is long and a volunteer is halfway
   *  down it; a full reload would scroll them back to the top after every tick. */
  const replace = (row: CheckInRow) =>
    setData((prev) => (prev ?? []).map((r) => (r.requestId === row.requestId ? row : r)));

  return (
    <div>
      <H1
        icon={<Icon name='circle-check' size={18} />}
        sub='Find a stall, see what is outstanding, and check it in.'
        actions={<ViewToggle view={view} onChange={setView} />}
      >
        Check-in
      </H1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <Search value={q} onChange={setQ} placeholder='Search vendor or stall number…' />
        {(
          [
            ['all', `All (${data?.length ?? 0})`],
            ['pending', `Not in (${(data?.length ?? 0) - done})`],
            ['done', `Checked in (${done})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type='button'
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            style={toolBtnStyle(filter === key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorBox>{error.message}</ErrorBox>}
      {loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No stalls match.</Empty>
      ) : view === 'cards' ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))',
              gap: 12,
            }}
          >
            {slice.map((r) => (
              <StallCard
                key={r.requestId}
                row={r}
                canWrite={canWrite}
                onChanged={replace}
                onError={reload}
              />
            ))}
          </div>
          {/* The tiles are not inside a card, so the footer brings its own —
              otherwise the rule along its top is a line drawn across nothing. */}
          <Card pad={0} style={{ marginTop: 12, overflow: 'hidden' }}>
            <Pager {...pager} noun='stall' />
          </Card>
        </>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Stall</TH>
                <TH>Type</TH>
                <TH>Requester</TH>
                <TH align='right'>Staff</TH>
                <TH align='right'>Passes</TH>
                <TH>Outstanding</TH>
                <TH>Checked In</TH>
                {canWrite && <TH align='right'> </TH>}
              </TR>
            </THead>
            <TBody>
              {slice.map((r) => (
                <StallRow
                  key={r.requestId}
                  row={r}
                  canWrite={canWrite}
                  onChanged={replace}
                  onError={reload}
                />
              ))}
            </TBody>
          </Table>
          <Pager {...pager} noun='stall' />
        </Card>
      )}
    </div>
  );
}

/**
 * The check-in itself, shared by the tile and the row.
 *
 * Both shapes offer the same act with the same note and the same toast, and a
 * second copy of it is a second place for "undo" to stop meaning undo.
 */
function useCheckInAction(
  row: CheckInRow,
  onChanged: (row: CheckInRow) => void,
  onError: () => void,
) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const isIn = row.checkedInAt !== null;

  const act = async () => {
    setBusy(true);
    try {
      const next = isIn
        ? await undoCheckIn(row.requestId)
        : await checkIn(row.requestId, note.trim() || undefined);
      onChanged(next);
      toast.ok(isIn ? `${row.stallName} checked out.` : `${row.stallName} checked in.`);
      setNote('');
    } catch (e) {
      toast.fail(e);
      onError();
    } finally {
      setBusy(false);
    }
  };

  return { note, setNote, busy, isIn, act };
}

/** The pending chips, in both shapes. */
function Pending({ row }: { row: CheckInRow }) {
  if (row.pending.length === 0) {
    return (
      <Tag tone='ok' size='sm'>
        <Icon name='check' size={11} /> All Clear
      </Tag>
    );
  }
  return (
    <>
      {row.pending.map((p) => (
        <Tag key={p.step} tone='warn' size='sm'>
          {p.label}
        </Tag>
      ))}
    </>
  );
}

function StallCard({
  row,
  canWrite,
  onChanged,
  onError,
}: {
  row: CheckInRow;
  canWrite: boolean;
  onChanged: (row: CheckInRow) => void;
  onError: () => void;
}) {
  const { note, setNote, busy, isIn, act } = useCheckInAction(row, onChanged, onError);

  return (
    <Card
      pad={15}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
        borderColor: isIn ? 'var(--ok-b)' : undefined,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{row.stallName}</div>
          <div
            style={{
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              fontSize: 12,
              color: 'var(--pri)',
              fontWeight: 600,
            }}
          >
            {row.stallNumbers.join(', ') || 'No stall allocated'}
          </div>
        </div>
        <TypeBadge type={row.requestType} />
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
        {row.requesterName} · {row.contactNumber}
      </div>

      <div style={{ display: 'flex', gap: 14, fontSize: 12.5, flexWrap: 'wrap' }}>
        <span>
          Staff registered:{' '}
          <strong>
            {row.staffRegistered}
            {row.staffExpected > 0 ? ` of ${row.staffExpected}` : ''}
          </strong>
        </span>
        <span>
          Passes: <strong>{row.passes2w}</strong> 2W · <strong>{row.passes4w}</strong> 4W ·{' '}
          <strong>{row.passesStaff}</strong> staff
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pending row={row} />
      </div>

      <div style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
        {isIn ? (
          <div style={{ fontSize: 11.5, color: 'var(--ok-fg)' }}>
            Checked in {formatDateTime(row.checkedInAt as string)}
            {row.note ? ` — ${row.note}` : ''}
          </div>
        ) : (
          canWrite && (
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Note (optional) — e.g. FSSAI shown on paper'
              style={{ fontSize: 12.5 }}
            />
          )
        )}
        {canWrite && (
          <Btn kind={isIn ? 'ghost' : 'primary'} onClick={act} disabled={busy}>
            <Icon name={isIn ? 'undo' : 'circle-check'} size={14} />
            {isIn ? 'Undo check-in' : 'Check in'}
          </Btn>
        )}
      </div>
    </Card>
  );
}

/**
 * The same stall as one table row.
 *
 * ⚠️ The note field rides in the action cell rather than being dropped from
 * this shape. It is the only thing that records WHY a stall with an open
 * pending chip was let in, and a table view that cannot capture it would quietly
 * make "check in with a reason" a phone-only act — which is the opposite of
 * who is sitting at a desk the night before.
 */
function StallRow({
  row,
  canWrite,
  onChanged,
  onError,
}: {
  row: CheckInRow;
  canWrite: boolean;
  onChanged: (row: CheckInRow) => void;
  onError: () => void;
}) {
  const { note, setNote, busy, isIn, act } = useCheckInAction(row, onChanged, onError);

  return (
    <TR style={{ background: isIn ? 'var(--ok-t)' : undefined }}>
      <TD>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{row.stallName}</div>
        <div
          style={{
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontSize: 11.5,
            color: 'var(--pri)',
            fontWeight: 600,
          }}
        >
          {row.stallNumbers.join(', ') || 'No stall allocated'}
        </div>
      </TD>
      <TD>
        <TypeBadge type={row.requestType} />
      </TD>
      <TD>
        <div>{row.requesterName}</div>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{row.contactNumber}</div>
      </TD>
      {/* ⚠️ "1 of 3", the same words the tile uses, rather than the "1 / 3" a
          numeric column invites. The two shapes are one screen, and a reader
          who switches between them should not have to re-learn a figure. */}
      <TD align='right' style={{ whiteSpace: 'nowrap' }}>
        {row.staffRegistered}
        {row.staffExpected > 0 ? ` of ${row.staffExpected}` : ''}
      </TD>
      <TD align='right' style={{ whiteSpace: 'nowrap' }}>
        {row.passes2w} · {row.passes4w} · {row.passesStaff}
      </TD>
      <TD>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <Pending row={row} />
        </div>
      </TD>
      <TD muted style={{ fontSize: 11.5 }}>
        {isIn ? (
          <span style={{ color: 'var(--ok-fg)' }}>
            {formatDateTime(row.checkedInAt as string)}
            {row.note ? ` — ${row.note}` : ''}
          </span>
        ) : (
          '—'
        )}
      </TD>
      {canWrite && (
        <TD align='right'>
          <div style={{ display: 'grid', gap: 6, justifyItems: 'stretch', minWidth: 170 }}>
            {!isIn && (
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label={`Note for ${row.stallName}`}
                placeholder='Note (optional)'
                style={{ fontSize: 12 }}
              />
            )}
            {/* The full "Undo check-in", not a bare "Undo": it is the button's
                accessible name, and "Undo" on its own says nothing about what
                is being undone to somebody who cannot see the row it sits in. */}
            <Btn kind={isIn ? 'ghost' : 'primary'} onClick={act} disabled={busy}>
              <Icon name={isIn ? 'undo' : 'circle-check'} size={14} />
              {isIn ? 'Undo check-in' : 'Check in'}
            </Btn>
          </div>
        </TD>
      )}
    </TR>
  );
}
