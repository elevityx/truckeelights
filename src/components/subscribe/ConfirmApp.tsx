'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toDataError } from '@/lib/data/errors';
import type { DataErrorCode } from '@/lib/data/types';
import { subscribeApi, type SubscribeApi } from './api';
import {
  clearChoices,
  clearNext,
  confirmNext,
  finishSubscription,
  nextFor,
  parseConfirm,
  readChoices,
  saveMessage,
  type Choices,
  type ConfirmParams,
} from './flow';
import { CheckGlyph, ChoicePicker, MailGlyph, PageShell } from './parts';
import './subscribe.css';

type View =
  | { k: 'loading' }
  | { k: 'invalid' }
  | { k: 'ready'; busy: boolean; error: string }
  | { k: 'choices'; choices: Choices; topicsError: boolean; busy: boolean; error: string }
  | { k: 'email_changed' }
  | { k: 'going'; to: string };

const session = () => window.sessionStorage;

function linkMessage(code: DataErrorCode): string {
  switch (code) {
    case 'token_expired':
    case 'token_invalid':
    case 'auth_failed':
      return 'This link has expired or was already used. Ask for a new email from your account page, or use the code from the newest email.';
    case 'rate_limited':
      return 'Too many tries. Wait a minute, then try again.';
    case 'network':
      return 'Can’t reach the server. Check your connection.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/**
 * `/auth/confirm/?token_hash=…&type=…&next=…` (B1, C3). Nothing is verified on load: email scanners open
 * links, so the person taps Confirm. Each `type` has its own branch; anything else is an error page.
 */
export default function ConfirmApp() {
  const [api, setApi] = useState<SubscribeApi | null>(null);
  const [p, setP] = useState<ConfirmParams | null>(null);
  const [view, setView] = useState<View>({ k: 'loading' });

  useEffect(() => {
    let live = true;
    void subscribeApi().then((a) => {
      if (!live) return;
      const parsed = parseConfirm(window.location.search);
      setApi(a);
      setP(parsed);
      setView(parsed.ok ? { k: 'ready', busy: false, error: '' } : { k: 'invalid' });
    });
    return () => {
      live = false;
    };
  }, []);

  const go = (to: string) => {
    setView({ k: 'going', to });
    window.location.replace(to);
  };

  const save = async (a: SubscribeApi, choices: Choices, next: string | null) => {
    const ctx = await a.regionContext();
    await finishSubscription(a, ctx.region.slug, choices);
    clearChoices(session);
    clearNext(session);
    go(nextFor(choices, next));
  };

  const confirm = async () => {
    if (!api || !p?.ok) return;
    setView({ k: 'ready', busy: true, error: '' });
    try {
      await api.verifyLinkToken(p.tokenHash, p.type);
    } catch (e) {
      setView({ k: 'ready', busy: false, error: linkMessage(toDataError(e).code) });
      return;
    }
    if (p.branch === 'recovery') return go('/admin/'); // C3: admins only; /admin/ asks for TOTP, then has the password form
    if (p.branch === 'email_change') return setView({ k: 'email_changed' });
    // Sign-in: save the choices kept by the Subscribe sheet in this browser (B2). The templates' links carry no
    // `next`, so fall back to the one the sending page recorded in this browser (the account page's sign-in).
    const stored = readChoices(session);
    const next = confirmNext(p.next, session);
    try {
      if (stored) return await save(api, stored, next);
      // A sign-in from /account/ in this browser: link this device's houses (B3), then land on the account page.
      if (next === '/account/') {
        await api.completeHouseLink().catch(() => 0);
        clearNext(session);
        return go('/account/');
      }
      // Opened in another browser, or a plain sign-in: an existing subscription needs nothing more.
      const acct = await api.getMyAccount();
      if (acct.subscription) return go(next ?? '/account/');
      setView({
        k: 'choices',
        choices: { houses: true, events: true, cadence: 'daily', account: next !== '/subscribed/' },
        topicsError: false,
        busy: false,
        error: '',
      });
    } catch (e) {
      setView({ k: 'ready', busy: false, error: saveMessage(toDataError(e).code) });
    }
  };

  const saveChoicesHere = async () => {
    if (!api || view.k !== 'choices' || !p?.ok) return;
    const c = view.choices;
    if (!c.houses && !c.events) return setView({ ...view, topicsError: true });
    setView({ ...view, busy: true, error: '' });
    try {
      await save(api, c, confirmNext(p.next, session));
    } catch (e) {
      setView({ ...view, busy: false, error: saveMessage(toDataError(e).code) });
    }
  };

  let body;
  if (view.k === 'invalid') {
    body = (
      <section className="sb-card big">
        <div className="sb-done">
          <span className="ic">
            <MailGlyph />
          </span>
          <h3>This link doesn’t work</h3>
          <p>It may be cut off or from an old email. Open the newest email from us, or ask for a new one.</p>
        </div>
        <div className="actions">
          <Link className="btn primary" href="/account/">
            Sign in with email
          </Link>
          <Link className="btn ghost" href="/">
            See the map
          </Link>
        </div>
      </section>
    );
  } else if (view.k === 'email_changed') {
    body = (
      <section className="sb-card big">
        <div className="sb-done">
          <span className="ic">
            <CheckGlyph />
          </span>
          <h3>Email updated</h3>
          <p>Your account uses the new address from now on.</p>
        </div>
        <Link className="btn primary" href="/account/">
          Go to my account
        </Link>
      </section>
    );
  } else if (view.k === 'choices') {
    const c = view.choices;
    const set = (patch: Partial<Choices>) => setView({ ...view, choices: { ...c, ...patch }, topicsError: false });
    body = (
      <section className="sb-card">
        <h2>You’re signed in. What should we send?</h2>
        <p className="m">Your choices from the other browser didn’t come along, so pick them again.</p>
        <ChoicePicker
          idPrefix="cf"
          value={c}
          topicsError={view.topicsError}
          onToggle={(t) => set({ [t]: !c[t] })}
          onCadence={(cad) => set({ cadence: cad })}
        />
        <label className="sb-ck" htmlFor="cf-acct">
          <input id="cf-acct" type="checkbox" checked={c.account} onChange={(e) => set({ account: e.target.checked })} />
          <span>
            <b>Stay signed in on this device</b>
            <small>To manage your house later. Unchecked, every email still has links to change or stop it.</small>
          </span>
        </label>
        <p className="err" role="alert">
          {view.error}
        </p>
        <button type="button" className="btn primary" disabled={view.busy} onClick={() => void saveChoicesHere()}>
          {view.busy ? 'Saving…' : 'Save'}
        </button>
        <Link className="linkbtn" href="/account/" style={{ alignSelf: 'center' }}>
          Skip, just sign me in
        </Link>
      </section>
    );
  } else {
    const busy = view.k === 'loading' || view.k === 'going' || (view.k === 'ready' && view.busy);
    const kind = p?.ok ? p.branch : 'signin';
    body = (
      <>
        <section className="sb-card big">
          <div className="sb-done">
            <span className="ic">
              <MailGlyph />
            </span>
            <h3>{kind === 'email_change' ? 'Confirm your new email' : kind === 'recovery' ? 'Reset the admin password' : 'Confirm your email'}</h3>
            <p>
              {kind === 'recovery'
                ? 'Password reset is for site admins only. After you confirm, the admin page asks for your 2FA code.'
                : 'Tap Confirm to finish. This extra tap stops email scanners from using your link before you do.'}
            </p>
          </div>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>
            {busy ? (
              <>
                <span className="sb-spin" aria-hidden="true" /> {view.k === 'going' ? 'Opening…' : 'Confirming…'}
              </>
            ) : (
              'Confirm'
            )}
          </button>
          {view.k === 'ready' && view.error && (
            <p className="sb-err-box" role="alert">
              {view.error}
            </p>
          )}
        </section>
        <p className="sb-fine">If you didn’t ask for this, close this page. Nothing happens until someone taps Confirm.</p>
      </>
    );
  }

  return <PageShell>{body}</PageShell>;
}
