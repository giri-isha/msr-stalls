/** English, then Tamil on the same line as the 2025 Google Forms printed
 *  them — `Stall Name/ஸ்டால் பெயர்`. The Tamil gets its own font stack so
 *  it renders on machines where Geist has no Tamil glyphs. */
export function BilingualLabel({ en, ta }: { en: string; ta: string | null }) {
  if (!ta) return <>{en}</>;
  return (
    <>
      {en}
      <span style={{ color: 'var(--mfg)' }}>/</span>
      <span className='msrs-ta' lang='ta'>
        {ta}
      </span>
    </>
  );
}
