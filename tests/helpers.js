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
export async function startMatch(page, { topOnly = true } = {}) {
  await page.click(topOnly ? '#randomize-top-btn' : '#randomize-squad-btn');
  await page.click('#confirm-squad-btn');
  await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });
}

/** The first on-screen (within the current viewport) outfield player on
 *  team A, in both world and screen coordinates — dragging needs a point
 *  Playwright's mouse can actually land on.
 *
 *  Being inside the viewport isn't enough for that: the HUD puts real
 *  controls over the pitch (the camera pad bottom-left, the subs button
 *  bottom-right), and a press on one of those is theirs, not the canvas's.
 *  A player who happens to be standing under one is simply not grabbable,
 *  so this skips them rather than handing back a point whose press would
 *  never reach the game — which is what made the drag tests intermittent,
 *  depending on where players had drifted to by kickoff. */
export async function findOnScreenPlayer(page, { viewportW = 420, viewportH = 900 } = {}) {
  return page.evaluate(({ viewportW, viewportH }) => {
    const s = window.__scene;
    const cam = s.cameras.main;
    for (const e of s.teamA) {
      if (e.slot === 0) continue; // skip the keeper, easier to reason about
      const sx = e.gfx.x - cam.scrollX, sy = e.gfx.y - cam.scrollY;
      if (sx <= 20 || sx >= viewportW - 20 || sy <= 20 || sy >= viewportH - 20) continue;
      const hit = document.elementFromPoint(sx, sy);
      if (!hit || hit.tagName !== 'CANVAS') continue;
      return { id: e.id, screenX: sx, screenY: sy, worldX: e.gfx.x, worldY: e.gfx.y };
    }
    return null;
  }, { viewportW, viewportH });
}
