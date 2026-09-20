import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

test.describe('random squad builders', () => {
  test('"Random (club players)" only draws from players with a real team', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-club-btn');

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const ids = s.squadSlots.filter(Boolean);
      const players = ids.map((id) => s.rosterAll.find((p) => p.id === id));
      const benchPlayers = [...s.benchIds].map((id) => s.rosterAll.find((p) => p.id === id));
      return {
        count: ids.length,
        allHaveTeam: players.every((p) => p && p.team),
        benchAllHaveTeam: benchPlayers.every((p) => p && p.team),
      };
    });

    expect(result.count).toBe(11);
    expect(result.allHaveTeam).toBe(true);
    expect(result.benchAllHaveTeam).toBe(true);
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

test.describe('player list pagination', () => {
  test('pages through results and resets to page 1 on a new search', async ({ page }) => {
    await waitForRosterLoaded(page);

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
    await page.click('#randomize-club-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForTimeout(300);
    await page.click('#sub-button');
    await page.waitForTimeout(150);
    const count = await page.locator('#formation-preset-btns button').count();
    expect(count).toBe(formations.length);
  });
});

test.describe('collapsible Formation / Browse Players sections', () => {
  test('each toggle button only collapses its own section', async ({ page }) => {
    await waitForRosterLoaded(page);

    await page.click('button[data-view="formation"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-editor')).toHaveClass(/hidden-section/);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    await page.click('button[data-view="formation"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-editor')).not.toHaveClass(/hidden-section/);
  });
});
