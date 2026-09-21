import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('player name labels', () => {
  test('a name is hidden rather than drawn on top of one already shown', async ({ page }) => {
    // Two overlapping labels are unreadable whatever the font, and with a
    // plate behind each the pair butts together and reads as one word.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const stacked = await page.evaluate(() => {
      const s = window.__scene;
      const [a, b, c] = s.teamA.filter((e) => e.body && e.slot !== 0);
      const at = { x: a.body.position.x, y: a.body.position.y };
      for (const e of [b, c]) s.matter.body.setPosition(e.body, { x: at.x + 6, y: at.y + 4 });
      s._syncGfx();
      return [a, b, c].map((e) => e.label.visible);
    });
    expect(stacked.filter(Boolean)).toHaveLength(1);
  });

  test('which one wins is stable frame to frame, so the pair does not flicker', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const patterns = await page.evaluate(() => {
      const s = window.__scene;
      const [a, b] = s.teamA.filter((e) => e.body && e.slot !== 0);
      s.matter.body.setPosition(b.body, { x: a.body.position.x + 6, y: a.body.position.y + 4 });
      const seen = new Set();
      for (let i = 0; i < 8; i++) {
        s._syncGfx();
        seen.add([...s.teamA, ...s.teamB].map((e) => (e.label.visible ? 1 : 0)).join(''));
      }
      return seen.size;
    });
    expect(patterns).toBe(1);
  });

  test('a player off the pitch keeps their name hidden', async ({ page }) => {
    // Declutter only ever hides a label — it must not bring back one that
    // a sending-off or substitution took away.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const stillHidden = await page.evaluate(() => {
      const s = window.__scene;
      const e = s.teamA.find((x) => x.body && x.slot !== 0);
      e.gfx.setVisible(false); e.label.setVisible(false);
      s._syncGfx();
      return e.label.visible;
    });
    expect(stillHidden).toBe(false);
  });
});

test.describe('keeper stays home', () => {
  test('a keeper whose drawn line runs out goes back to their post, not on up the pitch', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const keeper = s.teamA.find((e) => e.slot === 0);
      s.currentPossession = s.role; s.possRole = s.role;
      // A single waypoint they're already standing on: exactly the
      // "drawn line completed" case that used to hand them a carry-on.
      s.myPaths.set(keeper.id, [{ x: keeper.body.position.x, y: keeper.body.position.y }]);
      const targets = s._computeTargets();
      const base = s._offBallTarget(s.role, keeper, s.activeIdA, true, null);
      return {
        gotTarget: targets.some((t) => t.id === keeper.id),
        pathLeft: s.myPaths.has(keeper.id),
        autoPath: s.autoPathIds.has(keeper.id),
        baseY: base.y,
        ownGoalY: s.role === 'A' ? s.FIELD_H : 0,
        halfway: s.FIELD_H / 2,
      };
    });

    expect(result.gotTarget).toBe(false);
    expect(result.pathLeft).toBe(false);
    expect(result.autoPath).toBe(false);
    // Left to the off-ball logic they sit in their own defensive third,
    // in front of the goal they are meant to be keeping.
    expect(Math.abs(result.baseY - result.ownGoalY)).toBeLessThan(Math.abs(result.halfway - result.ownGoalY));
  });

  test('an outfielder in the same situation still carries the run on', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const e = s.teamA.find((x) => x.body && x.slot !== 0);
      s.currentPossession = s.role; s.possRole = s.role;
      s.myPaths.set(e.id, [{ x: e.body.position.x, y: e.body.position.y }]);
      const targets = s._computeTargets();
      return { gotTarget: targets.some((t) => t.id === e.id), autoPath: s.autoPathIds.has(e.id) };
    });
    expect(result.gotTarget).toBe(true);
    expect(result.autoPath).toBe(true);
  });
});
