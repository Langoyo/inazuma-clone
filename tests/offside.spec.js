import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// A attacks toward y=0 (B's goal); FIELD_H is 1520, so halfway is y=760.
// Coordinates below place B's back line at y=300 (deep, near their own
// goal) and vary where the receiving A player stands relative to it.

test.describe('offside', () => {
  test('a pass to a teammate ahead of the last two defenders is flagged, awarding the defending side a free kick', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      s.confrontation = null;

      const bOutfield = s.teamB.filter((e) => e.slot !== 0);
      bOutfield.forEach((e, i) => s.matter.body.setPosition(e.body, { x: 400 + i * 5, y: 300 }));
      const passer = s.teamA.find((e) => e.slot !== 0);
      const receiver = s.teamA.find((e) => e.slot !== 0 && e.id !== passer.id);
      s.matter.body.setPosition(passer.body, { x: 400, y: 900 }); // in A's own half
      s.matter.body.setPosition(receiver.body, { x: 420, y: 50 }); // well past B's back line

      s.possRole = 'A';
      s._setActive('A', passer.id);
      s._doPass('A', { x: receiver.body.position.x, y: receiver.body.position.y });
      const flaggedAtPass = !!(s.offsideFlag && s.offsideFlag.role === 'A' && s.offsideFlag.ids.has(receiver.id));

      const scoreBefore = { ...s.score };
      // Simulate the ball reaching the flagged receiver directly, the same
      // way this suite's other tests bypass real Matter collisions for
      // anything gated behind one.
      s._collisions({ pairs: [{ bodyA: s.ball, bodyB: receiver.body }] });

      return {
        flaggedAtPass,
        offsideClearedAfter: s.offsideFlag === null,
        possAfter: s.possRole,
        titleAfter: s.confrontResult?.title,
        scoreUnchanged: s.score.a === scoreBefore.a && s.score.b === scoreBefore.b,
      };
    });

    expect(result.flaggedAtPass).toBe(true);
    expect(result.offsideClearedAfter).toBe(true);
    expect(result.possAfter).toBe('B'); // the defending side gets the free kick
    expect(result.titleAfter).toContain('Offside');
    expect(result.scoreUnchanged).toBe(true);
  });

  test('a real pass through the physics loop is still flagged once the ball actually reaches the receiver', async ({ page }) => {
    // Regression test: the flagged-at-pass-time check above calls
    // _collisions directly, which doesn't exercise the real path a pass
    // actually takes — _updatePassFlight ticking every frame as the ball
    // rolls toward the receiver. A prior fix that cleared offsideFlag
    // whenever a pass's tracked "flight" ended broke this silently: that
    // flight only covers the lofted arc (PASS_LOFT_FRAC of the distance),
    // so it ends well before the ball actually reaches anyone, clearing
    // the flag before the real collision could ever fire.
    await waitForRosterLoaded(page);
    await startMatch(page);

    await page.evaluate(() => {
      const s = window.__scene;
      s.confrontation = null;
      const bOutfield = s.teamB.filter((e) => e.slot !== 0);
      bOutfield.forEach((e, i) => s.matter.body.setPosition(e.body, { x: 400 + i * 5, y: 300 }));
      const passer = s.teamA.find((e) => e.slot !== 0);
      const receiver = s.teamA.find((e) => e.slot !== 0 && e.id !== passer.id);
      // Keep the receiver still and out of anyone else's way so the ball
      // has a clear, short run to them — a real Matter collision, not a
      // simulated one.
      s.matter.body.setPosition(passer.body, { x: 400, y: 400 });
      s.matter.body.setPosition(receiver.body, { x: 400, y: 60 }); // well past B's back line
      s.matter.body.setVelocity(receiver.body, { x: 0, y: 0 });
      // _doPass throws from wherever the ball actually is (normally kept
      // at the passer's feet by _glueBall while they have it) — since we
      // just teleported the passer, the ball has to be moved to match too,
      // or the pass flies off in the right direction from the wrong spot.
      s.matter.body.setPosition(s.ball, { x: 400, y: 400 });
      s.matter.body.setVelocity(s.ball, { x: 0, y: 0 });

      s.possRole = 'A';
      s._setActive('A', passer.id);
      s._doPass('A', { x: receiver.body.position.x, y: receiver.body.position.y });
    });

    await page.waitForFunction(
      () => window.__scene.confrontResult?.title === '🚩 Offside!',
      { timeout: 5000 }
    );
    expect(await page.evaluate(() => window.__scene.possRole)).toBe('B');
  });

  test('the same pass to a teammate level with or behind the back line is not flagged', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const flagged = await page.evaluate(() => {
      const s = window.__scene;
      s.confrontation = null;

      const bOutfield = s.teamB.filter((e) => e.slot !== 0);
      bOutfield.forEach((e, i) => s.matter.body.setPosition(e.body, { x: 400 + i * 5, y: 300 }));
      const passer = s.teamA.find((e) => e.slot !== 0);
      const receiver = s.teamA.find((e) => e.slot !== 0 && e.id !== passer.id);
      // Pull every other A player well back so only the receiver (not
      // whoever else the live match happened to leave forward) could
      // possibly end up flagged.
      s.teamA.forEach((e) => { if (e.slot !== 0) s.matter.body.setPosition(e.body, { x: 500, y: 1300 }); });
      s.matter.body.setPosition(passer.body, { x: 400, y: 900 });
      s.matter.body.setPosition(receiver.body, { x: 420, y: 500 }); // behind B's back line

      s.possRole = 'A';
      s._setActive('A', passer.id);
      s._doPass('A', { x: receiver.body.position.x, y: receiver.body.position.y });
      return !!(s.offsideFlag && s.offsideFlag.ids.has(receiver.id));
    });

    expect(flagged).toBe(false);
  });

  test('never offside in your own half, even well ahead of the last defender', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const flagged = await page.evaluate(() => {
      const s = window.__scene;
      s.confrontation = null;

      // B's back line pushed forward past halfway (a high defensive line) —
      // the receiver is ahead of it but still in A's own half. Every other
      // A player is pulled back out of B's half too, so only the receiver
      // (not whoever else the live match happened to leave forward) could
      // possibly be flagged.
      const bOutfield = s.teamB.filter((e) => e.slot !== 0);
      bOutfield.forEach((e, i) => s.matter.body.setPosition(e.body, { x: 400 + i * 5, y: 850 }));
      const passer = s.teamA.find((e) => e.slot !== 0);
      const receiver = s.teamA.find((e) => e.slot !== 0 && e.id !== passer.id);
      s.teamA.forEach((e) => { if (e.slot !== 0) s.matter.body.setPosition(e.body, { x: 500, y: 1300 }); });
      s.matter.body.setPosition(passer.body, { x: 400, y: 1200 });
      s.matter.body.setPosition(receiver.body, { x: 420, y: 800 }); // still > 760 (A's own half)

      s.possRole = 'A';
      s._setActive('A', passer.id);
      s._doPass('A', { x: receiver.body.position.x, y: receiver.body.position.y });
      return !!(s.offsideFlag && s.offsideFlag.ids.has(receiver.id));
    });

    expect(flagged).toBe(false);
  });

  test('a receiver behind the deepest outfield defender is not flagged, even with the keeper further back still', async ({ page }) => {
    // Regression test: "second-last defender" has to count the keeper as
    // one of the defenders (they're normally the actual last one) — the
    // receiver here sits behind B's deepest OUTFIELD defender (the real
    // second-last opponent, keeper counted as last), which is onside by
    // law, but a version of _offsideLineDist that excludes the keeper
    // from its distance list ends up using the second-deepest OUTFIELD
    // defender instead — one player too far up — and wrongly flags it.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const flagged = await page.evaluate(() => {
      const s = window.__scene;
      s.confrontation = null;

      const gk = s.teamB.find((e) => e.slot === 0);
      const outfield = s.teamB.filter((e) => e.slot !== 0);
      s.matter.body.setPosition(gk.body, { x: 400, y: 50 }); // deepest of all, near B's own goal
      outfield.forEach((e, i) => s.matter.body.setPosition(e.body, { x: 400 + i * 60, y: 300 + i * 200 }));
      // outfield[0] at y=300 is the true second-last defender (keeper is
      // last); everyone else in outfield sits further back still.

      const passer = s.teamA.find((e) => e.slot !== 0);
      const receiver = s.teamA.find((e) => e.slot !== 0 && e.id !== passer.id);
      s.teamA.forEach((e) => { if (e.slot !== 0) s.matter.body.setPosition(e.body, { x: 500, y: 1300 }); });
      s.matter.body.setPosition(passer.body, { x: 400, y: 900 });
      s.matter.body.setPosition(receiver.body, { x: 420, y: 400 }); // behind outfield[0] (y=300) — onside

      s.possRole = 'A';
      s._setActive('A', passer.id);
      s._doPass('A', { x: receiver.body.position.x, y: receiver.body.position.y });
      return !!(s.offsideFlag && s.offsideFlag.ids.has(receiver.id));
    });

    expect(flagged).toBe(false);
  });
});
