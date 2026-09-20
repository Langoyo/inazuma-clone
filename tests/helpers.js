// Shared setup for the E2E suite. The game has no unit-testable seams —
// gameplay logic lives entirely inside the Phaser scene — so these tests
// drive the real browser UI and, where a check needs to reach past what's
// visible on screen, read scene state through the `window.__scene` hook
// `main.js` exposes in dev builds only (see that file).

/** Waits for the roster to finish loading, then clicks through the
 *  landing page and mode-select panel (defaulting to solo) to reach the
 *  squad editor — every test needs it open, so this is done once here
 *  instead of repeated in each one. */
export async function waitForRosterLoaded(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
    { timeout: 15000 }
  );
  await page.click('#landing-play-btn');
  await page.click('#mode-solo-btn');
}

/** Randomizes a squad and confirms it, leaving a live match in progress. */
export async function startMatch(page, { clubOnly = true } = {}) {
  await page.click(clubOnly ? '#randomize-club-btn' : '#randomize-squad-btn');
  await page.click('#confirm-squad-btn');
  await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });
}

/** The first on-screen (within the current viewport) outfield player on
 *  team A, in both world and screen coordinates — dragging needs a point
 *  Playwright's mouse can actually land on. */
export async function findOnScreenPlayer(page, { viewportW = 420, viewportH = 900 } = {}) {
  return page.evaluate(({ viewportW, viewportH }) => {
    const s = window.__scene;
    const cam = s.cameras.main;
    for (const e of s.teamA) {
      if (e.slot === 0) continue; // skip the keeper, easier to reason about
      const sx = e.gfx.x - cam.scrollX, sy = e.gfx.y - cam.scrollY;
      if (sx > 20 && sx < viewportW - 20 && sy > 20 && sy < viewportH - 20) {
        return { id: e.id, screenX: sx, screenY: sy, worldX: e.gfx.x, worldY: e.gfx.y };
      }
    }
    return null;
  }, { viewportW, viewportH });
}
