import type { CSSProperties, HTMLAttributes } from 'react';
import { displayVotes, isCapped, meterFraction, tier, type PowerKind } from '@/lib/votes/meter';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  kind: PowerKind;
  /** Raw vote count; the photo cap is applied here. */
  votes: number;
  photoCount: number;
  size?: 'md' | 'lg';
}

/** The seasonal power meter as React (same markup and CSS as the map pin's meterEl.ts). Decorative unless given a role. */
export default function Meter({ kind, votes, photoCount, size, className, style, ...rest }: Props) {
  const shown = displayVotes(votes, photoCount);
  return (
    <span
      aria-hidden={rest.role ? undefined : true}
      {...rest}
      className={`meter m-${kind}${size ? ` ${size}` : ''}${className ? ` ${className}` : ''}`}
      data-tier={tier(shown)}
      data-capped={isCapped(photoCount) ? '' : undefined}
      style={{ ...style, '--fill': meterFraction(shown).toFixed(3) } as CSSProperties}
    >
      <span className="track">
        <span className="fill" />
        <i />
        <i />
        <i />
      </span>
      <span className="fx">
        <b />
        <b />
        <b />
      </span>
    </span>
  );
}
