import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('kickoff', () => {
  test('the side without the ball starts well back from halfway', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const shape = await page.evaluate(() => {
      const s = window.__scene;
      const half = s.FIELD_H / 2;
      const nearest = (team) => Math.min(...team.map((e) => Math.abs(e.body.position.y - half)));
      const kicking = s.possRole;
      return {
        kicking,
        nearestKicking: nearest(kicking === 'A' ? s.teamA : s.teamB),
        nearestDefending: nearest(kicking === 'A' ? s.teamB : s.teamA),
        takerIsGk: kicking === 'A' ? s.activeIdA === s.gkIdA : s.activeIdB === s.gkIdB,
      };
    });

    // Kicking side stays tight to the halfway line; the defending side
    // starts KICKOFF_DEFEND_GAP (150) back, clear of the centre circle.
    expect(shape.nearestKicking).toBeLessThan(30);
    expect(shape.nearestDefending).toBeGreaterThan(100);
    expect(shape.takerIsGk).toBe(false);
  });

  test('the second half is kicked off by the other team', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const firstHalfKickoff = await page.evaluate(() => window.__scene.kickoffRole);

    await page.evaluate(() => {
      window.__scene.matchClock.secondsRemaining = 0.05;
    });
    await page.waitForFunction(() => window.__scene.matchClock.half === 2, { timeout: 10000 });

    const secondHalfPoss = await page.evaluate(() => window.__scene.possRole);
    expect(secondHalfPoss).not.toBe(firstHalfKickoff);
  });

  test('half-time freezes play with a banner, then resumes on its own', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    await page.evaluate(() => {
      window.__scene.matchClock.secondsRemaining = 0.05;
    });
    await page.waitForFunction(() => window.__scene.matchClock.half === 2, { timeout: 10000 });

    const atTransition = await page.evaluate(() => ({
      paused: window.__scene.paused,
      title: window.__scene.confrontResult?.title,
    }));
    expect(atTransition.paused).toBe(true);
    expect(atTransition.title).toBe('Half time');

    const posBefore = await page.evaluate(() => {
      const e = window.__scene.teamA[3];
      return { x: e.body.position.x, y: e.body.position.y };
    });
    await page.waitForTimeout(1500); // comfortably inside the 3s pause
    const posAfter = await page.evaluate(() => {
      const e = window.__scene.teamA[3];
      return { x: e.body.position.x, y: e.body.position.y };
    });
    expect(posAfter).toEqual(posBefore);
    expect(await page.evaluate(() => window.__scene.paused)).toBe(true);

    await page.waitForFunction(() => window.__scene.paused === false, { timeout: 10000 });
    // The banner is cleared explicitly on resume, not left to _shiftTimers
    // (which would otherwise double how long it lingers — see GameScene.js).
    expect(await page.evaluate(() => window.__scene.confrontResult)).toBeNull();

    const secBefore = await page.evaluate(() => window.__scene.matchClock.secondsRemaining);
    await page.waitForTimeout(500);
    const secAfter = await page.evaluate(() => window.__scene.matchClock.secondsRemaining);
    expect(secAfter).toBeLessThan(secBefore);
  });
});

test.describe('goal sensors', () => {
  test('a stray ball into the net is not a goal — the keeper collects it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const before = await page.evaluate(() => ({ ...window.__scene.score }));
    await page.evaluate(() => {
      const s = window.__scene;
      s.possRole = null;
      s.confrontation = null;
      s.matter.body.setPosition(s.ball, { x: s.FIELD_W / 2, y: 60 });
      s.matter.body.setVelocity(s.ball, { x: 0, y: -14 }); // rolling toward the top net
    });

    // Read the snapshot in the very same tick the banner appears in — the
    // AI immediately controls the side that just collected the ball, and
    // a separate follow-up evaluate() gives it enough real time to have
    // already played a pass (which clears possRole again) before we look.
    const afterHandle = await page.waitForFunction(() => {
      const s = window.__scene;
      if (s.confrontResult?.title !== 'Keeper collects it') return false;
      return { score: { ...s.score }, poss: s.possRole, takerIsGk: s.activeIdB === s.gkIdB };
    }, { timeout: 3000 });
    const after = await afterHandle.jsonValue();
    expect(after.score).toEqual(before);
    expect(after.poss).toBe('B');
    expect(after.takerIsGk).toBe(true);
  });

  test('a real shot confrontation still scores', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const before = await page.evaluate(() => ({ ...window.__scene.score }));
    await page.evaluate(() => window.__scene._onGoal('a'));
    const after = await page.evaluate(() => ({
      score: { ...window.__scene.score },
      poss: window.__scene.possRole,
    }));

    expect(after.score.a).toBe(before.a + 1);
    expect(after.poss).toBe('B'); // whoever conceded restarts
  });
});
