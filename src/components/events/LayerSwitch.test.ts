import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LayerSwitch from './LayerSwitch';

const html = (variant: 'bar' | 'float' | 'inline') =>
  renderToStaticMarkup(createElement(LayerSwitch, { variant, layer: 'events', onChange: () => {}, houses: 8, events: 15 }));

describe('LayerSwitch', () => {
  it('renders the floating pill below 1024px and the header segment above', () => {
    expect(html('float')).toMatch(/^<div class="layerfloat" role="group" aria-label="Show on the map and list">/);
    expect(html('bar')).toMatch(/^<div class="seg layerseg" role="group"/);
  });

  it('renders the same pill inline for the list control row', () => {
    expect(html('inline')).toMatch(/^<div class="layerfloat layerinline" role="group" aria-label="Show on the map and list">/);
  });

  it('keeps three pressed-state buttons with the counts in their text', () => {
    const out = html('float');
    expect(out.match(/<button/g)).toHaveLength(3);
    expect(out).toContain('aria-pressed="false">Houses<span class="n"><span class="sr-only">, </span>8</span>');
    expect(out).toContain('aria-pressed="true">Events<span class="n"><span class="sr-only">, </span>15</span>');
    expect(out).toContain('aria-pressed="false">Both</button>');
  });
});
