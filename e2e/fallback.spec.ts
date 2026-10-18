// AC-L1-15..19: every widget failure lands on the native events UI (houses never blocked), and the single-dialog handoff in both
// directions (AC-L1-17b/c). Widget build unless stated.
import type { Page } from '@playwright/test';
import { boot, DIALOG_PROBE, dialogCount, dialogLog, deepFocus, expect, nativeSheet, SEASONS, test, widgetReady, widgetSheet } from './harness';
import { FIXTURES, VIBES_ONLY_ID } from './routes';

const season = 'halloween' as const;
const LIST = '/?layer=events&view=list';

async function expectNativeList(page: Page) {
  await expect(page.locator('.list .erow').first()).toBeVisible({ timeout: 6000 });
  await expect(page.locator('[data-tv-list]')).toHaveCount(0);
  await expect(page.locator('.list .erow')).toHaveCount(FIXTURES[season].lightsRows.length);
}
const noCredit = async (page: Page) => expect(page.locator('.tv-credit')).toHaveCount(0);

test('AC-L1-15 API 503: native list, houses and Add a house work, no credit', async ({ page }) => {
  await boot(page, 'vibes', LIST, { season, api: '503' });
  await expectNativeList(page);
  await noCredit(page);
  await page.getByRole('button', { name: /^Houses/ }).filter({ visible: true }).first().click();
  await expect(page.locator('.list').getByRole('button', { name: /101 Fakepine Ln, Truckee, CA/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a house or an event' }).click();
  await page.locator('aside[aria-label="Add to the map"] .opt').first().click();
  await expect(page.locator('aside[role=dialog][aria-label="Add a house"]')).toBeVisible();
});

test('AC-L1-16 widget file aborted: native within 5 s', async ({ page }) => {
  const t0 = Date.now();
  await boot(page, 'vibes', LIST, { season, widget: 'abort' });
  await expectNativeList(page);
  expect(Date.now() - t0).toBeLessThan(5000 + 3000); // boot + render slack over the 5 s budget
  await noCredit(page);
});

test('AC-L1-16 widget file with one byte changed: SRI blocks it, native, console names integrity', async ({ page }) => {
  const r = await boot(page, 'vibes', LIST, { season, widget: 'tamper' });
  await expectNativeList(page);
  await noCredit(page);
  await expect.poll(() => r.consoleErrors.join('\n')).toMatch(/integrity/i);
  expect(await page.evaluate(() => 'TruckeeVibes' in window)).toBe(false);
});

for (const api of ['held', 'stale', 'old'] as const) {
  test(`AC-L1-17 ${api} envelope: native`, async ({ page }) => {
    const r = await boot(page, 'vibes', LIST, { season, api });
    await expect.poll(() => r.apiCalls).toBeGreaterThan(0);
    await expectNativeList(page);
    await noCredit(page);
  });
}

// ---- AC-L1-17b / 17c: one dialog at most, in every committed DOM state --------------------------------------

async function openWidgetRow(page: Page, id: string) {
  await widgetReady(page, '[data-tv-list]');
  await page.locator(`[data-tv-list] .erow[data-id="${id}"]`).click();
  await expect(widgetSheet(page)).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('event')).toBe(id);
}
const refresh = (page: Page) => page.clock.fastForward(5 * 60_000 + 1000); // jump: due timers fire once (the 5-min refresh)

for (const to of ['held', 'stale', '503'] as const) {
  test(`AC-L1-17b widget -> native mid-session (${to}): one dialog, same id, native list`, async ({ page }) => {
    await page.addInitScript(DIALOG_PROBE);
    const r = await boot(page, 'vibes', LIST, { season });
    const id = FIXTURES[season].lightsRows[2].id;
    await openWidgetRow(page, id);
    r.api = to;
    await refresh(page);
    await expect(nativeSheet(page)).toBeVisible();
    await expect(nativeSheet(page).locator('h2')).toHaveText(FIXTURES[season].envelope.events.find((e) => e.id === id)!.title as string);
    await expect(page.locator('[data-tv-overlay] aside')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('event')).toBe(id);
    await expectNativeList(page);
    expect(await dialogCount(page)).toBe(1);
    expect((await dialogLog(page)).max).toBe(1);
  });
}

test('AC-L1-17b widget -> native when the open event has no native copy: no dialog, ?event= removed', async ({ page }) => {
  await page.addInitScript(DIALOG_PROBE);
  const r = await boot(page, 'vibes', LIST, { season, vibesOnly: true });
  await openWidgetRow(page, VIBES_ONLY_ID);
  r.api = 'held';
  await refresh(page);
  await expectNativeList(page);
  await expect.poll(() => dialogCount(page)).toBe(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('event')).toBeNull();
  expect((await dialogLog(page)).max).toBe(1);
});

test('AC-L1-17c native -> widget recovery: native sheet unmounts before the panel appears, focus, Escape', async ({ page }) => {
  await page.addInitScript(DIALOG_PROBE);
  const r = await boot(page, 'vibes', LIST, { season });
  const id = FIXTURES[season].lightsRows[4].id;
  await openWidgetRow(page, id);
  r.api = 'held';
  await refresh(page);
  await expect(nativeSheet(page)).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __tvDialogs: { log: string[] } }).__tvDialogs.log.length = 0));
  r.api = 'ok';
  await refresh(page);
  await expect(widgetSheet(page)).toBeVisible();
  await expect(nativeSheet(page)).toHaveCount(0);
  const log = await dialogLog(page);
  expect(log.max).toBe(1);
  const rm = log.log.indexOf('remove-native');
  const add = log.log.indexOf('add-widget');
  expect(rm).toBeGreaterThanOrEqual(0);
  expect(add).toBeGreaterThan(rm);
  await expect(widgetSheet(page).locator('h2')).toHaveText(FIXTURES[season].envelope.events.find((e) => e.id === id)!.title as string);
  expect((await deepFocus(page)).tag).toBe('h2');
  expect(new URL(page.url()).searchParams.get('event')).toBe(id);
  await widgetReady(page, '[data-tv-list]');
  await page.keyboard.press('Escape');
  await expect(widgetSheet(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('event')).toBeNull();
});

test('AC-L1-17c a pin tap during the native -> widget handoff is applied once, after it', async ({ page }) => {
  await page.addInitScript(DIALOG_PROBE);
  const r = await boot(page, 'vibes', '/?layer=both', { season });
  await expect.poll(async () => (await page.locator('.empty').getAttribute('data-event-ids'))?.length ?? 0).toBeGreaterThan(0);
  const a = FIXTURES[season].lightsRows[1].id;
  const b = FIXTURES[season].lightsRows[5].id;
  const tap = (x: string) => page.evaluate((id) => (window as unknown as { __tlStubSelectEvent(id: string): void }).__tlStubSelectEvent(id), x);
  await tap(a);
  await expect(widgetSheet(page)).toBeVisible();
  r.api = 'held';
  await refresh(page);
  await expect(nativeSheet(page)).toBeVisible();
  // Tap B from inside the mutation record that removes the native sheet: after M1's commit, before the effect opens the panel.
  await page.evaluate((id) => {
    const w = window as unknown as { __tvDialogs: { log: string[]; onNativeRemoved?: () => void }; __tlStubSelectEvent(id: string): void };
    w.__tvDialogs.log.length = 0;
    w.__tvDialogs.onNativeRemoved = () => {
      w.__tvDialogs.onNativeRemoved = undefined;
      w.__tvDialogs.log.push('tap');
      w.__tlStubSelectEvent(id);
    };
  }, b);
  r.api = 'ok';
  await refresh(page);
  await expect(widgetSheet(page)).toBeVisible();
  await expect(widgetSheet(page).locator('h2')).toHaveText(FIXTURES[season].envelope.events.find((e) => e.id === b)!.title as string);
  await expect.poll(() => new URL(page.url()).searchParams.get('event')).toBe(b);
  const log = await dialogLog(page);
  expect(log.log.slice(0, 2)).toEqual(['remove-native', 'tap']);
  expect(log.log.filter((x) => x === 'tap')).toHaveLength(1);
  expect(log.max).toBe(1);
  expect(await dialogCount(page)).toBe(1);
});

// ---- AC-L1-18 / 19: no request to truckeevibes.com unless the widget is on ------------------------------------

for (const build of ['lights', 'vibes'] as const) {
  test(`AC-L1-18 no events capability -> no truckeevibes.com request (${build})`, async ({ page }) => {
    const r = await boot(page, build, '/?view=list', { season, noEvents: true });
    await expect(page.locator('.list').getByRole('button', { name: /101 Fakepine Ln, Truckee, CA/ })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(r.vibesRequests).toEqual([]);
  });
}

for (const s of SEASONS) {
  test(`AC-L1-19 provider lights -> no truckeevibes.com request (${s})`, async ({ page }) => {
    const r = await boot(page, 'lights', LIST, { season: s });
    await expect(page.locator('.list .erow').first()).toBeVisible();
    await page.locator('.list .erow').first().click();
    await expect(nativeSheet(page)).toBeVisible();
    await page.waitForTimeout(1000);
    expect(r.vibesRequests).toEqual([]);
  });
}

// ---- review P2: the 5 s loading budget runs from page start, whatever the API does ---------------------------------

test('AC-L1 budget: a hanging API shows the native list within 5 s of page start', async ({ page }) => {
  const t0 = Date.now();
  await boot(page, 'vibes', LIST, { season, api: 'hang' });
  await expectNativeList(page);
  expect(Date.now() - t0).toBeLessThan(5000 + 1500); // budget + boot/render slack (the widget's own API timeout is 10 s)
});

test('AC-L1 budget: a slow API falls back at 5 s, then the widget takes over when it is ready', async ({ page }) => {
  const t0 = Date.now();
  await boot(page, 'vibes', LIST, { season, apiDelayMs: 7000 });
  await expectNativeList(page);
  expect(Date.now() - t0).toBeLessThan(5000 + 1500);
  await widgetReady(page, '[data-tv-list]');
  await expect(page.locator('.list .erow:not([data-tv-list] *)')).toHaveCount(0);
});

// ---- review P2: Add flows keep the single-dialog invariant ------------------------------------------------------------

test('AC-L1-17 Add chooser and Add sheets never sit beside the widget event panel', async ({ page }) => {
  await page.addInitScript(DIALOG_PROBE);
  await boot(page, 'vibes', LIST, { season });
  await openWidgetRow(page, FIXTURES[season].lightsRows[2].id);
  // Keyboard path (the panel has no focus trap): Header Add while the event panel is open.
  await page.getByRole('button', { name: 'Add a house or an event' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('aside[role=dialog][aria-label="Add to the map"]')).toBeVisible();
  await expect(widgetSheet(page)).toHaveCount(0);
  expect(await dialogCount(page)).toBe(1);
  await page.locator('aside[aria-label="Add to the map"] .opt').nth(1).click();
  await expect(page.locator('aside[role=dialog][aria-label="Add an event"]')).toBeVisible();
  expect(await dialogCount(page)).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => dialogCount(page)).toBe(0);
  await expect(widgetSheet(page)).toHaveCount(0);
  // Event panel -> Header Add -> Add a house.
  await page.locator('[data-tv-list] .erow').first().click();
  await expect(widgetSheet(page)).toBeVisible();
  await page.getByRole('button', { name: 'Add a house or an event' }).focus();
  await page.keyboard.press('Enter');
  await page.locator('aside[aria-label="Add to the map"] .opt').first().click();
  await expect(page.locator('aside[role=dialog][aria-label="Add a house"]')).toBeVisible();
  expect(await dialogCount(page)).toBe(1);
  expect((await dialogLog(page)).max).toBe(1);
});
