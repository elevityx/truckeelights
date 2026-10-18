import type { MapAdapter } from './types';

type StubHooks = { __tlStubSelectEvent?: (id: string) => void; __tlStubSelectHouse?: (id: string) => void };
// Inlined at build: true only in the e2e harness builds (e2e/build-variants.mjs); production never sets it, so this is dead code there.
const e2e = () => process.env.NEXT_PUBLIC_E2E === '1' && typeof window !== 'undefined';

/** Keyless adapter for forks and CI: shows a notice and does nothing else. */
export function createStubAdapter(): MapAdapter {
  let host: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let eventIds = ''; // test/CI aid: the sorted ids of the event pins it was given (no visible change)
  return {
    async mount(el) {
      host = el;
      panel = document.createElement('div');
      panel.className = 'empty';
      panel.dataset.eventIds = eventIds;
      const p = document.createElement('p');
      p.textContent = 'Map needs a Google Maps key. Use the List view.';
      panel.appendChild(p);
      host.appendChild(panel);
    },
    setPins() {},
    setEvents(evs) {
      eventIds = evs.map((e) => e.id).sort().join(',');
      if (panel) panel.dataset.eventIds = eventIds;
    },
    focus() {},
    onPinSelect(cb) {
      if (!e2e()) return () => {};
      const w = window as unknown as StubHooks;
      const fn = (id: string) => cb(id);
      w.__tlStubSelectHouse = fn;
      return () => {
        if (w.__tlStubSelectHouse === fn) delete w.__tlStubSelectHouse;
      };
    },
    onEventSelect(cb) {
      if (!e2e()) return () => {};
      const w = window as unknown as StubHooks;
      const fn = (id: string) => cb(id);
      w.__tlStubSelectEvent = fn;
      return () => {
        if (w.__tlStubSelectEvent === fn) delete w.__tlStubSelectEvent;
      };
    },
    onMapClick() {
      return () => {}; // no map, so tap-to-add is off; Add a house still works
    },
    showProbe() {},
    zoomTo() {},
    fitEvents() {},
    setRoute() {},
    getCenter() {
      return null;
    },
    async reverseGeocode() {
      return [];
    },
    destroy() {
      panel?.remove();
      panel = null;
      host = null;
    },
  };
}
