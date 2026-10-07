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
};

export const STREET_LEVEL_MESSAGE = 'Pick a street address (house number and street)';
export const BLOCKED_MESSAGE = "This address can't be added right now. Contact us if this is your house.";

export type FlowAction =
  | { type: 'picked'; place: PickedPlace }
  | { type: 'setAddress'; address: string }
  | { type: 'moved'; lat: number; lng: number }
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
      };
    }
    case 'setAddress':
      return { ...s, address: a.address, confirmed: false, error: '' };
    case 'moved':
      return { ...s, lat: a.lat, lng: a.lng, confirmed: false };
    case 'confirm': {
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
