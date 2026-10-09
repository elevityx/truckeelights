import { displayVotes, isCapped, meterFraction, tier, type PowerKind } from '@/lib/votes/meter';

// The small seasonal power meter under a map pin. DOM built with createElement only (no HTML strings);
// it is decorative (aria-hidden): the pin's aria-label carries the meter text.

export function buildMeter(kind: PowerKind): HTMLElement {
  const m = document.createElement('span');
  m.className = `meter m-${kind}`;
  m.setAttribute('aria-hidden', 'true');
  const track = document.createElement('span');
  track.className = 'track';
  const fill = document.createElement('span');
  fill.className = 'fill';
  track.append(fill, document.createElement('i'), document.createElement('i'), document.createElement('i'));
  const fx = document.createElement('span');
  fx.className = 'fx';
  fx.append(document.createElement('b'), document.createElement('b'), document.createElement('b'));
  m.append(track, fx);
  return m;
}

/** Paint the meter for a raw vote count. The photo cap (no approved photo) holds it at three quarters. */
export function updateMeter(el: HTMLElement, votes: number, photoCount: number): void {
  const shown = displayVotes(votes, photoCount);
  el.style.setProperty('--fill', meterFraction(shown).toFixed(3));
  el.dataset.tier = tier(shown);
  el.toggleAttribute('data-capped', isCapped(photoCount));
}
