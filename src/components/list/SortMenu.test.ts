import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ListView from './ListView';
import SortMenu from './SortMenu';
import { EventsView } from '@/components/events/EventsList';

const pin = (id: string, address: string, votes: number) => ({ id, address, lat: 39.3, lng: -120.2, photoCount: 0, votes, badges: [] });
const pins = [pin('a', '10 Pine St, Truckee', 3), pin('b', '5 Elm St, Truckee', 0)];
const sw = createElement('div', { className: 'layerfloat layerinline' }, 'switch');

describe('SortMenu', () => {
  it('renders one closed button showing the current sort, with a menu popup', () => {
    const out = renderToStaticMarkup(createElement(SortMenu, { sort: 'az', onChange: () => {} }));
    expect(out).toMatch(/^<div class="sortmenu"><button type="button" class="sortbtn" aria-haspopup="menu" aria-expanded="false" aria-label="Sort houses: A–Z">/);
    expect(out).toContain('<span class="sl">A–Z</span>');
    expect(out).not.toContain('role="menu"');
  });
});

describe('list control row', () => {
  it('puts the switch next to the sort button and keeps the caption', () => {
    const out = renderToStaticMarkup(createElement(ListView, { season: 'halloween', year: 2026, pins, onOpen: () => {}, layerSwitch: sw }));
    expect(out).toMatch(/^<div class="list has-ctl"><div class="list-in"><div class="listctl"><div class="layerfloat layerinline">switch<\/div><div class="sortmenu">/);
    expect(out).toContain('Top voted · Halloween 2026 · resets each season');
    expect(out).toContain('class="sortmenu sort-head"');
    expect(out).not.toContain('lsort');
    expect(out.match(/aria-haspopup="menu"/g)).toHaveLength(2);
  });

  it('has no control row without the switch (no events), only the heading sort button', () => {
    const out = renderToStaticMarkup(createElement(ListView, { season: 'christmas', year: 2026, pins, onOpen: () => {} }));
    expect(out).toMatch(/^<div class="list"><div class="list-in"><div class="list-head">/);
    expect(out.match(/aria-haspopup="menu"/g)).toHaveLength(1);
  });

  it('shows only the switch in the Events layer (events are always by date)', () => {
    const out = renderToStaticMarkup(
      createElement(EventsView, { events: [], tz: 'America/Los_Angeles', region: { minLat: 39.2, maxLat: 39.4, minLng: -120.3, maxLng: -120.0 }, now: 0, season: 'halloween', year: 2026, onOpen: () => {}, layerSwitch: sw }),
    );
    expect(out).toContain('<div class="listctl"><div class="layerfloat layerinline">switch</div></div>');
    expect(out).not.toContain('sortbtn');
  });
});
