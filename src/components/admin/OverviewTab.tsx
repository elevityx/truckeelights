'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminDigestToday, adminSetSubscribeOpen, adminSubscriberCounts, getRegionContext, toDataError, userMessage,
  type DigestToday, type RegionContext, type SubscriberCounts,
} from '@/lib/data';
import { switchChecked, switchDisabled, switchFromOpen, switchStatusText, switchTarget, type PhotosSwitch } from './photosState';
import { usageBanner, usageLevel, usagePercent } from './claimsState';
import './accounts-admin.css';

interface Props {
  ctx: RegionContext;
  onForbidden(): void;
}

/** Overview: subscriber counts (counts only, no list), today's email use against the provider limit, and the subscribe switch. */
export default function OverviewTab({ ctx, onForbidden }: Props) {
  const region = ctx.region.id;
  const slug = ctx.region.slug;
  const [counts, setCounts] = useState<SubscriberCounts | null>(null);
  const [digest, setDigest] = useState<DigestToday | null>(null);
  const [err, setErr] = useState('');
  const [sw, setSw] = useState<PhotosSwitch>({ kind: 'loading' });
  const [swBusy, setSwBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, d] = await Promise.allSettled([adminSubscriberCounts(region), adminDigestToday()]);
    for (const r of [c, d]) {
      if (r.status === 'rejected' && toDataError(r.reason).code === 'forbidden') return onForbidden();
    }
    if (c.status === 'fulfilled') setCounts(c.value);
    if (d.status === 'fulfilled') setDigest(d.value);
    const failed = c.status === 'rejected' ? c.reason : d.status === 'rejected' ? d.reason : null;
    setErr(failed ? userMessage(toDataError(failed), ctx.region.name) : '');
  }, [region, ctx.region.name, onForbidden]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // The switch always shows the server's subscribe.open: loaded on mount, never defaulted.
  const loadSwitch = useCallback(async () => {
    setSw({ kind: 'loading' });
    try {
      const fresh = await getRegionContext(slug);
      setSw(fresh.subscribe ? switchFromOpen(fresh.subscribe.open) : { kind: 'unknown' });
    } catch {
      setSw({ kind: 'unknown' });
    }
  }, [slug]);
  useEffect(() => {
    const t = setTimeout(() => void loadSwitch(), 0);
    return () => clearTimeout(t);
  }, [loadSwitch]);

  async function toggle() {
    const target = switchTarget(sw);
    if (target === null) return;
    setSwBusy(true);
    setErr('');
    try {
      await adminSetSubscribeOpen(region, target);
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    }
    try {
      const fresh = await getRegionContext(slug); // show what the database says, even after an error
      setSw(fresh.subscribe ? switchFromOpen(fresh.subscribe.open) : { kind: 'unknown' });
    } catch {
      setSw({ kind: 'unknown' });
    } finally {
      setSwBusy(false);
    }
  }

  const banner = digest ? usageBanner(digest) : null;
  const level = digest ? usageLevel(digest) : 'ok';
  const tile = (label: string, v: number | undefined) => (
    <div key={label}><dt>{label}</dt><dd>{v === undefined ? '–' : v}</dd></div>
  );

  return (
    <section className="panel cl-sec" aria-label="Overview">
      <div className="ev-head">
        <h3>Subscribers</h3>
        <button className="sw" type="button" role="switch" aria-checked={switchChecked(sw)} disabled={switchDisabled(sw, swBusy)} onClick={() => void toggle()}>
          <span className="tr" aria-hidden="true" />
          Visitors can subscribe: {switchStatusText(sw)}
        </button>
        {sw.kind === 'unknown' && (
          <span role="alert" className="err">
            Couldn&apos;t check whether subscribing is on. <button className="btn ghost" type="button" onClick={() => void loadSwitch()}>Retry</button>
          </span>
        )}
      </div>
      {err && <p className="err" role="alert">{err} <button className="btn ghost" type="button" onClick={() => void load()}>Retry</button></p>}
      {banner && <div className="warn-banner" role="status">{banner}</div>}
      <dl className="ov-tiles">
        {tile('Active', counts?.active)}
        {tile('Stopped', counts?.stopped)}
        {tile('Daily', counts?.daily)}
        {tile('Weekly', counts?.weekly)}
        {tile('Want houses', counts?.houses)}
        {tile('Want events', counts?.events)}
      </dl>
      <div className="qcard">
        <div className="ov-use">
          <b>Emails sent today</b>
          <span>{digest ? `${digest.sent} of ${digest.providerDailyLimit}` : '–'}</span>
        </div>
        <div className={`ov-bar ${level === 'ok' ? '' : level}`} aria-hidden="true"><i style={{ width: `${digest ? usagePercent(digest) : 0}%` }} /></div>
        <p className="fine">
          The digest stops at {digest ? digest.cap : 50} a day so sign-in emails keep room. That is best effort: sign-in mail shares the same daily limit.
        </p>
      </div>
      <p className="fine">Counts only. There is no subscriber list in admin, by design.</p>
    </section>
  );
}
