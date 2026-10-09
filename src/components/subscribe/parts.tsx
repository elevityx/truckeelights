'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import BotCheck from '@/components/add/BotCheck';
import type { SubscriptionCadence, SubscriptionPrefs } from '@/lib/data/types';
import { resendLeft } from './flow';

/** New houses / New events (at least one) and Daily / Weekly. */
export function ChoicePicker({
  value,
  onToggle,
  onCadence,
  topicsError = false,
  compact = false,
  idPrefix,
}: {
  value: SubscriptionPrefs;
  onToggle(t: 'houses' | 'events'): void;
  onCadence(c: SubscriptionCadence): void;
  topicsError?: boolean;
  compact?: boolean;
  idPrefix: string;
}) {
  return (
    <>
      <div className="sb-fld">
        <span className="lbl" id={`${idPrefix}-what`}>
          What should we send?
        </span>
        <div className="sb-tog" role="group" aria-labelledby={`${idPrefix}-what`}>
          <button type="button" aria-pressed={value.houses} onClick={() => onToggle('houses')}>
            <b>
              <span className="bx" />
              New houses
            </b>
            {!compact && <small>Just added to the map</small>}
          </button>
          <button type="button" aria-pressed={value.events} onClick={() => onToggle('events')}>
            <b>
              <span className="bx" />
              New events
            </b>
            {!compact && <small>Parties, tours, lightings</small>}
          </button>
        </div>
        <p className="err" role="alert">
          {topicsError ? 'Pick at least one.' : ''}
        </p>
      </div>
      <div className="sb-fld">
        <span className="lbl" id={`${idPrefix}-often`}>
          How often?
        </span>
        <div className="sb-tog radio" role="group" aria-labelledby={`${idPrefix}-often`}>
          <button type="button" aria-pressed={value.cadence === 'daily'} onClick={() => onCadence('daily')}>
            <b>
              <span className="bx" />
              Daily
            </b>
            <small>{compact ? 'About 6 pm' : 'About 6 pm, only on days with news'}</small>
          </button>
          <button type="button" aria-pressed={value.cadence === 'weekly'} onClick={() => onCadence('weekly')}>
            <b>
              <span className="bx" />
              Weekly
            </b>
            <small>Thursdays</small>
          </button>
        </div>
      </div>
    </>
  );
}

/** Turnstile (the add flow's BotCheck), or a stand-in in the dev mock. */
export function SubBotCheck({ mock, onToken, onExpire, resetKey }: { mock: boolean; onToken(t: string): void; onExpire(): void; resetKey: number }) {
  if (mock) return <MockBotCheck key={resetKey} onToken={onToken} />;
  return <BotCheck onToken={onToken} onExpire={onExpire} resetKey={resetKey} />;
}

function MockBotCheck({ onToken }: { onToken(t: string): void }) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setOk(true), 900);
    const b = setTimeout(() => onToken('mock-token'), 1400);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [onToken]);
  return (
    <div className="sb-mockbot" role="status">
      {ok ? <span className="ok">✓</span> : <span className="sb-spin" />}
      <span>{ok ? 'Success!' : 'Verifying you’re human…'}</span>
      <span className="brand">
        Bot check
        <br />
        (dev stand-in)
      </span>
    </div>
  );
}

/** Ticks once a second while Resend is locked. */
export function useResendLeft(sentAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const left = resendLeft(sentAt, now);
  useEffect(() => {
    if (sentAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sentAt]);
  return left;
}

/** "Check your email": the 6-digit code, Confirm, Resend (after 60 s) and Use a different email. */
export function CodeStep({
  email,
  code,
  onCode,
  onVerify,
  busy,
  codeError,
  error,
  sentAt,
  onResend,
  onChangeEmail,
  confirmLabel = 'Confirm',
  idPrefix,
}: {
  email: string;
  code: string;
  onCode(v: string): void;
  onVerify(): void;
  busy: boolean;
  codeError: string;
  error: string;
  sentAt: number | null;
  onResend(): void;
  onChangeEmail?(): void;
  confirmLabel?: string;
  idPrefix: string;
}) {
  const left = useResendLeft(sentAt);
  return (
    <form
      className="sb"
      onSubmit={(e) => {
        e.preventDefault();
        onVerify();
      }}
    >
      <div className="sb-sentto">
        We sent a link and a 6-digit code to <b>{email}</b>. Tap the link, or type the code here.
      </div>
      <div className="sb-fld">
        <label htmlFor={`${idPrefix}-code`}>6-digit code</label>
        <input
          className="field sb-otp"
          id={`${idPrefix}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={code}
          aria-invalid={codeError ? true : undefined}
          aria-describedby={`${idPrefix}-code-note`}
          onChange={(e) => onCode(e.target.value)}
        />
        {codeError ? (
          <p className="err" id={`${idPrefix}-code-note`} role="alert">
            {codeError}
          </p>
        ) : (
          <p className="sb-hint" id={`${idPrefix}-code-note`}>
            Codes last 1 hour. Check spam if nothing shows up.
          </p>
        )}
      </div>
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? (
          <>
            <span className="sb-spin" aria-hidden="true" /> Checking…
          </>
        ) : (
          confirmLabel
        )}
      </button>
      <p className="err" role="alert">
        {error}
      </p>
      <div className="actions">
        <button type="button" className="btn ghost" disabled={left > 0 || busy} onClick={onResend}>
          {left > 0 ? `Resend in 0:${String(left).padStart(2, '0')}` : 'Resend code'}
        </button>
        {onChangeEmail && (
          <button type="button" className="btn ghost" disabled={busy} onClick={onChangeEmail}>
            Use a different email
          </button>
        )}
      </div>
    </form>
  );
}

export const MailGlyph = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <rect x="6" y="14" width="52" height="38" rx="6" fill="var(--surface-2)" stroke="currentColor" strokeWidth="2.5" />
    <path d="M8 18l24 18 24-18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
  </svg>
);
export const CheckGlyph = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <circle cx="32" cy="32" r="28" fill="var(--surface-2)" stroke="currentColor" strokeWidth="2.5" />
    <path d="M20 33l8 8 16-17" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ByeGlyph = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{ color: 'var(--muted)' }}>
    <circle cx="32" cy="32" r="28" fill="var(--surface-2)" stroke="currentColor" strokeWidth="2.5" />
    <path d="M22 22l20 20M42 22L22 42" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
  </svg>
);
export const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

/** Wordmark + "Back to the map", then the page body. Season bits follow [data-theme] (set by the boot script). */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="sb-page">
      <header className="sb-top">
        <div className="sb-top-in">
          <Link className="sb-wm disp" href="/" aria-label="Truckee Lights: back to the map">
            Truckee <span className="w2 s-h">Frights</span>
            <span className="w2 s-x">Lights</span>
          </Link>
          <Link className="linkbtn" href="/">
            Back to the map
          </Link>
        </div>
      </header>
      <main className="sb-main">{children}</main>
    </div>
  );
}
