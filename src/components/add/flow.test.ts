import { describe, expect, it } from 'vitest';
import { BLOCKED_MESSAGE, initialState, reducer, STREET_LEVEL_MESSAGE, type FlowState } from './flow';

const place = {
  placeId: 'ChIJabcdefghij',
  address: '10013 Jibboom St, Truckee, CA 96161, USA',
  lat: 39.33,
  lng: -120.18,
  types: ['street_address'],
};
const at2 = () => reducer(initialState, { type: 'picked', place });
const at3 = () => reducer(at2(), { type: 'confirm' });

describe('add-house flow', () => {
  it('a street-level pick moves to step 2 and prefills', () => {
    const s = at2();
    expect(s.step).toBe(2);
    expect(s.address).toBe(place.address);
    expect(s.lat).toBe(39.33);
  });
  it('a non-street pick stays on step 1 with the street message', () => {
    const s = reducer(initialState, { type: 'picked', place: { ...place, types: ['locality'] } });
    expect(s.step).toBe(1);
    expect(s.error).toBe(STREET_LEVEL_MESSAGE);
    expect(s.place).toBeNull();
  });
  it('confirm with a bad address stays on step 2', () => {
    const s = reducer(reducer(at2(), { type: 'setAddress', address: '<b>1 Main</b>' }), { type: 'confirm' });
    expect(s.step).toBe(2);
    expect(s.error).not.toBe('');
  });
  it('confirm with a good address moves to step 3', () => {
    const s = at3();
    expect(s.step).toBe(3);
    expect(s.confirmed).toBe(true);
  });
  it('editing or moving after confirm clears the confirmation', () => {
    expect(reducer(at3(), { type: 'moved', lat: 39.3, lng: -120.1 }).confirmed).toBe(false);
    expect(reducer(at3(), { type: 'setAddress', address: '1 Main St' }).confirmed).toBe(false);
  });
  it('cannot jump ahead of what is reachable', () => {
    expect(reducer(initialState, { type: 'goStep', step: 2 }).step).toBe(1);
    expect(reducer(at2(), { type: 'goStep', step: 3 }).step).toBe(2);
    expect(reducer(at3(), { type: 'goStep', step: 1 }).step).toBe(1);
  });
  it('created, exists, blocked results', () => {
    const c = reducer(at3(), { type: 'submitDone', result: { result: 'created', houseId: 'h1' } });
    expect(c.result).toEqual({ kind: 'created', houseId: 'h1', address: place.address });
    const e = reducer(at3(), { type: 'submitDone', result: { result: 'exists_visible', houseId: 'h2' } });
    expect(e.result?.kind).toBe('exists');
    const b = reducer(at3(), { type: 'submitDone', result: { result: 'blocked' } });
    expect(b.result?.kind).toBe('blocked');
    expect(BLOCKED_MESSAGE).toMatch(/can't be added right now/);
  });
  it('failures show the message, stay on step 3, and only captcha_failed bumps the widget', () => {
    const busy: FlowState = reducer(at3(), { type: 'submitStart' });
    expect(busy.busy).toBe(true);
    const rl = reducer(busy, { type: 'submitFail', code: 'rate_limited', message: 'Slow down' });
    expect(rl).toMatchObject({ step: 3, busy: false, error: 'Slow down', captchaKey: 0 });
    const cf = reducer(busy, { type: 'submitFail', code: 'captcha_failed', message: 'bot' });
    expect(cf.captchaKey).toBe(1);
  });
  it('double submit is ignored and results are terminal', () => {
    const busy = reducer(at3(), { type: 'submitStart' });
    expect(reducer(busy, { type: 'submitStart' })).toBe(busy);
    const done = reducer(busy, { type: 'submitDone', result: { result: 'blocked' } });
    expect(reducer(done, { type: 'goStep', step: 1 })).toBe(done);
  });
});

describe('pin drag re-geocode', () => {
  const moved = (s: FlowState) => reducer(s, { type: 'moved', lat: 39.331, lng: -120.181 });
  const other = { placeId: 'ChIJotherplace1', address: '10020 Jibboom St, Truckee, CA 96161, USA', lat: 39.331, lng: -120.181, types: ['street_address'] };
  it('a drag starts a lookup and blocks confirm until it lands', () => {
    const s = moved(at2());
    expect(s.geo.busy).toBe(true);
    expect(reducer(s, { type: 'confirm' }).step).toBe(2);
  });
  it('the answer updates address and place id together and keeps the dropped point', () => {
    const s1 = moved(at2());
    const s = reducer(s1, { type: 'geocoded', seq: s1.geo.seq, place: other });
    expect(s.address).toBe(other.address);
    expect(s.place?.placeId).toBe(other.placeId);
    expect([s.lat, s.lng]).toEqual([39.331, -120.181]);
    expect(s.geo.busy).toBe(false);
    expect(s.geo.undo).toBeNull(); // the user had not typed, so no Undo
  });
  it('ignores a stale answer from an earlier drag', () => {
    const s1 = moved(at2());
    const s2 = reducer(s1, { type: 'moved', lat: 39.332, lng: -120.182 });
    const s = reducer(s2, { type: 'geocoded', seq: s1.geo.seq, place: other });
    expect(s).toBe(s2);
    expect(reducer(s2, { type: 'geocodeFailed', seq: s1.geo.seq, message: 'x' })).toBe(s2);
  });
  it('a failed lookup keeps the previous address and place, with a note', () => {
    const s1 = moved(at2());
    const s = reducer(s1, { type: 'geocodeFailed', seq: s1.geo.seq, message: 'nudge' });
    expect(s.address).toBe(place.address);
    expect(s.place?.placeId).toBe(place.placeId);
    expect(s.geo).toMatchObject({ busy: false, note: 'nudge' });
  });
  it('edited text is replaced but can be restored with Undo', () => {
    const typed = reducer(at2(), { type: 'setAddress', address: '10013 Jibboom Street, Truckee' });
    const s1 = moved(typed);
    const s = reducer(s1, { type: 'geocoded', seq: s1.geo.seq, place: other });
    expect(s.address).toBe(other.address);
    expect(s.geo.undo).toBe('10013 Jibboom Street, Truckee');
    const u = reducer(s, { type: 'undoAddress' });
    expect(u.address).toBe('10013 Jibboom Street, Truckee');
    expect(u.geo.undo).toBeNull();
    expect(u.edited).toBe(true);
  });
});
