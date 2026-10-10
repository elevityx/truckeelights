// The send loop for one run kind (C8), bounded per invocation. The database owns the ledger, the keys and the cap:
//   svc_digest_start   -> the run for (kind, Pacific date); every cron tick that evening resumes the same run
//   svc_digest_batch   -> resumes unresolved `sending` rows (any run, idle 5 min) with their stored key, window and
//                         payload, then claims new recipients as `sending` with key
//                         digest:<public_id>:<window start>/<window end>; new claims stop at app_settings.digest_daily_cap
//   svc_digest_store_payload -> a row with no stored payload is rendered once and the exact email stored BEFORE the
//                         provider call; a row with one is sent from it verbatim (never re-rendered), so a resumed
//                         send repeats the identical request under the same key and Resend dedupes it
//   (Resend, with Idempotency-Key = the row's stored key)
//   svc_digest_mark    -> a DEFINITE outcome only: 2xx -> `sent`, advancing last_sent_through (and the last
//                         digest season); 4xx -> `failed`
//                         (the window is not advanced, so the next run picks the items up again under a new key). An ambiguous outcome
//                         (timeout, network error, 5xx) is left `sending` and resumed later with the same key.
//   svc_digest_finish  -> totals and cap_hit
// Each invocation stops claiming and sending at its deadline (~40 s) or after MAX_SENDS, and reports `more`; rows it
// claimed but did not send stay `sending` and the next 10-minute tick resumes them. Logs only counts and ids.
import type { Cadence, DigestDb, DigestRecipient, StoredPayload } from './db.ts';
import { renderDigest } from './digestEmail.ts';
import { sendEmail, type OutgoingEmail, type SendResult, type Sleep } from './resend.ts';
import { signToken, PREFS_TTL_SECONDS } from './token.ts';

/** Recipients claimed per batch call (small, so a deadline leaves few claimed-but-unsent rows). */
export const CHUNK = 10;
/** Most sends one invocation attempts before returning. */
export const MAX_SENDS = 100;
/** Wall-clock budget of one invocation; no new batch or send starts after it. */
export const BUDGET_MS = 40_000;
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

export interface RunSummary {
  kind: Cadence; sent: number; failed: number; skipped: number;
  /** Ambiguous provider outcomes left `sending` for a later resume with the same key. */
  pending: number;
  capHit: boolean;
  /** The budget or MAX_SENDS ran out with work possibly left: the next tick continues. */
  more: boolean;
}

/** A shared per-invocation budget: deadline (epoch ms) and sends left. */
export interface Budget { deadline: number; sendsLeft: number }

export async function buildEmail(r: DigestRecipient, cfg: RunConfig): Promise<OutgoingEmail | null> {
  // The prefs link's expiry derives from the row's window, not the clock, so a resumed send (same idempotency key)
  // renders byte-for-byte the same email. Resend rejects a reused key with a different payload.
  const windowS = Math.floor(Date.parse(r.window_to) / 1000);
  const nowS = Number.isFinite(windowS) ? windowS : Math.floor(cfg.now().getTime() / 1000);
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
    wantHouses: r.want_houses === true,
    wantEvents: r.want_events === true,
    timezone: r.timezone,
    season: r.season,
    seasonYear: r.season_year,
    seasonOpener: r.season_opener === true,
    windowTo: r.window_to,
    regionName: r.region_name,
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

/**
 * The request body for a stored payload, in one fixed key order (headers sorted by name), so the fresh send and every
 * resume of it serialize to the same bytes whatever order the database returns the jsonb keys in.
 */
export function outgoingFrom(p: StoredPayload): OutgoingEmail {
  const headers: Record<string, string> = {};
  for (const k of Object.keys(p.headers ?? {}).sort()) headers[k] = String(p.headers[k]);
  return { from: p.from, to: p.to, subject: p.subject, html: p.html, text: p.text, headers };
}

export function payloadOf(e: OutgoingEmail): StoredPayload {
  return { from: e.from, to: e.to, subject: e.subject, html: e.html, text: e.text, headers: { ...(e.headers ?? {}) } };
}

export async function runDigest(
  kind: Cadence, runDate: string, cfg: RunConfig, deps: RunDeps,
  budget: Budget = { deadline: cfg.now().getTime() + BUDGET_MS, sendsLeft: MAX_SENDS },
): Promise<RunSummary> {
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const send = deps.send ?? ((key: string, email: OutgoingEmail) => sendEmail(cfg.resendKey, key, email, { sleep }));
  const runId = await deps.db.start(kind, runDate);
  const summary: RunSummary = { kind, sent: 0, failed: 0, skipped: 0, pending: 0, capHit: false, more: false };
  const seen = new Set<string>();
  const outOfBudget = () => budget.sendsLeft <= 0 || cfg.now().getTime() >= budget.deadline;

  outer: while (true) {
    if (outOfBudget()) { summary.more = true; break; }
    const chunk = await deps.db.batch(runId, Math.min(CHUNK, budget.sendsLeft));
    const fresh = chunk.filter((r) => !seen.has(`${r.run_id}:${r.user_id}`));
    if (fresh.length === 0) break; // nothing left (or the cap is reached), or only rows already handled: never loop
    for (const r of fresh) {
      // Claimed rows not reached before the deadline stay `sending`; the next tick resumes them (same key).
      if (outOfBudget()) { summary.more = true; break outer; }
      seen.add(`${r.run_id}:${r.user_id}`);
      let email: OutgoingEmail;
      if (r.payload) {
        // A resume of a row whose email was already stored: send exactly that, never a fresh render.
        email = outgoingFrom(r.payload);
      } else {
        const built = await buildEmail(r, cfg);
        if (!built) {
          // The SQL returns only people with something new, so this means malformed content. Release the claim as a
          // failure (the window stays put; the next run tries again) rather than leaving it `sending`.
          await deps.db.mark(r.run_id, r.user_id, false, 'empty_render');
          summary.skipped++;
          continue;
        }
        email = outgoingFrom(payloadOf(built));
        try {
          await deps.db.storePayload(r.run_id, r.user_id, payloadOf(email));
        } catch {
          // Not stored, so not sent: the row stays `sending` and is resumed (it may already hold a payload, which the
          // resume then sends verbatim). Never call Resend with a payload the row does not hold.
          summary.pending++;
          continue;
        }
      }
      budget.sendsLeft--;
      const res = await send(r.idempotency_key, email);
      if (res.ok) {
        await deps.db.mark(r.run_id, r.user_id, true, null);
        summary.sent++;
      } else if (res.ambiguous) {
        summary.pending++; // Resend may have accepted it: never re-key; resumed after 5 minutes idle
      } else {
        await deps.db.mark(r.run_id, r.user_id, false, res.code);
        summary.failed++;
      }
      if (cfg.paceMs > 0) await sleep(cfg.paceMs);
    }
  }
  const totals = await deps.db.finish(runId);
  summary.capHit = totals.cap_hit === true;
  if (summary.capHit) log(`digest_cap_hit run=${runId}`);
  log(`digest_run kind=${kind} run=${runId} sent=${summary.sent} failed=${summary.failed} pending=${summary.pending} skipped=${summary.skipped} cap_hit=${summary.capHit} more=${summary.more}`);
  return summary;
}
