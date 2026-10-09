// Owner: events/db. Admin event moderation (Spec_Events §2, A4, A12). The database enforces admin + aal2 on every
// RPC (region-scoped, or derived from the row); nothing here is a security boundary.
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { eventArgs, toPublicEvent, type RawPublicEvent } from './events';
import { DataError, type AdminEvent, type EventInput, type EventStatus } from './types';

export interface RawAdminEvent extends RawPublicEvent {
  status: EventStatus;
  source: 'community' | 'seed';
  source_url: string | null;
  reject_reason: string | null;
  created_at: string;
  same_day_warning: boolean;
}

export function toAdminEvent(r: RawAdminEvent): AdminEvent {
  return {
    ...toPublicEvent(r),
    status: r.status,
    source: r.source === 'seed' ? 'seed' : 'community',
    sourceUrl: r.source_url ?? null,
    rejectReason: r.reject_reason ?? null,
    createdAt: r.created_at,
    sameDayWarning: r.same_day_warning === true,
  };
}

/** Rows in that status for the active season, pending first then oldest first (server order, max 500). */
export async function adminEventQueue(regionId: string, status: EventStatus): Promise<AdminEvent[]> {
  try {
    const { data, error } = await getSupabase().rpc('admin_event_queue', { p_region_id: regionId, p_status: status });
    if (error) throw error;
    return ((data ?? []) as RawAdminEvent[]).map(toAdminEvent);
  } catch (e) {
    throw toDataError(e);
  }
}

/**
 * pending -> approved | rejected, approved -> hidden, hidden -> approved, rejected -> approved.
 * Anything else fails with invalid_input (detail "transition"). reason is kept only on reject (max 200).
 */
export async function adminModerateEvent(id: string, status: EventStatus, reason?: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('admin_moderate_event', {
      p_event_id: id,
      p_status: status,
      p_reason: reason ?? null,
    });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

/** Same validation as submit minus the starts_at lower bound. Never changes status or source. */
export async function adminUpdateEvent(id: string, input: EventInput): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('admin_update_event', { p_event_id: id, ...eventArgs(input) });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

/** Inserts an approved, source 'seed' event (no quota). Returns its id. */
export async function adminCreateEvent(regionId: string, input: EventInput, sourceUrl: string | null): Promise<string> {
  try {
    const { data, error } = await getSupabase().rpc('admin_create_event', {
      p_region_id: regionId,
      ...eventArgs(input),
      p_source_url: sourceUrl,
    });
    if (error) throw error;
    if (typeof data !== 'string') throw new DataError('unknown');
    return data;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminSetEventsOpen(regionId: string, open: boolean): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('admin_set_events_open', { p_region_id: regionId, p_open: open });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminEventCounts(regionId: string): Promise<{ pending: number }> {
  try {
    const { data, error } = await getSupabase().rpc('admin_event_counts', { p_region_id: regionId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { pending?: unknown } | null | undefined;
    return { pending: typeof row?.pending === 'number' ? row.pending : 0 };
  } catch (e) {
    throw toDataError(e);
  }
}
