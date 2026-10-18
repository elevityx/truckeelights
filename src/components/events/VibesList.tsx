'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import ListControls from '@/components/list/ListControls';
import type { Controller } from './vibes';

/** The Events view when the TruckeeVibes widget is on: the host wrapper of EventsView around the widget's list mount. */
export function VibesList({ controller, layerSwitch, onAdd }: { controller: Controller | null; layerSwitch?: ReactNode; onAdd?: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controller || !mountRef.current) return;
    return controller.mountList(mountRef.current, { onAdd });
  }, [controller, onAdd]);
  return (
    <div className={layerSwitch ? 'list has-ctl' : 'list'}>
      <div className="list-in">
        {layerSwitch && <ListControls layerSwitch={layerSwitch} />}
        <div ref={mountRef} data-tv-list="" />
        <p className="land-ack">Truckee sits on the ancestral homeland of the Washoe (Wašiw) people.</p>
      </div>
    </div>
  );
}
