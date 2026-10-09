import { describe, expect, it } from 'vitest';
import type { Region } from '@/lib/data/types';
import { fitEventsCamera, fitPointsCamera, fitTargets, fitZoom, metersBetween, project, spreadOffsets, unproject, type SpreadPoint } from './eventLayout';

const region = {
  id: 'r',
  slug: 'truckee',
  name: 'Truckee',
  minLat: 39.15,
  maxLat: 39.45,
  minLng: -120.42,
  maxLng: -119.98,
  centerLat: 39.328,
  centerLng: -120.183,
  defaultZoom: 11,
  timezone: 'America/Los_Angeles',
  countryCode: 'US',
} as Region;

const vp = { width: 390, height: 640 };
const pad = { top: 150, right: 28, bottom: 80, left: 28 };

const truckee = { lat: 39.3276, lng: -120.1839 };
const glenshire = { lat: 39.3555, lng: -120.1155 };
const tahoeCity = { lat: 39.1655, lng: -120.144 };
const reno = { lat: 39.5446, lng: -119.8214 };

describe('project / unproject', () => {
  it('round-trips', () => {
    const p = unproject(project(truckee, 12), 12);
    expect(p.lat).toBeCloseTo(truckee.lat, 9);
    expect(p.lng).toBeCloseTo(truckee.lng, 9);
  });
});

describe('fitTargets', () => {
  it('keeps only local events when there are any', () => {
    expect(fitTargets([truckee, reno, glenshire], region)).toEqual([truckee, glenshire]);
  });
  it('falls back to every event plus the region center when no event is local', () => {
    expect(fitTargets([reno], region)).toEqual([reno, { lat: region.centerLat, lng: region.centerLng }]);
  });
  it('is empty with no events', () => {
    expect(fitTargets([], region)).toEqual([]);
  });
});

describe('fitEventsCamera', () => {
  it('returns null with nothing to fit or no viewport', () => {
    expect(fitEventsCamera([], region, vp, pad)).toBeNull();
    expect(fitEventsCamera([truckee], region, { width: 0, height: 0 }, pad)).toBeNull();
  });

  it('never zooms in past the default zoom (a single event)', () => {
    const cam = fitEventsCamera([truckee], region, vp, pad)!;
    expect(cam.zoom).toBe(region.defaultZoom);
  });

  it('fits every point inside the padded viewport', () => {
    const pts = [truckee, glenshire, tahoeCity];
    const cam = fitEventsCamera(pts, region, vp, pad)!;
    expect(cam.zoom).toBe(fitZoom({ minLat: 39.1655, maxLat: 39.3555, minLng: -120.1839, maxLng: -120.1155 }, vp, pad));
    expect(cam.zoom).toBeLessThanOrEqual(region.defaultZoom);
    const c = project(cam.center, cam.zoom);
    for (const p of pts) {
      const q = project(p, cam.zoom);
      const x = q.x - c.x + vp.width / 2;
      const y = q.y - c.y + vp.height / 2;
      expect(x).toBeGreaterThanOrEqual(pad.left - 0.5);
      expect(x).toBeLessThanOrEqual(vp.width - pad.right + 0.5);
      expect(y).toBeGreaterThanOrEqual(pad.top - 0.5);
      expect(y).toBeLessThanOrEqual(vp.height - pad.bottom + 0.5);
    }
  });

  it('shifts the center so the points sit in the padded area, not under the top controls', () => {
    const cam = fitEventsCamera([truckee, tahoeCity], region, vp, pad)!;
    const midLat = (truckee.lat + tahoeCity.lat) / 2;
    expect(cam.center.lat).toBeGreaterThan(midLat); // top padding > bottom: the camera looks further north
  });

  it('never zooms out past one level beyond the region box', () => {
    const far = [{ lat: 39.0, lng: -121.5 }, reno];
    const cam = fitEventsCamera(far, region, vp, pad)!;
    expect(cam.zoom).toBe(fitZoom(region, vp, pad) - 1);
  });
});

const ev = (id: string, lat: number, lng: number, startsAt: string): SpreadPoint => ({ id, lat, lng, startsAt });

describe('spreadOffsets', () => {
  it('gives a lone pin no offset', () => {
    expect(spreadOffsets([ev('a', truckee.lat, truckee.lng, '2026-10-30T23:00:00Z')], 12).size).toBe(0);
  });

  it('leaves far-apart pins alone', () => {
    const out = spreadOffsets([ev('a', truckee.lat, truckee.lng, '2026-10-01T00:00:00Z'), ev('b', tahoeCity.lat, tahoeCity.lng, '2026-10-02T00:00:00Z')], 12);
    expect(out.size).toBe(0);
  });

  it('puts a same-venue pair side by side, earlier start on the left', () => {
    const out = spreadOffsets(
      [ev('late', truckee.lat, truckee.lng, '2026-10-30T23:00:00Z'), ev('early', truckee.lat, truckee.lng, '2026-10-15T01:00:00Z')],
      12,
    );
    expect(out.get('early')).toEqual({ dx: -24, dy: 0 });
    expect(out.get('late')).toEqual({ dx: 24, dy: 0 });
  });

  it('lays a group on a ring in start order, clockwise from 9 o clock', () => {
    const at = '2026-10-1';
    const pts = [ev('c', truckee.lat, truckee.lng, `${at}3T00:00:00Z`), ev('a', truckee.lat, truckee.lng, `${at}1T00:00:00Z`), ev('b', truckee.lat, truckee.lng, `${at}2T00:00:00Z`), ev('d', truckee.lat, truckee.lng, `${at}4T00:00:00Z`)];
    const out = spreadOffsets(pts, 14);
    const r = out.get('a')!.dx * -1;
    expect(r).toBeCloseTo(24 / Math.sin(Math.PI / 4), 0); // neighbors 48 px apart
    expect(out.get('a')).toEqual({ dx: -r, dy: 0 }); // left
    expect(out.get('b')!.dx).toBeCloseTo(0, 5);
    expect(out.get('b')!.dy).toBeCloseTo(-r, 5); // top
    expect(out.get('c')).toEqual({ dx: r, dy: 0 }); // right
    expect(out.get('d')!.dy).toBeCloseTo(r, 5); // bottom
  });

  it('is deterministic whatever the input order', () => {
    const pts = [ev('x', 39.3341, -120.1796, '2026-10-05T00:00:00Z'), ev('y', 39.33412, -120.17962, '2026-10-05T00:00:00Z'), ev('z', 39.33405, -120.1797, '2026-10-04T00:00:00Z')];
    const a = spreadOffsets(pts, 15);
    const b = spreadOffsets([...pts].reverse(), 15);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(a.size).toBe(3);
  });

  it('groups pins that overlap on screen even when they are far apart in meters, and splits them when zoomed in', () => {
    const p = [ev('a', 39.3276, -120.1839, '2026-10-01T00:00:00Z'), ev('b', 39.3283, -120.1873, '2026-10-02T00:00:00Z')]; // ~300 m
    expect(metersBetween(p[0], p[1])).toBeGreaterThan(30);
    expect(spreadOffsets(p, 11).size).toBe(2);
    expect(spreadOffsets(p, 17).size).toBe(0);
  });

  it('keeps same-venue pins grouped at any zoom', () => {
    const p = [ev('a', 39.3276, -120.1839, '2026-10-01T00:00:00Z'), ev('b', 39.32775, -120.18392, '2026-10-02T00:00:00Z')]; // ~17 m
    expect(spreadOffsets(p, 21).size).toBe(2);
  });
});

describe('fitPointsCamera (route)', () => {
  const vp = { width: 1280, height: 690 };
  const pad = { top: 120, right: 460, bottom: 60, left: 60 };
  const pts = [
    { lat: 39.3312, lng: -120.1905 },
    { lat: 39.3338, lng: -120.1802 },
    { lat: 39.3268, lng: -120.1738 },
  ];
  it('keeps every point inside the padded area', () => {
    const cam = fitPointsCamera(pts, vp, pad)!;
    expect(cam.zoom).toBeGreaterThanOrEqual(10);
    expect(cam.zoom).toBeLessThanOrEqual(17);
    const c = project(cam.center, cam.zoom);
    for (const p of pts) {
      const q = project(p, cam.zoom);
      const x = q.x - c.x + vp.width / 2;
      const y = q.y - c.y + vp.height / 2;
      expect(x).toBeGreaterThanOrEqual(pad.left - 0.5);
      expect(x).toBeLessThanOrEqual(vp.width - pad.right + 0.5);
      expect(y).toBeGreaterThanOrEqual(pad.top - 0.5);
      expect(y).toBeLessThanOrEqual(vp.height - pad.bottom + 0.5);
    }
  });
  it('caps the zoom for a single stop and returns null for none', () => {
    expect(fitPointsCamera([pts[0]], vp, pad)!.zoom).toBe(17);
    expect(fitPointsCamera([], vp, pad)).toBeNull();
  });
});
