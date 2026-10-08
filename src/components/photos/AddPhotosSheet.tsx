'use client';

// Owner: WP-B. Visitor photo upload: pick up to 3, resize in the browser, reserve → upload → confirm.
import { useEffect, useReducer, useRef, useState, type ChangeEvent } from 'react';
import BotCheck from '@/components/add/BotCheck';
import Glyph from '@/components/list/Glyph';
import Sheet from '@/components/ui/Sheet';
import { CamIcon, XIcon } from '@/components/shell/Icons';
import { DataError, toDataError, userMessage, type DataErrorCode, type PinView, type RegionContext } from '@/lib/data';
import { firstSegment } from '@/lib/text/address';
import { photosApi, type PhotosApi } from './api';
import { initialState, isFinal, isPickable, MAX_PER_BATCH, overallPct, reducer, sentItems, takeUpTo, type Item } from './flow';
import '@/components/house/photos.css';

interface Props {
  ctx: RegionContext;
  house: PinView;
  onClose(): void;
  onDone(): void;
}

function size(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function caption(it: Item, uploading: boolean): string {
  switch (it.stage) {
    case 'resizing':
      return 'Shrinking…';
    case 'uploading':
      return 'Uploading…';
    case 'done':
      return 'Sent';
    case 'failed':
      return it.error === 'invalid_image' ? 'Couldn’t read it' : 'Not sent';
    default:
      return uploading ? 'Waiting' : size(it.file.size);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function AddPhotosSheet({ ctx, house, onClose, onDone }: Props) {
  const [s, dispatch] = useReducer(reducer, initialState);
  const [api, setApi] = useState<PhotosApi | null>(null);
  const [session, setSession] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const urls = useRef(new Set<string>());
  const halloween = ctx.season === 'halloween';
  const address = firstSegment(house.address);
  const msg = (code: DataErrorCode) => userMessage(new DataError(code), ctx.region.name);

  useEffect(() => {
    let live = true;
    void photosApi().then(async (a) => {
      if (!live) return;
      setApi(a);
      const ok = await a.hasSession().catch(() => false);
      if (live) setSession(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  // Revoke every preview URL when the sheet goes away.
  useEffect(() => {
    const set = urls.current;
    return () => {
      set.forEach((u) => URL.revokeObjectURL(u));
      set.clear();
    };
  }, []);

  const revoke = (u: string) => {
    URL.revokeObjectURL(u);
    urls.current.delete(u);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].filter(isPickable);
    e.target.value = ''; // picking the same file again still fires change
    const { kept, dropped } = takeUpTo(s.items.length, files);
    const add = kept.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return { file, url };
    });
    dispatch({ type: 'add', files: add, dropped });
  };

  const remove = (it: Item) => {
    revoke(it.url);
    dispatch({ type: 'remove', id: it.id });
  };

  const upload = async () => {
    if (!api || !s.items.length || s.phase !== 'pick') return;
    dispatch({ type: 'start' });
    try {
      if (!(await api.hasSession())) await api.ensureAnonymousSession(token);
      setSession(true);
    } catch (e) {
      const err = toDataError(e);
      if (err.code === 'captcha_failed') setToken('');
      dispatch({ type: 'fail', code: err.code });
      setSession(await api.hasSession().catch(() => false));
      return;
    }
    try {
      const result = await api.addPhotos(
        house.id,
        s.items.map((it) => it.file),
        (p) => dispatch({ type: 'progress', p }),
      );
      dispatch({ type: 'finish', result });
    } catch (e) {
      dispatch({ type: 'fail', code: toDataError(e).code });
    }
  };

  const retry = () => {
    sentItems(s).forEach((it) => revoke(it.url));
    dispatch({ type: 'retry' });
  };

  const n = s.items.length;
  const full = n >= MAX_PER_BATCH;
  const uploading = s.phase === 'uploading';
  const needToken = session === false;
  const canUpload = !!api && n > 0 && session !== null && (!needToken || token !== '');
  const pct = overallPct(s.items);
  const current = s.items.findIndex((it) => it.stage === 'resizing' || it.stage === 'uploading');

  const previews = n > 0 && (
    <ul className="previews" aria-label="Selected photos">
      {s.items.map((it, i) => (
        <li key={it.id} data-stage={uploading && it.stage === 'ready' ? 'waiting' : it.stage}>
          <div className="pv">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
            <img src={it.url} alt={`Selected photo ${i + 1}`} />
            {s.phase === 'pick' && (
              <button type="button" className="rm" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(it)}>
                <XIcon />
              </button>
            )}
            {uploading && it.stage !== 'ready' && <span className="pv-badge" aria-hidden="true" />}
          </div>
          <p className="cap">{caption(it, uploading)}</p>
        </li>
      ))}
    </ul>
  );

  let body;
  if (!ctx.photosOpen) {
    body = (
      <div className="result">
        <p>{msg('photos_closed')}</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Back to the house
          </button>
        </div>
      </div>
    );
  } else if (s.phase === 'result' && s.outcome) {
    const o = s.outcome;
    const thanks = o.kind === 'thanks' || o.kind === 'partial';
    body = (
      <div className="result ph-result" data-kind={o.kind}>
        {thanks && (
          <>
            <span className="ph-hero" aria-hidden="true">
              <Glyph name={halloween ? 'ghost' : 'tree'} />
            </span>
            <p className="disp">{halloween ? 'Eeek, thanks!' : 'Thank you!'}</p>
            <p>Photos appear after a quick review.</p>
          </>
        )}
        {o.kind === 'partial' && (
          <p className="fine">
            {plural(o.failed, 'photo')} didn’t upload. {msg(o.code)}
          </p>
        )}
        {o.kind === 'overcap' && (
          <>
            <p className="ph-lead">This house has lots of photos waiting for review. Try again later.</p>
            {o.pending > 0 && <p className="fine">{plural(o.pending, 'photo')} of yours made it in and will appear after review.</p>}
          </>
        )}
        {o.kind === 'failed' && (
          <p className="ph-lead" role="alert">
            {msg(o.code)}
          </p>
        )}
        <div className="actions">
          {(o.kind === 'failed' || o.kind === 'partial') && !isFinal(o.code) && (
            <button type="button" className={o.kind === 'failed' ? 'btn primary' : 'btn ghost'} onClick={retry}>
              Try again
            </button>
          )}
          <button
            type="button"
            className={o.kind === 'failed' && !isFinal(o.code) ? 'btn ghost' : 'btn primary'}
            onClick={o.kind === 'failed' ? onClose : onDone}
          >
            Back to the house
          </button>
        </div>
      </div>
    );
  } else if (uploading) {
    body = (
      <>
        <p className="ph-intro">
          Uploading {plural(n, 'photo')}… {halloween ? 'quieter than the old jail at midnight.' : 'faster than the chair up the summit.'}
        </p>
        <div className="prog" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="sr-only" role="status">
          {current >= 0 ? `Photo ${current + 1} of ${n}: ${caption(s.items[current], true)}` : ''}
        </p>
        {previews}
      </>
    );
  } else {
    body = (
      <>
        <p className="ph-intro">Up to {MAX_PER_BATCH} photos. We shrink each one before it uploads.</p>
        {n === 0 ? (
          <label className="dropzone">
            <span className="dz-icon" aria-hidden="true">
              <CamIcon />
            </span>
            <span className="btn alt" aria-hidden="true">
              Choose photos
            </span>
            <span className="fine">From your camera roll or files</span>
            <input type="file" accept="image/*" multiple onChange={onPick} aria-label={`Choose up to ${MAX_PER_BATCH} photos`} />
          </label>
        ) : (
          <>
            {previews}
            {!full && (
              <span className="filepick">
                <span className="btn ghost" aria-hidden="true">
                  <CamIcon />
                  Add another
                </span>
                <input type="file" accept="image/*" multiple onChange={onPick} aria-label={`Add up to ${MAX_PER_BATCH - n} more`} />
              </span>
            )}
          </>
        )}
        {s.dropped > 0 && (
          <p className="fine" role="status">
            Up to {MAX_PER_BATCH} at a time, so we left out {plural(s.dropped, 'photo')}.
          </p>
        )}
        {needToken && n > 0 && (
          <>
            <p className="fine">One quick check that you’re a person. We ask once per visit.</p>
            <BotCheck onToken={setToken} onExpire={() => setToken('')} resetKey={s.captchaKey} />
          </>
        )}
        <p className="err" role="alert">
          {s.error ? msg(s.error) : ''}
        </p>
        <div className="actions">
          <button type="button" className="btn primary" disabled={!canUpload} onClick={() => void upload()}>
            <CamIcon />
            {n ? `Upload ${plural(n, 'photo')}` : 'Upload photos'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  return (
    <Sheet label="Add photos" onClose={onClose}>
      <div className="sheet-in ph-sheet">
        <div className="sheet-h">
          <div>
            <p className="eyebrow">Add photos</p>
            <h2 className="addr">{address}</h2>
          </div>
          <button type="button" className="iconbtn x" aria-label="Close add photos" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="sec">{body}</div>
      </div>
    </Sheet>
  );
}
