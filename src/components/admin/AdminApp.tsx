'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminAal,
  adminHasUserSession,
  adminSignOut,
  adminVerifiedTotp,
  adminWhoami,
  getRegionContext,
  toDataError,
  userMessage,
  type RegionContext,
} from '@/lib/data';
import { supabaseConfigured } from '@/config/public-env';
import { decideScreen, type AdminScreen } from './gate';
import { LoginScreen, MfaScreen, NotAdminScreen, SetupScreen } from './AuthScreens';
import Console from './Console';
import './admin.css';

/** The screen is decided on mount and after every auth action. UI convenience only: the database enforces access. */
export default function AdminApp() {
  const [screen, setScreen] = useState<AdminScreen | 'loading' | 'error'>('loading');
  const [ctx, setCtx] = useState<RegionContext | null>(null);
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');

  const decide = useCallback(async () => {
    if (!supabaseConfigured()) {
      setError('This site is not connected to a database.');
      return setScreen('error');
    }
    try {
      const c = await getRegionContext();
      setCtx(c);
      const hasUser = await adminHasUserSession();
      if (!hasUser) return setScreen('login');
      const { current, next } = await adminAal();
      let isAdmin: boolean | null = null;
      if (current === 'aal2') {
        isAdmin = await adminWhoami(c.region.id).catch(() => false);
      } else if (current === 'aal1') {
        const f = await adminVerifiedTotp();
        setFactorId(f?.id ?? '');
        // A verified factor means a challenge is needed even if `next` was not reported.
        if (f) return setScreen('mfa');
      }
      setScreen(decideScreen({ hasUser, current, next, isAdmin }));
    } catch (e) {
      setError(userMessage(toDataError(e)));
      setScreen('error');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void decide(), 0);
    return () => clearTimeout(t);
  }, [decide]);

  const signOut = useCallback(async () => {
    try {
      await adminSignOut();
    } catch {
      /* fall through to re-deciding */
    }
    await decide();
  }, [decide]);

  switch (screen) {
    case 'loading':
      return <div className="adm"><div className="login"><p className="fine">Loading…</p></div></div>;
    case 'error':
      return (
        <div className="adm">
          <div className="login">
            <div className="login-card">
              <p className="err" role="alert">{error}</p>
              <button className="btn ghost" type="button" onClick={() => { setScreen('loading'); void decide(); }}>Try again</button>
            </div>
          </div>
        </div>
      );
    case 'login':
      return <div className="adm"><LoginScreen onDone={decide} /></div>;
    case 'mfa':
      return <div className="adm"><MfaScreen factorId={factorId} onDone={decide} onSignOut={signOut} /></div>;
    case 'setup':
      return <div className="adm"><SetupScreen onDone={decide} onSignOut={signOut} /></div>;
    case 'not_admin':
      return <div className="adm"><NotAdminScreen onSignOut={signOut} /></div>;
    case 'console':
      return ctx ? <Console ctx={ctx} onCtx={setCtx} onForbidden={decide} onSignOut={signOut} /> : null;
  }
}
