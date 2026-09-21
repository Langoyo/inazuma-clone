import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

test.describe('random squad builders', () => {
  test('"Random (top players)" only draws from the top-rated players at each position', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');

    const result = await page.evaluate(() => {
      const s = window.__scene;
      // Same call _randomize(true) itself makes — a pure function of the
      // roster, so recomputing it here after the fact gives back the exact
      // same pool to check membership against.
      const topPool = new Set(s._topPercentileByPosition(s.rosterAll).map((p) => p.id));
      const ids = s.squadSlots.filter(Boolean);
      const benchIds = [...s.benchIds];
      return {
        count: ids.length,
        allInTopPool: ids.every((id) => topPool.has(id)),
        benchAllInTopPool: benchIds.every((id) => topPool.has(id)),
      };
    });

    expect(result.count).toBe(11);
    expect(result.allInTopPool).toBe(true);
    expect(result.benchAllInTopPool).toBe(true);
  });

  test('the plain "Random" button draws from the whole roster, unaffected', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-squad-btn');

    const count = await page.evaluate(() => window.__scene.squadSlots.filter(Boolean).length);
    expect(count).toBe(11);
    // Not asserting team composition here — by design it's a mixed pool,
    // there's nothing specific to guarantee about it.
  });
});

test.describe('team color selector', () => {
  test('picking a color overrides the auto-derived kit color on the pitch', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    await page.fill('#my-team-color', '#00ff00');
    await page.dispatchEvent('#my-team-color', 'input');
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });

    const info = await page.evaluate(() => {
      const s = window.__scene;
      return { role: s.role, teamColor: s._css3(s.role === 'A' ? s.teamColorA : s.teamColorB) };
    });
    expect(info.teamColor).toBe('#00ff00');
  });

  test('leaving it untouched still falls back to the auto-derived squad color', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    const expectedColor = await page.evaluate(() => {
      const s = window.__scene;
      return s._css3(s._squadColor(s.squadSlots.filter(Boolean), 0x3399ff));
    });
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });

    const info = await page.evaluate(() => {
      const s = window.__scene;
      return { role: s.role, teamColor: s._css3(s.role === 'A' ? s.teamColorA : s.teamColorB) };
    });
    expect(info.teamColor).toBe(expectedColor);
  });
});

test.describe('player list pagination', () => {
  test('pages through results and resets to page 1 on a new search', async ({ page }) => {
    await waitForRosterLoaded(page);
    // Below 900px, Browse Players is a drawer that starts closed (see
    // squadSectionOpen) — this test's viewport is 420px (playwright.config.js).
    await page.click('button[data-view="players"]');

    const page1Info = await page.locator('#pick-page-info').textContent();
    expect(page1Info).toMatch(/^Page 1\//);
    await expect(page.locator('#pick-prev-btn')).toBeDisabled();

    const firstNameBefore = await page.locator('#squad-pick-list .pick-name').first().textContent();
    await page.click('#pick-next-btn');
    const page2Info = await page.locator('#pick-page-info').textContent();
    expect(page2Info).toMatch(/^Page 2\//);
    const firstNameAfter = await page.locator('#squad-pick-list .pick-name').first().textContent();
    expect(firstNameAfter).not.toBe(firstNameBefore);

    // Typing a search resets back to page 1, even mid-way through the list.
    await page.fill('#squad-search', 'a');
    await page.waitForTimeout(150);
    const afterSearchInfo = await page.locator('#pick-page-info').textContent();
    expect(afterSearchInfo).toMatch(/^Page 1\//);
  });
});

test.describe('formations', () => {
  const formations = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '4-5-1', '5-3-2', '3-4-3', '4-1-4-1', '5-4-1', '4-3-1-2'];

  for (const formation of formations) {
    test(`${formation} places exactly 11 pins`, async ({ page }) => {
      await waitForRosterLoaded(page);
      await page.selectOption('#formation-select', formation);
      await page.waitForTimeout(100);
      const count = await page.locator('#formation-pitch .slot-pin').count();
      expect(count).toBe(11);
    });
  }

  test('the Team panel picks up all ten as preset buttons', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForTimeout(300);
    await page.click('#sub-button');
    await page.waitForTimeout(150);
    const count = await page.locator('#formation-preset-btns button').count();
    expect(count).toBe(formations.length);
  });
});

test.describe('bench slots', () => {
  test('empty bench spots are selectable from the start, not just after one is filled', async ({ page }) => {
    // Regression test: the bench renders all 5 spots from the start (empty
    // ones included, so there's a visible hint there's a bench to fill at
    // all), but the empty placeholders never got a click handler wired up —
    // only occupied ones did — so tapping one to place a player did nothing.
    await waitForRosterLoaded(page);
    // Below 900px, Browse Players is a drawer that starts closed (see
    // squadSectionOpen) — this test's viewport is 420px (playwright.config.js).
    await page.click('button[data-view="players"]');

    const emptyPins = page.locator('#bench-strip .bench-pin.empty');
    await expect(emptyPins).toHaveCount(5);

    await emptyPins.first().click();
    const firstCard = page.locator('#squad-pick-list .pick-card').first();
    const playerName = await firstCard.locator('.pick-name').textContent();
    await firstCard.click();

    const benchNames = await page.evaluate(() => {
      const s = window.__scene;
      return [...s.benchIds].map((id) => {
        const p = s.rosterAll.find((r) => r.id === id);
        return p?.nickname || p?.name;
      });
    });
    expect(benchNames).toContain(playerName);
    await expect(page.locator('#bench-strip .bench-pin.empty')).toHaveCount(4);
  });
});

test.describe('collapsible Formation / Browse Players sections', () => {
  test('toggling Formation while Browse Players is closed leaves it closed', async ({ page }) => {
    await waitForRosterLoaded(page);
    // Below 900px, Browse Players is a drawer that starts closed (see
    // squadSectionOpen), covering most of the screen — including the
    // Formation toggle button itself — once open, so this direction (both
    // toggles reachable) only works while it's still closed.
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);

    await page.click('button[data-view="formation"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-editor')).toHaveClass(/hidden-section/);
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);

    await page.click('button[data-view="formation"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-editor')).not.toHaveClass(/hidden-section/);
  });

  test('closing the Browse Players drawer via its own close button leaves Formation untouched', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);
    await expect(page.locator('#squad-editor')).not.toHaveClass(/hidden-section/);

    // The drawer covers the Formation toggle button itself while open (see
    // above), so its own "✕" is the only way to close it from here.
    await page.click('#squad-players-drawer-close');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);
    await expect(page.locator('#squad-editor')).not.toHaveClass(/hidden-section/);
  });

  test('tapping outside the drawer closes it, but tapping the pitch/bench beside it does not', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    // A tap inside the drawer itself is obviously not "outside" it.
    await page.click('#squad-search');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    // Nor is a tap on the pitch/bench sliver still visible beside it —
    // that's meant to stay usable (arm a bench spot, then pick from the
    // still-open drawer), not dismiss the drawer out from under it. The
    // bench-slots test above already exercises this exact combo end to
    // end; this just checks the drawer itself doesn't close mid-way.
    await page.locator('#bench-strip .bench-pin.empty').first().click();
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    // A tap genuinely outside both (the panel's top-left corner, above and
    // left of the pitch, which the drawer doesn't reach) does close it.
    await page.mouse.click(10, 10);
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);
  });
});
