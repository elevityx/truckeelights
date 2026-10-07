// Constant SVG strings copied from mockup v2. Never built from data.
import type { Season } from '@/lib/data/types';

export const GLYPHS = {
  pumpkin: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 11c-.5-3 .5-5.5 3.5-7" stroke="#5c8f22" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="24" rx="16.5" ry="13" fill="#FF7A1A"/><path d="M20 11c-5 0-6 26 0 26M20 11c5 0 6 26 0 26M12 13c-6 4-6 18 0 22M28 13c6 4 6 18 0 22" stroke="#C4520A" stroke-width="1.4" fill="none"/><path d="M10.5 21l5.5-4.5 2 5.5zM29.5 21L24 16.5 22 22z" fill="#FFE27A"/><path d="M10.5 27.5c3 4.5 16 4.5 19 0l-3.2 1.2-2.1-2.2-2.2 3-2-3-2.2 3-2.1-3-2.1 2.2z" fill="#FFE27A"/></svg>',
  ghost: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 37V18a12 12 0 0 1 24 0v19l-4-3.2-4 3.2-4-3.2-4 3.2-4-3.2z" fill="#F3ECDA"/><path d="M27 8c3 2 5 6 5 10" stroke="#8AE234" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="15.5" cy="19" rx="2.6" ry="3.7" fill="#140A1F"/><ellipse cx="24.5" cy="19" rx="2.6" ry="3.7" fill="#140A1F"/><ellipse cx="20" cy="27.5" rx="2.4" ry="3.2" fill="#140A1F"/></svg>',
  tree: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5l7 10h-4l7 9h-4l8 9.5H8L16 24h-4l7-9h-4z" fill="#2E8B57" stroke="#174d30" stroke-width="1"/><rect x="17.5" y="33.5" width="5" height="5" fill="#7a4a24"/><path d="M20 1l1.5 3.2 3.5.4-2.6 2.4.7 3.4-3.1-1.7-3.1 1.7.7-3.4-2.6-2.4 3.5-.4z" fill="#F2C14E"/><g class="bulbs"><circle cx="17" cy="14" r="1.7" fill="#ff5a5f"/><circle cx="23" cy="19" r="1.7" fill="#F2C14E"/><circle cx="14.5" cy="25" r="1.7" fill="#6fd3ff"/><circle cx="25.5" cy="27.5" r="1.7" fill="#ff5a5f"/><circle cx="20" cy="31" r="1.7" fill="#F2C14E"/><circle cx="19" cy="22" r="1.7" fill="#7FD6A0"/></g></svg>',
  wreath: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="19" r="12" fill="none" stroke="#2E8B57" stroke-width="7.5"/><circle cx="20" cy="19" r="12" fill="none" stroke="#174d30" stroke-width="1.2" stroke-dasharray="2 3"/><g class="bulbs"><circle cx="20" cy="7" r="1.8" fill="#F2C14E"/><circle cx="30.4" cy="13" r="1.8" fill="#ff5a5f"/><circle cx="30.4" cy="25" r="1.8" fill="#6fd3ff"/><circle cx="9.6" cy="25" r="1.8" fill="#F2C14E"/><circle cx="9.6" cy="13" r="1.8" fill="#7FD6A0"/></g><path d="M20 31l-7 7 1.2-8.2zM20 31l7 7-1.2-8.2z" fill="#E0393E"/><circle cx="20" cy="31" r="3" fill="#C62828"/></svg>',
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** Alternate glyph (ghost / wreath) for roughly one house in four, stable per id. */
export function pickGlyph(id: string, season: Season): GlyphName {
  const alt = parseInt(id.slice(0, 2), 16) % 4 === 0;
  if (season === 'halloween') return alt ? 'ghost' : 'pumpkin';
  return alt ? 'wreath' : 'tree';
}
