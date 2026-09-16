import { parseDeclaration } from '@stalls/core';

/**
 * A declaration body, drawn.
 *
 * 🔴 Built from NODES, never from markup. The body is authored by somebody
 * pasting from a Word document and it is rendered onto the page that records
 * what they agreed to — so `dangerouslySetInnerHTML` is out, and so is storing
 * HTML and stripping it on the way past, because the stored text and the shown
 * text would stop being the same string. `parseDeclaration` turns three
 * markers into elements and leaves everything else as text, including `<`.
 *
 * ⚠️ Links get `rel='noreferrer'` and open in a new tab. A requester
 * mid-application who taps the privacy policy and loses two pages of typing has
 * been punished for reading the thing they are being asked to agree to.
 */
export function DeclarationText({ body }: { body: string }) {
  return (
    <>
      {parseDeclaration(body).map((nodes, p) => (
        <p
          // No id on a paragraph, and its text is not unique enough to key on —
          // a declaration can repeat a line. The list never reorders: it is
          // derived from one immutable string.
          // biome-ignore lint/suspicious/noArrayIndexKey: derived from immutable text that never reorders
          key={p}
          style={{ margin: p === 0 ? 0 : '7px 0 0' }}
        >
          {nodes.map((n, i) =>
            n.kind === 'bold' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above
              <strong key={i}>{n.text}</strong>
            ) : n.kind === 'link' ? (
              <a
                // biome-ignore lint/suspicious/noArrayIndexKey: as above
                key={i}
                href={n.href}
                target='_blank'
                rel='noreferrer'
                style={{ color: 'var(--pri)' }}
              >
                {n.text}
              </a>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above
              <span key={i}>{n.text}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
}
