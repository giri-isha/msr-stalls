/** English, then Tamil on the same line as the 2025 Google Forms printed
 *  them — `Stall Name/ஸ்டால் பெயர்`. The Tamil gets its own font stack so
 *  it renders on machines where the default sans has no Tamil glyphs. */
export function BilingualLabel({ en, ta }: { en: string; ta: string | null }) {
  if (!ta) return <>{en}</>;
  return (
    <>
      {en}
      <span className='text-ink-2'>/</span>
      <span className='font-tamil' lang='ta'>
        {ta}
      </span>
    </>
  );
}
