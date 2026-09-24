import { test, expect } from '@playwright/test';

// Sound effects (src/audio/sfx.js) are synthesized with the Web Audio API,
// which isn't meaningfully assertable in Playwright — actually hearing a
// kick/goal/whistle is verified manually in a real browser. What's covered
// here is the one piece of durable state: the mute preference persisting
// across a reload, the same localStorage round-trip pattern the squad-save
// feature already uses.

test.describe('sound effects toggle', () => {
  test('persists the mute preference across a reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );

    await expect(page.locator('#sfx-toggle-btn')).toHaveText('🔊');
    await page.click('#sfx-toggle-btn');
    await expect(page.locator('#sfx-toggle-btn')).toHaveText('🔇');
    expect(await page.evaluate(() => localStorage.getItem('inazuma-clone:sfx:v1'))).toBe('off');

    await page.reload();
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await expect(page.locator('#sfx-toggle-btn')).toHaveText('🔇');

    await page.click('#sfx-toggle-btn');
    await expect(page.locator('#sfx-toggle-btn')).toHaveText('🔊');
    expect(await page.evaluate(() => localStorage.getItem('inazuma-clone:sfx:v1'))).toBe('on');
  });

  test('isSfxEnabled/setSfxEnabled round-trip through localStorage directly', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const mod = await import('/src/audio/sfx.js');
      const initial = mod.isSfxEnabled();
      mod.setSfxEnabled(false);
      const afterOff = mod.isSfxEnabled();
      mod.setSfxEnabled(true);
      const afterOn = mod.isSfxEnabled();
      return { initial, afterOff, afterOn };
    });
    expect(result.initial).toBe(true);
    expect(result.afterOff).toBe(false);
    expect(result.afterOn).toBe(true);
  });
});
