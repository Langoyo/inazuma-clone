import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('team panel — rival formation view', () => {
  test('switching to "Rival Team" shows their lineup read-only, not the sub/swap flow', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });

    // Starts on "Your Team": the pitch shown is your own side's team.
    const myRole = await page.evaluate(() => window.__scene.role);
    const beforeIds = await page.evaluate((role) => {
      const s = window.__scene;
      const team = role === 'A' ? s.teamA : s.teamB;
      return team.map((e) => e.id).sort();
    }, myRole);
    const pitchIdsBefore = await page.locator('#sub-list-inner .slot-pin[data-roster-id]').evaluateAll(
      (els) => els.map((el) => el.dataset.rosterId).sort()
    );
    expect(pitchIdsBefore).toEqual(beforeIds.map(String).sort());

    await page.click('#sub-panel-side-tabs .sub-panel-side-tab[data-side="rival"]');
    await page.waitForTimeout(100);

    // Formation presets disappear entirely — they'd change your own
    // formation, which means nothing while looking at the rival's side.
    await expect(page.locator('#formation-preset-btns')).toBeHidden();
    await expect(page.locator('#sub-panel-state')).toHaveText(/read-only/);

    // The pitch now shows the *other* role's team.
    const rivalIds = await page.evaluate((role) => {
      const s = window.__scene;
      const oppRole = role === 'A' ? 'B' : 'A';
      const team = oppRole === 'A' ? s.teamA : s.teamB;
      return team.map((e) => e.id).sort();
    }, myRole);
    const pitchIdsAfter = await page.locator('#sub-list-inner .slot-pin[data-roster-id]').evaluateAll(
      (els) => els.map((el) => el.dataset.rosterId).sort()
    );
    expect(pitchIdsAfter).toEqual(rivalIds.map(String).sort());

    // Tapping a rival pin opens their read-only stats, not a sub selection
    // (which would otherwise let a rival pin pair with one of your own).
    await page.locator('#sub-list-inner .slot-pin[data-roster-id]').first().click();
    await page.waitForTimeout(150);
    const afterTap = await page.evaluate(() => ({
      subSel: window.__scene.subSel,
      panelDisplay: document.getElementById('player-stat-panel').style.display,
    }));
    expect(afterTap.subSel).toBeNull();
    expect(afterTap.panelDisplay).toBe('block');

    // Switching back to "Your Team" restores the normal editable view.
    await page.click('#player-stat-panel button');
    await page.click('#sub-panel-side-tabs .sub-panel-side-tab[data-side="me"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#formation-preset-btns')).toBeVisible();
    expect(await page.evaluate(() => window.__scene.subPanelSide)).toBe('me');
  });

  test('reopening the panel always resets back to "Your Team"', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });
    await page.click('#sub-panel-side-tabs .sub-panel-side-tab[data-side="rival"]');
    await page.waitForTimeout(100);

    await page.click('#sub-cancel-btn');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === false, { timeout: 2000 });
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });

    expect(await page.evaluate(() => window.__scene.subPanelSide)).toBe('me');
    await expect(page.locator('#formation-preset-btns')).toBeVisible();
  });
});
