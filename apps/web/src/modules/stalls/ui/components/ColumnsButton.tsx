import type { ColumnState } from '../useColumns';
import { OptionRow, PopHeader, Popover } from './Popover';

/**
 * The toolbar control that picks a table's columns.
 *
 * ⚠️ The badge counts what is HIDDEN, not what is shown. A reader who has
 * turned three columns off needs to be told so — "why is the stage missing?"
 * is otherwise answered by a preference their browser remembered weeks ago —
 * whereas a count of visible columns is a number nobody has a use for.
 *
 * A locked column is drawn ticked and disabled rather than left out of the
 * list. Its absence would read as a column the table does not have, and the
 * one thing this panel is for is telling somebody what a table COULD show.
 */
export function ColumnsButton({ state }: { state: ColumnState }) {
  return (
    <Popover icon='sliders' label='Columns' badge={state.hiddenCount} width={260}>
      {() => (
        <>
          <PopHeader
            title='Columns'
            action={state.customised ? 'Reset' : undefined}
            onAction={state.reset}
          />
          <div role='listbox' aria-label='Columns' aria-multiselectable>
            {state.defs.map((d) =>
              d.locked ? (
                <div
                  key={d.key}
                  // Not an `OptionRow`: it is not an option. Announcing it as a
                  // selected one would invite a click that does nothing.
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 6px',
                    fontSize: 12.5,
                    color: 'var(--mfg)',
                  }}
                >
                  <span aria-hidden>✓</span>
                  {d.label}
                  <span style={{ marginLeft: 'auto', fontSize: 11 }}>always</span>
                </div>
              ) : (
                <OptionRow
                  key={d.key}
                  role='option'
                  ticked={state.shown(d.key)}
                  label={d.label}
                  onClick={() => state.toggle(d.key)}
                />
              ),
            )}
          </div>
        </>
      )}
    </Popover>
  );
}
