import type { MapAdapter } from './types';

/** Keyless adapter for forks and CI: shows a notice and does nothing else. */
export function createStubAdapter(): MapAdapter {
  let host: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  return {
    async mount(el) {
      host = el;
      panel = document.createElement('div');
      panel.className = 'empty';
      const p = document.createElement('p');
      p.textContent = 'Map needs a Google Maps key. Use the List view.';
      panel.appendChild(p);
      host.appendChild(panel);
    },
    setPins() {},
    focus() {},
    onPinSelect() {
      return () => {};
    },
    onMapClick() {
      return () => {}; // no map, so tap-to-add is off; Add a house still works
    },
    showProbe() {},
    zoomTo() {},
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
