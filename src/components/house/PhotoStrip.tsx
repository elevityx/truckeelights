'use client';

// Owner: WP-B. Approved photos of a house (signed URLs from the photo-urls signer) + the lightbox.
import { useEffect, useState } from 'react';
import { photosApi } from '@/components/photos/api';
import type { HousePhoto } from '@/lib/data/types';
import Lightbox, { type LightboxVote } from './Lightbox';
import './photos.css';

interface Props {
  houseId: string;
  refreshKey: number;
  /** Address first segment, for alt text ("Photo 2 of 10102 Donner Pass Rd"). */
  address?: string;
  /** Votes on: the lightbox shows a heart that votes for the house. */
  vote?: LightboxVote;
}

/** Thumbnails shown in the sheet; the last one opens the rest in the lightbox. */
const SHOWN = 6;

type Load = { key: string; state: 'loading' } | { key: string; state: 'error' } | { key: string; state: 'ok'; photos: HousePhoto[] };

export default function PhotoStrip({ houseId, refreshKey, address, vote }: Props) {
  const key = `${houseId}:${refreshKey}`;
  const [load, setLoad] = useState<Load>({ key, state: 'loading' });
  const [open, setOpen] = useState<{ i: number; from: HTMLElement } | null>(null);
  const where = address || 'this house';

  useEffect(() => {
    let live = true;
    photosApi()
      .then((api) => api.listHousePhotos(houseId))
      .then(
        (photos) => live && setLoad({ key, state: 'ok', photos }),
        () => live && setLoad({ key, state: 'error' }),
      );
    return () => {
      live = false;
    };
  }, [houseId, key]);

  // A new house or refresh shows the skeleton until its own answer arrives.
  if (load.key !== key || load.state === 'loading') {
    return (
      <div className="strip strip-skel" role="status" aria-label="Loading photos">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (load.state === 'error') return <p className="nophotos">Photos couldn’t load.</p>;
  if (!load.photos.length) return <p className="nophotos">No photos yet.</p>;

  const photos = load.photos;
  return (
    <>
      <ul className="strip" aria-label={`Photos (${photos.length})`}>
        {photos.slice(0, SHOWN).map((p, i) => {
          const more = i === SHOWN - 1 && photos.length > SHOWN ? photos.length - i : 0;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-label={more ? `Open photo ${i + 1} and ${more - 1} more` : `Open photo ${i + 1} of ${photos.length}`}
                onClick={(e) => setOpen({ i, from: e.currentTarget })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs; static export has no image optimizer */}
                <img src={p.url} alt={`Photo ${i + 1} of ${where}`} loading="lazy" decoding="async" />
                {more > 0 && (
                  <span className="more" aria-hidden="true">
                    +{more}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <Lightbox photos={photos} start={open.i} address={where} returnFocus={open.from} onClose={() => setOpen(null)} vote={vote} />
      )}
    </>
  );
}
