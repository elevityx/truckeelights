'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

// useLayoutEffect warns during the static prerender; it only matters in the browser.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Below 1024px the list opens with this row (it scrolls with the list): the layer switch, then the sort button if any.
 * The sort button shows its label ("Top voted ▾") when the row has room and only its icon when it doesn't
 * (`data-fit="icon"`); the aria-label keeps the current sort either way.
 */
export default function ListControls({ layerSwitch, sort }: { layerSwitch: ReactNode; sort?: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = row.current;
    if (!el || !sort) return;
    const fit = () => {
      el.dataset.fit = 'label';
      if (el.scrollWidth > el.clientWidth) el.dataset.fit = 'icon';
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return (
    <div ref={row} className="listctl">
      {layerSwitch}
      {sort}
    </div>
  );
}
