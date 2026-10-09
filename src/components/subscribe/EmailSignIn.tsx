'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toDataError } from '@/lib/data/errors';
import type { SubscribeApi } from './api';
import { codeMessage, confirmRedirect, emailProblem, preparePlainSignIn, sendCode, sendMessage } from './flow';
import { CodeStep, SubBotCheck } from './parts';

type Step = 'email' | 'bot' | 'sending' | 'code' | 'verifying';

/**
 * Sign in by emailed code, on the page (the same OTP path as Subscribe). With `fixedEmail` it asks for a fresh
 * code for that address only (delete-account freshness, C4).
 */
export default function EmailSignIn({
  api,
  onSignedIn,
  fixedEmail,
  idPrefix,
  submitLabel = 'Email me a code',
}: {
  api: SubscribeApi;
  onSignedIn(): void;
  fixedEmail?: string;
  idPrefix: string;
  submitLabel?: string;
}) {
  const [step, setStep] = useState<Step>(fixedEmail ? 'bot' : 'email');
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [emailError, setEmailError] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [error, setError] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const token = useRef('');

  const onToken = useCallback((t: string) => {
    token.current = t;
    setStep((s) => (s === 'bot' ? 'sending' : s));
  }, []);

  useEffect(() => {
    if (step !== 'sending') return;
    let live = true;
    const t = token.current;
    token.current = '';
    // The emailed link carries no `next`: if it is opened in this browser, land back on the account page. A plain
    // sign-in never applies a Subscribe intent, so any left over from an abandoned Subscribe attempt is dropped.
    preparePlainSignIn(() => window.sessionStorage);
    void sendCode(api, email.trim(), t, confirmRedirect(window.location.origin, true))
      .then(() => {
        if (!live) return;
        setSentAt(Date.now());
        setCode('');
        setCodeError('');
        setError('');
        setStep('code');
      })
      .catch((e) => {
        if (!live) return;
        setError(sendMessage(toDataError(e).code));
        setCaptchaKey((k) => k + 1);
        setStep(sentAt === null ? (fixedEmail ? 'bot' : 'email') : 'code');
      });
    return () => {
      live = false;
    };
  }, [step, api, email, sentAt, fixedEmail]);

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) return setCodeError('Enter the 6-digit code from the email.');
    setStep('verifying');
    try {
      await api.verifyEmailCode(email.trim(), code);
    } catch (e) {
      setCodeError(codeMessage(toDataError(e).code));
      setStep('code');
      return;
    }
    try {
      await api.completeHouseLink(); // this device's houses, if it had an anonymous session (B3)
    } catch {
      /* nothing to link */
    }
    onSignedIn();
  };

  if (step === 'email') {
    return (
      <form
        className="sb"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const p = emailProblem(email);
          setEmailError(p);
          if (!p) {
            setError('');
            setStep('bot');
          }
        }}
      >
        <div className="sb-fld">
          <label htmlFor={`${idPrefix}-email`}>Email</label>
          <input
            className="field"
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            maxLength={254}
            value={email}
            aria-invalid={emailError ? true : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError('');
            }}
          />
          <p className="err" role="alert">
            {emailError || error}
          </p>
        </div>
        <button type="submit" className="btn primary">
          {submitLabel}
        </button>
      </form>
    );
  }
  if (step === 'bot' || step === 'sending') {
    return (
      <div className="sb-bot">
        <p className="sb-hint">One quick check that you’re a person.</p>
        <SubBotCheck mock={api.mock} onToken={onToken} onExpire={() => (token.current = '')} resetKey={captchaKey} />
        <p className="sb-hint" role="status">
          {step === 'sending' ? 'Sending your email…' : ''}
        </p>
        <p className="err" role="alert">
          {error}
        </p>
      </div>
    );
  }
  return (
    <CodeStep
      idPrefix={idPrefix}
      email={email.trim()}
      code={code}
      onCode={(v) => {
        setCode(v.replace(/\D/g, '').slice(0, 6));
        setCodeError('');
      }}
      onVerify={() => void verify()}
      busy={step === 'verifying'}
      codeError={codeError}
      error={error}
      sentAt={sentAt}
      onResend={() => {
        setCaptchaKey((k) => k + 1);
        setStep('bot');
      }}
      onChangeEmail={
        fixedEmail
          ? undefined
          : () => {
              setSentAt(null);
              setStep('email');
            }
      }
    />
  );
}
