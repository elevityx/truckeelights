// stub: replaced by events/db
// Exactly the A12 signatures, so the UI branch builds before the data branch lands. The page never calls these
// unless get_region_context reports `events`, which only a database with the events migration does.
import { DataError, type EventInput, type PublicEvent } from './types';

export async function listEvents(regionId: string): Promise<PublicEvent[]> {
  void regionId;
  return [];
}

export async function submitEvent(
  regionSlug: string,
  input: EventInput,
): Promise<{ result: 'created' | 'exists'; eventId: string | null }> {
  void regionSlug;
  void input;
  throw new DataError('unknown');
}
