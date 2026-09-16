import type { CheckInRow } from '@msr/stalls';
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
  Search,
  Tag,
  toolBtnStyle,
  useToast,
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
 */
export function CheckIn() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
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

  const done = (data ?? []).filter((r) => r.checkedInAt !== null).length;

  /** Replaces one row in place. The list is long and a volunteer is halfway
   *  down it; a full reload would scroll them back to the top after every tick. */
  const replace = (row: CheckInRow) =>
    setData((prev) => (prev ?? []).map((r) => (r.requestId === row.requestId ? row : r)));

  return (
    <div>
      <H1
        icon={<Icon name='circle-check' size={18} />}
        sub='Find a stall, see what is outstanding, and check it in.'
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
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))',
            gap: 12,
          }}
        >
          {rows.map((r) => (
            <StallCard
              key={r.requestId}
              row={r}
              canWrite={can('checkin.write')}
              onChanged={replace}
              onError={reload}
            />
          ))}
        </div>
      )}
    </div>
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
        {row.pending.length === 0 ? (
          <Tag tone='ok' size='sm'>
            <Icon name='check' size={11} /> All Clear
          </Tag>
        ) : (
          row.pending.map((p) => (
            <Tag key={p.step} tone='warn' size='sm'>
              {p.label}
            </Tag>
          ))
        )}
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
