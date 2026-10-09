import type { Layer } from './layer';
import './events.css';

interface Props {
  layer: Layer;
  onChange(l: Layer): void;
  houses: number;
  events: number;
  /** 'bar' sits in the header on wide screens; 'float' is the pill over the top of the map or list on narrower ones. */
  variant: 'bar' | 'float';
}

const OPTIONS: [Layer, string][] = [
  ['houses', 'Houses'],
  ['events', 'Events'],
  ['both', 'Both'],
];

/** Houses · Events · Both. One state drives the map and the list. */
export default function LayerSwitch({ layer, onChange, houses, events, variant }: Props) {
  return (
    <div className={variant === 'bar' ? 'seg layerseg' : 'layerfloat'} role="group" aria-label="Show on the map and list">
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
