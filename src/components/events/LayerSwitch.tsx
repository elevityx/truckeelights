import type { Layer } from './layer';
import './events.css';

interface Props {
  layer: Layer;
  onChange(l: Layer): void;
  houses: number;
  events: number;
  /**
   * 'bar' sits in the header on wide screens; 'float' is the pill over the top of the map on narrower ones;
   * 'inline' is the same pill in the list's control row (below 1024px), next to the sort button.
   */
  variant: 'bar' | 'float' | 'inline';
}

const OPTIONS: [Layer, string][] = [
  ['houses', 'Houses'],
  ['events', 'Events'],
  ['both', 'Both'],
];

/** Houses · Events · Both. One state drives the map and the list. */
export default function LayerSwitch({ layer, onChange, houses, events, variant }: Props) {
  return (
    <div className={variant === 'bar' ? 'seg layerseg' : variant === 'inline' ? 'layerfloat layerinline' : 'layerfloat'} role="group" aria-label="Show on the map and list">
      {OPTIONS.map(([value, label]) => {
        const n = value === 'houses' ? houses : value === 'events' ? events : null;
        return (
          <button key={value} type="button" aria-pressed={layer === value} onClick={() => onChange(value)}>
            {label}
            {n !== null && (
              <span className="n">
                <span className="sr-only">, </span>
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
