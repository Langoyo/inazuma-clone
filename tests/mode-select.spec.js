import { test, expect } from '@playwright/test';

test.describe('landing page and mode select', () => {
  test('landing page leads into a mode choice, solo keeps the rival tab', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );

    await expect(page.locator('#landing-panel')).toBeVisible();
    await expect(page.locator('#landing-title')).toHaveText('Inazuma Showdown');
    await expect(page.locator('#mode-select-panel')).toBeHidden();
    await expect(page.locator('#squad-editor-panel')).toBeHidden();

    await page.click('#landing-play-btn');
    await expect(page.locator('#landing-panel')).toBeHidden();
    await expect(page.locator('#mode-select-panel')).toBeVisible();

    await page.click('#mode-solo-btn');
    await expect(page.locator('#mode-select-panel')).toBeHidden();
    await expect(page.locator('#squad-editor-panel')).toBeVisible();
    await expect(page.locator('#squad-side-tabs')).toBeVisible();
    // Both match-settings rows are meaningful solo — nothing to hide.
    await expect(page.locator('#ai-difficulty-row')).toBeVisible();
    await expect(page.locator('#half-length-row')).toBeVisible();
  });

  test('multiplayer mode shows your own room code and hides the rival tab', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');

    await expect(page.locator('#mode-multi-panel')).toBeVisible();
    const roomCode = await page.evaluate(() => window.__scene.roomCode);
    await expect(page.locator('#mode-own-code')).toHaveText(roomCode);

    // Leaving the join field empty and continuing keeps using your own code
    // (the room you're sharing), rather than treating it as an error.
    await page.click('#mode-multi-start-btn');
    await expect(page.locator('#squad-editor-panel')).toBeVisible();
    await expect(page.locator('#squad-side-tabs')).toBeHidden();
    expect(await page.evaluate(() => window.__scene.roomCode)).toBe(roomCode);
    expect(await page.evaluate(() => window.__scene.uiMode)).toBe('multiplayer');
  });

  test('multiplayer hides AI difficulty entirely, and half length only for the host', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');

    // No AI plays in multiplayer, so its difficulty has nothing to affect.
    await expect(page.locator('#ai-difficulty-row')).toBeHidden();
    // Alone in the room, we're the provisional host — half length is ours to set.
    expect(await page.evaluate(() => window.__scene.role)).toBe('A');
    await expect(page.locator('#half-length-row')).toBeVisible();

    // Simulate a peer whose id sorts first, flipping us to the guest — same
    // technique networking.spec.js's own role-sync regression test uses.
    await page.evaluate(() => {
      const s = window.__scene;
      s.net.isHost = () => false;
      s._syncRoleFromNet();
    });
    expect(await page.evaluate(() => window.__scene.role)).toBe('B');
    await expect(page.locator('#half-length-row')).toBeHidden();
  });
});

test.describe('half length selection', () => {
  test('changing it before kickoff updates the pre-match clock, default is 3 minutes', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-solo-btn');

    expect(await page.locator('#half-length-select').inputValue()).toBe('3');
    expect(await page.evaluate(() => window.__scene.matchClock.secondsRemaining)).toBe(180);

    await page.selectOption('#half-length-select', '7');
    expect(await page.evaluate(() => window.__scene.halfLengthS)).toBe(420);
    expect(await page.evaluate(() => window.__scene.matchClock.secondsRemaining)).toBe(420);
  });
});

test.describe('info icons', () => {
  test('clicking one opens the shared modal with its own title and body, closing hides it', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-solo-btn');

    // Several info icons exist across the app (including inside panels that
    // are hidden right now, like the in-match Team panel) — target one
    // that's actually visible on screen: the squad editor's own.
    await expect(page.locator('#info-modal')).toBeHidden();
    await page.locator('#squad-editor-panel .info-icon').first().click();
    await expect(page.locator('#info-modal')).toBeVisible();
    const title = await page.locator('#info-modal-title').textContent();
    expect(title?.length).toBeGreaterThan(0);
    const body = await page.locator('#info-modal-body').textContent();
    expect(body?.length).toBeGreaterThan(0);

    await page.click('#info-modal-close');
    await expect(page.locator('#info-modal')).toBeHidden();
  });
});
