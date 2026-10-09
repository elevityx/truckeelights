import type { Season } from '@/lib/data/types';

/** Event glyph as JSX (same artwork as EVENT_GLYPHS): a lantern for Halloween, a star for Christmas. */
export default function EventGlyph({ season }: { season: Season }) {
  if (season === 'christmas') {
    return (
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <path d="M20 4l4.6 9.9 10.8 1.3-8 7.4 2.1 10.7L20 28l-9.5 5.3 2.1-10.7-8-7.4 10.8-1.3z" fill="#F2C14E" stroke="#a87a12" strokeWidth="1" />
        <path d="M20 10l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" fill="#FFE9A8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M14 10a6 6 0 0 1 12 0" stroke="#B8A9CF" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="12.5" y="9.5" width="15" height="4" rx="1.2" fill="#4a2f6e" stroke="#B8A9CF" strokeWidth=".8" />
      <path d="M12.5 13.5h15l-1.8 18h-11.4z" fill="#2a1638" stroke="#B8A9CF" strokeWidth=".8" />
      <path d="M15.2 15.5h9.6l-1.3 13.5h-7z" fill="#FFB347" />
      <path d="M20 18.5c2.4 2.6 2.6 5 0 7.6-2.6-2.6-2.4-5 0-7.6z" fill="#FFF2C4" />
      <path d="M20 15.5v13.5" stroke="#4a2f6e" strokeWidth="1" />
      <rect x="11.5" y="31.5" width="17" height="3.2" rx="1" fill="#4a2f6e" stroke="#B8A9CF" strokeWidth=".8" />
    </svg>
  );
}
