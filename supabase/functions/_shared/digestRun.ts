// The send loop for one run kind (C8). The database owns the ledger and the cap:
//   svc_digest_start   -> the run for (kind, Pacific date); a same-day rerun resumes it with the same window
//   svc_digest_batch   -> claims recipients with something new as `sending`, stops at app_settings.digest_daily_cap
//   (Resend, with Idempotency-Key = the row's run_id:user_id)
//   svc_digest_mark    -> 2xx: `sent`, advancing last_sent_through; else `failed` with a short code (the window is not
//                         advanced, so the next run picks the same items up again)
//   svc_digest_finish  -> totals and cap_hit
// A rerun never re-sends a `sent` row, and a crash between Resend and the mark is retried with the same key.
// Logs only counts and ids.
import type { Cadence, DigestDb, DigestRecipient } from './db.ts';
import { renderDigest } from './digestEmail.ts';
import { sendEmail, type OutgoingEmail, type SendResult, type Sleep } from './resend.ts';
import { signToken, PREFS_TTL_SECONDS } from './token.ts';

export const CHUNK = 100;
export const UNSUBSCRIBE_MAILTO = 'mailto:unsubscribe@mail.truckeelights.com?subject=unsubscribe';

export interface RunConfig {
  siteUrl: string;
  /** Public origin of the Edge Functions, e.g. `<SUPABASE_URL>/functions/v1`. */
  functionsUrl: string;
  from: string;
  hmacSecret: string;
  resendKey: string;
  paceMs: number;
  now: () => Date;
}

export interface RunDeps {
  db: DigestDb;
  send?: (idempotencyKey: string, email: OutgoingEmail) => Promise<SendResult>;
  sleep?: Sleep;
  log?: (line: string) => void;
}

export interface RunSummary { kind: Cadence; sent: number; failed: number; skipped: number; capHit: boolean }

export async function buildEmail(r: DigestRecipient, cfg: RunConfig): Promise<OutgoingEmail | null> {
  const nowS = Math.floor(cfg.now().getTime() / 1000);
  const unsubToken = await signToken(cfg.hmacSecret, { publicId: r.public_id, version: r.token_version, purpose: 'unsub', exp: 0 });
  const prefsToken = await signToken(cfg.hmacSecret, { publicId: r.public_id, version: r.token_version, purpose: 'prefs', exp: nowS + PREFS_TTL_SECONDS });
  // The one-click POST goes straight to the function; the human link goes to the static page.
  const oneClick = `${cfg.functionsUrl}/unsubscribe?t=${encodeURIComponent(unsubToken)}`;
  const rendered = renderDigest({
    houses: r.houses ?? [], events: r.events ?? [],
    housesTotal: r.house_total ?? 0, eventsTotal: r.event_total ?? 0,
    siteUrl: cfg.siteUrl,
    unsubUrl: `${cfg.siteUrl}/unsubscribe/?t=${encodeURIComponent(unsubToken)}`,
    prefsUrl: `${cfg.siteUrl}/unsubscribe/?t=${encodeURIComponent(prefsToken)}`,
    cadence: r.cadence,
    timezone: r.timezone,
  });
  if (!rendered) return null;
  return {
    from: cfg.from,
    to: r.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      'List-Unsubscribe': `<${oneClick}>, <${UNSUBSCRIBE_MAILTO}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export async function runDigest(kind: Cadence, runDate: string, cfg: RunConfig, deps: RunDeps): Promise<RunSummary> {
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const send = deps.send ?? ((key: string, email: OutgoingEmail) => sendEmail(cfg.resendKey, key, email, { sleep }));
  const runId = await deps.db.start(kind, runDate);
  const summary: RunSummary = { kind, sent: 0, failed: 0, skipped: 0, capHit: false };
  const seen = new Set<string>();

  while (true) {
    const chunk = await deps.db.batch(runId, CHUNK);
    const fresh = chunk.filter((r) => !seen.has(r.user_id));
    if (fresh.length === 0) break; // nothing left (or the cap is reached), or only rows already handled: never loop
    for (const r of fresh) {
      seen.add(r.user_id);
      const email = await buildEmail(r, cfg);
      if (!email) {
        // The SQL returns only people with something new, so this means malformed content. Release the claim as a
        // failure (the window stays put; the next run tries again) rather than leaving it `sending`.
        await deps.db.mark(runId, r.user_id, false, 'empty_render');
        summary.skipped++;
        continue;
      }
      const res = await send(r.idempotency_key, email);
      if (res.ok) {
        await deps.db.mark(runId, r.user_id, true, null);
        summary.sent++;
      } else {
        await deps.db.mark(runId, r.user_id, false, res.code);
        summary.failed++;
      }
      if (cfg.paceMs > 0) await sleep(cfg.paceMs);
    }
  }
  const totals = await deps.db.finish(runId);
  summary.capHit = totals.cap_hit === true;
  if (summary.capHit) log(`digest_cap_hit run=${runId}`);
  log(`digest_run kind=${kind} run=${runId} sent=${summary.sent} failed=${summary.failed} skipped=${summary.skipped} cap_hit=${summary.capHit}`);
  return summary;
}
