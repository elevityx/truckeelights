'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toDataError } from '@/lib/data/errors';
import { tokenExpired, tokenPurpose, type LinkPrefs, type LinkPurpose } from '@/lib/data/emailLinks';
import type { DataErrorCode, SubscriptionPrefs } from '@/lib/data/types';
import { toggleTopic } from './accountState';
import { subscribeApi, type SubscribeApi } from './api';
import { summary } from './flow';
import { ByeGlyph, ChoicePicker, PageShell } from './parts';
import './subscribe.css';

type View =
  | { k: 'loading' }
  | { k: 'bad'; code: DataErrorCode }
  /** `prefs` is null for an unsub link: those can stop emails but can't read or change choices. */
  | { k: 'ready'; prefs: LinkPrefs | null }
  | { k: 'stopped' };

function linkError(code: DataErrorCode): string {
  if (code === 'token_expired') return 'This settings link has expired. Every new email has a fresh one.';
  if (code === 'network') return 'Can’t reach the server. Check your connection, then reload this page.';
  return 'This link isn’t valid anymore. Use the newest email from us, or sign in to your account.';
}

/**
 * `/unsubscribe/?t=…` (B8). Opening the page changes nothing; Stop emails is a POST. A `prefs` link also lets the
 * person change topics and cadence, with no sign-in. Gmail and Apple Mail use the one-click header instead.
 */
export default function UnsubscribeApp() {
  const [api, setApi] = useState<SubscribeApi | null>(null);
  const [t, setT] = useState('');
  const [purpose, setPurpose] = useState<LinkPurpose | null>(null);
  const [view, setView] = useState<View>({ k: 'loading' });
  const [draft, setDraft] = useState<SubscriptionPrefs>({ houses: true, events: true, cadence: 'daily' });
  const [showPrefs, setShowPrefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      const a = await subscribeApi();
      const token = new URLSearchParams(window.location.search).get('t') ?? '';
      const p = tokenPurpose(token);
      if (!live) return;
      setApi(a);
      setT(token);
      setPurpose(p);
      if (!p) return setView({ k: 'bad', code: 'token_invalid' });
      if (p && tokenExpired(token, Date.now())) return setView({ k: 'bad', code: 'token_expired' });
      if (p === 'unsub') return setView({ k: 'ready', prefs: null });
      try {
        const prefs = await a.readLinkPrefs(token);
        if (!live) return;
        setDraft({ houses: prefs.houses, events: prefs.events, cadence: prefs.cadence });
        setView(prefs.status === 'stopped' ? { k: 'stopped' } : { k: 'ready', prefs });
      } catch (e) {
        if (live) setView({ k: 'bad', code: toDataError(e).code });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const stop = async () => {
    if (!api) return;
    setBusy(true);
    setMsg('');
    try {
      await api.stopByLink(t);
      setView({ k: 'stopped' });
    } catch (e) {
      setMsg(linkError(toDataError(e).code));
    } finally {
      setBusy(false);
    }
  };
  const savePrefs = async () => {
    if (!api) return;
    setBusy(true);
    setMsg('');
    try {
      const prefs = await api.savePrefsByLink(t, draft);
      setView({ k: 'ready', prefs });
      setMsg('Saved. The next email follows these settings.');
    } catch (e) {
      setMsg(linkError(toDataError(e).code));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (view.k === 'loading') {
    body = (
      <p className="sb-lede" role="status">
        Loading your email settings…
      </p>
    );
  } else if (view.k === 'bad') {
    body = (
      <section className="sb-card big">
        <div className="sb-done">
          <span className="ic">
            <ByeGlyph />
          </span>
          <h3>This link doesn’t work</h3>
          <p>{linkError(view.code)}</p>
        </div>
        <Link className="btn primary" href="/account/">
          Sign in to manage emails
        </Link>
      </section>
    );
  } else if (view.k === 'stopped') {
    body = (
      <section className="sb-card big">
        <div className="sb-done">
          <span className="ic">
            <ByeGlyph />
          </span>
          <h3>You’re unsubscribed</h3>
          <p>No more digests to this address. Changed your mind? Subscribe again from the map, any time.</p>
        </div>
        <Link className="btn primary" href="/">
          Back to the map
        </Link>
      </section>
    );
  } else {
    const canPrefs = purpose === 'prefs';
    body = (
      <>
        <h1>Email settings</h1>
        <p className="sb-lede">No sign-in needed. This link only works for the address it was sent to.</p>
        <section className="sb-card">
          <h2>Stop emails?</h2>
          <p className="m">{view.prefs ? `You get ${summary(view.prefs)}.` : 'You get the Truckee Lights digest of new houses and events.'}</p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void stop()}>
            {busy && !showPrefs ? 'Stopping…' : 'Stop emails'}
          </button>
          {canPrefs && !showPrefs && (
            <button type="button" className="linkbtn" style={{ alignSelf: 'center' }} onClick={() => setShowPrefs(true)}>
              Change what I get instead
            </button>
          )}
        </section>
        {canPrefs && showPrefs && (
          <section className="sb-card">
            <h2>Change what I get</h2>
            <ChoicePicker
              idPrefix="un"
              compact
              value={draft}
              onToggle={(k) => {
                const n = toggleTopic(draft, k);
                if (n) setDraft(n);
                else setMsg('Keep at least one, or use Stop emails.');
              }}
              onCadence={(c) => setDraft({ ...draft, cadence: c })}
            />
            <button type="button" className="btn primary" disabled={busy} onClick={() => void savePrefs()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </section>
        )}
        <p className="sb-hint" role="status" style={{ textAlign: 'center' }}>
          {msg}
        </p>
        <p className="sb-fine">Gmail’s own Unsubscribe button stops emails in one tap without opening this page.</p>
      </>
    );
  }

  return <PageShell>{body}</PageShell>;
}
