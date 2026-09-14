/** English, then Tamil on the same line as the 2025 Google Forms printed
 *  them — `Stall Name/ஸ்டால் பெயர்`. The Tamil gets its own font stack so
 *  it renders on machines where the default sans has no Tamil glyphs.
 *
 *  ⚠️ `msrs-tamil` is a CLASS rather than an inline style, and that is forced
 *  rather than chosen: this is a fragment with no element of its own, and the
 *  span it does render is inside text a caller assembles. The class is declared
 *  beside the token it spends, in `ui/tokens.css`. */
export function BilingualLabel({ en, ta }: { en: string; ta: string | null }) {
  if (!ta) return <>{en}</>;
  return (
    <>
      {en}
      <span style={{ color: 'var(--mfg)' }}>/</span>
      <span className='msrs-tamil' lang='ta'>
        {ta}
      </span>
    </>
  );
}
