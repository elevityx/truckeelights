'use client';

import { useEffect, useRef } from 'react';
import type { Controller } from './vibes';

/** The Both view's top section when the widget is on. */
export function VibesUpcoming({ controller, onAdd, onSeeAll }: { controller: Controller | null; onAdd?: () => void; onSeeAll(): void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controller || !mountRef.current) return;
    return controller.mountUpcoming(mountRef.current, { onAdd, onSeeAll });
  }, [controller, onAdd, onSeeAll]);
  return <div ref={mountRef} data-tv-upcoming="" />;
}
