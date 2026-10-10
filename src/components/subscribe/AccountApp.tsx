'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Meter from '@/components/house/Meter';
import Glyph from '@/components/list/Glyph';
import Toast from '@/components/shell/Toast';
import { toDataError } from '@/lib/data/errors';
import type { MyAccount, OwnedHouse, PinView, RegionContext, SubscriptionPrefs } from '@/lib/data/types';
import { pickGlyph } from '@/lib/maps/glyphs';
import { applySeason } from '@/lib/theme/applySeason';
import { powerKind } from '@/lib/votes/meter';
import {
  accountsAvailable,
  DELETE_WORD,
  deleteReady,
  draftFrom,
  houseView,
  NOTE_MAX,
  noteProblem,
  ownerActionMessage,
  pendingClaim,
  pendingRemoval,
  prefsChanged,
  searchHouses,
  splitAddress,
  toggleTopic,
} from './accountState';
import { subscribeApi, type SubscribeApi } from './api';
import EmailSignIn from './EmailSignIn';
import { saveMessage, summary } from './flow';
import { ByeGlyph, ChoicePicker, PageShell } from './parts';
import './subscribe.css';

type Phase = 'loading' | 'unavailable' | 'signin' | 'ready' | 'deleted' | 'error';

export default function AccountApp() {
  const [api, setApi] = useState<SubscribeApi | null>(null);
  const [ctx, setCtx] = useState<RegionContext | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [acct, setAcct] = useState<MyAccount | null>(null);
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const load = useCallback(async (a: SubscribeApi) => {
    try {
      if ((await a.sessionKind()) !== 'user') return setPhase('signin');
      setAcct(await a.getMyAccount());
      setPhase('ready');
    } catch (e) {
      const code = toDataError(e).code;
      setPhase(code === 'not_signed_in' ? 'signin' : 'error');
    }
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const a = await subscribeApi();
      if (!live) return;
      setApi(a);
      // C9 pages-first deploy: without the database's `subscribe` capability (an older database, or the context call
      // failed) accounts do not exist yet. Make no auth or account calls at all.
      let c: RegionContext | null = null;
      try {
        c = await a.regionContext();
      } catch {
        c = null;
      }
      if (!live) return;
      if (c) {
        applySeason(c.season);
        setCtx(c);
      }
      if (!accountsAvailable(c)) return setPhase('unavailable');
      await load(a);
    })();
    return () => {
      live = false;
    };
  }, [load]);

  const refresh = async () => {
    if (!api) return;
    try {
      setAcct(await api.getMyAccount());
    } catch (e) {
      say(ownerActionMessage(toDataError(e).code));
    }
  };

  let body;
  if (phase === 'loading' || !api) {
    body = (
      <p className="sb-lede" role="status">
        Loading your account…
      </p>
    );
  } else if (phase === 'unavailable') {
    body = (
      <section className="sb-card">
        <h2>Accounts aren’t available yet</h2>
        <p className="m">Check back soon. The map works as usual.</p>
        <Link className="btn primary" href="/">
          Back to the map
        </Link>
      </section>
    );
  } else if (phase === 'error') {
    body = (
      <section className="sb-card">
        <h2>We couldn’t load your account</h2>
        <p className="m">Check your connection and try again.</p>
        <button type="button" className="btn primary" onClick={() => void load(api)}>
          Try again
        </button>
      </section>
    );
  } else if (phase === 'deleted') {
    body = (
      <section className="sb-card big">
        <div className="sb-done">
          <span className="ic">
            <ByeGlyph />
          </span>
          <h3>Your account is deleted</h3>
          <p>We removed your email, your subscription and your requests. Houses you managed stay on the map with no manager.</p>
        </div>
        <Link className="btn primary" href="/">
          Back to the map
        </Link>
      </section>
    );
  } else if (phase === 'signin') {
    body = (
      <>
        <h1>My account</h1>
        <section className="sb-card">
          <h2>Sign in</h2>
          <p className="m">We’ll email you a link and a 6-digit code. No password.</p>
          <EmailSignIn api={api} idPrefix="acct" onSignedIn={() => void load(api)} />
        </section>
        <p className="sb-fine">
          New here? Signing in creates a free account. <Link href="/privacy/">Privacy</Link>
        </p>
      </>
    );
  } else if (acct) {
    body = (
      <>
        <h1>My account</h1>
        <div className="sb-who">
          <span>
            Signed in as <b>{acct.email}</b>
          </span>
          <button
            type="button"
            className="linkbtn"
            onClick={async () => {
              try {
                await api.signOutLocal();
              } catch {
                /* the local session is gone either way */
              }
              setAcct(null);
              setPhase('signin');
            }}
          >
            Sign out
          </button>
        </div>
        <SubscriptionCard api={api} acct={acct} regionSlug={ctx?.region.slug ?? acct.subscription?.regionSlug ?? null} onChanged={refresh} say={say} />
        {acct.houses.length === 0 ? (
          <section className="sb-card">
            <h2>My house</h2>
            <p className="m">
              No house in your account yet. Houses you add from a device where you’re signed in, or that you added just before you
              signed up, show up here.
            </p>
          </section>
        ) : (
          acct.houses.map((h) => (
            <HouseCard
              key={h.id}
              api={api}
              house={h}
              removalId={pendingRemoval(acct, h.id)?.id ?? null}
              season={ctx?.season ?? 'halloween'}
              onChanged={refresh}
              say={say}
            />
          ))
        )}
        <ClaimCard api={api} acct={acct} ctx={ctx} onChanged={refresh} say={say} />
        <DeleteCard api={api} email={acct.email} onDeleted={() => setPhase('deleted')} say={say} />
      </>
    );
  }

  return (
    <PageShell>
      {body}
      <Toast message={toast} />
    </PageShell>
  );
}

interface CardProps {
  api: SubscribeApi;
  onChanged(): Promise<void>;
  say(m: string): void;
}

function SubscriptionCard({ api, acct, regionSlug, onChanged, say }: CardProps & { acct: MyAccount; regionSlug: string | null }) {
  const sub = acct.subscription;
  const [draft, setDraft] = useState<SubscriptionPrefs>(() => draftFrom(sub));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (msg: string) => {
    if (!regionSlug) return setErr('Can’t reach the server. Check your connection.');
    setBusy(true);
    setErr('');
    try {
      await api.setSubscription(regionSlug, draft);
      await onChanged();
      say(msg);
    } catch (e) {
      setErr(saveMessage(toDataError(e).code));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.stopSubscription();
      await onChanged();
      say('Emails stopped');
    } catch (e) {
      setErr(saveMessage(toDataError(e).code));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (t: 'houses' | 'events') => {
    const next = toggleTopic(draft, t);
    if (next) setDraft(next);
    else say('Keep at least one, or use Stop emails');
  };

  return (
    <section className="sb-card">
      <div className="sb-card-h">
        <h2>Email updates</h2>
        {sub?.status === 'active' ? <span className="sb-pill ok">Active</span> : <span className="sb-pill mute">{sub ? 'Stopped' : 'Off'}</span>}
      </div>
      {sub?.status === 'stopped' && <p className="m">You won’t get any more digests. Pick what you want and start them again any time.</p>}
      {!sub && <p className="m">You’re not subscribed. Pick what you want to hear about.</p>}
      <ChoicePicker idPrefix="ac" compact value={draft} onToggle={toggle} onCadence={(c) => setDraft({ ...draft, cadence: c })} />
      {sub?.status === 'active' && <p className="sb-hint">You get {summary(sub)}.</p>}
      <p className="err" role="alert">
        {err}
      </p>
      <div className="actions">
        {sub?.status === 'active' ? (
          <>
            <button type="button" className="btn primary" disabled={busy || !prefsChanged(sub, draft)} onClick={() => void save('Saved')}>
              Save changes
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void stop()}>
              Stop emails
            </button>
          </>
        ) : (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save('Emails on')}>
            {sub ? 'Start emails again' : 'Start emails'}
          </button>
        )}
      </div>
    </section>
  );
}

function HouseCard({
  api,
  house: h,
  removalId,
  season,
  onChanged,
  say,
}: CardProps & { house: OwnedHouse; removalId: string | null; season: 'halloween' | 'christmas' }) {
  const v = houseView(h);
  const [mode, setMode] = useState<'idle' | 'remove'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const glyph = pickGlyph(h.id, season);
  const [street, town] = splitAddress(h.address);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      await onChanged();
      setMode('idle');
      setNote('');
      say(msg);
    } catch (e) {
      setErr(ownerActionMessage(toDataError(e).code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sb-card" aria-label={`My house: ${street}`}>
      <div className="sb-card-h">
        <h2>My house</h2>
        <span className={`sb-pill ${v.pill.tone}`}>{v.pill.text}</span>
      </div>
      <div className="sb-hh">
        <span className="g">
          <Glyph name={glyph} />
        </span>
        <div>
          <b>{street}</b>
          <span>{town}</span>
        </div>
      </div>
      <dl className="sb-stats">
        <div>
          <dt>Votes</dt>
          <dd>
            {h.votes.toLocaleString('en-US')} <Meter kind={powerKind(season, glyph)} votes={h.votes} photoCount={h.approvedPhotos} size="md" />
          </dd>
        </div>
        <div>
          <dt>Photos</dt>
          <dd>{h.approvedPhotos}</dd>
        </div>
      </dl>
      {mode === 'remove' ? (
        <div className="sb-inl">
          <p>
            <b>Ask us to take {street} off the map?</b> An admin removes it, with its votes and photos. You can add it again later, but
            it starts from zero.
          </p>
          <div className="sb-fld">
            <label htmlFor={`rm-${h.id}`}>Anything we should know? (optional)</label>
            <textarea
              className="field"
              id={`rm-${h.id}`}
              rows={3}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. We moved away this year."
            />
          </div>
          <p className="err" role="alert">
            {err}
          </p>
          <div className="actions">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setMode('idle')}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => {
                const p = noteProblem(note, false);
                if (p) return setErr(p);
                void run(() => api.requestHouseRemoval(h.id, note.trim() || null), 'Removal requested');
              }}
            >
              Request removal
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="actions">
            {(v.canHide || v.canUnhide) && (
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void run(() => api.setHouseVisibility(h.id, v.canUnhide), v.canUnhide ? 'Back on the map' : 'Hidden from the map')}
              >
                {v.canUnhide ? 'Unhide' : 'Hide'}
              </button>
            )}
            {v.canRequestRemoval ? (
              <button type="button" className="btn danger" disabled={busy} onClick={() => setMode('remove')}>
                Request removal
              </button>
            ) : (
              removalId && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(() => api.withdrawHouseClaim(removalId), 'Request withdrawn')}>
                  Withdraw removal request
                </button>
              )
            )}
          </div>
          <p className="err" role="alert">
            {err}
          </p>
          <p className="sb-hint">{v.note}</p>
        </>
      )}
      <p className="sb-hint">This is the listing you added. Managing it here doesn’t mean we checked who owns the property.</p>
    </section>
  );
}

function ClaimCard({ api, acct, ctx, onChanged, say }: CardProps & { acct: MyAccount; ctx: RegionContext | null }) {
  const pending = pendingClaim(acct);
  const [step, setStep] = useState<'idle' | 'search' | 'note'>('idle');
  const [q, setQ] = useState('');
  const [pins, setPins] = useState<PinView[] | null>(null);
  const [pick, setPick] = useState<PinView | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setStep('search');
    if (pins || !ctx) return;
    try {
      setPins(await api.listHouses(ctx.region.id));
    } catch {
      setPins([]);
      setErr('Can’t load the map’s houses right now. Try again in a minute.');
    }
  };
  const own = new Set(acct.houses.map((h) => h.id));
  const results = pins ? searchHouses(pins, q, own) : [];

  let inner;
  if (pending) {
    inner = (
      <>
        <div className="sb-card-h">
          <b>{splitAddress(pending.address)[0]}</b>
          <span className="sb-pill warn">Pending</span>
        </div>
        <p className="m">An admin checks each request, usually within a day. You can have one request open at a time.</p>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.withdrawHouseClaim(pending.id);
              await onChanged();
              say('Request withdrawn');
            } catch (e) {
              say(ownerActionMessage(toDataError(e).code));
            } finally {
              setBusy(false);
            }
          }}
        >
          Withdraw request
        </button>
      </>
    );
  } else if (step === 'idle') {
    inner = (
      <>
        <p className="m">Many houses came from the 2024 map with nobody managing them. If one is yours, ask to manage it. An admin checks each request.</p>
        <button type="button" className="btn ghost" disabled={!ctx} onClick={() => void start()}>
          Find my house
        </button>
      </>
    );
  } else if (step === 'search') {
    inner = (
      <>
        <div className="sb-fld">
          <label htmlFor="cl-q">Search by address</label>
          <input className="field" id="cl-q" type="search" autoComplete="off" placeholder="e.g. Old Signal" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="sb-res" aria-live="polite">
          {pins === null ? (
            <li className="empty">Loading houses…</li>
          ) : q.trim().length < 2 ? (
            <li className="empty">Type at least 2 letters of the street.</li>
          ) : results.length === 0 ? (
            <li className="empty">No house on this season’s map matches. Add it with the Add button instead.</li>
          ) : (
            results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPick(p);
                    setErr('');
                    setStep('note');
                  }}
                >
                  <span>{p.address}</span>
                  <small>Request</small>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="err" role="alert">
          {err}
        </p>
        <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setStep('idle')}>
          Cancel
        </button>
      </>
    );
  } else if (pick) {
    inner = (
      <>
        <div className="sb-sentto">
          <b>{pick.address}</b>
        </div>
        <div className="sb-fld">
          <label htmlFor="cl-note">How can we tell it’s yours?</label>
          <textarea
            className="field"
            id="cl-note"
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            aria-invalid={err ? true : undefined}
            placeholder="e.g. I put the lights up every year. Blue door, ghost on the roof."
            onChange={(e) => {
              setNote(e.target.value);
              setErr('');
            }}
          />
          <p className="err" role="alert">
            {err}
          </p>
          <p className="sb-hint sb-row2">
            <span>Only admins read this.</span>
            <span>
              {note.length} / {NOTE_MAX}
            </span>
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setStep('search')}>
            Back
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              const p = noteProblem(note);
              if (p) return setErr(p);
              setBusy(true);
              try {
                await api.requestHouseClaim(pick.id, note.trim());
                await onChanged();
                setStep('idle');
                setNote('');
                say('Request sent');
              } catch (e) {
                setErr(ownerActionMessage(toDataError(e).code));
              } finally {
                setBusy(false);
              }
            }}
          >
            Send request
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="sb-card">
      <h2>Is another house yours?</h2>
      {inner}
    </section>
  );
}

function DeleteCard({ api, email, onDeleted, say }: { api: SubscribeApi; email: string; onDeleted(): void; say(m: string): void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [err, setErr] = useState('');

  const del = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.deleteMyAccount();
      if (r === 'reauth') setReauth(true);
      else onDeleted();
    } catch (e) {
      const de = toDataError(e);
      setErr(
        de.code === 'forbidden'
          ? 'Admin accounts can’t be deleted here.'
          : de.detail === 'delete_unconfirmed'
            ? 'We couldn’t confirm the deletion yet. Tap Delete forever again. It’s safe to repeat.'
            : ownerActionMessage(de.code),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sb-card dz">
      <h2>Delete my account</h2>
      <p className="m">
        This deletes your email, your subscription and any requests. Houses you manage stay on the map with no manager. To take a
        house down, request removal first.
      </p>
      {!open ? (
        <button type="button" className="btn danger" onClick={() => setOpen(true)}>
          Delete my account…
        </button>
      ) : reauth ? (
        <div className="sb-inl">
          <p>
            <b>One more step.</b> For safety, confirm it’s you with a fresh code from your email.
          </p>
          <EmailSignIn
            api={api}
            idPrefix="del"
            fixedEmail={email}
            onSignedIn={() => {
              setReauth(false);
              say('Thanks. Tap Delete forever again.');
            }}
          />
        </div>
      ) : (
        <div className="sb-inl">
          <div className="sb-fld">
            <label htmlFor="d-type">Type {DELETE_WORD} to confirm</label>
            <input className="field" id="d-type" autoComplete="off" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <p className="err" role="alert">
            {err}
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setTyped('');
              }}
            >
              Cancel
            </button>
            <button type="button" className="btn danger" disabled={busy || !deleteReady(typed)} onClick={() => void del()}>
              {busy ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
