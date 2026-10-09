// The send loop for one run kind. Per (run, user): claim a `sending` row, call Resend with Idempotency-Key
// run_id:user_id, then record `sent` (which advances last_sent_through in the database) or `failed` with a short code.
// Assumes svc_digest_pending returns only subscribers with something new and no `sent` row for this run.
// A rerun skips anything already `sent`, stops at the daily cap, and logs only counts and ids.
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
  dailyCap: number;
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
    housesTotal: r.houses_total ?? 0, eventsTotal: r.events_total ?? 0,
    siteUrl: cfg.siteUrl,
    unsubUrl: `${cfg.siteUrl}/unsubscribe/?t=${encodeURIComponent(unsubToken)}`,
    prefsUrl: `${cfg.siteUrl}/unsubscribe/?t=${encodeURIComponent(prefsToken)}`,
    cadence: r.cadence,
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
  const { run_id: runId, sent_today: sentToday } = await deps.db.beginRun(kind, runDate);
  const summary: RunSummary = { kind, sent: 0, failed: 0, skipped: 0, capHit: false };
  let remaining = cfg.dailyCap - sentToday;
  const seen = new Set<string>();

  outer: while (true) {
    if (remaining <= 0) { summary.capHit = true; log(`digest_cap_hit run=${runId}`); break; }
    const chunk = await deps.db.pending(runId, Math.min(CHUNK, remaining));
    const fresh = chunk.filter((r) => !seen.has(r.user_id));
    if (fresh.length === 0) break; // nothing left, or only rows we already handled (never loop)
    for (const r of fresh) {
      seen.add(r.user_id);
      if (remaining <= 0) { summary.capHit = true; log(`digest_cap_hit run=${runId}`); break outer; }
      const email = await buildEmail(r, cfg);
      if (!email) { summary.skipped++; continue; } // nothing new for this person: no row, no send
      if (!(await deps.db.claim(runId, r.user_id))) { summary.skipped++; continue; } // already sent in this run
      const res = await send(`${runId}:${r.user_id}`, email);
      if (res.ok) {
        await deps.db.mark(runId, r.user_id, 'sent', res.id, null, r.window_through);
        summary.sent++; remaining--;
      } else {
        await deps.db.mark(runId, r.user_id, 'failed', null, res.code, null);
        summary.failed++;
      }
      if (cfg.paceMs > 0) await sleep(cfg.paceMs);
    }
  }
  await deps.db.finishRun(runId, summary.sent, summary.failed, summary.capHit);
  log(`digest_run kind=${kind} run=${runId} sent=${summary.sent} failed=${summary.failed} skipped=${summary.skipped} cap_hit=${summary.capHit}`);
  return summary;
}
