import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('stat influence on confrontations', () => {
  test('a moderate stat gap now wins roughly 60/40, not the old ~54/46', async ({ page }) => {
    // Calibration case for STAT_POWER_EXPONENT: a roster-median dribbler
    // against a roster-median defender. Before the exponent this landed
    // at ~54/46 — barely different from a coin flip despite a real gap in
    // ability. Run over enough trials that the 50% null (no stat effect
    // at all) is many standard deviations away, so this can't pass by luck.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const winRate = await page.evaluate(() => {
      const s = window.__scene;
      const eA = s.teamA.find((e) => e.slot !== 0 && e.body);
      const eB = s.teamB.find((e) => e.slot !== 0 && e.body);
      const stA = s.statsMapA.get(eA.id), stB = s.statsMapB.get(eB.id);
      stA.dribblePower = 1.080; stB.defensePower = 0.920; // roster medians
      stA.element = null; stB.element = null; stA.sp = 0; stB.sp = 0; // no techniques available
      let aWins = 0; const N = 3000;
      for (let i = 0; i < N; i++) {
        s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: eA.id, defenderId: eB.id,
          deadline: s.time.now + 1, attackerChoice: 'normal', defenderChoice: 'normal', attackerLocked: true, pending: null };
        s._prepareConfrontReveal(s.time.now);
        if (s.confrontation.pending.aWins) aWins++;
      }
      return aWins / N;
    });

    expect(winRate).toBeGreaterThan(0.56); // clearly past the old ~54%
    expect(winRate).toBeLessThan(0.64);    // and not overshooting into a near-lock
  });

  test('a real supertechnique still beats a plain stat edge', async ({ page }) => {
    // The exponent amplifies stats, but a well-picked technique (power
    // 61-110) must still swing a confrontation far more than any stat gap
    // does — otherwise spending PT would stop mattering. A worse-stat
    // attacker armed with their best technique against a better-stat
    // defender with none should still win clearly more often than not.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const winRate = await page.evaluate(() => {
      const s = window.__scene;
      const eA = s.teamA.find((e) => e.slot !== 0 && e.body);
      const eB = s.teamB.find((e) => e.slot !== 0 && e.body);
      const stA = s.statsMapA.get(eA.id), stB = s.statsMapB.get(eB.id);
      stA.dribblePower = 0.880; stB.defensePower = 1.090; // worse attacker, better defender
      stA.element = null; stB.element = null;
      // Whoever randomize-top happened to put in this slot may not have a
      // 'dribble' move at all (not every player does — techniques are
      // per-category, per-character; see techniquesFor) — synthesize one
      // of known, roster-typical power (82, matching a real example) so
      // this test is about the formula, not which random player was drawn.
      stA.techniques = { shot: null, dribble: { name: 'Test Technique', cost: 10, power: 82, cooldown: 0 }, defense: null, keeper: null };
      stA.techniquesExtra = [];
      let aWins = 0, normalPicks = 0; const N = 1500;
      for (let i = 0; i < N; i++) {
        stA.sp = 999; stB.sp = 0;
        const choice = s._bestTechChoice(stA, 'dribble');
        if (choice === 'normal') normalPicks++;
        s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: eA.id, defenderId: eB.id,
          deadline: s.time.now + 1, attackerChoice: choice, defenderChoice: 'normal', attackerLocked: true, pending: null };
        s._prepareConfrontReveal(s.time.now);
        if (s.confrontation.pending.aWins) aWins++;
      }
      return { winRate: aWins / N, normalPicks };
    });

    // Sanity: the synthetic technique was actually picked every time —
    // otherwise this would silently degrade into testing the stat-only
    // case again, same as the flake this replaced.
    expect(winRate.normalPicks).toBe(0);
    expect(winRate.winRate).toBeGreaterThan(0.6);
  });

  test('equal stats and no techniques still land at an even 50/50', async ({ page }) => {
    // A sanity check that the exponent doesn't introduce a bias of its own
    // — a ratio of exactly 1 must stay exactly 1 whatever power it's
    // raised to.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const winRate = await page.evaluate(() => {
      const s = window.__scene;
      const eA = s.teamA.find((e) => e.slot !== 0 && e.body);
      const eB = s.teamB.find((e) => e.slot !== 0 && e.body);
      const stA = s.statsMapA.get(eA.id), stB = s.statsMapB.get(eB.id);
      stA.dribblePower = 1.0; stB.defensePower = 1.0;
      stA.element = null; stB.element = null; stA.sp = 0; stB.sp = 0;
      let aWins = 0; const N = 3000;
      for (let i = 0; i < N; i++) {
        s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: eA.id, defenderId: eB.id,
          deadline: s.time.now + 1, attackerChoice: 'normal', defenderChoice: 'normal', attackerLocked: true, pending: null };
        s._prepareConfrontReveal(s.time.now);
        if (s.confrontation.pending.aWins) aWins++;
      }
      return aWins / N;
    });

    expect(winRate).toBeGreaterThan(0.46);
    expect(winRate).toBeLessThan(0.54);
  });
});
