import { Checkbox } from '../ui';

/**
 * The filer's word, in place of the requester's own tick.
 *
 * 🔴 Declarations are never SKIPPED on a form filed for somebody. The member
 * sees the same wording the requester would and attests to having read it out;
 * the consent rows then carry `attestedBy`, so the record says a desk ticked
 * them rather than pretending the requester did.
 *
 * One box, one sentence, always the same sentence — it is a statement somebody
 * may later have to stand behind, not copy to be reworded per screen.
 */
export function Attestation({
  checked,
  onChange,
  requesterName,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  requesterName: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 'var(--r2)',
        border: '1px solid var(--warn-b)',
        background: 'var(--warn-t)',
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>Filing for {requesterName}</div>
      <label
        htmlFor='attestation'
        style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13 }}
      >
        <Checkbox
          id='attestation'
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>I read these declarations to the requester and they agreed.</span>
      </label>
    </div>
  );
}
