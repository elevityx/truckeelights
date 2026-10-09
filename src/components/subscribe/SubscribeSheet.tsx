'use client';

import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Sheet from '@/components/ui/Sheet';
import { XIcon } from '@/components/shell/Icons';
import { toDataError } from '@/lib/data/errors';
import type { RegionContext } from '@/lib/data/types';
import { subscribeApi, devSheetPreset, type SubscribeApi } from './api';
import {
  clearChoices,
  codeMessage,
  confirmRedirect,
  deviceAddedHouse,
  finishSubscription,
  initialSheet,
  reducer,
  saveChoices,
  saveMessage,
  sendCode,
  sendMessage,
  summary,
  type SheetState,
} from './flow';
import { CheckGlyph, ChoicePicker, CodeStep, SubBotCheck } from './parts';
import './subscribe.css';

interface Props {
  ctx: RegionContext;
  onClose(): void;
  /** From the post-add nudge: start with the account box checked. */
  account?: boolean;
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export default function SubscribeSheet({ ctx, onClose, account }: Props) {
  const [s, dispatch] = useReducer(reducer, undefined, () => initialSheet(account ?? false));
  const [api, setApi] = useState<SubscribeApi | null>(null);
  /** The signed-in account's email when a non-anonymous session already exists (no code needed). */
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [preset, setPreset] = useState<Partial<SheetState> | null>(null);
  const tokenRef = useRef('');

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => closeRef.current(), []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const a = await subscribeApi();
      const email = await a.sessionEmail();
      const p = await devSheetPreset();
      if (!live) return;
      setApi(a);
      setSignedIn(email);
      setPreset(p);
      // "Default checked if this device has added a house" (the nudge passes account=true explicitly).
      if (account === undefined && deviceAddedHouse(local)) dispatch({ type: 'account', account: true });
    })();
    return () => {
      live = false;
    };
  }, [account]);

  const view: SheetState = preset ? { ...s, ...preset } : s;
  const c = view.choices;
  const busy = view.step === 'sending' || view.step === 'verifying' || view.step === 'saving';

  const save = async (a: SubscribeApi) => {
    dispatch({ type: 'saving' });
    try {
      // Already signed in: never sign out after saving (the account box isn't shown).
      const r = await finishSubscription(a, ctx.region.slug, signedIn ? { ...s.choices, account: true } : s.choices);
      clearChoices(session);
      if (r.signedOut) setSignedIn(null);
      dispatch({ type: 'done', linked: r.linked });
    } catch (e) {
      dispatch({ type: 'saveFailed', message: saveMessage(toDataError(e).code) });
    }
  };

  const submit = () => {
    if (!api || preset) return;
    if (signedIn) {
      dispatch({ type: 'submit', signedIn: true });
      if (s.choices.houses || s.choices.events) void save(api);
      return;
    }
    // Keep the choices for the confirm page in case the person taps the emailed link instead (B2).
    saveChoices(session, s.choices);
    dispatch({ type: 'submit', signedIn: false });
  };

  const onToken = useCallback(
    (t: string) => {
      tokenRef.current = t;
      if (!api) return;
      dispatch({ type: 'token' });
    },
    [api],
  );

  // Turnstile passed: send the code (once per token).
  useEffect(() => {
    if (s.step !== 'sending' || !api || preset) return;
    let live = true;
    const token = tokenRef.current;
    tokenRef.current = '';
    void sendCode(api, s.email, token, confirmRedirect(window.location.origin, s.choices.account))
      .then(() => live && dispatch({ type: 'sent', at: Date.now() }))
      .catch((e) => {
        if (!live) return;
        const d = toDataError(e);
        dispatch({ type: 'sendFailed', code: d.code, message: sendMessage(d.code) });
      });
    return () => {
      live = false;
    };
  }, [s.step, s.email, s.choices.account, api, preset]);

  const verify = async () => {
    if (!api || preset) return;
    dispatch({ type: 'verify' });
    if (!/^\d{6}$/.test(s.code)) return;
    try {
      await api.verifyEmailCode(s.email, s.code);
    } catch (e) {
      const d = toDataError(e);
      dispatch({ type: 'verifyFailed', code: d.code, message: codeMessage(d.code) });
      return;
    }
    await save(api);
  };

  const title =
    view.step === 'done'
      ? c.account || signedIn
        ? 'You’re all set'
        : 'You’re subscribed'
      : view.step === 'bot' || view.step === 'sending'
        ? 'One quick check'
        : view.step === 'code' || view.step === 'verifying' || (view.step === 'saving' && view.sentAt !== null)
          ? 'Check your email'
          : 'Subscribe';

  let body;
  if (view.step === 'done') {
    const stayed = c.account || signedIn !== null;
    body = (
      <div className="sb-done">
        <span className="ic">
          <CheckGlyph />
        </span>
        <h3>{stayed ? 'Subscribed and signed in' : 'You’re subscribed'}</h3>
        <p>
          We’ll email {signedIn ?? view.email} about {summary(c)}.{' '}
          {stayed
            ? view.linked > 0
              ? `${view.linked === 1 ? 'The house you added is' : `The ${view.linked} houses you added are`} in your account now.`
              : 'You can manage your emails and your house from your account.'
            : 'Every email has links to change or stop it, no sign-in needed.'}
        </p>
        <div className="actions" style={{ width: '100%' }}>
          {stayed && (
            <Link className="btn primary" href="/account/">
              Go to my account
            </Link>
          )}
          <button type="button" className={stayed ? 'btn ghost' : 'btn primary'} onClick={close}>
            Back to the map
          </button>
        </div>
      </div>
    );
  } else if (view.step === 'bot' || view.step === 'sending') {
    body = (
      <div className="sb">
        <p className="sb-hint">This keeps bots from signing up strangers.</p>
        <SubBotCheck mock={api?.mock ?? false} onToken={onToken} onExpire={() => (tokenRef.current = '')} resetKey={view.captchaKey} />
        <p className="sb-hint" role="status">
          {view.step === 'sending' ? 'Sending your email…' : ''}
        </p>
      </div>
    );
  } else if (view.step === 'code' || view.step === 'verifying' || (view.step === 'saving' && view.sentAt !== null)) {
    body = (
      <CodeStep
        idPrefix="sub"
        email={view.email}
        code={view.code}
        onCode={(v) => dispatch({ type: 'code', code: v })}
        onVerify={() => void verify()}
        busy={busy}
        codeError={view.codeError}
        error={view.error}
        sentAt={view.sentAt}
        onResend={() => dispatch({ type: 'resend' })}
        onChangeEmail={() => dispatch({ type: 'changeEmail' })}
        confirmLabel={c.account ? 'Confirm and sign in' : 'Confirm'}
      />
    );
  } else {
    body = (
      <form
        className="sb"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ChoicePicker
          idPrefix="sub"
          value={c}
          topicsError={view.topicsError}
          onToggle={(t) => dispatch({ type: 'toggle', topic: t })}
          onCadence={(cad) => dispatch({ type: 'cadence', cadence: cad })}
        />
        {signedIn ? (
          <p className="sb-sentto">
            Signed in as <b>{signedIn}</b>
          </p>
        ) : (
          <>
            <div className="sb-fld">
              <label htmlFor="sub-email">Email</label>
              <input
                className="field"
                id="sub-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                maxLength={254}
                value={view.email}
                aria-invalid={view.emailError ? true : undefined}
                aria-describedby="sub-email-err"
                onChange={(e) => dispatch({ type: 'email', email: e.target.value })}
              />
              <p className="err" id="sub-email-err" role="alert">
                {view.emailError}
              </p>
            </div>
            <label className="sb-ck" htmlFor="sub-acct">
              <input id="sub-acct" type="checkbox" checked={c.account} onChange={(e) => dispatch({ type: 'account', account: e.target.checked })} />
              <span>
                <b>Also create an account to manage my house</b>
                <small>
                  {deviceAddedHouse(local)
                    ? 'You added a house from this device. With an account you can see its votes, hide it for a while, or ask us to take it down.'
                    : 'Stay signed in on this device so you can ask to manage a house later.'}
                </small>
              </span>
            </label>
          </>
        )}
        <p className="err" role="alert">
          {view.error}
        </p>
        <button type="submit" className="btn primary" disabled={!api || busy}>
          {view.step === 'saving' ? (
            <>
              <span className="sb-spin" aria-hidden="true" /> Saving…
            </>
          ) : signedIn ? (
            'Save'
          ) : (
            'Subscribe'
          )}
        </button>
        <p className="sb-fine">
          We’ll only email you about new houses and events. Unsubscribe anytime. <Link href="/privacy/">Privacy</Link>
        </p>
      </form>
    );
  }

  return (
    <Sheet label="Subscribe" onClose={close} tall>
      <div className="sheet-in">
        <div className="sheet-h">
          <div>
            <p className="eyebrow">Email updates</p>
            <h2 className="disp">{title}</h2>
          </div>
          <button type="button" className="iconbtn x" aria-label="Close subscribe" onClick={close}>
            <XIcon />
          </button>
        </div>
        <div className="sec">{body}</div>
      </div>
    </Sheet>
  );
}
