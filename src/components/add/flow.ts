import type { DataErrorCode, SubmitResult } from '@/lib/data/types';
import type { PickedPlace } from '@/lib/maps/types';
import { addressProblemMessage, isStreetLevel, validateAddress } from './validate';

export type Step = 1 | 2 | 3;

export type FlowResult =
  | { kind: 'created'; houseId: string; address: string }
  | { kind: 'exists'; houseId: string; address: string }
  | { kind: 'blocked'; address: string };

export interface FlowState {
  step: Step;
  place: PickedPlace | null;
  address: string;
  lat: number;
  lng: number;
  confirmed: boolean; // step 2 passed its checks
  busy: boolean;
  error: string;
  captchaKey: number; // bumped to remount Turnstile after captcha_failed
  result: FlowResult | null;
  /** The address text was typed by the user since the last automatic fill. */
  edited: boolean;
  /** Pin-drag lookup: seq of the latest drag (older answers are stale), whether it is running, a note, and Undo text. */
  geo: { seq: number; busy: boolean; note: string; undo: string | null };
}

export const initialState: FlowState = {
  step: 1,
  place: null,
  address: '',
  lat: 0,
  lng: 0,
  confirmed: false,
  busy: false,
  error: '',
  captchaKey: 0,
  result: null,
  edited: false,
  geo: { seq: 0, busy: false, note: '', undo: null },
};

export const NUDGE_MESSAGE = "Couldn't find a street address there. Nudge the pin onto the house.";


export const STREET_LEVEL_MESSAGE = 'Pick a street address (house number and street)';
export const BLOCKED_MESSAGE = "This address can't be added right now. Contact us if this is your house.";

export type FlowAction =
  | { type: 'picked'; place: PickedPlace }
  | { type: 'setAddress'; address: string }
  | { type: 'moved'; lat: number; lng: number }
  | { type: 'geocoded'; seq: number; place: PickedPlace }
  | { type: 'geocodeFailed'; seq: number; message: string }
  | { type: 'undoAddress' }
  | { type: 'confirm' }
  | { type: 'goStep'; step: Step }
  | { type: 'submitStart' }
  | { type: 'submitDone'; result: SubmitResult }
  | { type: 'submitFail'; code: DataErrorCode; message: string };

export function reducer(s: FlowState, a: FlowAction): FlowState {
  if (s.result && a.type !== 'picked') return s; // result views are terminal
  switch (a.type) {
    case 'picked': {
      if (!isStreetLevel(a.place.types)) {
        return { ...s, step: 1, error: STREET_LEVEL_MESSAGE };
      }
      return {
        ...s,
        step: 2,
        place: a.place,
        address: a.place.address,
        lat: a.place.lat,
        lng: a.place.lng,
        confirmed: false,
        error: '',
        result: null,
        edited: false,
        geo: { seq: s.geo.seq + 1, busy: false, note: '', undo: null },
      };
    }
    case 'setAddress':
      return { ...s, address: a.address, confirmed: false, error: '', edited: true, geo: { ...s.geo, undo: null } };
    case 'moved':
      // Start a new lookup; any answer for an older seq is ignored.
      return { ...s, lat: a.lat, lng: a.lng, confirmed: false, geo: { ...s.geo, seq: s.geo.seq + 1, busy: true, note: '' } };
    case 'geocoded': {
      if (a.seq !== s.geo.seq || !s.place) return s;
      // place_id and address always change together, so the submitted id matches the shown address.
      return {
        ...s,
        place: { ...a.place, lat: s.lat, lng: s.lng },
        address: a.place.address,
        edited: false,
        error: '',
        geo: { ...s.geo, busy: false, note: '', undo: s.edited && s.address !== a.place.address ? s.address : null },
      };
    }
    case 'geocodeFailed':
      if (a.seq !== s.geo.seq) return s;
      return { ...s, geo: { ...s.geo, busy: false, note: a.message } }; // pin stays put, previous address and place kept
    case 'undoAddress':
      if (s.geo.undo === null) return s;
      return { ...s, address: s.geo.undo, edited: true, confirmed: false, geo: { ...s.geo, undo: null } };
    case 'confirm': {
      if (s.geo.busy) return s; // wait for the address that matches the pin
      const problem = validateAddress(s.address);
      if (problem) return { ...s, error: addressProblemMessage(problem) };
      return { ...s, step: 3, confirmed: true, error: '' };
    }
    case 'goStep': {
      if (s.busy) return s;
      if (a.step === 1) return { ...s, step: 1, error: '' };
      if (a.step === 2 && s.place) return { ...s, step: 2, error: '' };
      if (a.step === 3 && s.place && s.confirmed) return { ...s, step: 3, error: '' };
      return s;
    }
    case 'submitStart':
      return s.busy ? s : { ...s, busy: true, error: '' };
    case 'submitDone': {
      const address = s.address.trim();
      const r = a.result;
      const result: FlowResult =
        r.result === 'created'
          ? { kind: 'created', houseId: r.houseId, address }
          : r.result === 'exists_visible'
            ? { kind: 'exists', houseId: r.houseId, address }
            : { kind: 'blocked', address };
      return { ...s, busy: false, error: '', result };
    }
    case 'submitFail':
      return {
        ...s,
        busy: false,
        error: a.message,
        captchaKey: a.code === 'captcha_failed' ? s.captchaKey + 1 : s.captchaKey,
      };
  }
}
